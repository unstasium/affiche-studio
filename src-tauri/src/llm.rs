use futures_util::StreamExt;
use serde_json::{json, Value};

use crate::project::ProjectMeta;

pub struct LlmConfig {
    pub base_url: String,
    pub model: String,
    pub api_key: String,
    pub reasoning_effort: Option<String>,
    pub session_id: String,
}

fn system_prompt(width: u32, height: u32) -> String {
    format!(
        r#"Tu es Affiche Studio, un directeur artistique senior spécialisé dans les affiches de streetwear et d'événements. Tu produis des affiches en HTML/CSS, pas des images.

RÈGLES DE SORTIE — IMPÉRATIVES :
- Réponds UNIQUEMENT avec un bloc de code ```html ... ``` contenant un document HTML complet.
- Aucun texte avant ou après le bloc.
- Le document doit être autonome : CSS dans <style>, aucun JavaScript.
- La page fait exactement {width}px de large et {height}px de haut. body {{ margin:0; width:{width}px; height:{height}px; overflow:hidden; }}
- N'utilise que les images fournies, avec des chemins relatifs de la forme assets/<nom-du-fichier>. N'invente jamais de chemin d'image.
- Les polices Google Fonts sont autorisées via <link>, mais prévois une pile de secours système.
- Tout le texte doit être en français, sauf demande contraire explicite.
- Soigne la hiérarchie typographique, les marges, l'alignement et la lisibilité à petite taille.
- L'affiche doit être équilibrée et professionnelle, jamais un simple empilement de blocs.

Style : éditorial, contrasté, contemporain. Évite les dégradés violets génériques et les emojis."#
    )
}

pub fn build_messages(
    meta: &ProjectMeta,
    assets: &[String],
    palette: &[String],
    prompt: &str,
    previous_html: &str,
) -> Vec<Value> {
    let mut user = String::new();
    user.push_str(&format!("Projet : {}\n", meta.name));
    user.push_str(&format!(
        "Format : {} × {} px (portrait)\n",
        meta.width, meta.height
    ));
    if !palette.is_empty() {
        user.push_str(&format!("Palette imposée : {}\n", palette.join(", ")));
    } else {
        user.push_str("Palette : libre, mais cohérente et limitée à 4–5 couleurs.\n");
    }
    if assets.is_empty() {
        user.push_str("Assets : aucun. Travaille en typographie pure.\n");
    } else {
        user.push_str("Assets disponibles (chemins relatifs) :\n");
        for asset in assets {
            user.push_str(&format!("- assets/{asset}\n"));
        }
    }
    user.push_str("\nBrief :\n");
    user.push_str(prompt.trim());
    user.push('\n');

    if !previous_html.trim().is_empty() {
        let mut prev = previous_html.trim().to_string();
        if prev.len() > 60_000 {
            prev.truncate(60_000);
        }
        user.push_str(
            "\nVersion actuelle de l'affiche (modifie-la pour répondre au brief, conserve ce qui fonctionne) :\n",
        );
        user.push_str("```html\n");
        user.push_str(&prev);
        user.push_str("\n```\n");
    }

    vec![
        json!({"role":"system","content": system_prompt(meta.width, meta.height)}),
        json!({"role":"user","content": user}),
    ]
}

fn extract_html(raw: &str) -> String {
    let text = raw.trim();
    if let Some(start) = text.find("```html") {
        let after = &text[start + 7..];
        if let Some(end) = after.find("```") {
            return after[..end].trim().to_string();
        }
    }
    if let Some(start) = text.find("```") {
        let after = &text[start + 3..];
        let after = after.strip_prefix("HTML").unwrap_or(after);
        if let Some(end) = after.find("```") {
            return after[..end].trim().to_string();
        }
    }
    text.to_string()
}

fn looks_like_html(html: &str) -> bool {
    let lowered = html.to_ascii_lowercase();
    lowered.contains("<html") && lowered.contains("<body")
}

pub async fn generate<F>(
    client: &reqwest::Client,
    cfg: &LlmConfig,
    messages: Vec<Value>,
    on_chunk: F,
) -> Result<String, String>
where
    F: Fn(&str),
{
    if cfg.api_key.is_empty() {
        return Err(
            "Aucune clé API configurée. Ouvrez « Réglages API » pour en ajouter une.".into(),
        );
    }

    let url = format!(
        "{}/chat/completions",
        cfg.base_url.trim_end_matches('/')
    );
    let mut body = json!({
        "model": cfg.model,
        "messages": messages,
        "stream": true,
        "temperature": 0.7,
    });
    if let Some(effort) = cfg.reasoning_effort.as_deref() {
        if !effort.trim().is_empty() {
            body["reasoning_effort"] = json!(effort.trim());
        }
    }

    let response = client
        .post(&url)
        .bearer_auth(&cfg.api_key)
        .header("User-Agent", concat!("affiche-studio/", env!("CARGO_PKG_VERSION")))
        .header("HTTP-Referer", "https://github.com/unstasium/affiche-studio")
        .header("X-Title", "Affiche Studio")
        .header("x-opencode-session", &cfg.session_id)
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("Connexion à l'API impossible : {e}"))?;

    let status = response.status();
    if !status.is_success() {
        let detail = response.text().await.unwrap_or_default();
        let detail = detail.chars().take(800).collect::<String>();
        return Err(format!("Erreur API {status} : {detail}"));
    }

    let mut stream = response.bytes_stream();
    let mut buffer = String::new();
    let mut accumulated = String::new();
    let mut raw_all = String::new();
    let mut finished = false;

    while let Some(chunk) = stream.next().await {
        let bytes = chunk.map_err(|e| format!("Flux interrompu : {e}"))?;
        let text = String::from_utf8_lossy(&bytes).to_string();
        raw_all.push_str(&text);
        buffer.push_str(&text);

        while let Some(pos) = buffer.find("\n\n") {
            let event: String = buffer.drain(..pos + 2).collect();
            for line in event.lines() {
                let line = line.trim_end_matches('\r');
                let Some(data) = line.strip_prefix("data:") else {
                    continue;
                };
                let data = data.trim();
                if data == "[DONE]" {
                    finished = true;
                    continue;
                }
                let Ok(value) = serde_json::from_str::<Value>(data) else {
                    continue;
                };
                if let Some(content) = value["choices"][0]["delta"]["content"].as_str() {
                    if !content.is_empty() {
                        accumulated.push_str(content);
                        on_chunk(content);
                    }
                }
            }
        }
        if finished {
            break;
        }
    }

    if accumulated.is_empty() {
        if let Ok(value) = serde_json::from_str::<Value>(&raw_all) {
            if let Some(content) = value["choices"][0]["message"]["content"].as_str() {
                accumulated.push_str(content);
                on_chunk(content);
            }
        }
    }

    if accumulated.trim().is_empty() {
        return Err("Le modèle n'a renvoyé aucun contenu.".into());
    }

    let html = extract_html(&accumulated);
    if !looks_like_html(&html) {
        return Err(
            "Le modèle n'a pas renvoyé un document HTML complet. Reformulez le brief ou changez de modèle."
                .into(),
        );
    }
    Ok(html)
}
