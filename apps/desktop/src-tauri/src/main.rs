#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::time::Duration;
use tauri::Manager;

struct SshTunnel(Mutex<Option<Child>>);

#[tauri::command]
fn connect_ssh(alias: String, remote_port: u16, tunnel: tauri::State<'_, SshTunnel>) -> Result<(), String> {
    if alias.is_empty() || alias.starts_with('-') || !alias.chars().all(|c| c.is_ascii_alphanumeric() || "._-".contains(c)) {
        return Err("请输入 SSH 配置中的主机别名".into());
    }
    if remote_port == 0 {
        return Err("远程端口无效".into());
    }
    let mut guard = tunnel.0.lock().map_err(|_| "SSH 状态不可用")?;
    if let Some(mut previous) = guard.take() {
        let _ = previous.kill();
        let _ = previous.wait();
    }
    let mut command = Command::new("ssh");
    command.args([
        "-o", "BatchMode=yes",
        "-o", "ExitOnForwardFailure=yes",
        "-o", "StrictHostKeyChecking=yes",
        "-N", "-L", &format!("127.0.0.1:18001:127.0.0.1:{remote_port}"), &alias,
    ]);
    command.stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000);
    }
    let mut child = command.spawn().map_err(|_| "无法启动 SSH，请检查系统是否安装 OpenSSH".to_string())?;
    std::thread::sleep(Duration::from_millis(600));
    if child.try_wait().map_err(|_| "无法检查 SSH 状态")?.is_some() {
        return Err("SSH 连接失败，请检查主机别名、密钥和服务器端口".into());
    }
    *guard = Some(child);
    Ok(())
}

fn main() {
    tauri::Builder::default()
        .manage(SshTunnel(Mutex::new(None)))
        .plugin(tauri_plugin_updater::Builder::new().build())
        .invoke_handler(tauri::generate_handler![connect_ssh])
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::Destroyed = event {
                if let Ok(mut guard) = window.state::<SshTunnel>().0.lock() {
                    if let Some(mut child) = guard.take() {
                        let _ = child.kill();
                        let _ = child.wait();
                    }
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("failed to run app");
}
