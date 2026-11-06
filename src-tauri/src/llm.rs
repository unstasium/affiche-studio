use futures_util::StreamExt;
use serde_json::{json, Value};
use std::process::Stdio;
use std::time::Duration;
use tokio::io::AsyncWriteExt;
use tokio::process::Command;

use crate::document::Document;
use crate::project::ProjectMeta;

pub struct LlmConfig {
    pub base_url: String,
    pub model: String,
    pub api_key: String,
    pub reasoning_effort: Option<String>,
    pub session_id: String,
}

fn system_prompt(width: u32, height: u32, language: &str) -> String {
    let lang = match language {
        "en" => "anglais",
        "es" => "espagnol",
        _ => "français",
    };
    format!(
        r##"Tu es Affiche Studio, un directeur artistique senior spécialisé dans les affiches de streetwear, d'événements et de marques. Tu ne produis pas d'images : tu produis un document de calques JSON qui sera rendu en HTML/CSS.

RÈGLES DE SORTIE — IMPÉRATIVES :
- Réponds UNIQUEMENT avec un bloc ```json ... ``` contenant le document complet. Aucun texte avant ou après.
- Le canvas fait exactement {width}px de large et {height}px de haut.
- Tous les textes de l'affiche doivent être en {lang}.
- Les calques sont empilés du plus bas au plus haut (le dernier est au-dessus).
- Chaque calque reste dans les limites du canvas. Laisse des marges généreuses.
- N'invente jamais de chemin d'image : utilise uniquement les fichiers de la liste fournie.

SCHÉMA :
{{
  "background": "#0b0b0e ou linear-gradient(...)",
  "layers": [
    {{
      "type": "text",
      "name": "Titre",
      "x": 64, "y": 120, "w": 952, "h": 220,
      "rotation": 0, "opacity": 1,
      "text": "HOODIE",
      "style": {{
        "fontFamily": "Anton", "fontSize": 198, "fontWeight": 400,
        "fontStyle": "normal", "color": "#f3f3fc",
        "align": "left", "valign": "top",
        "lineHeight": 0.9, "letterSpacing": 0,
        "textTransform": "uppercase", "padding": 0,
        "background": "", "radius": 0
      }}
    }},
    {{
      "type": "image",
      "name": "Produit face",
      "x": 120, "y": 700, "w": 460, "h": 640,
      "rotation": 0, "opacity": 1,
      "src": "hoodie.png", "fit": "contain", "radius": 0
    }},
    {{
      "type": "shape",
      "name": "Bandeau",
      "x": 0, "y": 1600, "w": 1080, "h": 140,
      "rotation": 0, "opacity": 1,
      "shape": "rect", "fill": "#cd4c51",
      "stroke": "", "strokeWidth": 0, "radius": 24
    }}
  ]
}}

Polices disponibles : Anton, Archivo Black, Bebas Neue, Oswald, Inter, DM Sans, Space Grotesk, Manrope, Instrument Serif, Playfair Display, Libre Baskerville, JetBrains Mono.

Si un document existant est fourni, tu dois le MODIFIER : conserve les ids et tout ce qui n'est pas concerné par la demande. Sinon, crée un document entièrement nouveau, équilibré et professionnel."##
    )
}

pub fn build_messages(
    meta: &ProjectMeta,
    document: Option<&Document>,
    selected: &[String],
    assets: &[String],
    instruction: &str,
    regenerate: bool,
) -> Vec<Value> {
    let mut user = String::new();
    user.push_str(&format!("Projet : {}\n", meta.name));
    user.push_str(&format!(
        "Format : {} × {} px\nLangue de l'affiche : {}\n",
        meta.width,
        meta.height,
        match meta.language.as_str() {
            "en" => "anglais",
            "es" => "espagnol",
            _ => "français",
        }
    ));
    if !meta.palette.is_empty() {
        user.push_str(&format!("Palette imposée : {}\n", meta.palette.join(", ")));
    }
    if assets.is_empty() {
        user.push_str("Assets : aucun. Travaille en typographie et formes.\n");
    } else {
        user.push_str("Assets disponibles :\n");
        for asset in assets {
            user.push_str(&format!("- {asset}\n"));
        }
    }
    if !selected.is_empty() {
        user.push_str(&format!(
            "Calques sélectionnés par l'utilisateur : {}\n",
            selected.join(", ")
        ));
    }
    user.push_str("\nDemande :\n");
    user.push_str(instruction.trim());
    user.push('\n');

    if !regenerate {
        if let Some(document) = document {
            let serialized = serde_json::to_string(document).unwrap_or_default();
            let mut serialized = serialized;
            if serialized.len() > 120_000 {
                serialized.truncate(120_000);
            }
            user.push_str("\nDocument actuel à modifier (conserve les ids et l'existant) :\n");
            user.push_str("```json\n");
            user.push_str(&serialized);
            user.push_str("\n```\n");
        }
    }

    vec![
        json!({"role":"system","content": system_prompt(meta.width, meta.height, &meta.language)}),
        json!({"role":"user","content": user}),
    ]
}

