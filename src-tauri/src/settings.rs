use serde::{Deserialize, Serialize};
use std::fs;
use std::path::Path;

fn default_backend() -> String {
    "api".to_string()
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Settings {
    pub base_url: String,
    pub model: String,
    #[serde(skip)]
    pub api_key: String,
    pub remember_key: bool,
    pub reasoning_effort: Option<String>,
    #[serde(default = "default_backend")]
    pub backend: String,
    #[serde(skip)]
    pub image_search_key: String,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            base_url: "https://api.openai.com/v1".to_string(),
            model: "gpt-4o-mini".to_string(),
            api_key: String::new(),
            remember_key: false,
            reasoning_effort: None,
            backend: default_backend(),
            image_search_key: String::new(),
        }
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SettingsView {
    pub base_url: String,
    pub model: String,
    pub has_key: bool,
    pub remember_key: bool,
    pub reasoning_effort: Option<String>,
    pub backend: String,
    pub has_image_search_key: bool,
}

impl Settings {
    pub fn view(&self) -> SettingsView {
        SettingsView {
            base_url: self.base_url.clone(),
            model: self.model.clone(),
            has_key: !self.api_key.is_empty(),
            remember_key: self.remember_key,
            reasoning_effort: self.reasoning_effort.clone(),
            backend: self.backend.clone(),
            has_image_search_key: !self.image_search_key.is_empty(),
        }
    }

    pub fn load(config_dir: &Path) -> Self {
        let mut settings = fs::read_to_string(config_dir.join("settings.json"))
            .ok()
            .and_then(|raw| serde_json::from_str::<Settings>(&raw).ok())
            .unwrap_or_default();

        if let Ok(key) = fs::read_to_string(config_dir.join("imagesearch_key")) {
            let key = key.trim().to_string();
            if !key.is_empty() {
                settings.image_search_key = key;
            }
        }

        if let Ok(key) = fs::read_to_string(config_dir.join("api_key")) {
            let key = key.trim().to_string();
            if !key.is_empty() {
                settings.api_key = key;
            }
        }

        if settings.api_key.is_empty() {
            for var in ["AFFICHE_STUDIO_API_KEY", "OPENAI_API_KEY"] {
                if let Ok(key) = std::env::var(var) {
                    if !key.trim().is_empty() {
                        settings.api_key = key.trim().to_string();
                        settings.remember_key = false;
                        break;
                    }
                }
            }
        }

        settings
    }

    pub fn save(&self, config_dir: &Path) -> std::io::Result<()> {
        fs::create_dir_all(config_dir)?;

        let data = serde_json::json!({
            "baseUrl": self.base_url,
            "model": self.model,
            "rememberKey": self.remember_key,
            "reasoningEffort": self.reasoning_effort,
            "backend": self.backend,
        });
        fs::write(
            config_dir.join("settings.json"),
            serde_json::to_string_pretty(&data)?,
        )?;

        let image_key_path = config_dir.join("imagesearch_key");
        if !self.image_search_key.is_empty() {
            fs::write(&image_key_path, &self.image_search_key)?;
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                let _ = fs::set_permissions(&image_key_path, fs::Permissions::from_mode(0o600));
            }
        }

        let key_path = config_dir.join("api_key");
        if self.remember_key && !self.api_key.is_empty() {
            fs::write(&key_path, &self.api_key)?;
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                let _ = fs::set_permissions(&key_path, fs::Permissions::from_mode(0o600));
            }
        } else {
            let _ = fs::remove_file(&key_path);
        }

        Ok(())
    }
}
