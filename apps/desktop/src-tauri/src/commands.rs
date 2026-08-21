use serde::Serialize;
use tauri::{AppHandle, State};
use tauri_plugin_dialog::{DialogExt, FilePath};
use vault_core::SecretString;

use crate::{
    dto::{SelectedVaultDto, VaultSnapshotDto},
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
pub fn lock_vault(state: State<'_, AppState>) -> Result<(), DesktopErrorDto> {
    let mut service = state
        .service
        .lock()
        .map_err(|_| DesktopErrorDto::from(DesktopError::Internal))?;
    service.lock().map_err(Into::into)
}
