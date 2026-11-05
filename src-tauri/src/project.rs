use base64::Engine;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};

pub const IMAGE_EXTENSIONS: &[&str] = &["png", "jpg", "jpeg", "webp", "gif", "svg", "avif"];

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectMeta {
    pub id: String,
    pub name: String,
    pub width: u32,
    pub height: u32,
    pub created_at: String,
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
    pub html: String,
    pub assets: Vec<Asset>,
    pub has_poster: bool,
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
    let id = safe_id(id)?;
    Ok(root.join(id))
}

pub fn create(
    root: &Path,
    name: &str,
    width: u32,
    height: u32,
) -> Result<Project, String> {
    let name = name.trim();
    if name.is_empty() {
        return Err("Le nom du projet est vide.".into());
    }
    if width < 200 || height < 200 || width > 8000 || height > 8000 {
        return Err("Dimensions invalides (200 à 8000 px).".into());
    }

    let slug = slugify(name);
    let id = format!("{}-{}", slug, &uuid::Uuid::new_v4().to_string()[..8]);
    let dir = root.join(&id);
    fs::create_dir_all(dir.join("assets")).map_err(|e| e.to_string())?;
    fs::create_dir_all(dir.join("exports")).map_err(|e| e.to_string())?;

    let meta = ProjectMeta {
        id,
        name: name.to_string(),
        width,
        height,
        created_at: chrono::Utc::now().to_rfc3339(),
    };
    fs::write(
        dir.join("project.json"),
        serde_json::to_string_pretty(&meta).map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())?;

    Ok(Project {
        meta,
        html: String::new(),
        assets: vec![],
        has_poster: false,
    })
}

fn read_meta(dir: &Path) -> Option<ProjectMeta> {
    let raw = fs::read_to_string(dir.join("project.json")).ok()?;
    serde_json::from_str(&raw).ok()
}

pub fn list(root: &Path) -> Vec<ProjectMeta> {
    let mut projects = Vec::new();
    if let Ok(entries) = fs::read_dir(root) {
        for entry in entries.flatten() {
            if entry.path().is_dir() {
                if let Some(meta) = read_meta(&entry.path()) {
                    projects.push(meta);
                }
            }
        }
    }
    projects.sort_by(|a, b| b.created_at.cmp(&a.created_at));
    projects
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

fn read_html(dir: &Path) -> String {
    fs::read_to_string(dir.join("poster.html")).unwrap_or_default()
}

pub fn open(root: &Path, id: &str) -> Result<Project, String> {
    let dir = project_dir(root, id)?;
    if !dir.is_dir() {
        return Err("Projet introuvable.".into());
    }
    let meta = read_meta(&dir).ok_or("Métadonnées du projet illisibles.")?;
    let html = read_html(&dir);
    let has_poster = !html.trim().is_empty();
    let assets = list_assets(&dir);
    Ok(Project {
        meta,
        html,
        assets,
        has_poster,
    })
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

pub fn save_html(root: &Path, id: &str, html: &str) -> Result<(), String> {
    let dir = project_dir(root, id)?;
    if !dir.is_dir() {
        return Err("Projet introuvable.".into());
    }
    fs::write(dir.join("poster.html"), html).map_err(|e| e.to_string())
}

pub fn preview_html(root: &Path, id: &str) -> Result<String, String> {
    let dir = project_dir(root, id)?;
    let html = read_html(&dir);
    if html.trim().is_empty() {
        return Ok(String::new());
    }
    let mut out = html;
    let asset_dir = dir.join("assets");
    if let Ok(entries) = fs::read_dir(&asset_dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if !path.is_file() {
                continue;
            }
            let name = match path.file_name().and_then(|n| n.to_str()) {
                Some(n) => n,
                None => continue,
            };
            if let Ok(bytes) = fs::read(&path) {
                let data_url = format!(
                    "data:{};base64,{}",
                    mime_from_ext(&path),
                    base64::engine::general_purpose::STANDARD.encode(bytes)
                );
                out = out.replace(&format!("./assets/{name}"), &data_url);
                out = out.replace(&format!("assets/{name}"), &data_url);
            }
        }
    }
    Ok(out)
}

pub fn write_render_file(root: &Path, id: &str, html: &str) -> Result<PathBuf, String> {
    let dir = project_dir(root, id)?;
    let exports = dir.join("exports");
    fs::create_dir_all(&exports).map_err(|e| e.to_string())?;
    let path = exports.join("_render.html");
    fs::write(&path, html).map_err(|e| e.to_string())?;
    Ok(path)
}
