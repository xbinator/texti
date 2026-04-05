use serde::{Deserialize, Serialize};
use std::time::Instant;

#[derive(Debug, Serialize, Deserialize)]
pub struct ConnectionTestResult {
    pub success: bool,
    pub latency_ms: Option<u64>,
    pub error: Option<String>,
}

fn get_default_base_url(provider: &str) -> Option<String> {
    match provider {
        "openai" => Some("https://api.openai.com/v1".to_string()),
        "anthropic" => Some("https://api.anthropic.com/v1".to_string()),
        "deepseek" => Some("https://api.deepseek.com/v1".to_string()),
        "moonshot" => Some("https://api.moonshot.cn/v1".to_string()),
        "zhipu" => Some("https://open.bigmodel.cn/api/paas/v4".to_string()),
        "google" => Some("https://generativelanguage.googleapis.com/v1beta".to_string()),
        _ => None,
    }
}

fn get_auth_header(provider: &str) -> (String, String) {
    match provider {
        "anthropic" => ("x-api-key".to_string(), "x-api-key".to_string()),
        "google" => ("key".to_string(), "query".to_string()),
        _ => ("Authorization".to_string(), "Bearer".to_string()),
    }
}

#[tauri::command]
pub async fn test_api_connection(
    provider: String,
    api_key: String,
    base_url: Option<String>,
) -> Result<ConnectionTestResult, String> {
    let url = base_url
        .or_else(|| get_default_base_url(&provider))
        .ok_or_else(|| format!("Unknown provider: {}", provider))?;

    let test_url = match provider.as_str() {
        "google" => format!("{}/models?key={}", url, api_key),
        _ => format!("{}/models", url),
    };

    let (header_name, header_prefix) = get_auth_header(&provider);

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(10))
        .build()
        .map_err(|e| format!("Failed to create HTTP client: {}", e))?;

    let start = Instant::now();

    let response = if provider == "google" {
        client.get(&test_url).send().await
    } else if provider == "anthropic" {
        client
            .get(&test_url)
            .header(&header_name, api_key)
            .send()
            .await
    } else {
        client
            .get(&test_url)
            .header(&header_name, format!("{} {}", header_prefix, api_key))
            .send()
            .await
    };

    let latency_ms = start.elapsed().as_millis() as u64;

    match response {
        Ok(resp) => {
            let status = resp.status();
            if status.is_success() {
                Ok(ConnectionTestResult {
                    success: true,
                    latency_ms: Some(latency_ms),
                    error: None,
                })
            } else {
                let error_text = resp.text().await.unwrap_or_else(|_| "Unknown error".to_string());
                Ok(ConnectionTestResult {
                    success: false,
                    latency_ms: Some(latency_ms),
                    error: Some(format!("HTTP {}: {}", status, error_text)),
                })
            }
        }
        Err(e) => Ok(ConnectionTestResult {
            success: false,
            latency_ms: Some(latency_ms),
            error: Some(e.to_string()),
        }),
    }
}
