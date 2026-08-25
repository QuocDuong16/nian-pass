use std::{sync::Arc, time::Duration};

use serde::Serialize;
use tauri::{AppHandle, State};
use tauri_plugin_dialog::{DialogExt, FilePath};
use vault_core::SecretString;

use crate::{
    clipboard::{CLIPBOARD_CLEAR_MS, DesktopClipboardService},
    dto::{
        ClipboardReceiptDto, ClosePolicyDto, CreatedEntryDto, CreatedGroupDto, EntryDetailDto,
        LockResultDto, SelectedVaultDto, VaultSnapshotDto,
    },
    mutations::{
        CreateEntryRequestDto, CreateGroupRequestDto, MoveEntryRequestDto, MoveGroupRequestDto,
        RenameGroupRequestDto, SetCustomFieldRequestDto, UpdateEntryRequestDto,
    },
    state::{AppState, DesktopError},
};

#[derive(Serialize)]
#[serde(rename_all = "snake_case")]
enum DesktopErrorCode {
    AlreadyUnlocked,
    Locked,
    NoVaultSelected,
    UnlockFailed,
    UnsupportedVault,
    EntryNotFound,
    GroupNotFound,
    InvalidRequest,
    InvalidMove,
    ReservedField,
    SecretUnavailable,
    UnsavedChanges,
    ClipboardFailed,
    Internal,
}

/// Stable IPC error payload without dependency or path details.
#[derive(Serialize)]
pub struct DesktopErrorDto {
    code: DesktopErrorCode,
}

impl From<DesktopError> for DesktopErrorDto {
    fn from(value: DesktopError) -> Self {
        let code = match value {
            DesktopError::AlreadyUnlocked => DesktopErrorCode::AlreadyUnlocked,
            DesktopError::Locked => DesktopErrorCode::Locked,
            DesktopError::NoVaultSelected => DesktopErrorCode::NoVaultSelected,
            DesktopError::UnlockFailed => DesktopErrorCode::UnlockFailed,
            DesktopError::UnsupportedVault => DesktopErrorCode::UnsupportedVault,
            DesktopError::EntryNotFound => DesktopErrorCode::EntryNotFound,
            DesktopError::GroupNotFound => DesktopErrorCode::GroupNotFound,
            DesktopError::InvalidRequest => DesktopErrorCode::InvalidRequest,
            DesktopError::InvalidMove => DesktopErrorCode::InvalidMove,
            DesktopError::ReservedField => DesktopErrorCode::ReservedField,
            DesktopError::SecretUnavailable => DesktopErrorCode::SecretUnavailable,
            DesktopError::UnsavedChanges => DesktopErrorCode::UnsavedChanges,
            DesktopError::ClipboardFailed => DesktopErrorCode::ClipboardFailed,
            DesktopError::Internal => DesktopErrorCode::Internal,
        };
        Self { code }
    }
}

#[tauri::command]
pub async fn select_vault(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<Option<SelectedVaultDto>, DesktopErrorDto> {
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

fn reveal_entry_value(
    entry_id: String,
    state: State<'_, AppState>,
    read: fn(&crate::state::DesktopVaultService, &str) -> Result<SecretString, DesktopError>,
) -> Result<String, DesktopErrorDto> {
    let service = state
        .service
        .lock()
        .map_err(|_| DesktopErrorDto::from(DesktopError::Internal))?;
    let secret = read(&service, &entry_id)?;
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

fn with_service<T>(
    state: State<'_, AppState>,
    operation: impl FnOnce(&mut crate::state::DesktopVaultService) -> Result<T, DesktopError>,
) -> Result<T, DesktopErrorDto> {
    let mut service = state
        .service
        .lock()
        .map_err(|_| DesktopErrorDto::from(DesktopError::Internal))?;
    operation(&mut service).map_err(Into::into)
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

async fn copy_entry(
    entry_id: String,
    state: AppState,
    password: bool,
) -> Result<ClipboardReceiptDto, DesktopErrorDto> {
    let clipboard = state.clipboard.clone();
    let copy = tauri::async_runtime::spawn_blocking(move || {
        if password {
            state.copy_entry_password(&entry_id)
        } else {
            state.copy_entry_username(&entry_id)
        }
    })
    .await
    .map_err(|_| DesktopErrorDto::from(DesktopError::Internal))??;
    schedule_expiration(clipboard, copy.generation);
    Ok(copy.into())
}

fn schedule_expiration(clipboard: Arc<DesktopClipboardService>, generation: u64) {
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(Duration::from_millis(CLIPBOARD_CLEAR_MS)).await;
        let _ =
            tauri::async_runtime::spawn_blocking(move || clipboard.expire_generation(generation))
                .await;
    });
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
        path::Path,
        sync::{Arc, Mutex},
    };

    use serde::de::DeserializeOwned;
    use serde_json::{Value, from_str, from_value, json, to_value};
    use tauri::{Manager, test::mock_app};
    use vault_core::SecretString;

    use super::{
        DesktopErrorDto, close_policy, copy_entry_password, copy_entry_username, create_entry,
        create_group, delete_entry, delete_entry_custom_field, delete_group,
        discard_changes_and_lock, entry_detail, lock_vault, move_entry, move_group, rename_group,
        reveal_entry_custom_field, reveal_entry_notes, reveal_entry_password, reveal_entry_title,
        reveal_entry_url, reveal_entry_username, set_entry_custom_field, update_entry,
    };
    use crate::{
        clipboard::ClipboardPort,
        dto::ClosePolicyDto,
        mutations::{
            CreateEntryRequestDto, CreateGroupRequestDto, MoveEntryRequestDto, MoveGroupRequestDto,
            RenameGroupRequestDto, SetCustomFieldRequestDto, UpdateEntryRequestDto,
        },
        state::{AppState, DesktopError},
    };

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

    fn request<T: DeserializeOwned>(value: Value) -> T {
        from_value(value).expect("synthetic command request should deserialize")
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
            DesktopError::ClipboardFailed,
            DesktopError::Internal,
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
