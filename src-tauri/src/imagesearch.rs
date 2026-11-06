use serde::Serialize;
use serde_json::Value;

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct WebImage {
    pub id: String,
    pub title: String,
    pub thumbnail: String,
    pub url: String,
    pub author: String,
    pub license: String,
    pub source: String,
}

fn clean(value: &Value) -> String {
    value
        .as_str()
        .map(strip_html)
        .unwrap_or_default()
        .trim()
        .to_string()
}

fn strip_html(input: &str) -> String {
    let mut output = String::new();
    let mut in_tag = false;
    for character in input.chars() {
        match character {
            '<' => in_tag = true,
            '>' => in_tag = false,
            _ if !in_tag => output.push(character),
            _ => {}
        }
    }
    output
        .replace("&amp;", "&")
        .replace("&quot;", "\"")
        .replace("&#39;", "'")
        .replace("&nbsp;", " ")
}

async fn openverse(
    client: &reqwest::Client,
    query: &str,
    count: usize,
) -> Result<Vec<WebImage>, String> {
    let url = reqwest::Url::parse_with_params(
        "https://api.openverse.org/v1/images/",
        &[
            ("q", query),
            ("page_size", &count.to_string()),
            ("license_type", "all"),
            ("mature", "false"),
        ],
    )
    .map_err(|e| e.to_string())?;

    let response = client
        .get(url)
        .header("User-Agent", concat!("affiche-studio/", env!("CARGO_PKG_VERSION")))
        .header("Accept", "application/json")
        .send()
        .await
        .map_err(|e| e.to_string())?;
    if !response.status().is_success() {
        return Err(format!("Openverse {}", response.status()));
    }
    let payload: Value = response.json().await.map_err(|e| e.to_string())?;
    let results = payload["results"].as_array().cloned().unwrap_or_default();
    let mut images = Vec::new();
    for item in results {
        let thumbnail = item["thumbnail"].as_str().unwrap_or("");
        let full = item["url"].as_str().unwrap_or("");
        if thumbnail.is_empty() || full.is_empty() {
            continue;
        }
        images.push(WebImage {
            id: item["id"].as_str().unwrap_or("openverse").to_string(),
            title: item["title"].as_str().unwrap_or("Image").to_string(),
            thumbnail: thumbnail.to_string(),
            url: full.to_string(),
            author: item["creator"].as_str().unwrap_or("Auteur inconnu").to_string(),
            license: item["license"].as_str().unwrap_or("?").to_uppercase(),
            source: "Openverse".to_string(),
        });
        if images.len() >= count {
            break;
        }
    }
    Ok(images)
}

async fn wikimedia(
    client: &reqwest::Client,
    query: &str,
    count: usize,
) -> Result<Vec<WebImage>, String> {
    let search = format!("filetype:bitmap {query}");
    let url = reqwest::Url::parse_with_params(
        "https://commons.wikimedia.org/w/api.php",
        &[
            ("action", "query"),
            ("generator", "search"),
            ("gsrsearch", &search),
            ("gsrnamespace", "6"),
            ("gsrlimit", &count.to_string()),
            ("prop", "imageinfo"),
            ("iiprop", "url|extmetadata"),
            ("iiurlwidth", "520"),
            ("format", "json"),
        ],
    )
    .map_err(|e| e.to_string())?;

    let response = client
        .get(url)
        .header("User-Agent", concat!("affiche-studio/", env!("CARGO_PKG_VERSION")))
        .header("Accept", "application/json")
        .send()
        .await
        .map_err(|e| e.to_string())?;
    if !response.status().is_success() {
        return Err(format!("Wikimedia {}", response.status()));
    }
    let payload: Value = response.json().await.map_err(|e| e.to_string())?;
    let pages = payload["query"]["pages"].as_object().cloned().unwrap_or_default();
    let mut images = Vec::new();
    for (id, page) in pages {
        let info = &page["imageinfo"][0];
        let thumbnail = info["thumburl"].as_str().unwrap_or("");
        let full = info["url"].as_str().unwrap_or("");
        if thumbnail.is_empty() || full.is_empty() {
            continue;
        }
        let metadata = &info["extmetadata"];
        images.push(WebImage {
            id: format!("commons-{id}"),
            title: page["title"]
                .as_str()
                .unwrap_or("Image")
                .trim_start_matches("File:")
                .to_string(),
            thumbnail: thumbnail.to_string(),
            url: full.to_string(),
            author: clean(&metadata["Artist"]["value"]),
            license: clean(&metadata["LicenseShortName"]["value"]),
            source: "Wikimedia Commons".to_string(),
        });
        if images.len() >= count {
            break;
        }
    }
    Ok(images)
}

