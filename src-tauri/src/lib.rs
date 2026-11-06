mod document;
mod export;
mod llm;
mod project;
mod settings;

use std::sync::Mutex;
use std::time::Duration;

use base64::Engine;
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, State};

use document::Document;
use settings::{Settings, SettingsView};

pub struct AppState {
    pub projects_dir: std::path::PathBuf,
    pub config_dir: std::path::PathBuf,
    pub client: reqwest::Client,
    pub settings: Mutex<Settings>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Environment {
    browser: Option<String>,
    has_key: bool,
    projects_dir: String,
    version: String,
    opencode: Option<String>,
    dev_open: Option<String>,
    dev_theme: Option<String>,
    dev_lang: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ExportResult {
    path: String,
    browser: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct UpdateInfo {
    available: bool,
    current_version: String,
    version: Option<String>,
    notes: Option<String>,
    date: Option<String>,
    can_auto_install: bool,
}

fn can_auto_install() -> bool {
    #[cfg(target_os = "linux")]
    {
        return std::env::var_os("APPIMAGE").is_some();
    }
    #[cfg(windows)]
    {
        return true;
    }
    #[cfg(target_os = "macos")]
    {
        return false;
    }
    #[allow(unreachable_code)]
    false
}

#[tauri::command]
fn get_settings(state: State<'_, AppState>) -> SettingsView {
    state.settings.lock().unwrap().view()
}

#[tauri::command]
fn save_settings(
    state: State<'_, AppState>,
    base_url: String,
    model: String,
    api_key: Option<String>,
    remember_key: bool,
    reasoning_effort: Option<String>,
    backend: Option<String>,
) -> Result<SettingsView, String> {
    let mut settings = state.settings.lock().unwrap();
    let backend = backend
        .map(|value| value.trim().to_ascii_lowercase())
        .unwrap_or_else(|| "api".to_string());
    settings.backend = if backend == "opencode" { "opencode".into() } else { "api".into() };
    settings.base_url = base_url.trim().trim_end_matches('/').to_string();
    settings.model = model.trim().to_string();
    settings.remember_key = remember_key;
    if let Some(key) = api_key {
        let key = key.trim().to_string();
        if !key.is_empty() {
            settings.api_key = key;
        }
    }
    settings.reasoning_effort = reasoning_effort
        .map(|v| v.trim().to_ascii_lowercase())
        .filter(|v| !v.is_empty() && v != "default");
    if settings.backend == "api" && settings.base_url.is_empty() {
        return Err("L'URL de l'API est vide.".into());
    }
    if settings.model.is_empty() {
        return Err("Le nom du modèle est vide.".into());
    }
    settings
        .save(&state.config_dir)
        .map_err(|e| format!("Impossible d'enregistrer les réglages : {e}"))?;
    Ok(settings.view())
}

#[tauri::command]
fn clear_api_key(state: State<'_, AppState>) -> Result<SettingsView, String> {
    let mut settings = state.settings.lock().unwrap();
    settings.api_key.clear();
    settings
        .save(&state.config_dir)
        .map_err(|e| format!("Impossible d'enregistrer les réglages : {e}"))?;
    Ok(settings.view())
}

#[tauri::command]
fn environment(state: State<'_, AppState>) -> Environment {
    Environment {
        browser: export::find_browser().map(|p| p.to_string_lossy().to_string()),
        has_key: !state.settings.lock().unwrap().api_key.is_empty(),
        projects_dir: state.projects_dir.to_string_lossy().to_string(),
        version: env!("CARGO_PKG_VERSION").to_string(),
        opencode: find_opencode().map(|p| p.to_string_lossy().to_string()),
        dev_open: std::env::var("AFFICHE_STUDIO_OPEN").ok(),
        dev_theme: std::env::var("AFFICHE_STUDIO_THEME").ok(),
        dev_lang: std::env::var("AFFICHE_STUDIO_LANG").ok(),
    }
}

fn find_opencode() -> Option<std::path::PathBuf> {
    #[allow(unused_mut)]
    let mut names = vec!["opencode".to_string()];
    #[cfg(windows)]
    names.push("opencode.exe".to_string());

    if let Some(path) = std::env::var_os("PATH") {
        for dir in std::env::split_paths(&path) {
            for name in &names {
                let candidate = dir.join(name);
                if candidate.is_file() {
                    return Some(candidate);
                }
            }
        }
    }

    // Les apps lancées depuis le bureau n'ont pas toujours le PATH du shell.
    let home = std::env::var_os("HOME")
        .or_else(|| std::env::var_os("USERPROFILE"))
        .map(std::path::PathBuf::from);
    if let Some(home) = home {
        for relative in [
            ".opencode/bin/opencode",
            ".local/bin/opencode",
            ".bun/bin/opencode",
            ".cargo/bin/opencode",
            "bin/opencode",
            ".local/share/opencode/bin/opencode",
        ] {
            let candidate = home.join(relative);
            if candidate.is_file() {
                return Some(candidate);
            }
        }
    }
    for absolute in ["/usr/local/bin/opencode", "/usr/bin/opencode", "/opt/opencode/bin/opencode"] {
        let candidate = std::path::PathBuf::from(absolute);
        if candidate.is_file() {
            return Some(candidate);
        }
    }
    None
}

#[tauri::command]
fn list_projects(state: State<'_, AppState>) -> Vec<project::ProjectMeta> {
    project::list(&state.projects_dir)
}

#[tauri::command]
fn create_project(
    state: State<'_, AppState>,
    name: String,
    width: u32,
    height: u32,
    language: String,
    palette: Option<Vec<String>>,
) -> Result<project::Project, String> {
    project::create(
        &state.projects_dir,
        &name,
        width,
        height,
        &language,
        palette,
    )
}

#[tauri::command]
fn open_project(state: State<'_, AppState>, project_id: String) -> Result<project::Project, String> {
    project::open(&state.projects_dir, &project_id)
}

#[tauri::command]
fn delete_project(state: State<'_, AppState>, project_id: String) -> Result<(), String> {
    project::delete(&state.projects_dir, &project_id)
}

#[tauri::command]
fn duplicate_project(
    state: State<'_, AppState>,
    project_id: String,
) -> Result<project::Project, String> {
    project::duplicate(&state.projects_dir, &project_id)
}

#[tauri::command]
fn update_project_meta(
    state: State<'_, AppState>,
    project_id: String,
    name: Option<String>,
    language: Option<String>,
    palette: Option<Vec<String>>,
) -> Result<project::ProjectMeta, String> {
    project::update_meta(&state.projects_dir, &project_id, name, language, palette)
}

#[tauri::command]
fn import_asset(
    state: State<'_, AppState>,
    project_id: String,
    name: String,
    data_base64: String,
) -> Result<project::Asset, String> {
    let payload = data_base64
        .split_once(',')
        .map(|(_, b)| b)
        .unwrap_or(&data_base64);
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(payload.trim())
        .map_err(|e| format!("Fichier illisible : {e}"))?;
    project::import_asset(&state.projects_dir, &project_id, &name, &bytes)
}

#[tauri::command]
fn save_document(
    state: State<'_, AppState>,
    project_id: String,
    document: Document,
) -> Result<project::ProjectMeta, String> {
    project::save_document(&state.projects_dir, &project_id, &document)
}

#[tauri::command]
fn save_chat(
    state: State<'_, AppState>,
    project_id: String,
    chat: Vec<project::ChatMessage>,
) -> Result<(), String> {
    project::save_chat(&state.projects_dir, &project_id, &chat)
}

#[tauri::command]
fn save_version(
    state: State<'_, AppState>,
    project_id: String,
) -> Result<project::VersionInfo, String> {
    project::save_version(&state.projects_dir, &project_id)
}

#[tauri::command]
fn list_versions(
    state: State<'_, AppState>,
    project_id: String,
) -> Result<Vec<project::VersionInfo>, String> {
    project::list_versions(&state.projects_dir, &project_id)
}

#[tauri::command]
fn restore_version(
    state: State<'_, AppState>,
    project_id: String,
    version: String,
) -> Result<Document, String> {
    project::restore_version(&state.projects_dir, &project_id, &version)
}

#[tauri::command]
async fn generate_design(
    app: AppHandle,
    state: State<'_, AppState>,
    project_id: String,
    instruction: String,
    regenerate: bool,
    selected: Vec<String>,
) -> Result<Document, String> {
    if instruction.trim().is_empty() {
        return Err("Décrivez l'affiche ou la modification souhaitée.".into());
    }

    let project = project::open(&state.projects_dir, &project_id)?;
    let assets: Vec<String> = project.assets.iter().map(|a| a.name.clone()).collect();

    let config = {
        let settings = state.settings.lock().unwrap();
        llm::LlmConfig {
            base_url: settings.base_url.clone(),
            model: settings.model.clone(),
            api_key: settings.api_key.clone(),
            reasoning_effort: settings.reasoning_effort.clone(),
            session_id: project_id.clone(),
        }
    };

    let messages = llm::build_messages(
        &project.meta,
        Some(&project.document),
        &selected,
        &assets,
        &instruction,
        regenerate,
    );

    let _ = app.emit("gen-stage", serde_json::json!({"stage": "connexion"}));

    let result = llm::generate(&state.client, &config, messages, |chunk| {
        let _ = app.emit("gen-chunk", serde_json::json!({ "text": chunk }));
    })
    .await;

    match result {
        Ok(document) => {
            let _ = project::save_document(&state.projects_dir, &project_id, &document);
            let _ = app.emit("gen-done", serde_json::json!({ "document": document }));
            Ok(document)
        }
        Err(message) => {
            let _ = app.emit("gen-error", serde_json::json!({ "message": message }));
            Err(message)
        }
    }
}

#[tauri::command]
fn export_png(
    state: State<'_, AppState>,
    project_id: String,
    html: String,
    scale: u32,
) -> Result<ExportResult, String> {
    let dir = project::project_dir(&state.projects_dir, &project_id)?;
    let project = project::open(&state.projects_dir, &project_id)?;
    let scale = scale.clamp(1, 4);
    let render_file = project::write_render_file(&state.projects_dir, &project_id, &html)?;

    let browser = export::find_browser().ok_or_else(|| {
        "Aucun navigateur compatible trouvé. Installez Google Chrome, Chromium ou Microsoft Edge."
            .to_string()
    })?;

    let exports = dir.join("exports");
    std::fs::create_dir_all(&exports).map_err(|e| e.to_string())?;
    let filename = format!(
        "{}-{}-{}x.png",
        project::slugify(&project.meta.name),
        chrono::Local::now().format("%Y%m%d-%H%M%S"),
        scale
    );
    let out = exports.join(filename);
    export::render_png(
        &browser,
        &render_file,
        &out,
        project.meta.width,
        project.meta.height,
        scale,
    )?;

    Ok(ExportResult {
        path: out.to_string_lossy().to_string(),
        browser: Some(browser.to_string_lossy().to_string()),
    })
}

#[tauri::command]
fn export_pdf(
    state: State<'_, AppState>,
    project_id: String,
    html: String,
) -> Result<ExportResult, String> {
    let dir = project::project_dir(&state.projects_dir, &project_id)?;
    let project = project::open(&state.projects_dir, &project_id)?;
    let render_file = project::write_render_file(&state.projects_dir, &project_id, &html)?;

    let browser = export::find_browser().ok_or_else(|| {
        "Aucun navigateur compatible trouvé. Installez Google Chrome, Chromium ou Microsoft Edge."
            .to_string()
    })?;

    let exports = dir.join("exports");
    std::fs::create_dir_all(&exports).map_err(|e| e.to_string())?;
    let filename = format!(
        "{}-{}.pdf",
        project::slugify(&project.meta.name),
        chrono::Local::now().format("%Y%m%d-%H%M%S")
    );
    let out = exports.join(filename);
    export::render_pdf(&browser, &render_file, &out)?;

    Ok(ExportResult {
        path: out.to_string_lossy().to_string(),
        browser: Some(browser.to_string_lossy().to_string()),
    })
}

#[tauri::command]
fn export_html(
    state: State<'_, AppState>,
    project_id: String,
    html: String,
) -> Result<ExportResult, String> {
    let project = project::open(&state.projects_dir, &project_id)?;
    let filename = format!(
        "{}-{}.html",
        project::slugify(&project.meta.name),
        chrono::Local::now().format("%Y%m%d-%H%M%S")
    );
    let path = project::write_export(&state.projects_dir, &project_id, &filename, &html)?;
    Ok(ExportResult {
        path,
        browser: None,
    })
}

#[tauri::command]
async fn check_update(app: AppHandle) -> Result<UpdateInfo, String> {
    use tauri_plugin_updater::UpdaterExt;
    let current_version = app.package_info().version.to_string();
    let updater = app.updater().map_err(|e| e.to_string())?;
    let update = updater.check().await.map_err(|e| e.to_string())?;
    Ok(match update {
        Some(update) => UpdateInfo {
            available: true,
            current_version,
            version: Some(update.version.clone()),
            notes: update.body.clone(),
            date: update.date.map(|value| value.to_string()),
            can_auto_install: can_auto_install(),
        },
        None => UpdateInfo {
            available: false,
            current_version,
            version: None,
            notes: None,
            date: None,
            can_auto_install: can_auto_install(),
        },
    })
}

#[tauri::command]
async fn install_update(app: AppHandle) -> Result<(), String> {
    use tauri_plugin_updater::UpdaterExt;
    let updater = app.updater().map_err(|e| e.to_string())?;
    let update = updater.check().await.map_err(|e| e.to_string())?;
    if let Some(update) = update {
        update
            .download_and_install(
                |chunk, total| {
                    let _ = app.emit(
                        "update-progress",
                        serde_json::json!({ "chunk": chunk, "total": total }),
                    );
                },
                || {
                    let _ = app.emit("update-downloaded", serde_json::json!({}));
                },
            )
            .await
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
fn open_url(url: String) -> Result<(), String> {
    if !(url.starts_with("https://") || url.starts_with("http://")) {
        return Err("URL invalide.".into());
    }
    export::open_url(&url)
}

#[tauri::command]
fn reveal_path(path: String) -> Result<(), String> {
    let path = std::path::PathBuf::from(path);
    let target = if path.is_file() {
        path.parent().map(|p| p.to_path_buf()).unwrap_or(path)
    } else {
        path
    };
    if !target.exists() {
        return Err("Dossier introuvable.".into());
    }
    export::reveal(&target)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_updater::Builder::new().build())
        .setup(|app| {
            let data_dir = app
                .path()
                .app_data_dir()
                .map_err(|e| format!("Dossier de données introuvable : {e}"))?;
            let projects_dir = data_dir.join("projects");
            std::fs::create_dir_all(&projects_dir)?;

            let config_dir = app
                .path()
                .app_config_dir()
                .map_err(|e| format!("Dossier de configuration introuvable : {e}"))?;
            std::fs::create_dir_all(&config_dir)?;

            let settings = Settings::load(&config_dir);
            let client = reqwest::Client::builder()
                .connect_timeout(Duration::from_secs(20))
                .build()?;

            app.manage(AppState {
                projects_dir,
                config_dir,
                client,
                settings: Mutex::new(settings),
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_settings,
            save_settings,
            clear_api_key,
            environment,
            list_projects,
            create_project,
            open_project,
            delete_project,
            duplicate_project,
            update_project_meta,
            import_asset,
            save_document,
            save_chat,
            save_version,
            list_versions,
            restore_version,
            generate_design,
            export_png,
            export_pdf,
            export_html,
            check_update,
            install_update,
            open_url,
            reveal_path
        ])
        .run(tauri::generate_context!())
        .expect("erreur au lancement d'Affiche Studio");
}
