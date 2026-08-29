#![cfg(target_os = "ios")]

use std::sync::MutexGuard;

use tauri::State;
use vault_core::SecretString;

use crate::dto::{EntryDetailDto, MobileSelectedVaultDto, VaultSnapshotDto};

use super::{
    MobileAppState, MobileError,
    autofill::MobileAutofillStatusDto,
    errors::MobileErrorDto,
    source_ios::{IdentityProjection, IosVaultSource},
    state::MobileVaultService,
};

fn lock_service(
    state: &MobileAppState,
) -> Result<MutexGuard<'_, MobileVaultService>, MobileErrorDto> {
    state
        .service
        .lock()
        .map_err(|_| MobileErrorDto::from(MobileError::Internal))
}

#[tauri::command]
pub(crate) async fn mobile_select_vault(
    source: State<'_, IosVaultSource>,
    state: State<'_, MobileAppState>,
) -> Result<Option<MobileSelectedVaultDto>, MobileErrorDto> {
    let operation = lock_service(&state)?
        .begin_selection()
        .map_err(MobileErrorDto::from)?;
    let selected = match source.select().await {
        Ok(value) => value,
        Err(error) => {
            lock_service(&state)?.finish_operation(operation.id);
            return Err(error.into());
        }
    };
    let Some(selected) = selected else {
        lock_service(&state)?.finish_operation(operation.id);
        return Ok(None);
    };
    if let Some(previous) = operation.previous.as_ref()
        && let Err(error) = source.release(&previous.token).await
    {
        let _ = source.release(&selected.source_token).await;
        lock_service(&state)?.finish_operation(operation.id);
        return Err(error.into());
    }
    let selected_token = selected.source_token.clone();
    let result = lock_service(&state)?.complete_selection(
        operation.id,
        selected.staged_path,
        selected.file_name,
        selected.source_token,
        false,
        false,
    );
    match result {
        Ok(value) => Ok(Some(value)),
        Err(error) => {
            let _ = source.release(&selected_token).await;
            lock_service(&state)?.finish_operation(operation.id);
            Err(error.into())
        }
    }
}

#[tauri::command]
pub(crate) async fn mobile_unlock_vault(
    password: String,
    state: State<'_, MobileAppState>,
) -> Result<VaultSnapshotDto, MobileErrorDto> {
    let service = state.service.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let credential = SecretString::new(password);
        service
            .lock()
            .map_err(|_| MobileError::Internal)?
            .unlock(&credential)
    })
    .await
    .map_err(|_| MobileErrorDto::from(MobileError::Internal))?
    .map_err(Into::into)
}

#[tauri::command]
pub(crate) fn mobile_vault_snapshot(
    state: State<'_, MobileAppState>,
) -> Result<VaultSnapshotDto, MobileErrorDto> {
    lock_service(&state)?.snapshot().map_err(Into::into)
}

#[tauri::command]
pub(crate) fn mobile_entry_detail(
    entry_id: String,
    state: State<'_, MobileAppState>,
) -> Result<EntryDetailDto, MobileErrorDto> {
    lock_service(&state)?
        .entry_detail(&entry_id)
        .map_err(Into::into)
}

#[tauri::command]
pub(crate) async fn mobile_lock_vault(
    source: State<'_, IosVaultSource>,
    state: State<'_, MobileAppState>,
) -> Result<(), MobileErrorDto> {
    let operation = lock_service(&state)?
        .begin_lock()
        .map_err(MobileErrorDto::from)?;
    match source.release(&operation.source_token).await {
        Ok(()) => lock_service(&state)?
            .complete_lock(operation.id)
            .map_err(Into::into),
        Err(error) => {
            lock_service(&state)?.cancel_operation(operation.id);
            Err(error.into())
        }
    }
}

#[tauri::command]
pub(crate) async fn mobile_autofill_status(
    source: State<'_, IosVaultSource>,
) -> Result<MobileAutofillStatusDto, MobileErrorDto> {
    source.autofill_status().await.map_err(Into::into)
}

async fn configure_autofill(
    source: &IosVaultSource,
    state: &MobileAppState,
    command: &str,
) -> Result<MobileAutofillStatusDto, MobileErrorDto> {
    let (operation, identities) = {
        let mut service = lock_service(state)?;
        let operation = service
            .begin_ios_autofill_operation()
            .map_err(MobileErrorDto::from)?;
        let identities = match service.password_identities() {
            Ok(value) => value,
            Err(error) => {
                service.cancel_operation(operation.id);
                return Err(error.into());
            }
        };
        (operation, identities)
    };
    let projection: Vec<_> = identities
        .iter()
        .map(|identity| IdentityProjection {
            record_identifier: identity.record_identifier(),
            service_identifier: identity.service_identifier(),
            username: identity.username(),
        })
        .collect();
    let result = source
        .configure_autofill(command, &operation.source_token, &projection)
        .await;
    lock_service(state)?.finish_operation(operation.id);
    result.map_err(Into::into)
}

#[tauri::command]
pub(crate) async fn mobile_enable_autofill_for_vault(
    source: State<'_, IosVaultSource>,
    state: State<'_, MobileAppState>,
) -> Result<MobileAutofillStatusDto, MobileErrorDto> {
    configure_autofill(&source, &state, "enableAutofill").await
}

#[tauri::command]
pub(crate) async fn mobile_refresh_ios_autofill_mirror(
    source: State<'_, IosVaultSource>,
    state: State<'_, MobileAppState>,
) -> Result<MobileAutofillStatusDto, MobileErrorDto> {
    configure_autofill(&source, &state, "refreshAutofill").await
}

#[tauri::command]
pub(crate) async fn mobile_disable_autofill_for_vault(
    source: State<'_, IosVaultSource>,
    state: State<'_, MobileAppState>,
) -> Result<MobileAutofillStatusDto, MobileErrorDto> {
    let operation = lock_service(&state)?
        .begin_ios_autofill_operation()
        .map_err(MobileErrorDto::from)?;
    let result = source.disable_autofill().await;
    lock_service(&state)?.finish_operation(operation.id);
    result.map_err(Into::into)
}

#[tauri::command]
pub(crate) async fn mobile_open_autofill_settings(
    source: State<'_, IosVaultSource>,
) -> Result<(), MobileErrorDto> {
    source.open_settings().await.map_err(Into::into)
}
