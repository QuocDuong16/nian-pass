use tauri::{AppHandle, State};
use tauri_plugin_dialog::{DialogExt, FilePath};
use vault_core::SecretString;
use vault_session::VaultSession;

mod attachments;
mod clipboard;
mod custom_icons;
mod database_settings;
mod export_copy;
mod keyfile;
mod sync;
mod url_open;
mod vault_mutations;
pub use self::{
    attachments::*, clipboard::*, custom_icons::*, database_settings::*, export_copy::*,
    keyfile::*, sync::*, url_open::*, vault_mutations::*,
};

use crate::dto::{EntryDetailDto, SelectedVaultDto, VaultSnapshotDto};
use crate::platform::RuntimeInfoDto;

use crate::{
    browser_bridge::BrowserBridgeState,
    command_support::reveal_entry_value,
    dto::{ClosePolicyDto, LockResultDto, TotpCodeDto},
    errors::DesktopErrorDto,
    state::{AppState, DesktopError},
};

#[tauri::command]
pub fn resolve_browser_connection(
    request_id: String,
    allow: bool,
    state: State<'_, BrowserBridgeState>,
) -> Result<(), DesktopErrorDto> {
    if state.resolve(&request_id, allow) {
        Ok(())
    } else {
        Err(DesktopError::InvalidRequest.into())
    }
}

#[tauri::command]
pub fn runtime_info() -> RuntimeInfoDto {
    RuntimeInfoDto::current()
}

#[tauri::command]
pub async fn select_vault<R: tauri::Runtime>(
    app: AppHandle<R>,
    state: State<'_, AppState>,
) -> Result<Option<SelectedVaultDto>, DesktopErrorDto> {
    let _operation = state
        .begin_vault_operation()
        .map_err(DesktopErrorDto::from)?;
    let dialog = app
        .dialog()
        .file()
        .add_filter("KeePass database", &["kdbx"]);
    let selected = tauri::async_runtime::spawn_blocking(move || dialog.blocking_pick_file())
        .await
        .map_err(|_| DesktopErrorDto::from(DesktopError::Internal))?;

    let Some(selected) = selected else {
        return Ok(None);
    };
    let path = match selected {
        FilePath::Path(path) => path,
        FilePath::Url(_) => return Err(DesktopError::UnsupportedVault.into()),
    };

    let mut service = state
        .service
        .lock()
        .map_err(|_| DesktopErrorDto::from(DesktopError::Internal))?;
    service.select_path(path).map(Some).map_err(Into::into)
}

#[tauri::command]
pub async fn create_vault<R: tauri::Runtime>(
    app: AppHandle<R>,
    vault_name: String,
    password: String,
    state: State<'_, AppState>,
) -> Result<Option<VaultSnapshotDto>, DesktopErrorDto> {
    let dialog = app
        .dialog()
        .file()
        .add_filter("KeePass database", &["kdbx"])
        .set_file_name("vault.kdbx");
    create_vault_with_picker(vault_name, password, state, move || {
        dialog.blocking_save_file()
    })
    .await
}

async fn create_vault_with_picker(
    vault_name: String,
    password: String,
    state: State<'_, AppState>,
    picker: impl FnOnce() -> Option<FilePath> + Send + 'static,
) -> Result<Option<VaultSnapshotDto>, DesktopErrorDto> {
    create_vault_with_persistence_capability(
        vault_name,
        password,
        state,
        VaultSession::ordinary_save_supported(),
        picker,
    )
    .await
}

async fn create_vault_with_persistence_capability(
    vault_name: String,
    password: String,
    state: State<'_, AppState>,
    persistence_supported: bool,
    picker: impl FnOnce() -> Option<FilePath> + Send + 'static,
) -> Result<Option<VaultSnapshotDto>, DesktopErrorDto> {
    let vault_name = vault_name.trim().to_owned();
    if vault_name.is_empty() || password.is_empty() {
        return Err(DesktopError::InvalidRequest.into());
    }
    let operation = state
        .begin_vault_operation()
        .map_err(DesktopErrorDto::from)?;
    if !persistence_supported {
        return Err(DesktopError::UnsupportedPersistencePlatform.into());
    }
    let selected = tauri::async_runtime::spawn_blocking(picker)
        .await
        .map_err(|_| DesktopErrorDto::from(DesktopError::Internal))?;
    let Some(selected) = selected else {
        return Ok(None);
    };
    let path = match selected {
        FilePath::Path(path) => path,
        FilePath::Url(_) => return Err(DesktopError::UnsupportedVault.into()),
    };
    let service = state.service.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let _operation = operation;
        let credential = SecretString::new(password);
        let mut service = service.lock().map_err(|_| DesktopError::Internal)?;
        service.create(path, &vault_name, credential).map(Some)
    })
    .await
    .map_err(|_| DesktopErrorDto::from(DesktopError::Internal))?
    .map_err(Into::into)
}

#[tauri::command]
pub async fn unlock_vault(
    password: String,
    state: State<'_, AppState>,
) -> Result<VaultSnapshotDto, DesktopErrorDto> {
    let service = state.service.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let credential = SecretString::new(password);
        let mut service = service.lock().map_err(|_| DesktopError::Internal)?;
        service.unlock(credential)
    })
    .await
    .map_err(|_| DesktopErrorDto::from(DesktopError::Internal))?
    .map_err(Into::into)
}

#[tauri::command]
pub async fn unlock_vault_with_keyfile(
    password: Option<String>,
    state: State<'_, AppState>,
) -> Result<VaultSnapshotDto, DesktopErrorDto> {
    let service = state.service.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let password = password.map(SecretString::new);
        let mut service = service.lock().map_err(|_| DesktopError::Internal)?;
        service.unlock_with_components(password)
    })
    .await
    .map_err(|_| DesktopErrorDto::from(DesktopError::Internal))?
    .map_err(Into::into)
}

#[tauri::command]
pub fn vault_snapshot(state: State<'_, AppState>) -> Result<VaultSnapshotDto, DesktopErrorDto> {
    let service = state
        .service
        .lock()
        .map_err(|_| DesktopErrorDto::from(DesktopError::Internal))?;
    service.snapshot().map_err(Into::into)
}

#[tauri::command]
pub async fn save_vault(state: State<'_, AppState>) -> Result<VaultSnapshotDto, DesktopErrorDto> {
    crate::persistence::save(state).await
}

#[tauri::command]
pub async fn change_master_password(
    new_password: String,
    state: State<'_, AppState>,
) -> Result<VaultSnapshotDto, DesktopErrorDto> {
    crate::persistence::change_master_password(new_password, state).await
}

#[tauri::command]
pub async fn remove_master_password(
    state: State<'_, AppState>,
) -> Result<VaultSnapshotDto, DesktopErrorDto> {
    crate::persistence::remove_master_password(state).await
}

#[tauri::command]
pub async fn reload_vault(
    password: Option<String>,
    state: State<'_, AppState>,
) -> Result<VaultSnapshotDto, DesktopErrorDto> {
    crate::persistence::reload(password, state).await
}