async fn brave(
    client: &reqwest::Client,
    key: &str,
    query: &str,
    count: usize,
    pinterest: bool,
) -> Result<Vec<WebImage>, String> {
    let search = if pinterest {
        format!("site:pinterest.com {query}")
    } else {
        query.to_string()
    };
    let url = reqwest::Url::parse_with_params(
        "https://api.search.brave.com/res/v1/images/search",
        &[
            ("q", search.as_str()),
            ("count", &count.to_string()),
            ("safesearch", "strict"),
        ],
    )
    .map_err(|e| e.to_string())?;
    let response = client
        .get(url)
        .header("X-Subscription-Token", key)
        .header("Accept", "application/json")
        .header("User-Agent", concat!("affiche-studio/", env!("CARGO_PKG_VERSION")))
        .send()
        .await
        .map_err(|e| format!("Brave Search : {e}"))?;
    if !response.status().is_success() {
        return Err(format!(
            "Brave Search a répondu {} (vérifiez la clé et le quota).",
            response.status()
        ));
    }
    let payload: Value = response.json().await.map_err(|e| e.to_string())?;
    let results = payload["results"].as_array().cloned().unwrap_or_default();
    let mut images = Vec::new();
    for item in results {
        let thumbnail = item["thumbnail"]["src"]
            .as_str()
            .or_else(|| item["thumbnail"].as_str())
            .unwrap_or("");
        let full = item["properties"]["url"]
            .as_str()
            .or_else(|| item["url"].as_str())
            .unwrap_or("");
        if thumbnail.is_empty() || full.is_empty() {
            continue;
        }
        images.push(WebImage {
            id: item["url"].as_str().unwrap_or("brave").to_string(),
            title: item["title"].as_str().unwrap_or("Image").to_string(),
            thumbnail: thumbnail.to_string(),
            url: full.to_string(),
            author: item["source"].as_str().unwrap_or("Web").to_string(),
            license: if pinterest { "Pinterest".into() } else { "Web".into() },
            source: if pinterest { "Pinterest".into() } else { "Brave Search".into() },
        });
        if images.len() >= count {
            break;
        }
    }
    Ok(images)
}

pub async fn search(
    client: &reqwest::Client,
    query: &str,
    count: usize,
    provider: &str,
    key: &str,
) -> Result<Vec<WebImage>, String> {
    let query = query.trim();
    if query.len() < 2 {
        return Err("Entrez au moins deux caractères.".into());
    }
    let count = count.clamp(1, 30);

    if provider == "brave" || provider == "pinterest" {
        if key.trim().is_empty() {
            return Err(
                "Ajoutez une clé Brave Search dans les réglages pour chercher sur le web / Pinterest."
                    .into(),
            );
        }
        return brave(client, key, query, count, provider == "pinterest").await;
    }

    let mut errors = Vec::new();
    match openverse(client, query, count).await {
        Ok(images) if !images.is_empty() => return Ok(images),
        Ok(_) => errors.push("Openverse: aucun résultat".to_string()),
        Err(error) => errors.push(format!("Openverse: {error}")),
    }
    match wikimedia(client, query, count).await {
        Ok(images) if !images.is_empty() => return Ok(images),
        Ok(_) => errors.push("Wikimedia: aucun résultat".to_string()),
        Err(error) => errors.push(format!("Wikimedia: {error}")),
    }
    Err(errors.join(" · "))
}
