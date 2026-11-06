use std::path::{Path, PathBuf};
use std::process::Command;

const PATH_CANDIDATES: &[&str] = &[
    "chromium",
    "chromium-browser",
    "google-chrome",
    "google-chrome-stable",
    "microsoft-edge",
    "microsoft-edge-stable",
    "brave-browser",
    "chrome",
];

fn path_candidates() -> Vec<PathBuf> {
    let mut found = Vec::new();
    if let Some(path) = std::env::var_os("PATH") {
        for dir in std::env::split_paths(&path) {
            for name in PATH_CANDIDATES {
                let candidate = dir.join(name);
                if candidate.is_file() {
                    found.push(candidate);
                }
                #[cfg(windows)]
                {
                    let exe = dir.join(format!("{name}.exe"));
                    if exe.is_file() {
                        found.push(exe);
                    }
                }
            }
        }
    }

    #[cfg(target_os = "macos")]
    {
        for app in [
            "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
            "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
            "/Applications/Chromium.app/Contents/MacOS/Chromium",
            "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
        ] {
            let path = PathBuf::from(app);
            if path.is_file() {
                found.push(path);
            }
        }
    }

    #[cfg(windows)]
    {
        let mut roots = Vec::new();
        if let Ok(pf) = std::env::var("ProgramFiles") {
            roots.push(pf);
        }
        if let Ok(pf) = std::env::var("ProgramFiles(x86)") {
            roots.push(pf);
        }
        if let Ok(local) = std::env::var("LOCALAPPDATA") {
            roots.push(local);
        }
        for root in roots {
            for rel in [
                r"Google\Chrome\Application\chrome.exe",
                r"Microsoft\Edge\Application\msedge.exe",
                r"BraveSoftware\Brave-Browser\Application\brave.exe",
                r"Chromium\Application\chrome.exe",
            ] {
                let path = Path::new(&root).join(rel);
                if path.is_file() {
                    found.push(path);
                }
            }
        }
    }

    found
}

pub fn find_browser() -> Option<PathBuf> {
    path_candidates().into_iter().next()
}

fn file_url(path: &Path) -> String {
    let text = path.to_string_lossy().replace('\\', "/");
    if text.starts_with('/') {
        format!("file://{text}")
    } else {
        format!("file:///{text}")
    }
}

fn run(browser: &Path, args: &[String]) -> Result<(), String> {
    let output = Command::new(browser)
        .args(args)
        .output()
        .map_err(|e| format!("Impossible de lancer le navigateur : {e}"))?;
    if output.status.success() {
        return Ok(());
    }
    let stderr = String::from_utf8_lossy(&output.stderr);
    Err(format!(
        "Le rendu a échoué ({}). {}",
        output.status,
        stderr.chars().take(600).collect::<String>()
    ))
}

fn base_args() -> Vec<String> {
    let mut args = vec![
        "--hide-scrollbars".to_string(),
        "--disable-gpu".to_string(),
        "--virtual-time-budget=12000".to_string(),
        "--run-all-compositor-stages-before-draw".to_string(),
    ];
    #[cfg(target_os = "linux")]
    args.push("--no-sandbox".to_string());
    args
}

pub fn render_png(
    browser: &Path,
    html_path: &Path,
    out_path: &Path,
    width: u32,
    height: u32,
    scale: u32,
) -> Result<(), String> {
    if let Some(parent) = out_path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let _ = std::fs::remove_file(out_path);

    let mut args = vec!["--headless=new".to_string()];
    args.extend(base_args());
    args.push(format!("--force-device-scale-factor={scale}"));
    args.push(format!("--window-size={width},{height}"));
    args.push(format!("--screenshot={}", out_path.to_string_lossy()));
    args.push(file_url(html_path));

    if run(browser, &args).is_err() {
        args[0] = "--headless".to_string();
        run(browser, &args)?;
    }

    let meta = std::fs::metadata(out_path)
        .map_err(|_| "Le navigateur n'a produit aucune image.".to_string())?;
    if meta.len() == 0 {
        return Err("Le fichier PNG généré est vide.".into());
    }
    Ok(())
}

pub fn render_pdf(
    browser: &Path,
    html_path: &Path,
    out_path: &Path,
) -> Result<(), String> {
    if let Some(parent) = out_path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let _ = std::fs::remove_file(out_path);

    let mut args = vec![
        "--headless=new".to_string(),
        "--no-pdf-header-footer".to_string(),
    ];
    args.extend(base_args());
    args.push(format!("--print-to-pdf={}", out_path.to_string_lossy()));
    args.push(file_url(html_path));

    if run(browser, &args).is_err() {
        args[0] = "--headless".to_string();
        args.retain(|a| a != "--no-pdf-header-footer");
        args.push("--print-to-pdf-no-header".to_string());
        run(browser, &args)?;
    }

    let meta = std::fs::metadata(out_path)
        .map_err(|_| "Le navigateur n'a produit aucun PDF.".to_string())?;
    if meta.len() == 0 {
        return Err("Le fichier PDF généré est vide.".into());
    }
    Ok(())
}

#[cfg(target_os = "linux")]
pub fn reveal(path: &Path) -> Result<(), String> {
    Command::new("xdg-open")
        .arg(path)
        .spawn()
        .map(|_| ())
        .map_err(|e| e.to_string())
}

#[cfg(target_os = "macos")]
pub fn reveal(path: &Path) -> Result<(), String> {
    Command::new("open")
        .arg(path)
        .spawn()
        .map(|_| ())
        .map_err(|e| e.to_string())
}

#[cfg(windows)]
pub fn reveal(path: &Path) -> Result<(), String> {
    Command::new("explorer")
        .arg(path)
        .spawn()
        .map(|_| ())
        .map_err(|e| e.to_string())
}


#[cfg(target_os = "linux")]
pub fn open_url(url: &str) -> Result<(), String> {
    Command::new("xdg-open")
        .arg(url)
        .spawn()
        .map(|_| ())
        .map_err(|e| e.to_string())
}

#[cfg(target_os = "macos")]
pub fn open_url(url: &str) -> Result<(), String> {
    Command::new("open")
        .arg(url)
        .spawn()
        .map(|_| ())
        .map_err(|e| e.to_string())
}

#[cfg(windows)]
pub fn open_url(url: &str) -> Result<(), String> {
    Command::new("cmd")
        .args(["/C", "start", "", url])
        .spawn()
        .map(|_| ())
        .map_err(|e| e.to_string())
}