#[tauri::command]
pub fn entry_detail(
    entry_id: String,
    state: State<'_, AppState>,
) -> Result<EntryDetailDto, DesktopErrorDto> {
    let service = state
        .service
        .lock()
        .map_err(|_| DesktopErrorDto::from(DesktopError::Internal))?;
    service.entry_detail(&entry_id).map_err(Into::into)
}

#[tauri::command]
pub fn reveal_entry_password(
    entry_id: String,
    state: State<'_, AppState>,
) -> Result<String, DesktopErrorDto> {
    let service = state
        .service
        .lock()
        .map_err(|_| DesktopErrorDto::from(DesktopError::Internal))?;
    let secret = service.entry_password(&entry_id)?;
    Ok(secret.expose_secret().to_owned())
}

#[tauri::command]
pub fn reveal_entry_totp(
    entry_id: String,
    state: State<'_, AppState>,
) -> Result<TotpCodeDto, DesktopErrorDto> {
    let service = state
        .service
        .lock()
        .map_err(|_| DesktopErrorDto::from(DesktopError::Internal))?;
    let value = service.entry_totp_code(&entry_id)?;
    Ok(TotpCodeDto {
        code: value.code().expose_secret().to_owned(),
        valid_for_seconds: value.valid_for_seconds(),
        period_seconds: value.period_seconds(),
    })
}

#[tauri::command]
pub fn reveal_entry_notes(
    entry_id: String,
    state: State<'_, AppState>,
) -> Result<String, DesktopErrorDto> {
    let service = state
        .service
        .lock()
        .map_err(|_| DesktopErrorDto::from(DesktopError::Internal))?;
    let secret = service.entry_notes(&entry_id)?;
    Ok(secret.expose_secret().to_owned())
}

#[tauri::command]
pub fn reveal_entry_title(
    entry_id: String,
    state: State<'_, AppState>,
) -> Result<String, DesktopErrorDto> {
    reveal_entry_value(
        entry_id,
        state,
        crate::state::DesktopVaultService::entry_title,
    )
}

#[tauri::command]
pub fn reveal_entry_username(
    entry_id: String,
    state: State<'_, AppState>,
) -> Result<String, DesktopErrorDto> {
    reveal_entry_value(
        entry_id,
        state,
        crate::state::DesktopVaultService::entry_username,
    )
}

#[tauri::command]
pub fn reveal_entry_url(
    entry_id: String,
    state: State<'_, AppState>,
) -> Result<String, DesktopErrorDto> {
    reveal_entry_value(
        entry_id,
        state,
        crate::state::DesktopVaultService::entry_url,
    )
}

#[tauri::command]
pub fn reveal_entry_custom_field(
    entry_id: String,
    name: String,
    state: State<'_, AppState>,
) -> Result<String, DesktopErrorDto> {
    let service = state
        .service
        .lock()
        .map_err(|_| DesktopErrorDto::from(DesktopError::Internal))?;
    let secret = service.entry_custom_field(&entry_id, &name)?;
    Ok(secret.expose_secret().to_owned())
}

#[tauri::command]
pub async fn close_policy(state: State<'_, AppState>) -> Result<ClosePolicyDto, DesktopErrorDto> {
    crate::close_trace::trace("RUST_CLOSE_POLICY_ENTER");
    let state = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        crate::close_trace::trace("RUST_CLOSE_POLICY_BEFORE_SERVICE_LOCK");
        let service = state
            .service
            .lock()
            .map_err(|_| DesktopErrorDto::from(DesktopError::Internal))?;
        crate::close_trace::trace("RUST_CLOSE_POLICY_SERVICE_LOCKED");
        let policy = service.close_policy();
        match policy {
            ClosePolicyDto::Allow => crate::close_trace::trace("RUST_CLOSE_POLICY_RESULT_ALLOW"),
            ClosePolicyDto::ConfirmDiscard => {
                crate::close_trace::trace("RUST_CLOSE_POLICY_RESULT_CONFIRM_DISCARD");
            }
        }
        Ok(policy)
    })
    .await
    .map_err(|_| DesktopErrorDto::from(DesktopError::Internal))?
}

#[tauri::command]
pub async fn lock_vault(state: State<'_, AppState>) -> Result<LockResultDto, DesktopErrorDto> {
    let state = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || state.lock().map(Into::into))
        .await
        .map_err(|_| DesktopErrorDto::from(DesktopError::Internal))?
        .map_err(Into::into)
}

#[tauri::command]
pub async fn discard_changes_and_lock(
    state: State<'_, AppState>,
) -> Result<LockResultDto, DesktopErrorDto> {
    let state = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || state.discard_changes_and_lock().map(Into::into))
        .await
        .map_err(|_| DesktopErrorDto::from(DesktopError::Internal))?
        .map_err(Into::into)
}
#[cfg(test)]
mod tests {
    use std::{
        fs, io,
        path::{Path, PathBuf},
        sync::{
            Arc, Mutex,
            atomic::{AtomicU64, Ordering},
        },
    };

    use kdbx::KdbxCredential;
    use serde::de::DeserializeOwned;
    use serde_json::{Value, from_str, from_value, json, to_value};
    use tauri::{
        Manager,
        test::{mock_app, mock_builder, mock_context, noop_assets},
    };
    use vault_core::{EntryId, SecretBytes, SecretString};
    use vault_session::VaultSession;

    use super::{
        change_master_password, clear_keyfile, close_policy, copy_entry_custom_field,
        copy_entry_notes, copy_entry_password, copy_entry_title, copy_entry_totp_code,
        copy_entry_url, copy_entry_username, create_entry, create_group, create_vault,
        create_vault_with_persistence_capability, create_vault_with_picker,
        credential_has_password, delete_entry, delete_entry_custom_field, delete_group,
        delete_sync_profile, discard_changes_and_lock, duplicate_entry, entry_detail,
        entry_history, lock_vault, move_entries, move_entry, move_group, password_health_report,
        permanently_delete_entries, permanently_delete_entry, permanently_delete_group,
        reload_vault, remove_master_password, rename_group, reset_sync_state,
        resolve_browser_connection, resolve_sync_conflict, restore_entries, restore_entry,
        restore_entry_history, restore_group, reveal_entry_custom_field, reveal_entry_notes,
        reveal_entry_password, reveal_entry_title, reveal_entry_totp, reveal_entry_url,
        reveal_entry_username, runtime_info, save_sync_profile, save_vault, select_keyfile,
        select_vault, set_entry_custom_field, set_entry_tags, sync_now, sync_profiles,
        test_sync_provider, trash_entries, unlock_vault_with_keyfile, update_entry,
    };
    use crate::{
        browser_bridge::BrowserBridgeState,
        clipboard::ClipboardPort,
        dto::ClosePolicyDto,
        errors::DesktopErrorDto,
        mutations::{
            BulkDeleteEntriesRequestDto, BulkMoveEntriesRequestDto, BulkRestoreEntriesRequestDto,
            BulkTrashEntriesRequestDto, CreateEntryRequestDto, CreateGroupRequestDto,
            MoveEntryRequestDto, MoveGroupRequestDto, RenameGroupRequestDto,
            SetCustomFieldRequestDto, SetEntryTagsRequestDto, UpdateEntryRequestDto,
        },
        state::{AppState, DesktopError},
        sync::{
            ProviderCredentialsDto, ResolveSyncConflictRequestDto, SaveSyncProfileRequestDto,
            SyncRuntime,
        },
    };

