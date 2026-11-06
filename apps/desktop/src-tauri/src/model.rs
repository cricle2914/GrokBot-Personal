use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::Manager;
use crate::ssh::{self, SshConnection};

#[derive(Clone, Deserialize, Serialize)]
pub struct ModelSettings {
    pub provider: String,
    pub base_url: String,
    pub model_name: String,
    #[serde(default)]
    pub has_api_key: bool,
}
fn config_path(app: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(|_| "无法读取应用目录")?;
    std::fs::create_dir_all(&dir).map_err(|_| "无法创建应用目录")?;
    Ok(dir.join("model.json"))
}
fn credential() -> Result<keyring::Entry, String> {
    keyring::Entry::new("com.grokbot.personal", "global-model-api-key").map_err(|_| "无法访问系统凭据管理器".into())
}
fn resolve_key(api_key: Option<String>) -> Result<String, String> {
    if let Some(key) = api_key.filter(|key| !key.trim().is_empty()) { return Ok(key); }
    credential()?.get_password().map_err(|_| "请填写模型 API Key".into())
}
fn validate(config: &ModelSettings) -> Result<(), String> {
    let url = reqwest::Url::parse(&config.base_url).map_err(|_| "API 地址无效")?;
    if url.scheme() != "https" || url.host_str().is_none() || !url.username().is_empty() || url.password().is_some() || url.query().is_some() || url.fragment().is_some() {
        return Err("模型 API 地址必须为不含凭据或查询参数的 HTTPS 地址".into());
    }
    if config.model_name.trim().is_empty() { return Err("请填写模型名称".into()); }
    Ok(())
}
#[tauri::command]
pub fn load_model(app: tauri::AppHandle) -> Result<Option<ModelSettings>, String> {
    let path = config_path(&app)?;
    if !path.exists() { return Ok(None); }
    let mut config: ModelSettings = serde_json::from_slice(&std::fs::read(path).map_err(|_| "无法读取模型设置")?).map_err(|_| "模型设置损坏")?;
    config.has_api_key = credential()?.get_password().is_ok();
    Ok(Some(config))
}
#[tauri::command]
pub fn save_model(app: tauri::AppHandle, mut config: ModelSettings, api_key: Option<String>) -> Result<ModelSettings, String> {
    validate(&config)?;
    let key = resolve_key(api_key)?;
    credential()?.set_password(&key).map_err(|_| "无法将 API Key 保存到系统凭据管理器")?;
    config.has_api_key = true;
    std::fs::write(config_path(&app)?, serde_json::to_vec(&config).map_err(|_| "模型设置编码失败")?).map_err(|_| "无法保存模型设置")?;
    Ok(config)
}
#[tauri::command]
pub async fn test_model(config: ModelSettings, api_key: Option<String>) -> Result<(), String> {
    validate(&config)?;
    let key = resolve_key(api_key)?;
    tauri::async_runtime::spawn_blocking(move || {
        let client = reqwest::blocking::Client::builder().timeout(std::time::Duration::from_secs(90)).redirect(reqwest::redirect::Policy::none()).build().map_err(|_| "无法初始化模型连接")?;
        let base = config.base_url.trim_end_matches('/');
        let anthropic = config.provider == "Anthropic";
        let url = if anthropic { format!("{base}{}", if base.ends_with("/v1") { "/messages" } else { "/v1/messages" }) } else { format!("{base}/chat/completions") };
        let mut payload = json!({"model": config.model_name, "messages": [{"role": "user", "content": "Reply with OK."}], "stream": false});
        let request = if anthropic {
            payload["max_tokens"] = json!(32);
            client.post(url).header("x-api-key", key).header("anthropic-version", "2023-06-01")
        } else { client.post(url).bearer_auth(key) };
        let response = request.json(&payload).send().map_err(|_| "模型连接失败或超时，请检查 API 地址和网络")?;
        let status = response.status().as_u16();
        if status != 200 { return Err(format!("模型测试失败（HTTP {status}），请检查 API Key、模型名称及额度")); }
        let body: Value = response.json().map_err(|_| "模型返回内容无效")?;
        let valid = if anthropic { body["content"].as_array().map(|blocks| blocks.iter().any(|b| b["type"] == "text" && b["text"].as_str().is_some_and(|s| !s.trim().is_empty()))).unwrap_or(false) } else { body["choices"][0]["message"]["content"].as_str().is_some_and(|s| !s.trim().is_empty()) };
        if !valid { return Err("模型未返回有效文本".into()); }
        Ok(())
    }).await.map_err(|_| "模型测试中断")?
}
#[tauri::command]
pub async fn sync_model(app: tauri::AppHandle, state: tauri::State<'_, SshConnection>, port: u16, env_path: String, token: String) -> Result<(), String> {
    let config = load_model(app)?.ok_or("请先保存模型设置")?;
    let key = resolve_key(None)?;
    let shared = SshConnection(state.0.clone());
    tauri::async_runtime::spawn_blocking(move || {
        let result = ssh::request(&shared, json!({"port": port, "env_path": env_path, "token": token, "path": "/model-config", "method": "PUT", "body": {"provider": config.provider, "base_url": config.base_url, "model_name": config.model_name, "api_key": key}}))?;
        if result["status"].as_u64() != Some(200) { return Err(result["body"]["detail"].as_str().unwrap_or("模型设置未同步到云端").to_string()); }
        Ok(())
    }).await.map_err(|_| "模型同步中断")?
}
