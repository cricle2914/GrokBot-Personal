#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod ssh;
mod model;

fn main() {
    tauri::Builder::default()
        .manage(ssh::SshConnection::default())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .invoke_handler(tauri::generate_handler![ssh::inspect_host, ssh::connect_server, ssh::ssh_api, ssh::disconnect_server, model::load_model, model::save_model, model::test_model, model::sync_model])
        .run(tauri::generate_context!())
        .expect("failed to run app");
}