    static TEST_DIRECTORY_SEQUENCE: AtomicU64 = AtomicU64::new(0);

    #[test]
    fn runtime_info_command_exposes_safe_build_metadata() {
        let encoded = serde_json::to_value(runtime_info()).expect("runtime info should serialize");
        assert_eq!(encoded["platform"], json!("desktop"));
        assert_eq!(encoded["version"], json!(env!("CARGO_PKG_VERSION")));
        assert!(encoded["commit"].as_str().is_some());
    }

    #[test]
    fn browser_connection_resolution_is_narrow_and_single_use() {
        let request_id = "00112233445566778899aabbccddeeff";
        let (bridge, receiver) = BrowserBridgeState::with_pending_request(request_id);
        let app = mock_app();
        app.manage(bridge);
        assert!(resolve_browser_connection(request_id.to_owned(), true, app.state()).is_ok());
        assert_eq!(receiver.try_recv(), Ok(true));
        assert!(resolve_browser_connection(request_id.to_owned(), true, app.state()).is_err());
    }

    #[test]
    fn unavailable_browser_bridge_rejects_resolution_without_panicking() {
        let app = mock_app();
        app.manage(BrowserBridgeState::unavailable());
        assert!(
            resolve_browser_connection(
                "00112233445566778899aabbccddeeff".to_owned(),
                true,
                app.state()
            )
            .is_err()
        );
    }

    #[test]
    fn vault_selection_obeys_the_shared_operation_gate_before_opening_a_dialog() {
        let app = unlocked_app();
        let state = app.state::<AppState>();
        let _active_operation = state
            .begin_vault_operation()
            .expect("first operation should acquire the gate");
        let result = tauri::async_runtime::block_on(select_vault(app.handle().clone(), state));
        let Err(error) = result else {
            panic!("a concurrent source switch must be rejected");
        };
        assert_eq!(
            to_value(error).expect("stable error should serialize"),
            json!({ "code": "operation_in_progress" })
        );
    }

    #[test]
    fn keyfile_commands_share_the_vault_operation_gate_and_clear_through_the_wrapper() {
        let app = mock_app();
        app.manage(AppState::new(Arc::new(FakeClipboard(Mutex::new(None)))));
        let state = app.state::<AppState>();
        let active = state
            .begin_vault_operation()
            .expect("first operation should acquire the gate");

        let result =
            tauri::async_runtime::block_on(select_keyfile(app.handle().clone(), state.clone()));
        let Err(error) = result else {
            panic!("busy keyfile command must fail before opening the picker");
        };
        assert_eq!(
            to_value(error).expect("stable busy error"),
            json!({ "code": "operation_in_progress" })
        );

        drop(active);
        assert!(clear_keyfile(state).is_ok());
    }

    #[test]
    fn keyfile_unlock_command_preserves_typed_service_failures() {
        let app = mock_app();
        app.manage(AppState::new(Arc::new(FakeClipboard(Mutex::new(None)))));
        let state = app.state::<AppState>();

        let result = tauri::async_runtime::block_on(unlock_vault_with_keyfile(None, state));
        let Err(error) = result else {
            panic!("unlock without a selected vault must fail");
        };
        assert_eq!(
            to_value(error).expect("stable unlock error"),
            json!({ "code": "no_vault_selected" })
        );
    }

    #[test]
    fn create_vault_command_builds_native_picker_but_honors_gate_before_showing_it() {
        let app = mock_builder()
            .plugin(tauri_plugin_dialog::init())
            .build(mock_context(noop_assets()))
            .expect("dialog plugin should compose with mock runtime");
        app.manage(AppState::new(Arc::new(FakeClipboard(Mutex::new(None)))));
        let state = app.state::<AppState>();
        let _active = state
            .begin_vault_operation()
            .expect("test operation should acquire gate");
        let result = tauri::async_runtime::block_on(create_vault(
            app.handle().clone(),
            "Personal".to_owned(),
            "demopass".to_owned(),
            state,
        ));
        let Err(error) = result else {
            panic!("busy create must fail before showing the picker");
        };
        assert_eq!(
            to_value(error).expect("stable busy error"),
            json!({ "code": "operation_in_progress" })
        );
    }

    #[cfg(not(windows))]
    #[test]
    fn create_vault_picker_flow_validates_gates_cancels_and_creates_without_gui() {
        let app = mock_app();
        app.manage(AppState::new(Arc::new(FakeClipboard(Mutex::new(None)))));
        let state = app.state::<AppState>();

        let invalid = tauri::async_runtime::block_on(create_vault_with_picker(
            "   ".to_owned(),
            "demopass".to_owned(),
            state.clone(),
            || panic!("invalid create request must not invoke the picker"),
        ));
        let Err(invalid) = invalid else {
            panic!("blank vault name should fail");
        };
        assert_eq!(
            to_value(invalid).expect("stable create error"),
            json!({ "code": "invalid_request" })
        );

        let active = state
            .begin_vault_operation()
            .expect("test operation should acquire gate");
        let busy = tauri::async_runtime::block_on(create_vault_with_picker(
            "Personal".to_owned(),
            "demopass".to_owned(),
            state.clone(),
            || panic!("busy create request must not invoke the picker"),
        ));
        drop(active);
        let Err(busy) = busy else {
            panic!("busy create should fail");
        };
        assert_eq!(
            to_value(busy).expect("stable busy error"),
            json!({ "code": "operation_in_progress" })
        );

        let Ok(cancelled) = tauri::async_runtime::block_on(create_vault_with_picker(
            "Personal".to_owned(),
            "demopass".to_owned(),
            state.clone(),
            || None,
        )) else {
            panic!("picker cancellation should not be an error");
        };
        assert!(cancelled.is_none());

        let directory = TestDir::create();
        let path = directory.0.join("created-command.kdbx");
        let Ok(Some(created)) = tauri::async_runtime::block_on(create_vault_with_picker(
            "  Personal  ".to_owned(),
            "demopass".to_owned(),
            state,
            {
                let path = path.clone();
                move || Some(tauri_plugin_dialog::FilePath::Path(path))
            },
        )) else {
            panic!("command create should succeed with a snapshot");
        };
        assert_eq!(created.file_name, "created-command.kdbx");
        assert_eq!(created.groups.first().expect("root group").name, "Personal");
        assert!(created.capabilities.writable);
        assert!(path.is_file());
        let created_bytes = std::fs::read(&path).expect("created vault should be readable");

        let duplicate_app = mock_app();
        duplicate_app.manage(AppState::new(Arc::new(FakeClipboard(Mutex::new(None)))));
        let duplicate_path = path.clone();
        let duplicate = tauri::async_runtime::block_on(create_vault_with_picker(
            "Duplicate".to_owned(),
            "demopass".to_owned(),
            duplicate_app.state::<AppState>(),
            move || Some(tauri_plugin_dialog::FilePath::Path(duplicate_path)),
        ));
        let Err(duplicate) = duplicate else {
            panic!("existing target must not be overwritten");
        };
        assert_eq!(
            to_value(duplicate).expect("stable duplicate error"),
            json!({ "code": "vault_already_exists" })
        );
        assert_eq!(
            std::fs::read(&path).expect("existing vault should remain readable"),
            created_bytes,
            "a duplicate create request must preserve the existing vault bytes"
        );
    }

