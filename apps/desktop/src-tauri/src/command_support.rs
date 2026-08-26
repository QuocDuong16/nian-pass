use std::{sync::Arc, time::Duration};

use tauri::State;
use vault_core::SecretString;

use crate::{
    clipboard::{CLIPBOARD_CLEAR_MS, DesktopClipboardService},
    dto::ClipboardReceiptDto,
    errors::DesktopErrorDto,
    state::{AppState, DesktopError, DesktopVaultService},
};

pub(crate) fn reveal_entry_value(
    entry_id: String,
    state: State<'_, AppState>,
    read: fn(&DesktopVaultService, &str) -> Result<SecretString, DesktopError>,
) -> Result<String, DesktopErrorDto> {
    let service = state
        .service
        .lock()
        .map_err(|_| DesktopErrorDto::from(DesktopError::Internal))?;
    let secret = read(&service, &entry_id)?;
    Ok(secret.expose_secret().to_owned())
}

pub(crate) fn with_service<T>(
    state: State<'_, AppState>,
    operation: impl FnOnce(&mut DesktopVaultService) -> Result<T, DesktopError>,
) -> Result<T, DesktopErrorDto> {
    let mut service = state
        .service
        .lock()
        .map_err(|_| DesktopErrorDto::from(DesktopError::Internal))?;
    operation(&mut service).map_err(Into::into)
}

pub(crate) async fn copy_entry(
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
