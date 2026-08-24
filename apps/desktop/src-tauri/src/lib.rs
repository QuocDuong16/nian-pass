mod clipboard;
mod commands;
mod dto;
mod state;

use std::sync::Arc;

use clipboard::TauriClipboard;
use commands::{
    copy_entry_password, copy_entry_username, entry_detail, lock_vault, reveal_entry_notes,
    reveal_entry_password, select_vault, unlock_vault, vault_snapshot,
};
use state::AppState;
use tauri::{Manager, Runtime};

fn with_desktop_plugins<R: Runtime>(builder: tauri::Builder<R>) -> tauri::Builder<R> {
    builder
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .setup(setup_app)
}

fn setup_app<R: Runtime>(app: &mut tauri::App<R>) -> Result<(), Box<dyn std::error::Error>> {
    install_app_state(app);
    Ok(())
}

fn install_app_state<R: Runtime>(app: &mut tauri::App<R>) {
    app.manage(AppState::new(Arc::new(TauriClipboard::new(
        app.handle().clone(),
    ))));
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    with_desktop_plugins(tauri::Builder::default())
        .invoke_handler(tauri::generate_handler![
            select_vault,
            unlock_vault,
            vault_snapshot,
            entry_detail,
            reveal_entry_password,
            reveal_entry_notes,
            copy_entry_username,
            copy_entry_password,
            lock_vault
        ])
        .run(tauri::generate_context!())
        .expect("Nian Pass desktop runtime failed");
}

#[cfg(test)]
mod tests {
    use tauri::test::{mock_app, mock_builder};

    use super::{setup_app, with_desktop_plugins};

    #[test]
    fn desktop_plugins_and_state_compose_without_launching_a_window() {
        let _builder = with_desktop_plugins(mock_builder());
        let mut app = mock_app();
        assert!(setup_app(&mut app).is_ok());
    }
}