    #[cfg(not(windows))]
    #[test]
    fn create_vault_rejects_unsupported_capability_before_picker() {
        let app = mock_app();
        app.manage(AppState::new(Arc::new(FakeClipboard(Mutex::new(None)))));
        let result = tauri::async_runtime::block_on(create_vault_with_persistence_capability(
            "Personal".to_owned(),
            "demopass".to_owned(),
            app.state::<AppState>(),
            false,
            || panic!("unsupported persistence must not show the save picker"),
        ));
        let Err(error) = result else {
            panic!("unsupported persistence must stop vault creation");
        };
        assert_eq!(
            to_value(error).expect("stable unsupported-platform error"),
            json!({ "code": "unsupported_persistence_platform" })
        );
    }

    #[cfg(windows)]
    #[test]
    fn create_vault_picker_flow_rejects_unsupported_persistence_before_picker() {
        let app = mock_app();
        app.manage(AppState::new(Arc::new(FakeClipboard(Mutex::new(None)))));
        let result = tauri::async_runtime::block_on(create_vault_with_picker(
            "Personal".to_owned(),
            "demopass".to_owned(),
            app.state::<AppState>(),
            || panic!("unsupported Windows create must not show the save picker"),
        ));
        let Err(error) = result else {
            panic!("Windows create must fail closed while ordinary Save is disabled");
        };
        assert_eq!(
            to_value(error).expect("stable unsupported-platform error"),
            json!({ "code": "unsupported_persistence_platform" })
        );
    }

    struct TestDir(PathBuf);

    impl TestDir {
        fn create() -> Self {
            let parent = std::env::temp_dir();
            for _ in 0..128 {
                let sequence = TEST_DIRECTORY_SEQUENCE.fetch_add(1, Ordering::Relaxed);
                let path = parent.join(format!(
                    "nian-pass-desktop-command-test-{}-{sequence}",
                    std::process::id()
                ));
                match fs::create_dir(&path) {
                    Ok(()) => return Self(path),
                    Err(error) if error.kind() == io::ErrorKind::AlreadyExists => continue,
                    Err(error) => panic!("could not create command test directory: {error}"),
                }
            }
            panic!("could not allocate command test directory");
        }
    }

    impl Drop for TestDir {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    struct FakeClipboard(Mutex<Option<String>>);

    impl ClipboardPort for FakeClipboard {
        fn write_text(&self, value: &str) -> Result<(), ()> {
            *self.0.lock().map_err(|_| ())? = Some(value.to_owned());
            Ok(())
        }

        fn read_text(&self) -> Result<Option<String>, ()> {
            self.0.lock().map_err(|_| ()).map(|value| value.clone())
        }

        fn clear(&self) -> Result<(), ()> {
            *self.0.lock().map_err(|_| ())? = None;
            Ok(())
        }
    }

    fn unlocked_app() -> tauri::App<tauri::test::MockRuntime> {
        let app = mock_app();
        let state = AppState::new(Arc::new(FakeClipboard(Mutex::new(None))));
        {
            let mut service = state.service.lock().expect("desktop service lock");
            let path = Path::new(env!("CARGO_MANIFEST_DIR"))
                .join("../../../fixtures/kdbx/keepassxc-2.7.12-kdbx41.kdbx");
            service
                .select_path(path)
                .expect("fixture path should be selectable");
            service
                .unlock(SecretString::new("demopass".to_owned()))
                .expect("fixture should unlock");
        }
        app.manage(state);
        app
    }

    fn writable_app() -> (TestDir, PathBuf, tauri::App<tauri::test::MockRuntime>) {
        let directory = TestDir::create();
        let path = directory.0.join("vault.kdbx");
        fs::copy(
            Path::new(env!("CARGO_MANIFEST_DIR"))
                .join("../../../fixtures/kdbx/keepassxc-2.7.12-kdbx41.kdbx"),
            &path,
        )
        .expect("fixture copy should succeed");
        let app = mock_app();
        let state = AppState::new(Arc::new(FakeClipboard(Mutex::new(None))));
        {
            let mut service = state.service.lock().expect("desktop service lock");
            service
                .select_path(path.clone())
                .expect("temporary fixture should be selectable");
            service
                .unlock(SecretString::new("demopass".to_owned()))
                .expect("temporary fixture should unlock");
        }
        app.manage(state);
        (directory, path, app)
    }

    fn request<T: DeserializeOwned>(value: Value) -> T {
        from_value(value).expect("synthetic command request should deserialize")
    }

    #[cfg(unix)]
    #[test]
    fn save_command_uses_retained_session_authority_and_returns_only_canonical_snapshot() {
        let (_directory, path, app) = writable_app();
        let state = app.state::<AppState>();
        let entry_id = {
            let mut service = state.service.lock().expect("desktop service lock");
            let entry_id = service
                .snapshot()
                .expect("snapshot should exist")
                .entries
                .first()
                .expect("fixture entry")
                .id
                .clone();
            service
                .session_mut()
                .expect("session should exist")
                .document_mut()
                .set_entry_title(&EntryId::new(entry_id.clone()), "command local B")
                .expect("local mutation should succeed");
            entry_id
        };
        let before = fs::read(&path).expect("source should be readable");
        let Ok(saved) = tauri::async_runtime::block_on(save_vault(state.clone())) else {
            panic!("save command should succeed with retained session authority");
        };
        assert!(!saved.dirty);
        assert_ne!(
            fs::read(&path).expect("saved source should be readable"),
            before
        );
        let serialized = to_value(&saved).expect("canonical snapshot should serialize");
        assert!(!serialized.to_string().contains("demopass"));
        assert!(serialized.get("masterPassword").is_none());

        {
            let mut service = state.service.lock().expect("desktop service lock");
            service
                .session_mut()
                .expect("session should exist")
                .document_mut()
                .set_entry_title(&EntryId::new(entry_id.clone()), "local dirty D")
                .expect("second local mutation should succeed");
        }
        let mut external = VaultSession::open(&path, &SecretString::new("demopass".to_owned()))
            .expect("external session should open");
        external
            .document_mut()
            .set_entry_title(&EntryId::new(entry_id), "external C")
            .expect("external mutation should succeed");
        external
            .save(&SecretString::new("demopass".to_owned()))
            .expect("external save should succeed");

        let Ok(reloaded) =
            tauri::async_runtime::block_on(reload_vault(Some("demopass".to_owned()), state))
        else {
            panic!("reload command should succeed");
        };
        assert!(!reloaded.dirty);
    }

