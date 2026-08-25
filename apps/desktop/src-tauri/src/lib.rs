mod clipboard;
mod commands;
mod dto;
mod errors;
mod mutations;
mod persistence;
mod state;

use std::sync::Arc;

use clipboard::TauriClipboard;
use commands::{
    close_policy, copy_entry_password, copy_entry_username, create_entry, create_group,
    delete_entry, delete_entry_custom_field, delete_group, discard_changes_and_lock, entry_detail,
    lock_vault, move_entry, move_group, reload_vault, rename_group, reveal_entry_custom_field,
    reveal_entry_notes, reveal_entry_password, reveal_entry_title, reveal_entry_url,
    reveal_entry_username, save_vault, select_vault, set_entry_custom_field, unlock_vault,
    update_entry, vault_snapshot,
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
            save_vault,
            reload_vault,
            entry_detail,
            reveal_entry_password,
            reveal_entry_notes,
            reveal_entry_title,
            reveal_entry_username,
            reveal_entry_url,
            reveal_entry_custom_field,
            copy_entry_username,
            copy_entry_password,
            update_entry,
            create_entry,
            delete_entry,
            move_entry,
            create_group,
            rename_group,
            move_group,
            delete_group,
            set_entry_custom_field,
            delete_entry_custom_field,
            close_policy,
            lock_vault,
            discard_changes_and_lock
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

    #[test]
    fn m44_command_surface_has_no_stale_source_bypass() {
        let command_source = concat!(include_str!("commands.rs"), include_str!("persistence.rs"));
        let forbidden = [
            ["save_", "force"].concat(),
            ["ignore_", "fingerprint"].concat(),
            ["overwrite_", "anyway"].concat(),
        ];
        for name in forbidden {
            assert!(!command_source.contains(&name));
        }
    }
}
