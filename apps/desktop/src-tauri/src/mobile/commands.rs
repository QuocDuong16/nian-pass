use crate::platform::RuntimeInfoDto;

#[cfg(target_os = "android")]
use tauri::State;
#[cfg(target_os = "android")]
use vault_core::SecretString;

#[cfg(target_os = "android")]
use crate::dto::{
    CreatedEntryDto, CreatedGroupDto, EntryDetailDto, MobileSelectedVaultDto, VaultSnapshotDto,
};
#[cfg(target_os = "android")]
use crate::mobile::{
    MobileAppState, MobileError,
    errors::MobileErrorDto,
    mutations::{
        MobileCreateEntryRequest, MobileCreateGroupRequest, MobileMoveEntryRequest,
        MobileMoveGroupRequest, MobileRenameGroupRequest, MobileSetCustomFieldRequest,
        MobileUpdateEntryRequest,
    },
    persistence,
    source::AndroidVaultSource,
    state::{MobileSecretKind, MobileVaultService},
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
fn lock_service(
    state: &MobileAppState,
) -> Result<std::sync::MutexGuard<'_, MobileVaultService>, MobileErrorDto> {
    state
        .service
        .lock()
        .map_err(|_| MobileErrorDto::from(MobileError::Internal))
}

#[cfg(target_os = "android")]
#[tauri::command]
pub(crate) async fn mobile_select_vault(
    source: State<'_, AndroidVaultSource>,
    state: State<'_, MobileAppState>,
) -> Result<Option<MobileSelectedVaultDto>, MobileErrorDto> {
    let operation = lock_service(&state)?
        .begin_selection()
        .map_err(MobileErrorDto::from)?;
    let selected = match source.select().await {
        Ok(selected) => selected,
        Err(error) => {
            lock_service(&state)?.finish_operation(operation.id);
            return Err(error.into());
        }
    };
    let Some(selected) = selected else {
        lock_service(&state)?.finish_operation(operation.id);
        return Ok(None);
    };
    let selected_token = selected.source_token.clone();
    let selected_preserve_recovery = selected.recovery_required;
    if let Some(previous) = operation.previous.as_ref()
        && let Err(error) = source
            .release(&previous.token, previous.preserve_recovery)
            .await
    {
        let _ = source
            .release(&selected_token, selected_preserve_recovery)
            .await;
        lock_service(&state)?.finish_operation(operation.id);
        return Err(error.into());
    }
    let completed = lock_service(&state)?.complete_selection(
        operation.id,
        selected.staged_path,
        selected.file_name,
        selected.source_token,
        selected.writable,
        selected.recovery_required,
    );
    let dto = match completed {
        Ok(dto) => dto,
        Err(error) => {
            let _ = source
                .release(&selected_token, selected_preserve_recovery)
                .await;
            lock_service(&state)?.finish_operation(operation.id);
            return Err(error.into());
        }
    };
    Ok(Some(dto))
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
        service
            .lock()
            .map_err(|_| MobileError::Internal)?
            .unlock(&credential)
    })
    .await
    .map_err(|_| MobileErrorDto::from(MobileError::Internal))?
    .map_err(Into::into)
}

#[cfg(target_os = "android")]
macro_rules! read_command {
    ($name:ident, $result:ty, $call:expr) => {
        #[tauri::command]
        pub(crate) fn $name(state: State<'_, MobileAppState>) -> Result<$result, MobileErrorDto> {
            $call(&*lock_service(&state)?).map_err(Into::into)
        }
    };
}

#[cfg(target_os = "android")]
read_command!(
    mobile_vault_snapshot,
    VaultSnapshotDto,
    MobileVaultService::snapshot
);

#[cfg(target_os = "android")]
#[tauri::command]
pub(crate) fn mobile_entry_detail(
    entry_id: String,
    state: State<'_, MobileAppState>,
) -> Result<EntryDetailDto, MobileErrorDto> {
    lock_service(&state)?
        .entry_detail(&entry_id)
        .map_err(Into::into)
}

#[cfg(target_os = "android")]
macro_rules! load_secret_command {
    ($name:ident, $kind:ident) => {
        #[tauri::command]
        pub(crate) fn $name(
            entry_id: String,
            state: State<'_, MobileAppState>,
        ) -> Result<String, MobileErrorDto> {
            lock_service(&state)?
                .entry_secret(&entry_id, MobileSecretKind::$kind)
                .map(|secret| secret.expose_secret().to_owned())
                .map_err(Into::into)
        }
    };
}

#[cfg(target_os = "android")]
load_secret_command!(mobile_load_entry_title, Title);
#[cfg(target_os = "android")]
load_secret_command!(mobile_load_entry_username, Username);
#[cfg(target_os = "android")]
load_secret_command!(mobile_load_entry_url, Url);
#[cfg(target_os = "android")]
load_secret_command!(mobile_load_entry_notes, Notes);
#[cfg(target_os = "android")]
#[tauri::command]
pub(crate) fn mobile_load_entry_custom_field(
    entry_id: String,
    name: String,
    state: State<'_, MobileAppState>,
) -> Result<String, MobileErrorDto> {
    lock_service(&state)?
        .entry_custom_field(&entry_id, &name)
        .map(|secret| secret.expose_secret().to_owned())
        .map_err(Into::into)
}