    #[cfg(unix)]
    #[test]
    fn credential_rotation_command_uses_operation_gate_and_returns_safe_snapshot() {
        let (_directory, path, app) = writable_app();
        let state = app.state::<AppState>();
        let lease = state
            .begin_vault_operation()
            .expect("operation gate should be available");
        let blocked = tauri::async_runtime::block_on(change_master_password(
            "public-rotation-a".to_owned(),
            state.clone(),
        ));
        let Err(error) = blocked else {
            panic!("rotation should respect operation gate");
        };
        assert_eq!(
            to_value(error).expect("stable busy error should serialize"),
            json!({ "code": "operation_in_progress" })
        );
        drop(lease);

        let rotated = tauri::async_runtime::block_on(change_master_password(
            "public-rotation-b".to_owned(),
            state,
        ));
        let Ok(rotated) = rotated else {
            panic!("rotation command should succeed");
        };
        assert!(!rotated.dirty);
        let serialized = to_value(&rotated).expect("snapshot should serialize");
        assert!(!serialized.to_string().contains("public-rotation-b"));
        assert!(
            VaultSession::open(&path, &SecretString::new("public-rotation-b".to_owned())).is_ok()
        );
        assert!(VaultSession::open(&path, &SecretString::new("demopass".to_owned())).is_err());
    }

    #[cfg(unix)]
    #[test]
    fn remove_master_command_fails_without_keyfile_and_obeys_gate_with_safe_snapshot() {
        const KEYFILE: &[u8] = b"public-command-keyfile-factor";
        let (_directory, path, app) = writable_app();
        let state = app.state::<AppState>();
        let before = fs::read(&path).expect("original source");
        let Err(no_keyfile) = tauri::async_runtime::block_on(remove_master_password(state.clone()))
        else {
            panic!("password-only vault cannot remove its only factor");
        };
        assert_eq!(
            to_value(no_keyfile).expect("stable error"),
            json!({ "code": "invalid_request" })
        );
        assert_eq!(fs::read(&path).expect("untouched source"), before);
        {
            let mut service = state.service.lock().expect("service lock");
            service
                .replace_keyfile(SecretBytes::new(KEYFILE.to_vec()))
                .expect("add keyfile");
        }
        let lease = state.begin_vault_operation().expect("acquire gate");
        let Err(blocked) = tauri::async_runtime::block_on(remove_master_password(state.clone()))
        else {
            panic!("concurrent credential mutation must fail");
        };
        assert_eq!(
            to_value(blocked).expect("stable busy error"),
            json!({ "code": "operation_in_progress" })
        );
        drop(lease);
        let Ok(snapshot) = tauri::async_runtime::block_on(remove_master_password(state.clone()))
        else {
            panic!("keyfile-backed removal should succeed");
        };
        assert!(!snapshot.dirty);
        let json = to_value(&snapshot).expect("safe snapshot").to_string();
        assert!(!json.contains("public-command-keyfile-factor"));
        assert!(!json.contains("demopass"));
        let Ok(false) = credential_has_password(state) else {
            panic!("status should show no retained password");
        };
        assert!(
            VaultSession::open_with_credential(&path, KdbxCredential::new(None, Some(KEYFILE)),)
                .is_ok()
        );
        assert!(VaultSession::open(&path, &SecretString::new("demopass".to_owned())).is_err());
    }

    #[test]
    fn committed_contract_fixture_matches_all_error_codes() {
        let contract: Value = from_str(include_str!("../../contracts/desktop-contract.json"))
            .expect("committed desktop contract should be valid JSON");
        let errors = [
            DesktopError::AlreadyUnlocked,
            DesktopError::Locked,
            DesktopError::NoVaultSelected,
            DesktopError::UnlockFailed,
            DesktopError::UnsupportedVault,
            DesktopError::EntryNotFound,
            DesktopError::GroupNotFound,
            DesktopError::InvalidRequest,
            DesktopError::InvalidMove,
            DesktopError::HistoryChanged,
            DesktopError::HistoryRestoreUnsupported,
            DesktopError::AttachmentNotFound,
            DesktopError::AttachmentAlreadyExists,
            DesktopError::AttachmentTooLarge,
            DesktopError::AttachmentIoFailed,
            DesktopError::ReservedField,
            DesktopError::SecretUnavailable,
            DesktopError::UnsavedChanges,
            DesktopError::SaveFailed,
            DesktopError::SaveAuthenticationFailed,
            DesktopError::SaveUncertain,
            DesktopError::ExternalChange,
            DesktopError::ReloadFailed,
            DesktopError::ClipboardFailed,
            DesktopError::Internal,
            DesktopError::OperationInProgress,
            DesktopError::SyncFailed,
            DesktopError::SyncRemoteChanged,
            DesktopError::SyncLocalChanged,
            DesktopError::SyncLocalChangedDuringRecovery,
            DesktopError::SyncRecoveryRequired,
            DesktopError::SyncStateUnsupported,
            DesktopError::SyncStateCorrupt,
            DesktopError::SyncUnsupportedProvider,
            DesktopError::SyncUnsafeProvider,
            DesktopError::SyncCredentialsRequired,
            DesktopError::VaultCreateFailed,
            DesktopError::VaultAlreadyExists,
            DesktopError::UnsupportedWriteFormat,
            DesktopError::UnsupportedPersistencePlatform,
            DesktopError::ReadOnlySource,
        ];
        let serialized: Vec<Value> = errors
            .into_iter()
            .map(DesktopErrorDto::from)
            .map(|error| to_value(error).expect("desktop error DTO should serialize"))
            .map(|error| error["code"].clone())
            .collect();

        assert_eq!(
            contract["errorCodes"],
            to_value(serialized).expect("error code list should serialize")
        );
    }

    #[test]
    fn sync_commands_keep_a_narrow_typed_surface_and_operation_gate() {
        let (directory, _path, app) = writable_app();
        app.manage(SyncRuntime::new(directory.0.clone()).expect("sync runtime"));
        let state = app.state::<AppState>();
        let runtime = app.state::<SyncRuntime>();
        let Ok(saved) = save_sync_profile(
            request::<SaveSyncProfileRequestDto>(json!({
                "target": {
                    "provider": "webdav",
                    "resourceUrl": "https://dav.example.test/vault.kdbx"
                }
            })),
            state.clone(),
            runtime.clone(),
        ) else {
            panic!("save profile command should succeed");
        };
        let Ok(profiles) = sync_profiles(state.clone(), runtime.clone()) else {
            panic!("profile command should succeed");
        };
        assert_eq!(profiles.len(), 1);

        let empty_credentials = || {
            request::<ProviderCredentialsDto>(json!({
                "webdav": null,
                "s3": null
            }))
        };
        assert!(
            tauri::async_runtime::block_on(test_sync_provider(
                saved.profile_id.clone(),
                empty_credentials(),
                state.clone(),
                runtime.clone(),
            ))
            .is_err()
        );
        assert!(
            tauri::async_runtime::block_on(sync_now(
                saved.profile_id.clone(),
                empty_credentials(),
                Some("SYNTHETIC_MASTER_PASSWORD".to_owned()),
                state.clone(),
                runtime.clone(),
            ))
            .is_err()
        );
        assert!(
            tauri::async_runtime::block_on(resolve_sync_conflict(
                request::<ResolveSyncConflictRequestDto>(json!({
                    "profileId": saved.profile_id.clone(),
                    "conflictOperationId": "00112233445566778899aabbccddeeff",
                    "choice": "keepLocal",
                    "credentials": { "webdav": null, "s3": null },
                    "masterPassword": "SYNTHETIC_MASTER_PASSWORD"
                })),
                state.clone(),
                runtime.clone(),
            ))
            .is_err()
        );
        assert!(reset_sync_state(saved.profile_id.clone(), state.clone(), runtime.clone()).is_ok());
        assert!(delete_sync_profile(saved.profile_id, state, runtime).is_ok());
    }