fn extract_json(raw: &str) -> String {
    let text = raw.trim();
    if let Some(start) = text.find("```json") {
        let after = &text[start + 7..];
        if let Some(end) = after.find("```") {
            return after[..end].trim().to_string();
        }
    }
    if let Some(start) = text.find("```") {
        let after = &text[start + 3..];
        if let Some(end) = after.find("```") {
            return after[..end].trim().to_string();
        }
    }
    if let (Some(start), Some(end)) = (text.find('{'), text.rfind('}')) {
        if end > start {
            return text[start..=end].to_string();
        }
    }
    text.to_string()
}

pub async fn generate<F>(
    client: &reqwest::Client,
    cfg: &LlmConfig,
    messages: Vec<Value>,
    on_chunk: F,
) -> Result<Document, String>
where
    F: Fn(&str),
{
    if cfg.api_key.is_empty() {
        return Err(
            "Aucune clé API configurée. Ouvrez « Réglages API » pour en ajouter une.".into(),
        );
    }

    let url = format!("{}/chat/completions", cfg.base_url.trim_end_matches('/'));
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

    if accumulated.trim().is_empty() {
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

    parse_document(&accumulated)
}

fn parse_document(raw: &str) -> Result<Document, String> {
    let payload = extract_json(raw);
    let value: Value = serde_json::from_str(&payload)
        .map_err(|e| format!("Le modèle n'a pas renvoyé un JSON valide : {e}"))?;
    let value = value.get("document").cloned().unwrap_or(value);

    let mut document: Document = serde_json::from_value(value)
        .map_err(|e| format!("Document de calques invalide : {e}"))?;
    document.normalize();
    if document.layers.is_empty() {
        return Err("Le modèle n'a produit aucun calque. Reformulez le brief.".into());
    }
    Ok(document)
}

pub fn build_cli_prompt(messages: &[Value]) -> String {
    messages
        .iter()
        .filter_map(|message| {
            let role = message["role"].as_str()?;
            let content = message["content"].as_str()?;
            Some(format!("### {role}\n{content}"))
        })
        .collect::<Vec<_>>()
        .join("\n\n")
}

fn model_with_variant(model: &str, effort: Option<&str>) -> String {
    let model = model.trim();
    match effort {
        Some(effort) if !effort.trim().is_empty() && !model.contains('#') => {
            format!("{model}#{}", effort.trim())
        }
        _ => model.to_string(),
    }
}

pub async fn generate_via_opencode(
    model: &str,
    effort: Option<&str>,
    prompt: &str,
) -> Result<Document, String> {
    let model = model_with_variant(model, effort);
    let mut child = Command::new("opencode")
        .arg("run")
        .arg("--format")
        .arg("json")
        .arg("--model")
        .arg(&model)
        .arg("--auto")
        .arg("--agent")
        .arg("plan")
        .current_dir({
            let dir = std::env::temp_dir().join("affiche-studio-opencode");
            let _ = std::fs::create_dir_all(&dir);
            dir
        })
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true)
        .spawn()
        .map_err(|e| {
            format!("Impossible de lancer `opencode` : {e}. Installez OpenCode et connectez un provider.")
        })?;

    if let Some(mut stdin) = child.stdin.take() {
        stdin
            .write_all(prompt.as_bytes())
            .await
            .map_err(|e| format!("Envoi du prompt à OpenCode impossible : {e}"))?;
    }

    let output = tokio::time::timeout(Duration::from_secs(300), child.wait_with_output())
        .await
        .map_err(|_| "OpenCode a dépassé 5 minutes. Réessayez avec un modèle plus rapide.".to_string())?
        .map_err(|e| format!("OpenCode a échoué : {e}"))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!(
            "OpenCode a renvoyé une erreur : {}",
            stderr.chars().take(800).collect::<String>()
        ));
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let mut text = String::new();
    for line in stdout.lines() {
        let Ok(value) = serde_json::from_str::<Value>(line) else {
            continue;
        };
        if value["type"] == "text" {
            if let Some(part) = value["part"]["text"].as_str() {
                text.push_str(part);
            }
        }
    }

    if text.trim().is_empty() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!(
            "OpenCode n'a renvoyé aucun texte. {}",
            stderr.chars().take(500).collect::<String>()
        ));
    }

    parse_document(&text)
}


#[cfg(test)]
mod tests {
    use super::*;
    use crate::project::ProjectMeta;

    #[tokio::test]
    #[ignore]
    async fn opencode_cli_document_smoke() {
        let meta = ProjectMeta {
            version: 2,
            id: "test".into(),
            name: "Test".into(),
            width: 1080,
            height: 1920,
            language: "fr".into(),
            palette: vec![
                "#0b0b0e".into(),
                "#f3f3fc".into(),
                "#cd4c51".into(),
                "#843537".into(),
                "#8a8a94".into(),
            ],
            created_at: String::new(),
            updated_at: String::new(),
        };
        let document = Document::default();
        let messages = build_messages(
            &meta,
            Some(&document),
            &[],
            &[],
            "Crée une affiche simple avec un grand titre et un fond sombre.",
            true,
        );
        let prompt = build_cli_prompt(&messages);
        let result =
            generate_via_opencode("opencode-go/deepseek-v4.1-flash", Some("low"), &prompt).await;
        assert!(result.is_ok(), "{:?}", result.err());
        let generated = result.unwrap();
        assert!(!generated.layers.is_empty(), "aucun calque généré");
    }
}
