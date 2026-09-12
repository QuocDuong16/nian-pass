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

pub async fn reload(
    password: String,
    state: State<'_, AppState>,
) -> Result<VaultSnapshotDto, DesktopErrorDto> {
    persist_with_credential(password, state, crate::state::DesktopVaultService::reload).await
}

async fn persist_with_credential(
    password: String,
    state: State<'_, AppState>,
    operation: fn(
        &mut crate::state::DesktopVaultService,
        SecretString,
    ) -> Result<VaultSnapshotDto, DesktopError>,
) -> Result<VaultSnapshotDto, DesktopErrorDto> {
    let operation_lease = state
        .begin_vault_operation()
        .map_err(DesktopErrorDto::from)?;
    let service = state.service.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let _operation_lease = operation_lease;
        let credential = SecretString::new(password);
        let mut service = service.lock().map_err(|_| DesktopError::Internal)?;
        operation(&mut service, credential)
    })
    .await
    .map_err(|_| DesktopErrorDto::from(DesktopError::Internal))?
    .map_err(Into::into)
}