    #[test]
    fn m42_commands_keep_reveal_narrow_and_copy_receipts_secret_free() {
        let app = unlocked_app();
        let state = app.state::<AppState>();
        let snapshot = state
            .service
            .lock()
            .expect("desktop service lock")
            .snapshot()
            .expect("snapshot should exist");
        let password_id = snapshot
            .entries
            .iter()
            .find(|entry| entry.password_present)
            .expect("fixture password entry")
            .id
            .clone();
        let notes_id = snapshot
            .entries
            .iter()
            .find(|entry| entry.notes_present)
            .expect("fixture notes entry")
            .id
            .clone();
        let username_id = snapshot
            .entries
            .iter()
            .find(|entry| !matches!(entry.username, crate::dto::SummaryTextDto::Missing))
            .expect("fixture username entry")
            .id
            .clone();
        let url_id = snapshot
            .entries
            .iter()
            .find(|entry| !matches!(entry.url, crate::dto::SummaryTextDto::Missing))
            .expect("fixture URL entry")
            .id
            .clone();

        let Ok(detail) = entry_detail(password_id.clone(), state.clone()) else {
            panic!("entry detail should succeed");
        };
        assert!(detail.id == password_id);
        let Ok(password) = reveal_entry_password(password_id.clone(), state.clone()) else {
            panic!("password reveal should succeed");
        };
        assert!(!password.is_empty());
        assert!(reveal_entry_notes(notes_id.clone(), state.clone()).is_ok());

        assert!(
            tauri::async_runtime::block_on(copy_entry_title(password_id.clone(), state.clone()))
                .is_ok()
        );
        let Ok(password_receipt) =
            tauri::async_runtime::block_on(copy_entry_password(password_id, state.clone()))
        else {
            panic!("password copy should succeed");
        };
        let receipt_json = to_value(password_receipt).expect("receipt should serialize");
        assert!(!receipt_json.to_string().contains(&password));
        assert!(
            tauri::async_runtime::block_on(copy_entry_username(username_id, state.clone())).is_ok()
        );
        assert!(tauri::async_runtime::block_on(copy_entry_url(url_id, state.clone())).is_ok());
        assert!(tauri::async_runtime::block_on(copy_entry_notes(notes_id, state.clone())).is_ok());
        assert!(tauri::async_runtime::block_on(lock_vault(state)).is_ok());
    }

    #[test]
    fn totp_commands_generate_and_copy_only_ephemeral_codes() {
        const URI: &str = "otpauth://totp/NianPass:test?secret=JBSWY3DPEHPK3PXP&period=30&digits=6";
        let app = unlocked_app();
        let state = app.state::<AppState>();
        let entry_id = state
            .service
            .lock()
            .expect("desktop service lock")
            .snapshot()
            .expect("snapshot should exist")
            .entries
            .first()
            .expect("fixture entry")
            .id
            .clone();

        let Ok(configured) = update_entry(
            request::<UpdateEntryRequestDto>(json!({
                "entryId": entry_id,
                "totpEnabled": true,
                "totpUri": URI
            })),
            state.clone(),
        ) else {
            panic!("TOTP configuration should succeed");
        };
        assert!(
            configured
                .entries
                .iter()
                .any(|entry| { entry.id == entry_id && entry.totp_present })
        );
        let configured_json = to_value(&configured)
            .expect("snapshot should serialize")
            .to_string();
        assert!(!configured_json.contains("JBSWY3DPEHPK3PXP"));
        assert!(!configured_json.contains("otpauth"));

        let Ok(revealed) = reveal_entry_totp(entry_id.clone(), state.clone()) else {
            panic!("TOTP reveal should generate an ephemeral code");
        };
        assert!(revealed.code.bytes().all(|byte| byte.is_ascii_digit()));
        assert_eq!(revealed.code.len(), 6);
        assert!(revealed.valid_for_seconds > 0);
        assert!(revealed.valid_for_seconds <= revealed.period_seconds);

        let Ok(receipt) =
            tauri::async_runtime::block_on(copy_entry_totp_code(entry_id, state.clone()))
        else {
            panic!("TOTP copy should succeed");
        };
        let receipt_json = to_value(receipt)
            .expect("receipt should serialize")
            .to_string();
        assert!(!receipt_json.contains(&revealed.code));
        assert!(!receipt_json.contains("JBSWY3DPEHPK3PXP"));

        assert!(tauri::async_runtime::block_on(discard_changes_and_lock(state)).is_ok());
    }

    #[test]
    fn password_health_command_is_secret_free_and_read_only() {
        let app = unlocked_app();
        let state = app.state::<AppState>();
        let before = state
            .service
            .lock()
            .expect("desktop service lock")
            .snapshot()
            .expect("snapshot should exist");
        let Ok(report) = password_health_report(state.clone()) else {
            panic!("password health report should succeed");
        };
        assert!(report.password_entries <= report.total_entries);
        assert_eq!(report.minimum_length, kdbx::PASSWORD_POLICY_MIN_LENGTH);
        let encoded = to_value(report)
            .expect("password health report should serialize")
            .to_string();
        assert!(!encoded.contains("demopass"));
        assert!(!encoded.contains("fingerprint"));
        assert!(!encoded.contains("passwordValue"));
        let after = state
            .service
            .lock()
            .expect("desktop service lock")
            .snapshot()
            .expect("snapshot should remain available");
        assert_eq!(before.dirty, after.dirty);
    }

    #[test]
    fn history_commands_keep_revisions_secret_free_and_revalidate_staleness() {
        let (_directory, _path, app) = writable_app();
        let state = app.state::<AppState>();
        let before = state
            .service
            .lock()
            .expect("desktop service lock")
            .snapshot()
            .expect("snapshot should exist");
        let entry = before
            .entries
            .iter()
            .find(|entry| matches!(entry.title, crate::dto::SummaryTextDto::Visible { .. }))
            .expect("fixture should contain a visible title")
            .clone();
        let original_title = match &entry.title {
            crate::dto::SummaryTextDto::Visible { value } => value.clone(),
            _ => panic!("selected title should be visible"),
        };

        let Ok(_) = update_entry(
            request::<UpdateEntryRequestDto>(json!({
                "entryId": entry.id,
                "title": "History command after"
            })),
            state.clone(),
        ) else {
            panic!("history preparation update should succeed");
        };
        let Ok(history) = entry_history(entry.id.clone(), state.clone()) else {
            panic!("history command should succeed");
        };
        assert_eq!(history.items.len(), 1);
        let encoded = to_value(&history).expect("history should serialize");
        assert_eq!(encoded["documentRevision"].as_str(), Some("1"));
        assert!(encoded.to_string().contains(&original_title));
        assert!(!encoded.to_string().contains("demopass"));
        assert!(encoded.get("password").is_none());

        let Ok(restored) = restore_entry_history(
            entry.id.clone(),
            history.items[0].index,
            history.document_revision.clone(),
            state.clone(),
        ) else {
            panic!("history restore command should succeed");
        };
        let restored_entry = restored
            .entries
            .iter()
            .find(|candidate| candidate.id == entry.id)
            .expect("restored entry should remain");
        assert!(matches!(
            &restored_entry.title,
            crate::dto::SummaryTextDto::Visible { value } if value == &original_title
        ));

        let Ok(fresh_history) = entry_history(entry.id.clone(), state.clone()) else {
            panic!("fresh history should list");
        };
        let Ok(_) = update_entry(
            request::<UpdateEntryRequestDto>(json!({
                "entryId": entry.id,
                "title": "History command newer"
            })),
            state.clone(),
        ) else {
            panic!("newer history update should succeed");
        };
        let Err(stale) = restore_entry_history(entry.id, 0, fresh_history.document_revision, state)
        else {
            panic!("stale history restore must fail");
        };
        assert_eq!(
            to_value(stale).expect("stale history error should serialize"),
            json!({ "code": "history_changed" })
        );
    }

