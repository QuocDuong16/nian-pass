use tauri::State;
use vault_core::SecretString;

use crate::{
    dto::VaultSnapshotDto,
    errors::DesktopErrorDto,
    state::{AppState, DesktopError},
};

pub async fn save(state: State<'_, AppState>) -> Result<VaultSnapshotDto, DesktopErrorDto> {
    let operation_lease = state
        .begin_vault_operation()
        .map_err(DesktopErrorDto::from)?;
    let service = state.service.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let _operation_lease = operation_lease;
        let mut service = service.lock().map_err(|_| DesktopError::Internal)?;
        service.save()
    })
    .await
    .map_err(|_| DesktopErrorDto::from(DesktopError::Internal))?
    .map_err(Into::into)
}

pub async fn change_master_password(
    new_password: String,
    state: State<'_, AppState>,
) -> Result<VaultSnapshotDto, DesktopErrorDto> {
    let operation_lease = state
        .begin_vault_operation()
        .map_err(DesktopErrorDto::from)?;
    let service = state.service.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let _operation_lease = operation_lease;
        let new_password = SecretString::new(new_password);
        let mut service = service.lock().map_err(|_| DesktopError::Internal)?;
        service.change_master_password(new_password)
    })
    .await
    .map_err(|_| DesktopErrorDto::from(DesktopError::Internal))?
    .map_err(Into::into)
}

pub async fn remove_master_password(
    state: State<'_, AppState>,
) -> Result<VaultSnapshotDto, DesktopErrorDto> {
    let operation_lease = state
        .begin_vault_operation()
        .map_err(DesktopErrorDto::from)?;
    let service = state.service.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let _operation_lease = operation_lease;
        let mut service = service.lock().map_err(|_| DesktopError::Internal)?;
        service.remove_master_password()
    })
    .await
    .map_err(|_| DesktopErrorDto::from(DesktopError::Internal))?
    .map_err(Into::into)
}

pub async fn reload(
    password: Option<String>,
    state: State<'_, AppState>,
) -> Result<VaultSnapshotDto, DesktopErrorDto> {
    let operation_lease = state
        .begin_vault_operation()
        .map_err(DesktopErrorDto::from)?;
    let service = state.service.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let _operation_lease = operation_lease;
        let password = password.map(SecretString::new);
        let mut service = service.lock().map_err(|_| DesktopError::Internal)?;
        service.reload_with_components(password)
    })
    .await
    .map_err(|_| DesktopErrorDto::from(DesktopError::Internal))?
    .map_err(Into::into)
}
