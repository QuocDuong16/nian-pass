#[cfg(any(desktop, test))]
mod browser_bridge;
#[cfg(any(desktop, test))]
mod browser_bridge_runtime;
#[cfg(any(desktop, test))]
mod clipboard;
#[cfg(any(desktop, test))]
mod close_trace;
#[cfg(any(desktop, test))]
mod command_support;
#[cfg(any(desktop, test))]
mod commands;
mod dto;
#[cfg(any(desktop, test))]
mod errors;
#[cfg(any(target_os = "android", target_os = "ios", test))]
mod mobile;
#[cfg(any(desktop, test))]
mod mutations;
#[cfg(any(desktop, test))]
mod persistence;
mod platform;
#[cfg(any(desktop, test))]
mod state;
#[cfg(any(desktop, test))]
mod sync;

#[cfg(desktop)]
use std::sync::Arc;

#[cfg(desktop)]
use browser_bridge::BrowserBridgeState;
#[cfg(desktop)]
use clipboard::TauriClipboard;
#[cfg(desktop)]
use commands::{
    close_policy, copy_entry_password, copy_entry_username, create_entry, create_group,
    create_vault, delete_entry, delete_entry_custom_field, delete_group, delete_sync_profile,
    discard_changes_and_lock, entry_detail, lock_vault, move_entry, move_group, reload_vault,
    rename_group, reset_sync_state, resolve_browser_connection, resolve_sync_conflict,
    reveal_entry_custom_field, reveal_entry_notes, reveal_entry_password, reveal_entry_title,
    reveal_entry_url, reveal_entry_username, runtime_info, save_sync_profile, save_vault,
    select_vault, set_entry_custom_field, sync_now, sync_profiles, test_sync_provider,
    unlock_vault, update_entry, vault_snapshot,
};
#[cfg(desktop)]
use state::AppState;
#[cfg(desktop)]
use sync::SyncRuntime;
#[cfg(desktop)]
use tauri::{Manager, Runtime};

#[cfg(desktop)]
fn with_desktop_plugins<R: Runtime>(builder: tauri::Builder<R>) -> tauri::Builder<R> {
    builder
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .setup(setup_app)
}

#[cfg(desktop)]
fn setup_app<R: Runtime>(app: &mut tauri::App<R>) -> Result<(), Box<dyn std::error::Error>> {
    install_app_state(app);
    let application_data = app.path().app_data_dir()?;
    let sync = SyncRuntime::new(application_data)
        .map_err(|_| std::io::Error::other("could not initialize private sync state"))?;
    app.manage(sync);
    Ok(())
}

#[cfg(desktop)]
fn install_app_state<R: Runtime>(app: &mut tauri::App<R>) {
    #[cfg(not(test))]
    install_app_state_with_bridge(app, BrowserBridgeState::start);
    #[cfg(test)]
    install_app_state_with_bridge(app, |_, _| BrowserBridgeState::unavailable());
}

#[cfg(desktop)]
fn install_app_state_with_bridge<R: Runtime>(
    app: &mut tauri::App<R>,
    create_bridge: impl FnOnce(tauri::AppHandle<R>, AppState) -> BrowserBridgeState,
) {
    let state = AppState::new(Arc::new(TauriClipboard::new(app.handle().clone())));
    app.manage(state.clone());
    let bridge = create_bridge(app.handle().clone(), state);
    app.manage(bridge);
}

#[cfg(desktop)]
fn should_exit_after_window_destroyed(label: &str, event: &tauri::WindowEvent) -> bool {
    label == "main" && matches!(event, tauri::WindowEvent::Destroyed)
}

#[cfg(not(any(target_os = "android", target_os = "ios")))]
pub fn run() {
    let app = with_desktop_plugins(tauri::Builder::default())
        .invoke_handler(tauri::generate_handler![
            runtime_info,
            select_vault,
            create_vault,
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
            discard_changes_and_lock,
            resolve_browser_connection,
            sync_profiles,
            save_sync_profile,
            delete_sync_profile,
            reset_sync_state,
            test_sync_provider,
            sync_now,
            resolve_sync_conflict
        ])
        .build(tauri::generate_context!())
        .expect("Nian Pass desktop runtime failed");

    close_trace::trace("RUST_APP_RUNNING");
    app.run(|app_handle, event| {
        if let tauri::RunEvent::WindowEvent { label, event, .. } = event {
            if label == "main" && matches!(event, tauri::WindowEvent::CloseRequested { .. }) {
                close_trace::trace("RUST_WINDOW_CLOSE_REQUESTED");
            }
            if should_exit_after_window_destroyed(&label, &event) {
                close_trace::trace("RUST_WINDOW_DESTROYED");
                close_trace::trace("RUST_BROWSER_BRIDGE_SHUTDOWN_BEGIN");
                app_handle.state::<BrowserBridgeState>().shutdown();
                close_trace::trace("RUST_BROWSER_BRIDGE_SHUTDOWN_END");
                close_trace::trace("RUST_APP_EXIT_REQUESTED");
                app_handle.exit(0);
            }
        }
    });
}

#[cfg(any(target_os = "android", target_os = "ios"))]
#[tauri::mobile_entry_point]
pub fn run() {
    run_mobile();
}