    #[test]
    fn bulk_entry_commands_are_atomic_and_keep_trash_semantics_explicit() {
        let (_directory, _path, app) = writable_app();
        let state = app.state::<AppState>();
        let root = state
            .service
            .lock()
            .expect("desktop service lock")
            .snapshot()
            .expect("snapshot should exist")
            .root_group_id;

        let Ok(destination) = create_group(
            request::<CreateGroupRequestDto>(json!({
                "parentGroupId": root,
                "name": "Bulk destination"
            })),
            state.clone(),
        ) else {
            panic!("bulk destination should be created");
        };
        let destination_id = destination.created_group_id;

        let create_bulk_entry = |title: &str| {
            let Ok(created) = create_entry(
                request::<CreateEntryRequestDto>(json!({
                    "groupId": root,
                    "title": title,
                    "username": "",
                    "url": "",
                    "password": null,
                    "notes": null
                })),
                state.clone(),
            ) else {
                panic!("bulk fixture entry should be created");
            };
            created.created_entry_id
        };
        let first = create_bulk_entry("Bulk first");
        let second = create_bulk_entry("Bulk second");

        let Ok(moved) = move_entries(
            request::<BulkMoveEntriesRequestDto>(json!({
                "entryIds": [first, second],
                "destinationGroupId": destination_id
            })),
            state.clone(),
        ) else {
            panic!("bulk move should succeed");
        };
        for entry_id in [&first, &second] {
            let entry = moved
                .entries
                .iter()
                .find(|entry| &entry.id == entry_id)
                .expect("moved entry should remain projected");
            assert_eq!(entry.group_id, destination_id);
        }

        let Err(duplicate) = move_entries(
            request::<BulkMoveEntriesRequestDto>(json!({
                "entryIds": [first, first],
                "destinationGroupId": root
            })),
            state.clone(),
        ) else {
            panic!("duplicate bulk IDs must fail");
        };
        assert_eq!(
            to_value(duplicate).expect("bulk validation error should serialize"),
            json!({ "code": "invalid_request" })
        );
        let after_rejected_move = state
            .service
            .lock()
            .expect("desktop service lock")
            .snapshot()
            .expect("snapshot should exist");
        assert!([&first, &second].iter().all(|entry_id| {
            after_rejected_move
                .entries
                .iter()
                .find(|entry| &entry.id == *entry_id)
                .is_some_and(|entry| entry.group_id == destination_id)
        }));

        let Ok(trashed) = trash_entries(
            request::<BulkTrashEntriesRequestDto>(json!({
                "entryIds": [first, second]
            })),
            state.clone(),
        ) else {
            panic!("bulk Trash should succeed");
        };
        let recycle_bin_id = trashed
            .recycle_bin_group_id
            .clone()
            .expect("bulk Trash should materialize the recycle bin");
        assert!([&first, &second].iter().all(|entry_id| {
            trashed
                .entries
                .iter()
                .find(|entry| &entry.id == *entry_id)
                .is_some_and(|entry| entry.group_id == recycle_bin_id)
        }));

        let third = create_bulk_entry("Bulk third");
        let Err(recycled_source_move) = move_entries(
            request::<BulkMoveEntriesRequestDto>(json!({
                "entryIds": [first],
                "destinationGroupId": root
            })),
            state.clone(),
        ) else {
            panic!("bulk Move must not move a recycled entry directly");
        };
        assert_eq!(
            to_value(recycled_source_move).expect("recycled source error should serialize"),
            json!({ "code": "invalid_request" })
        );

        let Ok(restored) = restore_entries(
            request::<BulkRestoreEntriesRequestDto>(json!({
                "entryIds": [first, second]
            })),
            state.clone(),
        ) else {
            panic!("bulk Restore should succeed");
        };
        assert!([&first, &second].iter().all(|entry_id| {
            restored
                .entries
                .iter()
                .find(|entry| &entry.id == *entry_id)
                .is_some_and(|entry| entry.group_id == destination_id)
        }));

        let Ok(retrashed) = trash_entries(
            request::<BulkTrashEntriesRequestDto>(json!({
                "entryIds": [first, second]
            })),
            state.clone(),
        ) else {
            panic!("restored entries should be trashable again");
        };
        assert!([&first, &second].iter().all(|entry_id| {
            retrashed
                .entries
                .iter()
                .find(|entry| &entry.id == *entry_id)
                .is_some_and(|entry| entry.group_id == recycle_bin_id)
        }));

        let mixed_live = create_bulk_entry("Bulk mixed live");
        let Err(mixed_delete) = permanently_delete_entries(
            request::<BulkDeleteEntriesRequestDto>(json!({
                "entryIds": [first, mixed_live]
            })),
            state.clone(),
        ) else {
            panic!("bulk permanent delete must reject mixed live/recycled entries");
        };
        assert_eq!(
            to_value(mixed_delete).expect("mixed delete error should serialize"),
            json!({ "code": "invalid_request" })
        );

        let Ok(deleted) = permanently_delete_entries(
            request::<BulkDeleteEntriesRequestDto>(json!({
                "entryIds": [first, second]
            })),
            state.clone(),
        ) else {
            panic!("bulk permanent delete should succeed for recycled entries");
        };
        assert!(
            [&first, &second]
                .iter()
                .all(|entry_id| deleted.entries.iter().all(|entry| &entry.id != *entry_id))
        );
        assert!(deleted.entries.iter().any(|entry| entry.id == mixed_live));

        let Err(recycle_move) = move_entries(
            request::<BulkMoveEntriesRequestDto>(json!({
                "entryIds": [third],
                "destinationGroupId": recycle_bin_id
            })),
            state.clone(),
        ) else {
            panic!("bulk Move must not bypass Trash semantics");
        };
        assert_eq!(
            to_value(recycle_move).expect("recycle move error should serialize"),
            json!({ "code": "invalid_request" })
        );
        let final_snapshot = state
            .service
            .lock()
            .expect("desktop service lock")
            .snapshot()
            .expect("snapshot should exist");
        assert!(
            final_snapshot
                .entries
                .iter()
                .find(|entry| entry.id == third)
                .is_some_and(|entry| entry.group_id == root)
        );
    }

