use base64::Engine;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};

use crate::document::{Document, DEFAULT_PALETTE};

pub const IMAGE_EXTENSIONS: &[&str] = &["png", "jpg", "jpeg", "webp", "gif", "svg", "avif"];
const MAX_VERSIONS: usize = 40;

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectMeta {
    pub version: u32,
    pub id: String,
    pub name: String,
    pub width: u32,
    pub height: u32,
    pub language: String,
    pub palette: Vec<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ChatMessage {
    pub role: String,
    pub content: String,
    pub at: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Asset {
    pub name: String,
    pub data_url: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Project {
    #[serde(flatten)]
    pub meta: ProjectMeta,
    pub document: Document,
    pub chat: Vec<ChatMessage>,
    pub assets: Vec<Asset>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VersionInfo {
    pub id: String,
    pub created_at: String,
    pub layers: usize,
}

fn safe_id(id: &str) -> Result<&str, String> {
    if id.is_empty()
        || id.len() > 128
        || !id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
    {
        return Err("Identifiant de projet invalide.".into());
    }
    Ok(id)
}

pub fn slugify(name: &str) -> String {
    let mut out = String::new();
    let mut last_dash = false;
    for c in name.chars().flat_map(|c| c.to_lowercase()) {
        if c.is_ascii_alphanumeric() {
            out.push(c);
            last_dash = false;
        } else if !last_dash {
            out.push('-');
            last_dash = true;
        }
    }
    let trimmed = out.trim_matches('-').to_string();
    if trimmed.is_empty() {
        "affiche".to_string()
    } else {
        trimmed.chars().take(40).collect()
    }
}

pub fn sanitize_filename(name: &str) -> String {
    let base = Path::new(name)
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("asset");
    let mut out = String::new();
    for c in base.chars() {
        if c.is_ascii_alphanumeric() || matches!(c, '.' | '-' | '_') {
            out.push(c);
        } else {
            out.push('_');
        }
    }
    let out = out.trim_matches('.').trim_matches('_').to_string();
    if out.is_empty() {
        "asset".to_string()
    } else {
        out.chars().take(120).collect()
    }
}

pub fn mime_from_ext(path: &Path) -> &'static str {
    match path
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_ascii_lowercase()
        .as_str()
    {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "webp" => "image/webp",
        "gif" => "image/gif",
        "svg" => "image/svg+xml",
        "avif" => "image/avif",
        "woff" => "font/woff",
        "woff2" => "font/woff2",
        "ttf" => "font/ttf",
        "otf" => "font/otf",
        _ => "application/octet-stream",
    }
}

fn unique_path(dir: &Path, name: &str) -> PathBuf {
    let candidate = dir.join(name);
    if !candidate.exists() {
        return candidate;
    }
    let path = Path::new(name);
    let stem = path.file_stem().and_then(|s| s.to_str()).unwrap_or("asset");
    let ext = path.extension().and_then(|s| s.to_str()).unwrap_or("");
    for i in 1..10_000 {
        let file = if ext.is_empty() {
            format!("{stem}-{i}")
        } else {
            format!("{stem}-{i}.{ext}")
        };
        let candidate = dir.join(file);
        if !candidate.exists() {
            return candidate;
        }
    }
    dir.join(format!("asset-{}", uuid::Uuid::new_v4()))
}

pub fn project_dir(root: &Path, id: &str) -> Result<PathBuf, String> {
    Ok(root.join(safe_id(id)?))
}

fn read_meta(dir: &Path) -> Option<ProjectMeta> {
    let raw = fs::read_to_string(dir.join("project.json")).ok()?;
    serde_json::from_str(&raw).ok()
}

fn read_document(dir: &Path) -> Document {
    let raw = match fs::read_to_string(dir.join("document.json")) {
        Ok(raw) => raw,
        Err(error) => {
            eprintln!("document read error: {error}");
            return Document::default();
        }
    };
    match serde_json::from_str::<Document>(&raw) {
        Ok(document) => document,
        Err(error) => {
            eprintln!("document parse error: {error}");
            Document::default()
        }
    }
}

fn read_chat(dir: &Path) -> Vec<ChatMessage> {
    fs::read_to_string(dir.join("chat.json"))
        .ok()
        .and_then(|raw| serde_json::from_str::<Vec<ChatMessage>>(&raw).ok())
        .unwrap_or_default()
}

pub fn list_assets(dir: &Path) -> Vec<Asset> {
    let mut assets = Vec::new();
    let asset_dir = dir.join("assets");
    if let Ok(entries) = fs::read_dir(&asset_dir) {
        let mut files: Vec<_> = entries.flatten().map(|e| e.path()).collect();
        files.sort();
        for path in files {
            if !path.is_file() {
                continue;
            }
            let name = match path.file_name().and_then(|n| n.to_str()) {
                Some(n) => n.to_string(),
                None => continue,
            };
            let ext = path
                .extension()
                .and_then(|e| e.to_str())
                .unwrap_or("")
                .to_ascii_lowercase();
            if !IMAGE_EXTENSIONS.contains(&ext.as_str()) && ext != "woff" && ext != "woff2" {
                continue;
            }
            if let Ok(bytes) = fs::read(&path) {
                let data_url = format!(
                    "data:{};base64,{}",
                    mime_from_ext(&path),
                    base64::engine::general_purpose::STANDARD.encode(bytes)
                );
                assets.push(Asset { name, data_url });
            }
        }
    }
    assets
}

pub fn create(
    root: &Path,
    name: &str,
    width: u32,
    height: u32,
    language: &str,
    palette: Option<Vec<String>>,
) -> Result<Project, String> {
    let name = name.trim();
    if name.is_empty() {
        return Err("Le nom du projet est vide.".into());
    }
    if width < 200 || height < 200 || width > 8000 || height > 8000 {
        return Err("Dimensions invalides (200 à 8000 px).".into());
    }
    let language = if matches!(language, "fr" | "en" | "es") {
        language
    } else {
        "fr"
    };
    let palette = palette
        .unwrap_or_else(|| DEFAULT_PALETTE.iter().map(|c| c.to_string()).collect());

    let slug = slugify(name);
    let id = format!("{}-{}", slug, &uuid::Uuid::new_v4().to_string()[..8]);
    let dir = root.join(&id);
    fs::create_dir_all(dir.join("assets")).map_err(|e| e.to_string())?;
    fs::create_dir_all(dir.join("exports")).map_err(|e| e.to_string())?;
    fs::create_dir_all(dir.join("versions")).map_err(|e| e.to_string())?;

    let now = chrono::Utc::now().to_rfc3339();
    let meta = ProjectMeta {
        version: 2,
        id,
        name: name.to_string(),
        width,
        height,
        language: language.to_string(),
        palette: palette.clone(),
        created_at: now.clone(),
        updated_at: now,
    };
    let background = palette
        .first()
        .cloned()
        .unwrap_or_else(|| "#0b0b0e".to_string());
    let document = Document::new(width, height, &background, palette);
    fs::write(
        dir.join("project.json"),
        serde_json::to_string_pretty(&meta).map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())?;
    fs::write(
        dir.join("document.json"),
        serde_json::to_string_pretty(&document).map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())?;
    fs::write(dir.join("chat.json"), "[]").map_err(|e| e.to_string())?;

    Ok(Project {
        meta,
        document,
        chat: vec![],
        assets: vec![],
    })
}

pub fn list(root: &Path) -> Vec<ProjectMeta> {
    let mut projects = Vec::new();
    if let Ok(entries) = fs::read_dir(root) {
        for entry in entries.flatten() {
            let dir = entry.path();
            if !dir.is_dir() || !dir.join("document.json").is_file() {
                continue;
            }
            if let Some(meta) = read_meta(&dir) {
                projects.push(meta);
            }
        }
    }
    projects.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
    projects
}

pub fn open(root: &Path, id: &str) -> Result<Project, String> {
    let dir = project_dir(root, id)?;
    if !dir.is_dir() {
        return Err("Projet introuvable.".into());
    }
    let meta = read_meta(&dir).ok_or("Métadonnées du projet illisibles.")?;
    let mut document = read_document(&dir);
    document.normalize();
    let chat = read_chat(&dir);
    let assets = list_assets(&dir);
    Ok(Project {
        meta,
        document,
        chat,
        assets,
    })
}

pub fn save_document(root: &Path, id: &str, document: &Document) -> Result<ProjectMeta, String> {
    let dir = project_dir(root, id)?;
    if !dir.is_dir() {
        return Err("Projet introuvable.".into());
    }
    let mut document = document.clone();
    document.normalize();
    fs::write(
        dir.join("document.json"),
        serde_json::to_string_pretty(&document).map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())?;

    let mut meta = read_meta(&dir).ok_or("Métadonnées du projet illisibles.")?;
    meta.updated_at = chrono::Utc::now().to_rfc3339();
    fs::write(
        dir.join("project.json"),
        serde_json::to_string_pretty(&meta).map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())?;
    Ok(meta)
}

pub fn update_meta(
    root: &Path,
    id: &str,
    name: Option<String>,
    language: Option<String>,
    palette: Option<Vec<String>>,
) -> Result<ProjectMeta, String> {
    let dir = project_dir(root, id)?;
    let mut meta = read_meta(&dir).ok_or("Métadonnées du projet illisibles.")?;
    if let Some(name) = name {
        if !name.trim().is_empty() {
            meta.name = name.trim().to_string();
        }
    }
    if let Some(language) = language {
        if matches!(language.as_str(), "fr" | "en" | "es") {
            meta.language = language;
        }
    }
    if let Some(palette) = palette {
        if palette.len() >= 2 {
            meta.palette = palette;
        }
    }
    meta.updated_at = chrono::Utc::now().to_rfc3339();
    fs::write(
        dir.join("project.json"),
        serde_json::to_string_pretty(&meta).map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())?;
    Ok(meta)
}

pub fn save_chat(root: &Path, id: &str, chat: &[ChatMessage]) -> Result<(), String> {
    let dir = project_dir(root, id)?;
    fs::write(
        dir.join("chat.json"),
        serde_json::to_string_pretty(chat).map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())
}

pub fn import_asset(
    root: &Path,
    id: &str,
    filename: &str,
    bytes: &[u8],
) -> Result<Asset, String> {
    let dir = project_dir(root, id)?;
    if !dir.is_dir() {
        return Err("Projet introuvable.".into());
    }
    if bytes.is_empty() {
        return Err("Fichier vide.".into());
    }
    if bytes.len() > 40 * 1024 * 1024 {
        return Err("Fichier trop volumineux (40 Mo max).".into());
    }
    let name = sanitize_filename(filename);
    let path = unique_path(&dir.join("assets"), &name);
    fs::write(&path, bytes).map_err(|e| e.to_string())?;
    let final_name = path
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("asset")
        .to_string();
    Ok(Asset {
        name: final_name,
        data_url: format!(
            "data:{};base64,{}",
            mime_from_ext(&path),
            base64::engine::general_purpose::STANDARD.encode(bytes)
        ),
    })
}

pub fn save_version(root: &Path, id: &str) -> Result<VersionInfo, String> {
    let dir = project_dir(root, id)?;
    let document = read_document(&dir);
    let versions = dir.join("versions");
    fs::create_dir_all(&versions).map_err(|e| e.to_string())?;
    let stamp = chrono::Local::now().format("%Y%m%d-%H%M%S").to_string();
    let filename = format!("{stamp}.json");
    fs::write(
        versions.join(&filename),
        serde_json::to_string_pretty(&document).map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())?;

    if let Ok(entries) = fs::read_dir(&versions) {
        let mut files: Vec<_> = entries
            .flatten()
            .map(|e| e.path())
            .filter(|p| p.extension().and_then(|e| e.to_str()) == Some("json"))
            .collect();
        files.sort();
        while files.len() > MAX_VERSIONS {
            if let Some(old) = files.first() {
                let _ = fs::remove_file(old);
            }
            files.remove(0);
        }
    }

    Ok(VersionInfo {
        id: stamp,
        created_at: chrono::Local::now().to_rfc3339(),
        layers: document.layers.len(),
    })
}

pub fn list_versions(root: &Path, id: &str) -> Result<Vec<VersionInfo>, String> {
    let dir = project_dir(root, id)?;
    let versions = dir.join("versions");
    let mut out = Vec::new();
    if let Ok(entries) = fs::read_dir(&versions) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.extension().and_then(|e| e.to_str()) != Some("json") {
                continue;
            }
            let Some(stem) = path.file_stem().and_then(|s| s.to_str()) else {
                continue;
            };
            let layers = fs::read_to_string(&path)
                .ok()
                .and_then(|raw| serde_json::from_str::<Document>(&raw).ok())
                .map(|d| d.layers.len())
                .unwrap_or(0);
            out.push(VersionInfo {
                id: stem.to_string(),
                created_at: stem.to_string(),
                layers,
            });
        }
    }
    out.sort_by(|a, b| b.id.cmp(&a.id));
    Ok(out)
}

pub fn restore_version(root: &Path, id: &str, version: &str) -> Result<Document, String> {
    let dir = project_dir(root, id)?;
    if !version
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
    {
        return Err("Version invalide.".into());
    }
    let raw = fs::read_to_string(dir.join("versions").join(format!("{version}.json")))
        .map_err(|_| "Version introuvable.".to_string())?;
    let mut document: Document = serde_json::from_str(&raw).map_err(|e| e.to_string())?;
    document.normalize();
    save_document(root, id, &document)?;
    Ok(document)
}

pub fn duplicate(root: &Path, id: &str) -> Result<Project, String> {
    let source = project_dir(root, id)?;
    let meta = read_meta(&source).ok_or("Projet introuvable.")?;
    let document = read_document(&source);
    let chat = read_chat(&source);

    let slug = slugify(&format!("{} copie", meta.name));
    let new_id = format!("{}-{}", slug, &uuid::Uuid::new_v4().to_string()[..8]);
    let target = root.join(&new_id);
    fs::create_dir_all(target.join("assets")).map_err(|e| e.to_string())?;
    fs::create_dir_all(target.join("exports")).map_err(|e| e.to_string())?;
    fs::create_dir_all(target.join("versions")).map_err(|e| e.to_string())?;

    if let Ok(entries) = fs::read_dir(source.join("assets")) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_file() {
                if let Some(name) = path.file_name() {
                    let _ = fs::copy(&path, target.join("assets").join(name));
                }
            }
        }
    }

    let now = chrono::Utc::now().to_rfc3339();
    let new_meta = ProjectMeta {
        id: new_id,
        name: format!("{} (copie)", meta.name),
        created_at: now.clone(),
        updated_at: now,
        ..meta
    };
    fs::write(
        target.join("project.json"),
        serde_json::to_string_pretty(&new_meta).map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())?;
    fs::write(
        target.join("document.json"),
        serde_json::to_string_pretty(&document).map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())?;
    fs::write(
        target.join("chat.json"),
        serde_json::to_string_pretty(&chat).map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())?;

    open(root, &new_meta.id)
}

