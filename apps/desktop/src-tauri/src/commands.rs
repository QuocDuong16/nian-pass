use std::{sync::Arc, time::Duration};

use serde::Serialize;
use tauri::{AppHandle, State};
use tauri_plugin_dialog::{DialogExt, FilePath};
use vault_core::SecretString;

use crate::{
    clipboard::{CLIPBOARD_CLEAR_MS, DesktopClipboardService},
    dto::{ClipboardReceiptDto, EntryDetailDto, LockResultDto, SelectedVaultDto, VaultSnapshotDto},
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
    SecretUnavailable,
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
            DesktopError::SecretUnavailable => DesktopErrorCode::SecretUnavailable,
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

#[cfg(test)]
mod tests {
    use std::{
        path::Path,
        sync::{Arc, Mutex},
    };

    use serde_json::{Value, from_str, to_value};
    use tauri::{Manager, test::mock_app};
    use vault_core::SecretString;

    use super::{
        DesktopErrorDto, copy_entry_password, copy_entry_username, entry_detail, lock_vault,
        reveal_entry_notes, reveal_entry_password,
    };
    use crate::{
        clipboard::ClipboardPort,
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
            DesktopError::SecretUnavailable,
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
}