#[cfg(target_os = "android")]
fn run_mobile() {
    use mobile::autofill_commands::{
        mobile_autofill_approve, mobile_autofill_cancel, mobile_autofill_candidates,
        mobile_autofill_publish_candidates, mobile_autofill_request, mobile_autofill_status,
        mobile_disable_autofill_for_vault, mobile_enable_autofill_for_vault,
        mobile_open_autofill_settings,
    };
    use mobile::commands::{
        mobile_create_entry, mobile_create_group, mobile_delete_entry,
        mobile_delete_entry_custom_field, mobile_delete_group, mobile_discard_changes_and_lock,
        mobile_entry_detail, mobile_load_entry_custom_field, mobile_load_entry_notes,
        mobile_load_entry_title, mobile_load_entry_url, mobile_load_entry_username,
        mobile_lock_vault, mobile_move_entry, mobile_move_group, mobile_reload_vault,
        mobile_rename_group, mobile_save_vault, mobile_select_vault, mobile_set_entry_custom_field,
        mobile_unlock_vault, mobile_update_entry, mobile_vault_snapshot, runtime_info,
    };
    use mobile::security_commands::{mobile_security_acknowledge_safe_ui, mobile_security_resume};

    tauri::Builder::default()
        .plugin(mobile::source::init())
        .setup(|app| {
            mobile::install_state(app);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            runtime_info,
            mobile_select_vault,
            mobile_unlock_vault,
            mobile_vault_snapshot,
            mobile_entry_detail,
            mobile_load_entry_title,
            mobile_load_entry_username,
            mobile_load_entry_url,
            mobile_load_entry_notes,
            mobile_load_entry_custom_field,
            mobile_update_entry,
            mobile_create_entry,
            mobile_delete_entry,
            mobile_move_entry,
            mobile_create_group,
            mobile_rename_group,
            mobile_move_group,
            mobile_delete_group,
            mobile_set_entry_custom_field,
            mobile_delete_entry_custom_field,
            mobile_save_vault,
            mobile_reload_vault,
            mobile_lock_vault,
            mobile_discard_changes_and_lock,
            mobile_security_resume,
            mobile_security_acknowledge_safe_ui,
            mobile_autofill_status,
            mobile_enable_autofill_for_vault,
            mobile_disable_autofill_for_vault,
            mobile_autofill_request,
            mobile_autofill_candidates,
            mobile_autofill_publish_candidates,
            mobile_autofill_approve,
            mobile_autofill_cancel,
            mobile_open_autofill_settings
        ])
        .run(tauri::generate_context!())
        .expect("Nian Pass Android runtime failed");
}

#[cfg(target_os = "ios")]
fn run_mobile() {
    use mobile::commands::runtime_info;
    use mobile::ios_commands::{
        mobile_autofill_status, mobile_disable_autofill_for_vault,
        mobile_enable_autofill_for_vault, mobile_entry_detail, mobile_lock_vault,
        mobile_open_autofill_settings, mobile_refresh_ios_autofill_mirror, mobile_select_vault,
        mobile_unlock_vault, mobile_vault_snapshot,
    };

    tauri::Builder::default()
        .plugin(mobile::source_ios::init())
        .setup(|app| {
            mobile::install_state(app);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            runtime_info,
            mobile_select_vault,
            mobile_unlock_vault,
            mobile_vault_snapshot,
            mobile_entry_detail,
            mobile_lock_vault,
            mobile_autofill_status,
            mobile_enable_autofill_for_vault,
            mobile_disable_autofill_for_vault,
            mobile_refresh_ios_autofill_mirror,
            mobile_open_autofill_settings
        ])
        .run(tauri::generate_context!())
        .expect("Nian Pass iOS runtime failed");
}

#[cfg(test)]
mod tests {
    use std::path::Path;

    use tauri::{
        Manager as _,
        test::{mock_app, mock_builder},
    };
    use vault_core::SecretString;

    use super::{
        AppState, BrowserBridgeState, install_app_state_with_bridge, setup_app,
        should_exit_after_window_destroyed, with_desktop_plugins,
    };

    #[test]
    fn desktop_plugins_and_state_compose_without_launching_a_window() {
        let _builder = with_desktop_plugins(mock_builder());
        let mut app = mock_app();
        assert!(setup_app(&mut app).is_ok());
    }

    #[test]
    fn unavailable_browser_bridge_does_not_block_normal_vault_use() {
        let mut app = mock_app();
        install_app_state_with_bridge(&mut app, |_, _| BrowserBridgeState::unavailable());
        assert!(!app.state::<BrowserBridgeState>().is_available());

        let state = app.state::<AppState>();
        let mut service = state
            .service
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        let fixture = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../../../fixtures/kdbx/keepassxc-2.7.12-kdbx41.kdbx");
        service
            .select_path(fixture)
            .unwrap_or_else(|error| panic!("fixture must remain selectable: {error:?}"));
        service
            .unlock(SecretString::new("demopass".to_owned()))
            .unwrap_or_else(|error| panic!("fixture must remain unlockable: {error:?}"));
        let snapshot = service
            .snapshot()
            .unwrap_or_else(|error| panic!("snapshot must remain available: {error:?}"));
        assert!(!snapshot.entries.is_empty());
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

    #[test]
    fn only_main_window_destruction_requests_desktop_exit() {
        assert!(should_exit_after_window_destroyed(
            "main",
            &tauri::WindowEvent::Destroyed
        ));
        assert!(!should_exit_after_window_destroyed(
            "browser-approval",
            &tauri::WindowEvent::Destroyed
        ));
        assert!(!should_exit_after_window_destroyed(
            "main",
            &tauri::WindowEvent::Focused(false)
        ));
    }
}
