use crate::platform::RuntimeInfoDto;

#[cfg(target_os = "android")]
use tauri::State;
#[cfg(target_os = "android")]
use vault_core::SecretString;

#[cfg(target_os = "android")]
use crate::dto::{EntryDetailDto, SelectedVaultDto, VaultSnapshotDto};
#[cfg(target_os = "android")]
use crate::mobile::{
    MobileAppState, MobileError, errors::MobileErrorDto, source::AndroidVaultSource,
};

fn compiled_runtime_info() -> RuntimeInfoDto {
    RuntimeInfoDto::current()
}

#[cfg(any(target_os = "android", target_os = "ios"))]
#[tauri::command]
pub(crate) fn runtime_info() -> RuntimeInfoDto {
    compiled_runtime_info()
}

#[cfg(target_os = "android")]
#[tauri::command]
pub(crate) async fn mobile_select_vault(
    source: State<'_, AndroidVaultSource>,
    state: State<'_, MobileAppState>,
) -> Result<Option<SelectedVaultDto>, MobileErrorDto> {
    let selected = source.select().await.map_err(MobileErrorDto::from)?;
    let Some(selected) = selected else {
        return Ok(None);
    };
    let mut service = state
        .service
        .lock()
        .map_err(|_| MobileErrorDto::from(MobileError::Internal))?;
    service
        .replace_selection(selected.staged_path, selected.file_name)
        .map(Some)
        .map_err(Into::into)
}

#[cfg(target_os = "android")]
#[tauri::command]
pub(crate) async fn mobile_unlock_vault(
    password: String,
    state: State<'_, MobileAppState>,
) -> Result<VaultSnapshotDto, MobileErrorDto> {
    let service = state.service.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let credential = SecretString::new(password);
        let mut service = service.lock().map_err(|_| MobileError::Internal)?;
        service.unlock(&credential)
    })
    .await
    .map_err(|_| MobileErrorDto::from(MobileError::Internal))?
    .map_err(Into::into)
}

#[cfg(target_os = "android")]
#[tauri::command]
pub(crate) fn mobile_vault_snapshot(
    state: State<'_, MobileAppState>,
) -> Result<VaultSnapshotDto, MobileErrorDto> {
    let service = state
        .service
        .lock()
        .map_err(|_| MobileErrorDto::from(MobileError::Internal))?;
    service.snapshot().map_err(Into::into)
}

#[cfg(target_os = "android")]
#[tauri::command]
pub(crate) fn mobile_entry_detail(
    entry_id: String,
    state: State<'_, MobileAppState>,
) -> Result<EntryDetailDto, MobileErrorDto> {
    let service = state
        .service
        .lock()
        .map_err(|_| MobileErrorDto::from(MobileError::Internal))?;
    service.entry_detail(&entry_id).map_err(Into::into)
}

#[cfg(target_os = "android")]
#[tauri::command]
pub(crate) fn mobile_lock_vault(state: State<'_, MobileAppState>) -> Result<(), MobileErrorDto> {
    let mut service = state
        .service
        .lock()
        .map_err(|_| MobileErrorDto::from(MobileError::Internal))?;
    service.lock().map_err(Into::into)
}

#[cfg(test)]
mod tests {
    use crate::platform::RuntimePlatform;

    use super::compiled_runtime_info;

    #[test]
    fn runtime_command_reports_the_compiled_platform() {
        assert!(matches!(
            compiled_runtime_info().platform,
            RuntimePlatform::Desktop
        ));
    }
}
