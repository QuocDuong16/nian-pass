mod commands;
mod dto;
mod state;

use commands::{lock_vault, select_vault, unlock_vault, vault_snapshot};
use state::AppState;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(AppState::default())
        .invoke_handler(tauri::generate_handler![
            select_vault,
            unlock_vault,
            vault_snapshot,
            lock_vault
        ])
        .run(tauri::generate_context!())
        .expect("Nian Pass desktop runtime failed");
}
