use tauri::AppHandle;
use tauri::State;
use tauri_plugin_dialog::{DialogExt, FilePath};
use vault_core::SecretString;

mod sync;
pub use self::sync::*;

use crate::dto::{EntryDetailDto, SelectedVaultDto, VaultSnapshotDto};
use crate::platform::RuntimeInfoDto;

use crate::{
    browser_bridge::BrowserBridgeState,
    command_support::{copy_entry, reveal_entry_value, with_service},
    dto::{ClipboardReceiptDto, ClosePolicyDto, CreatedEntryDto, CreatedGroupDto, LockResultDto},
    errors::DesktopErrorDto,
    mutations::{
        CreateEntryRequestDto, CreateGroupRequestDto, MoveEntryRequestDto, MoveGroupRequestDto,
        RenameGroupRequestDto, SetCustomFieldRequestDto, UpdateEntryRequestDto,
    },
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
pub fn vault_snapshot(state: State<'_, AppState>) -> Result<VaultSnapshotDto, DesktopErrorDto> {
    let service = state
        .service
        .lock()
        .map_err(|_| DesktopErrorDto::from(DesktopError::Internal))?;
    service.snapshot().map_err(Into::into)
}

#[tauri::command]
pub async fn save_vault(
    password: String,
    state: State<'_, AppState>,
) -> Result<VaultSnapshotDto, DesktopErrorDto> {
    crate::persistence::save(password, state).await
}

#[tauri::command]
pub async fn reload_vault(
    password: String,
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
pub fn update_entry(
    request: UpdateEntryRequestDto,
    state: State<'_, AppState>,
) -> Result<VaultSnapshotDto, DesktopErrorDto> {
    with_service(state, |service| service.update_entry(request))
}

#[tauri::command]
pub fn create_entry(
    request: CreateEntryRequestDto,
    state: State<'_, AppState>,
) -> Result<CreatedEntryDto, DesktopErrorDto> {
    with_service(state, |service| service.create_entry(request))
}

#[tauri::command]
pub fn delete_entry(
    entry_id: String,
    state: State<'_, AppState>,
) -> Result<VaultSnapshotDto, DesktopErrorDto> {
    with_service(state, |service| service.delete_entry(entry_id))
}

#[tauri::command]
pub fn move_entry(
    request: MoveEntryRequestDto,
    state: State<'_, AppState>,
) -> Result<VaultSnapshotDto, DesktopErrorDto> {
    with_service(state, |service| service.move_entry(request))
}

#[tauri::command]
pub fn create_group(
    request: CreateGroupRequestDto,
    state: State<'_, AppState>,
) -> Result<CreatedGroupDto, DesktopErrorDto> {
    with_service(state, |service| service.create_group(request))
}

#[tauri::command]
pub fn rename_group(
    request: RenameGroupRequestDto,
    state: State<'_, AppState>,
) -> Result<VaultSnapshotDto, DesktopErrorDto> {
    with_service(state, |service| service.rename_group(request))
}

#[tauri::command]
pub fn move_group(
    request: MoveGroupRequestDto,
    state: State<'_, AppState>,
) -> Result<VaultSnapshotDto, DesktopErrorDto> {
    with_service(state, |service| service.move_group(request))
}

#[tauri::command]
pub fn delete_group(
    group_id: String,
    state: State<'_, AppState>,
) -> Result<VaultSnapshotDto, DesktopErrorDto> {
    with_service(state, |service| service.delete_group(group_id))
}

#[tauri::command]
pub fn set_entry_custom_field(
    request: SetCustomFieldRequestDto,
    state: State<'_, AppState>,
) -> Result<VaultSnapshotDto, DesktopErrorDto> {
    with_service(state, |service| service.set_custom_field(request))
}

#[tauri::command]
pub fn delete_entry_custom_field(
    entry_id: String,
    name: String,
    state: State<'_, AppState>,
) -> Result<VaultSnapshotDto, DesktopErrorDto> {
    with_service(state, |service| service.delete_custom_field(entry_id, name))
}

#[tauri::command]
pub fn close_policy(state: State<'_, AppState>) -> Result<ClosePolicyDto, DesktopErrorDto> {
    let service = state
        .service
        .lock()
        .map_err(|_| DesktopErrorDto::from(DesktopError::Internal))?;
    Ok(service.close_policy())
}

#[tauri::command]
pub async fn copy_entry_username(
    entry_id: String,
    state: State<'_, AppState>,
) -> Result<ClipboardReceiptDto, DesktopErrorDto> {
    copy_entry(entry_id, state.inner().clone(), false).await
}

#[tauri::command]
pub async fn copy_entry_password(
    entry_id: String,
    state: State<'_, AppState>,
) -> Result<ClipboardReceiptDto, DesktopErrorDto> {
    copy_entry(entry_id, state.inner().clone(), true).await
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

    use serde::de::DeserializeOwned;
    use serde_json::{Value, from_str, from_value, json, to_value};
    use tauri::{Manager, test::mock_app};
    use vault_core::{EntryId, SecretString};
    use vault_session::VaultSession;

    use super::{
        close_policy, copy_entry_password, copy_entry_username, create_entry, create_group,
        delete_entry, delete_entry_custom_field, delete_group, delete_sync_profile,
        discard_changes_and_lock, entry_detail, lock_vault, move_entry, move_group, reload_vault,
        rename_group, reset_sync_state, resolve_browser_connection, resolve_sync_conflict,
        reveal_entry_custom_field, reveal_entry_notes, reveal_entry_password, reveal_entry_title,
        reveal_entry_url, reveal_entry_username, runtime_info, save_sync_profile, save_vault,
        select_vault, set_entry_custom_field, sync_now, sync_profiles, test_sync_provider,
        update_entry,
    };
    use crate::{
        browser_bridge::BrowserBridgeState,
        clipboard::ClipboardPort,
        dto::ClosePolicyDto,
        errors::DesktopErrorDto,
        mutations::{
            CreateEntryRequestDto, CreateGroupRequestDto, MoveEntryRequestDto, MoveGroupRequestDto,
            RenameGroupRequestDto, SetCustomFieldRequestDto, UpdateEntryRequestDto,
        },
        state::{AppState, DesktopError},
        sync::{
            ProviderCredentialsDto, ResolveSyncConflictRequestDto, SaveSyncProfileRequestDto,
            SyncRuntime,
        },
    };

    static TEST_DIRECTORY_SEQUENCE: AtomicU64 = AtomicU64::new(0);

    #[test]
    fn runtime_info_command_exposes_only_the_host_platform() {
        let encoded = serde_json::to_value(runtime_info()).expect("runtime info should serialize");
        assert_eq!(encoded, json!({ "platform": "desktop" }));
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
    fn m44_commands_move_credentials_and_return_only_canonical_snapshots() {
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
        let synthetic = "M4.4-SAVE-PASSWORD";
        let Err(wrong) =
            tauri::async_runtime::block_on(save_vault(synthetic.to_owned(), state.clone()))
        else {
            panic!("wrong credential should fail");
        };
        let serialized = to_value(wrong).expect("stable error should serialize");
        assert!(!serialized.to_string().contains(synthetic));
        assert_eq!(fs::read(&path).expect("source should remain"), before);
        assert!(
            state
                .service
                .lock()
                .expect("desktop service lock")
                .snapshot()
                .expect("dirty snapshot")
                .dirty
        );

        let Ok(saved) =
            tauri::async_runtime::block_on(save_vault("demopass".to_owned(), state.clone()))
        else {
            panic!("save command should succeed");
        };
        assert!(!saved.dirty);

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
            tauri::async_runtime::block_on(reload_vault("demopass".to_owned(), state))
        else {
            panic!("reload command should succeed");
        };
        assert!(!reloaded.dirty);
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
                "SYNTHETIC_MASTER_PASSWORD".to_owned(),
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

        let Ok(detail) = entry_detail(password_id.clone(), state.clone()) else {
            panic!("entry detail should succeed");
        };
        assert!(detail.id == password_id);
        let Ok(password) = reveal_entry_password(password_id.clone(), state.clone()) else {
            panic!("password reveal should succeed");
        };
        assert!(!password.is_empty());
        assert!(reveal_entry_notes(notes_id, state.clone()).is_ok());

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
        assert!(tauri::async_runtime::block_on(lock_vault(state)).is_ok());
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
            close_policy(state.clone()),
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
        assert!(delete_entry(created.created_entry_id, state.clone()).is_ok());

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
        assert!(delete_group(group_destination.created_group_id, state.clone()).is_ok());

        assert!(matches!(
            close_policy(state.clone()),
            Ok(ClosePolicyDto::ConfirmDiscard)
        ));
        assert!(tauri::async_runtime::block_on(lock_vault(state.clone())).is_err());
        assert!(tauri::async_runtime::block_on(discard_changes_and_lock(state.clone())).is_ok());
        assert!(matches!(close_policy(state), Ok(ClosePolicyDto::Allow)));
    }
}
