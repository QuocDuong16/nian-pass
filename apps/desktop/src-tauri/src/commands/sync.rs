use tauri::State;

use crate::{
    errors::DesktopErrorDto,
    state::AppState,
    sync::{
        ProviderCredentialsDto, ResolveSyncConflictRequestDto, SaveSyncProfileRequestDto,
        SyncProfileDto, SyncResultDto, SyncRuntime, TestProviderResultDto,
    },
};

#[tauri::command]
pub fn sync_profiles(
    state: State<'_, AppState>,
    runtime: State<'_, SyncRuntime>,
) -> Result<Vec<SyncProfileDto>, DesktopErrorDto> {
    runtime.profiles(&state).map_err(Into::into)
}

#[tauri::command]
pub fn save_sync_profile(
    request: SaveSyncProfileRequestDto,
    state: State<'_, AppState>,
    runtime: State<'_, SyncRuntime>,
) -> Result<SyncProfileDto, DesktopErrorDto> {
    let _operation = state
        .begin_vault_operation()
        .map_err(DesktopErrorDto::from)?;
    runtime.save_profile(&state, request).map_err(Into::into)
}

#[tauri::command]
pub fn delete_sync_profile(
    profile_id: String,
    state: State<'_, AppState>,
    runtime: State<'_, SyncRuntime>,
) -> Result<(), DesktopErrorDto> {
    let _operation = state
        .begin_vault_operation()
        .map_err(DesktopErrorDto::from)?;
    runtime.delete_profile(&profile_id).map_err(Into::into)
}

#[tauri::command]
pub fn reset_sync_state(
    profile_id: String,
    state: State<'_, AppState>,
    runtime: State<'_, SyncRuntime>,
) -> Result<(), DesktopErrorDto> {
    let _operation = state
        .begin_vault_operation()
        .map_err(DesktopErrorDto::from)?;
    runtime.reset_state(&state, &profile_id).map_err(Into::into)
}

#[tauri::command]
pub async fn test_sync_provider(
    profile_id: String,
    credentials: ProviderCredentialsDto,
    state: State<'_, AppState>,
    runtime: State<'_, SyncRuntime>,
) -> Result<TestProviderResultDto, DesktopErrorDto> {
    let _operation = state
        .begin_vault_operation()
        .map_err(DesktopErrorDto::from)?;
    runtime
        .test_provider(&profile_id, credentials)
        .await
        .map_err(Into::into)
}

#[tauri::command]
pub async fn sync_now(
    profile_id: String,
    credentials: ProviderCredentialsDto,
    master_password: String,
    state: State<'_, AppState>,
    runtime: State<'_, SyncRuntime>,
) -> Result<SyncResultDto, DesktopErrorDto> {
    let _operation = state
        .begin_vault_operation()
        .map_err(DesktopErrorDto::from)?;
    runtime
        .sync_now(&state, &profile_id, credentials, master_password)
        .await
        .map_err(Into::into)
}

#[tauri::command]
pub async fn resolve_sync_conflict(
    request: ResolveSyncConflictRequestDto,
    state: State<'_, AppState>,
    runtime: State<'_, SyncRuntime>,
) -> Result<SyncResultDto, DesktopErrorDto> {
    let _operation = state
        .begin_vault_operation()
        .map_err(DesktopErrorDto::from)?;
    runtime
        .resolve_conflict(&state, request)
        .await
        .map_err(Into::into)
}
