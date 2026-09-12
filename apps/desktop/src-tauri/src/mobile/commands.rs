use crate::platform::RuntimeInfoDto;

#[cfg(any(target_os = "android", test))]
use std::{
    future::Future,
    sync::{Arc, Mutex},
};
#[cfg(target_os = "android")]
use tauri::State;
#[cfg(target_os = "android")]
use vault_core::SecretString;

#[cfg(target_os = "android")]
use crate::dto::{
    EntryDetailDto, MobileCreatedEntryDto, MobileCreatedGroupDto, MobileSelectedVaultDto,
    MobileVaultSnapshotDto,
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
#[cfg(all(test, not(target_os = "android")))]
use crate::mobile::{MobileError, state::MobileVaultService};

fn compiled_runtime_info() -> RuntimeInfoDto {
    RuntimeInfoDto::current()
}

#[cfg(any(target_os = "android", test))]
#[derive(Clone, Copy)]
enum MobileLockKind {
    Clean,
    Discard,
}

#[cfg(any(target_os = "android", test))]
async fn run_mobile_lock_transaction<Release, ReleaseFuture>(
    service: Arc<Mutex<MobileVaultService>>,
    kind: MobileLockKind,
    release: Release,
) -> Result<(), MobileError>
where
    Release: FnOnce(String) -> ReleaseFuture,
    ReleaseFuture: Future<Output = Result<(), MobileError>>,
{
    let operation = {
        let mut service = service.lock().map_err(|_| MobileError::Internal)?;
        match kind {
            MobileLockKind::Clean => service.begin_lock()?,
            MobileLockKind::Discard => service.begin_discard_and_lock()?,
        }
    };

    match release(operation.source_token).await {
        Ok(()) => {
            let mut service = service.lock().map_err(|_| MobileError::Internal)?;
            match kind {
                MobileLockKind::Clean => service.complete_lock(operation.id),
                MobileLockKind::Discard => service.complete_discard_and_lock(operation.id),
            }
        }
        Err(error) => {
            if let Ok(mut service) = service.lock() {
                service.cancel_operation(operation.id);
            }
            Err(error)
        }
    }
}

#[cfg(any(target_os = "android", target_os = "ios"))]
#[tauri::command]
pub(crate) fn runtime_info() -> RuntimeInfoDto {
    compiled_runtime_info()
}

#[cfg(target_os = "android")]
pub(super) fn lock_service(
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
) -> Result<MobileVaultSnapshotDto, MobileErrorDto> {
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
    MobileVaultSnapshotDto,
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
    MobileVaultSnapshotDto,
    update_entry
);
#[cfg(target_os = "android")]
mutation_command!(
    mobile_create_entry,
    request,
    MobileCreateEntryRequest,
    MobileCreatedEntryDto,
    create_entry
);
#[cfg(target_os = "android")]
mutation_command!(
    mobile_move_entry,
    request,
    MobileMoveEntryRequest,
    MobileVaultSnapshotDto,
    move_entry
);
#[cfg(target_os = "android")]
mutation_command!(
    mobile_create_group,
    request,
    MobileCreateGroupRequest,
    MobileCreatedGroupDto,
    create_group
);
#[cfg(target_os = "android")]
mutation_command!(
    mobile_rename_group,
    request,
    MobileRenameGroupRequest,
    MobileVaultSnapshotDto,
    rename_group
);
#[cfg(target_os = "android")]
mutation_command!(
    mobile_move_group,
    request,
    MobileMoveGroupRequest,
    MobileVaultSnapshotDto,
    move_group
);
#[cfg(target_os = "android")]
mutation_command!(
    mobile_set_entry_custom_field,
    request,
    MobileSetCustomFieldRequest,
    MobileVaultSnapshotDto,
    set_custom_field
);

#[cfg(target_os = "android")]
#[tauri::command]
pub(crate) fn mobile_delete_entry(
    entry_id: String,
    state: State<'_, MobileAppState>,
) -> Result<MobileVaultSnapshotDto, MobileErrorDto> {
    lock_service(&state)?
        .delete_entry(entry_id)
        .map_err(Into::into)
}
#[cfg(target_os = "android")]
#[tauri::command]
pub(crate) fn mobile_delete_group(
    group_id: String,
    state: State<'_, MobileAppState>,
) -> Result<MobileVaultSnapshotDto, MobileErrorDto> {
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
) -> Result<MobileVaultSnapshotDto, MobileErrorDto> {
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
) -> Result<MobileVaultSnapshotDto, MobileErrorDto> {
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
) -> Result<MobileVaultSnapshotDto, MobileErrorDto> {
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
    let source = source.inner().clone();
    run_mobile_lock_transaction(
        state.service.clone(),
        MobileLockKind::Clean,
        move |token| async move { source.release(&token, false).await },
    )
    .await
    .map_err(MobileErrorDto::from)
}

#[cfg(target_os = "android")]
#[tauri::command]
pub(crate) async fn mobile_discard_changes_and_lock(
    source: State<'_, AndroidVaultSource>,
    state: State<'_, MobileAppState>,
) -> Result<(), MobileErrorDto> {
    let source = source.inner().clone();
    run_mobile_lock_transaction(
        state.service.clone(),
        MobileLockKind::Discard,
        move |token| async move { source.release(&token, false).await },
    )
    .await
    .map_err(MobileErrorDto::from)
}

#[cfg(test)]
mod tests {
    use super::{MobileLockKind, compiled_runtime_info, run_mobile_lock_transaction};
    use crate::mobile::{MobileError, state::MobileVaultService};
    use crate::platform::RuntimePlatform;
    use std::{
        fs,
        path::{Path, PathBuf},
        sync::{
            Arc, Mutex,
            atomic::{AtomicU64, Ordering},
        },
    };
    use vault_core::SecretString;

    static NEXT: AtomicU64 = AtomicU64::new(0);

    fn unlocked_service() -> (PathBuf, Arc<Mutex<MobileVaultService>>) {
        let root = std::env::temp_dir().join(format!(
            "nian-pass-mobile-lock-command-{}-{}",
            std::process::id(),
            NEXT.fetch_add(1, Ordering::Relaxed)
        ));
        fs::create_dir(&root).expect("test dir");
        let staged = root.join("staged.kdbx");
        fs::copy(
            Path::new(env!("CARGO_MANIFEST_DIR"))
                .join("../../../fixtures/kdbx/keepassxc-2.7.12-kdbx41.kdbx"),
            &staged,
        )
        .expect("stage");
        let mut service = MobileVaultService::new();
        let selection = service.begin_selection().expect("begin selection");
        service
            .complete_selection(
                selection.id,
                staged,
                "vault.kdbx".to_owned(),
                "0123456789abcdef0123456789abcdef".to_owned(),
                true,
                false,
            )
            .expect("select");
        service
            .unlock(&SecretString::new("demopass".to_owned()))
            .expect("unlock");
        (root, Arc::new(Mutex::new(service)))
    }

    #[test]
    fn runtime_command_reports_the_compiled_platform() {
        assert!(matches!(
            compiled_runtime_info().platform,
            RuntimePlatform::Desktop
        ));
    }

    #[test]
    fn command_release_failure_returns_error_and_keeps_service_unlocked() {
        let (root, service) = unlocked_service();
        let result = tauri::async_runtime::block_on(run_mobile_lock_transaction(
            service.clone(),
            MobileLockKind::Clean,
            |_| async { Err(MobileError::Internal) },
        ));

        assert!(matches!(result, Err(MobileError::Internal)));
        assert!(
            !service
                .lock()
                .expect("service")
                .snapshot()
                .expect("snapshot")
                .dirty
        );
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn command_release_success_returns_success_and_locks_service() {
        let (root, service) = unlocked_service();
        let result = tauri::async_runtime::block_on(run_mobile_lock_transaction(
            service.clone(),
            MobileLockKind::Clean,
            |token| async move {
                assert_eq!(token, "0123456789abcdef0123456789abcdef");
                Ok(())
            },
        ));

        assert!(result.is_ok());
        assert!(matches!(
            service.lock().expect("service").snapshot(),
            Err(MobileError::Locked)
        ));
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn command_discard_release_failure_keeps_dirty_service_unlocked() {
        let (root, service) = unlocked_service();
        let entry_id = service
            .lock()
            .expect("service")
            .snapshot()
            .expect("snapshot")
            .entries
            .first()
            .expect("entry")
            .id
            .clone();
        service
            .lock()
            .expect("service")
            .update_entry(crate::mobile::mutations::MobileUpdateEntryRequest {
                entry_id,
                title: Some("dirty command mutation".to_owned()),
                username: None,
                url: None,
                password: None,
                notes: None,
            })
            .expect("mutate");

        let result = tauri::async_runtime::block_on(run_mobile_lock_transaction(
            service.clone(),
            MobileLockKind::Discard,
            |_| async { Err(MobileError::Internal) },
        ));

        assert!(matches!(result, Err(MobileError::Internal)));
        assert!(
            service
                .lock()
                .expect("service")
                .snapshot()
                .expect("snapshot")
                .dirty
        );
        let _ = fs::remove_dir_all(root);
    }
}