    #[test]
    fn m43_semantic_commands_refresh_canonical_state_and_require_explicit_discard() {
        let app = unlocked_app();
        let state = app.state::<AppState>();
        let snapshot = state
            .service
            .lock()
            .expect("desktop service lock")
            .snapshot()
            .expect("snapshot should exist");
        let root = snapshot.root_group_id.clone();
        let destination = snapshot
            .groups
            .iter()
            .find(|group| group.id != root)
            .expect("fixture child group")
            .id
            .clone();
        let entry = snapshot.entries.first().expect("fixture entry").id.clone();
        assert!(matches!(
            tauri::async_runtime::block_on(close_policy(state.clone())),
            Ok(ClosePolicyDto::Allow)
        ));

        let updated = update_entry(
            request::<UpdateEntryRequestDto>(json!({
                "entryId": entry,
                "title": "M4.3 command title",
                "username": "M4.3 command user",
                "url": "m4.3://command",
                "password": "M4.3-COMMAND-PASSWORD",
                "notes": "M4.3-COMMAND-NOTES"
            })),
            state.clone(),
        );
        assert!(updated.is_ok());
        assert_eq!(
            reveal_entry_title(entry.clone(), state.clone())
                .ok()
                .as_deref(),
            Some("M4.3 command title")
        );
        assert_eq!(
            reveal_entry_username(entry.clone(), state.clone())
                .ok()
                .as_deref(),
            Some("M4.3 command user")
        );
        assert_eq!(
            reveal_entry_url(entry.clone(), state.clone())
                .ok()
                .as_deref(),
            Some("m4.3://command")
        );

        assert!(
            set_entry_tags(
                request::<SetEntryTagsRequestDto>(json!({
                    "entryId": entry,
                    "tags": ["finance", "primary"]
                })),
                state.clone(),
            )
            .is_ok()
        );
        let Ok(tagged) = entry_detail(entry.clone(), state.clone()) else {
            panic!("tagged detail should be available");
        };
        assert_eq!(tagged.tags, ["finance", "primary"]);

        assert!(
            set_entry_custom_field(
                request::<SetCustomFieldRequestDto>(json!({
                    "entryId": entry,
                    "name": "M4.3 command custom",
                    "value": "M4.3-COMMAND-CUSTOM",
                    "protection": "protected"
                })),
                state.clone(),
            )
            .is_ok()
        );
        assert_eq!(
            reveal_entry_custom_field(
                entry.clone(),
                "M4.3 command custom".to_owned(),
                state.clone(),
            )
            .ok()
            .as_deref(),
            Some("M4.3-COMMAND-CUSTOM")
        );
        let custom_copy = tauri::async_runtime::block_on(copy_entry_custom_field(
            entry.clone(),
            "M4.3 command custom".to_owned(),
            state.clone(),
        ));
        assert!(custom_copy.is_ok());

        assert!(
            delete_entry_custom_field(
                entry.clone(),
                "M4.3 command custom".to_owned(),
                state.clone(),
            )
            .is_ok()
        );

        let Ok(created) = create_entry(
            request::<CreateEntryRequestDto>(json!({
                "groupId": root,
                "title": "M4.3 command entry",
                "username": "",
                "url": "",
                "password": null,
                "notes": null
            })),
            state.clone(),
        ) else {
            panic!("entry command should create");
        };
        let Ok(duplicated) = duplicate_entry(created.created_entry_id.clone(), state.clone())
        else {
            panic!("entry command should duplicate");
        };
        assert!(duplicated.created_entry_id != created.created_entry_id);
        assert!(
            move_entry(
                request::<MoveEntryRequestDto>(json!({
                    "entryId": created.created_entry_id,
                    "destinationGroupId": destination
                })),
                state.clone(),
            )
            .is_ok()
        );
        assert!(
            permanently_delete_entry(created.created_entry_id.clone(), state.clone()).is_err(),
            "permanent entry deletion must be rejected outside Trash"
        );
        let Ok(trashed_entry) = delete_entry(created.created_entry_id.clone(), state.clone())
        else {
            panic!("entry should move to Trash");
        };
        let recycle_bin = trashed_entry
            .recycle_bin_group_id
            .clone()
            .expect("Trash should exist after first soft delete");
        assert!(trashed_entry.entries.iter().any(|candidate| {
            candidate.id == created.created_entry_id && candidate.group_id == recycle_bin
        }));
        let Ok(restored_entry) = restore_entry(created.created_entry_id.clone(), state.clone())
        else {
            panic!("entry restore should succeed");
        };
        assert!(restored_entry.entries.iter().any(|candidate| {
            candidate.id == created.created_entry_id && candidate.group_id != recycle_bin
        }));
        assert!(delete_entry(created.created_entry_id.clone(), state.clone()).is_ok());
        assert!(permanently_delete_entry(created.created_entry_id.clone(), state.clone()).is_ok());

        let Ok(group) = create_group(
            request::<CreateGroupRequestDto>(json!({
                "parentGroupId": root,
                "name": "M4.3 command group"
            })),
            state.clone(),
        ) else {
            panic!("group command should create");
        };
        let Ok(group_destination) = create_group(
            request::<CreateGroupRequestDto>(json!({
                "parentGroupId": root,
                "name": "M4.3 command destination"
            })),
            state.clone(),
        ) else {
            panic!("destination group command should create");
        };
        assert!(
            rename_group(
                request::<RenameGroupRequestDto>(json!({
                    "groupId": group.created_group_id,
                    "name": "M4.3 command renamed"
                })),
                state.clone(),
            )
            .is_ok()
        );
        assert!(
            move_group(
                request::<MoveGroupRequestDto>(json!({
                    "groupId": group.created_group_id,
                    "destinationGroupId": group_destination.created_group_id
                })),
                state.clone(),
            )
            .is_ok()
        );
        assert!(
            permanently_delete_group(group_destination.created_group_id.clone(), state.clone())
                .is_err(),
            "permanent group deletion must be rejected outside Trash"
        );
        let Ok(trashed_group) =
            delete_group(group_destination.created_group_id.clone(), state.clone())
        else {
            panic!("group subtree should move to Trash");
        };
        let recycle_bin = trashed_group
            .recycle_bin_group_id
            .clone()
            .expect("Trash should remain available");
        assert!(
            trashed_group
                .groups
                .iter()
                .any(|candidate| { candidate.id == group_destination.created_group_id })
        );
        let Ok(restored_group) =
            restore_group(group_destination.created_group_id.clone(), state.clone())
        else {
            panic!("group restore should succeed");
        };
        assert!(restored_group.groups.iter().any(|candidate| {
            candidate.id == group_destination.created_group_id && candidate.id != recycle_bin
        }));
        assert!(delete_group(group_destination.created_group_id.clone(), state.clone()).is_ok());
        assert!(
            permanently_delete_group(group_destination.created_group_id.clone(), state.clone())
                .is_ok()
        );

        assert!(matches!(
            tauri::async_runtime::block_on(close_policy(state.clone())),
            Ok(ClosePolicyDto::ConfirmDiscard)
        ));
        assert!(tauri::async_runtime::block_on(lock_vault(state.clone())).is_err());
        assert!(tauri::async_runtime::block_on(discard_changes_and_lock(state.clone())).is_ok());
        assert!(matches!(
            tauri::async_runtime::block_on(close_policy(state)),
            Ok(ClosePolicyDto::Allow)
        ));
    }
}
