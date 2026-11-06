use std::{io::{Read, Write}, net::{IpAddr, SocketAddr, TcpStream}, sync::{Arc, Mutex}, time::Duration};
use base64::{engine::general_purpose::STANDARD_NO_PAD, Engine};
use serde_json::{json, Value};
use ssh2::Session;
use tauri::Manager;

#[derive(Default)]
pub struct SshConnection(pub Arc<Mutex<Option<Session>>>);

fn handshake(host: &str, port: u16) -> Result<Session, String> {
    let ip: IpAddr = host.parse().map_err(|_| "请输入服务器公网 IP 地址")?;
    if port == 0 { return Err("SSH 端口无效".into()); }
    let socket = TcpStream::connect_timeout(&SocketAddr::new(ip, port), Duration::from_secs(10))
        .map_err(|_| "无法连接服务器，请检查 IP、SSH 端口和安全组")?;
    let mut session = Session::new().map_err(|_| "无法初始化 SSH")?;
    session.set_tcp_stream(socket);
    session.set_timeout(15000);
    session.handshake().map_err(|_| "SSH 握手失败")?;
    Ok(session)
}
fn fingerprint(session: &Session) -> Result<String, String> {
    session.host_key_hash(ssh2::HashType::Sha256)
        .map(|hash| format!("SHA256:{}", STANDARD_NO_PAD.encode(hash)))
        .ok_or_else(|| "无法读取服务器指纹".into())
}
fn hosts_path(app: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(|_| "无法读取应用目录")?;
    std::fs::create_dir_all(&dir).map_err(|_| "无法创建应用目录")?;
    Ok(dir.join("trusted-hosts.json"))
}
fn read_hosts(app: &tauri::AppHandle) -> Result<Value, String> {
    let path = hosts_path(app)?;
    match std::fs::read(&path) {
        Ok(data) => serde_json::from_slice(&data).map_err(|_| "服务器信任记录损坏".into()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(json!({})),
        Err(_) => Err("无法读取服务器信任记录".into()),
    }
}
#[tauri::command]
pub async fn inspect_host(app: tauri::AppHandle, host: String, port: u16) -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let session = handshake(&host, port)?;
        let fp = fingerprint(&session)?;
        let saved = read_hosts(&app)?;
        let key = format!("{host}:{port}");
        if let Some(previous) = saved[&key].as_str() {
            if previous != fp { return Err("服务器指纹已变化，连接已停止；请先核实服务器身份".into()); }
        }
        Ok(json!({"fingerprint": fp, "trusted": saved[&key].as_str() == Some(fp.as_str())}))
    }).await.map_err(|_| "SSH 检查中断")?
}
#[tauri::command]
pub async fn connect_server(app: tauri::AppHandle, state: tauri::State<'_, SshConnection>, host: String, port: u16, username: String, password: String, expected_fingerprint: String) -> Result<(), String> {
    let session = tauri::async_runtime::spawn_blocking(move || {
        if username.trim().is_empty() || password.is_empty() { return Err("请输入用户名和密码".into()); }
        let session = handshake(&host, port)?;
        let fp = fingerprint(&session)?;
        if fp != expected_fingerprint { return Err("服务器指纹不一致，连接已停止".into()); }
        let mut saved = read_hosts(&app)?;
        let key = format!("{host}:{port}");
        if let Some(previous) = saved[&key].as_str() {
            if previous != fp { return Err("服务器指纹已变化，连接已停止".into()); }
        }
        session.userauth_password(&username, &password)
            .map_err(|_| "SSH 登录失败，请检查用户名、密码及服务器是否允许密码登录")?;
        if !session.authenticated() { return Err("SSH 认证未完成".into()); }
        saved[&key] = json!(fp);
        std::fs::write(hosts_path(&app)?, serde_json::to_vec(&saved).map_err(|_| "指纹编码失败")?)
            .map_err(|_| "无法保存服务器指纹")?;
        session.set_timeout(115000);
        Ok(session)
    }).await.map_err(|_| "SSH 登录中断")??;
    *state.0.lock().map_err(|_| "SSH 状态不可用")? = Some(session);
    Ok(())
}
pub fn request(state: &SshConnection, mut request: Value) -> Result<Value, String> {
    let guard = state.0.lock().map_err(|_| "SSH 状态不可用")?;
    let session = guard.as_ref().ok_or("请先登录云服务器")?;
    let path = request["path"].as_str().ok_or("缺少服务路径")?;
    if !(path == "/health" || path == "/model-config" || path == "/model-config/test" || path == "/bots" || path.starts_with("/bots/")) {
        return Err("不支持的服务路径".into());
    }
    if request["port"].as_u64().filter(|p| *p > 0 && *p <= 65535).is_none() { request["port"] = json!(8001); }
    let script = include_str!("remote_bridge.py");
    let command = format!("python3 -c '{}'", script.replace('\'', "'\\''"));
    let mut channel = session.channel_session().map_err(|_| "SSH 已断开，请重新连接")?;
    channel.exec(&command).map_err(|_| "无法检查云端服务（需要 Python 3）")?;
    channel.write_all(serde_json::to_string(&request).map_err(|_| "请求编码失败")?.as_bytes()).map_err(|_| "无法发送服务请求")?;
    channel.send_eof().map_err(|_| "无法完成服务请求")?;
    let mut output = String::new();
    channel.read_to_string(&mut output).map_err(|_| "云端服务响应超时或 SSH 已断开")?;
    channel.wait_close().map_err(|_| "云端服务请求中断")?;
    serde_json::from_str(&output).map_err(|_| "云端服务检查失败，请确认服务器已安装 Python 3")
}
#[tauri::command]
pub async fn ssh_api(state: tauri::State<'_, SshConnection>, request: Value) -> Result<Value, String> {
    let shared = SshConnection(state.0.clone());
    tauri::async_runtime::spawn_blocking(move || self::request(&shared, request)).await.map_err(|_| "服务请求中断")?
}
#[tauri::command]
pub fn disconnect_server(state: tauri::State<'_, SshConnection>) -> Result<(), String> {
    if let Some(session) = state.0.lock().map_err(|_| "SSH 状态不可用")?.take() {
        let _ = session.disconnect(None, "Client disconnected", None);
    }
    Ok(())
}