pub fn delete(root: &Path, id: &str) -> Result<(), String> {
    let dir = project_dir(root, id)?;
    fs::remove_dir_all(dir).map_err(|e| e.to_string())
}

pub fn write_export(root: &Path, id: &str, filename: &str, content: &str) -> Result<String, String> {
    let dir = project_dir(root, id)?;
    let exports = dir.join("exports");
    fs::create_dir_all(&exports).map_err(|e| e.to_string())?;
    let path = exports.join(filename);
    fs::write(&path, content).map_err(|e| e.to_string())?;
    Ok(path.to_string_lossy().to_string())
}

pub fn write_render_file(root: &Path, id: &str, html: &str) -> Result<PathBuf, String> {
    let dir = project_dir(root, id)?;
    let exports = dir.join("exports");
    fs::create_dir_all(&exports).map_err(|e| e.to_string())?;
    let path = exports.join("_render.html");
    fs::write(&path, html).map_err(|e| e.to_string())?;
    Ok(path)
}


pub fn upscale_asset(
    root: &Path,
    id: &str,
    name: &str,
    factor: u32,
) -> Result<Asset, String> {
    if !matches!(factor, 2 | 4) {
        return Err("Facteur d'upscale invalide (×2 ou ×4).".into());
    }
    let dir = project_dir(root, id)?;
    let source = dir.join("assets").join(sanitize_filename(name));
    if !source.is_file() {
        return Err("Image introuvable.".into());
    }
    let image = image::open(&source)
        .map_err(|e| format!("Format non pris en charge pour l'upscale : {e}"))?;
    let (width, height) = (image.width(), image.height());
    if width.saturating_mul(factor) > 12_000 || height.saturating_mul(factor) > 12_000 {
        return Err("L'image est déjà trop grande pour cet upscale.".into());
    }
    let resized = image.resize_exact(
        width * factor,
        height * factor,
        image::imageops::FilterType::Lanczos3,
    );
    let stem = Path::new(name)
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or("image");
    let target = unique_path(
        &dir.join("assets"),
        &format!("{stem}@{factor}x.png"),
    );
    resized
        .save_with_format(&target, image::ImageFormat::Png)
        .map_err(|e| format!("Enregistrement impossible : {e}"))?;
    let bytes = fs::read(&target).map_err(|e| e.to_string())?;
    let final_name = target
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("image.png")
        .to_string();
    Ok(Asset {
        name: final_name,
        data_url: format!(
            "data:image/png;base64,{}",
            base64::engine::general_purpose::STANDARD.encode(bytes)
        ),
    })
}
