mod export;
mod llm;
mod project;
mod settings;

use std::sync::Mutex;
use std::time::Duration;

use base64::Engine;
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, State};

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
    dev_open: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ExportResult {
    path: String,
    browser: Option<String>,
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
) -> Result<SettingsView, String> {
    let mut settings = state.settings.lock().unwrap();
    settings.base_url = base_url.trim().trim_end_matches('/').to_string();
    settings.model = model.trim().to_string();
    settings.remember_key = remember_key;
    if let Some(key) = api_key {
        let key = key.trim().to_string();
        if !key.is_empty() {
            settings.api_key = key;
        }
    }
    if settings.base_url.is_empty() {
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
        dev_open: std::env::var("AFFICHE_STUDIO_OPEN").ok(),
    }
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
) -> Result<project::Project, String> {
    project::create(&state.projects_dir, &name, width, height)
}

#[tauri::command]
fn open_project(state: State<'_, AppState>, project_id: String) -> Result<project::Project, String> {
    project::open(&state.projects_dir, &project_id)
}

#[tauri::command]
fn delete_project(state: State<'_, AppState>, project_id: String) -> Result<(), String> {
    let dir = project::project_dir(&state.projects_dir, &project_id)?;
    std::fs::remove_dir_all(dir).map_err(|e| e.to_string())
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
fn save_poster(
    state: State<'_, AppState>,
    project_id: String,
    html: String,
) -> Result<(), String> {
    project::save_html(&state.projects_dir, &project_id, &html)
}

#[tauri::command]
fn preview_html(state: State<'_, AppState>, project_id: String) -> Result<String, String> {
    project::preview_html(&state.projects_dir, &project_id)
}

#[tauri::command]
async fn generate_poster(
    app: AppHandle,
    state: State<'_, AppState>,
    project_id: String,
    prompt: String,
) -> Result<String, String> {
    if prompt.trim().is_empty() {
        return Err("Décrivez l'affiche que vous voulez générer.".into());
    }

    let project = project::open(&state.projects_dir, &project_id)?;
    let assets: Vec<String> = project.assets.iter().map(|a| a.name.clone()).collect();

    let config = {
        let settings = state.settings.lock().unwrap();
        llm::LlmConfig {
            base_url: settings.base_url.clone(),
            model: settings.model.clone(),
            api_key: settings.api_key.clone(),
        }
    };

    let messages = llm::build_messages(&project.meta, &assets, &[], &prompt, &project.html);

    let _ = app.emit("gen-stage", serde_json::json!({"stage": "connexion"}));

    let result = llm::generate(&state.client, &config, messages, |chunk| {
        let _ = app.emit("gen-chunk", serde_json::json!({ "text": chunk }));
    })
    .await;

    match result {
        Ok(html) => {
            project::save_html(&state.projects_dir, &project_id, &html)?;
            let _ = app.emit("gen-done", serde_json::json!({ "html": html }));
            Ok(html)
        }
        Err(message) => {
            let _ = app.emit("gen-error", serde_json::json!({ "message": message }));
            Err(message)
        }
    }
}

#[tauri::command]
fn export_png(state: State<'_, AppState>, project_id: String) -> Result<ExportResult, String> {
    let dir = project::project_dir(&state.projects_dir, &project_id)?;
    let project = project::open(&state.projects_dir, &project_id)?;
    if project.html.trim().is_empty() {
        return Err("Générez d'abord une affiche.".into());
    }
    let html = project::preview_html(&state.projects_dir, &project_id)?;
    let render_file = project::write_render_file(&state.projects_dir, &project_id, &html)?;

    let browser = export::find_browser().ok_or_else(|| {
        "Aucun navigateur compatible trouvé. Installez Google Chrome, Chromium ou Microsoft Edge."
            .to_string()
    })?;

    let exports = dir.join("exports");
    std::fs::create_dir_all(&exports).map_err(|e| e.to_string())?;
    let filename = format!(
        "{}-{}.png",
        project::slugify(&project.meta.name),
        chrono::Local::now().format("%Y%m%d-%H%M%S")
    );
    let out = exports.join(filename);
    export::render_png(
        &browser,
        &render_file,
        &out,
        project.meta.width,
        project.meta.height,
    )?;

    Ok(ExportResult {
        path: out.to_string_lossy().to_string(),
        browser: Some(browser.to_string_lossy().to_string()),
    })
}

#[tauri::command]
fn export_html(state: State<'_, AppState>, project_id: String) -> Result<ExportResult, String> {
    let dir = project::project_dir(&state.projects_dir, &project_id)?;
    let project = project::open(&state.projects_dir, &project_id)?;
    if project.html.trim().is_empty() {
        return Err("Générez d'abord une affiche.".into());
    }
    let html = project::preview_html(&state.projects_dir, &project_id)?;
    let exports = dir.join("exports");
    std::fs::create_dir_all(&exports).map_err(|e| e.to_string())?;
    let filename = format!(
        "{}-{}.html",
        project::slugify(&project.meta.name),
        chrono::Local::now().format("%Y%m%d-%H%M%S")
    );
    let out = exports.join(filename);
    std::fs::write(&out, html).map_err(|e| e.to_string())?;
    Ok(ExportResult {
        path: out.to_string_lossy().to_string(),
        browser: None,
    })
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
            import_asset,
            save_poster,
            preview_html,
            generate_poster,
            export_png,
            export_html,
            reveal_path
        ])
        .run(tauri::generate_context!())
        .expect("erreur au lancement d'Affiche Studio");
}