#[cfg(target_os = "android")]
macro_rules! mutation_command {
    ($name:ident, $request:ident, $request_ty:ty, $result:ty, $method:ident) => {
        #[tauri::command]
        pub(crate) fn $name(
            $request: $request_ty,
            state: State<'_, MobileAppState>,
        ) -> Result<$result, MobileErrorDto> {
            lock_service(&state)?.$method($request).map_err(Into::into)
        }
    };
}

#[cfg(target_os = "android")]
mutation_command!(
    mobile_update_entry,
    request,
    MobileUpdateEntryRequest,
    VaultSnapshotDto,
    update_entry
);
#[cfg(target_os = "android")]
mutation_command!(
    mobile_create_entry,
    request,
    MobileCreateEntryRequest,
    CreatedEntryDto,
    create_entry
);
#[cfg(target_os = "android")]
mutation_command!(
    mobile_move_entry,
    request,
    MobileMoveEntryRequest,
    VaultSnapshotDto,
    move_entry
);
#[cfg(target_os = "android")]
mutation_command!(
    mobile_create_group,
    request,
    MobileCreateGroupRequest,
    CreatedGroupDto,
    create_group
);
#[cfg(target_os = "android")]
mutation_command!(
    mobile_rename_group,
    request,
    MobileRenameGroupRequest,
    VaultSnapshotDto,
    rename_group
);
#[cfg(target_os = "android")]
mutation_command!(
    mobile_move_group,
    request,
    MobileMoveGroupRequest,
    VaultSnapshotDto,
    move_group
);
#[cfg(target_os = "android")]
mutation_command!(
    mobile_set_entry_custom_field,
    request,
    MobileSetCustomFieldRequest,
    VaultSnapshotDto,
    set_custom_field
);

#[cfg(target_os = "android")]
#[tauri::command]
pub(crate) fn mobile_delete_entry(
    entry_id: String,
    state: State<'_, MobileAppState>,
) -> Result<VaultSnapshotDto, MobileErrorDto> {
    lock_service(&state)?
        .delete_entry(entry_id)
        .map_err(Into::into)
}
#[cfg(target_os = "android")]
#[tauri::command]
pub(crate) fn mobile_delete_group(
    group_id: String,
    state: State<'_, MobileAppState>,
) -> Result<VaultSnapshotDto, MobileErrorDto> {
    lock_service(&state)?
        .delete_group(group_id)
        .map_err(Into::into)
}
#[cfg(target_os = "android")]
#[tauri::command]
pub(crate) fn mobile_delete_entry_custom_field(
    entry_id: String,
    name: String,
    state: State<'_, MobileAppState>,
) -> Result<VaultSnapshotDto, MobileErrorDto> {
    lock_service(&state)?
        .delete_custom_field(entry_id, name)
        .map_err(Into::into)
}

#[cfg(target_os = "android")]
#[tauri::command]
pub(crate) async fn mobile_save_vault(
    password: String,
    source: State<'_, AndroidVaultSource>,
    state: State<'_, MobileAppState>,
) -> Result<VaultSnapshotDto, MobileErrorDto> {
    persistence::save(password, source.inner().clone(), state.service.clone())
        .await
        .map_err(Into::into)
}

#[cfg(target_os = "android")]
#[tauri::command]
pub(crate) async fn mobile_reload_vault(
    password: String,
    source: State<'_, AndroidVaultSource>,
    state: State<'_, MobileAppState>,
) -> Result<VaultSnapshotDto, MobileErrorDto> {
    persistence::reload(password, source.inner().clone(), state.service.clone())
        .await
        .map_err(Into::into)
}

#[cfg(target_os = "android")]
#[tauri::command]
pub(crate) async fn mobile_lock_vault(
    source: State<'_, AndroidVaultSource>,
    state: State<'_, MobileAppState>,
) -> Result<(), MobileErrorDto> {
    let token = lock_service(&state)?.lock().map_err(MobileErrorDto::from)?;
    source
        .release(&token, false)
        .await
        .map_err(MobileErrorDto::from)
}

#[cfg(target_os = "android")]
#[tauri::command]
pub(crate) async fn mobile_discard_changes_and_lock(
    source: State<'_, AndroidVaultSource>,
    state: State<'_, MobileAppState>,
) -> Result<(), MobileErrorDto> {
    let token = lock_service(&state)?
        .discard_and_lock()
        .map_err(MobileErrorDto::from)?;
    source
        .release(&token, false)
        .await
        .map_err(MobileErrorDto::from)
}

#[cfg(test)]
mod tests {
    use super::compiled_runtime_info;
    use crate::platform::RuntimePlatform;
    #[test]
    fn runtime_command_reports_the_compiled_platform() {
        assert!(matches!(
            compiled_runtime_info().platform,
            RuntimePlatform::Desktop
        ));
    }
}
