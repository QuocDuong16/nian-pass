#![cfg(target_os = "android")]

use std::sync::{Arc, Mutex};

use vault_core::SecretString;

use crate::dto::MobileVaultSnapshotDto;

use super::{
    MobileError,
    source::AndroidVaultSource,
    state::MobileVaultService,
    transaction::{PreparedSourceCandidate, run_save_transaction},
};

pub(super) async fn save(
    password: String,
    source: AndroidVaultSource,
    service: Arc<Mutex<MobileVaultService>>,
) -> Result<MobileVaultSnapshotDto, MobileError> {
    let operation = service
        .lock()
        .map_err(|_| MobileError::Internal)?
        .begin_save()?;
    let operation_id = operation.id;
    let prepare_service = service.clone();
    let verify_service = service.clone();
    let result = run_save_transaction(
        &source,
        &operation.source_token,
        move |current_path, candidate_path| async move {
            tauri::async_runtime::spawn_blocking(move || {
                let credential = SecretString::new(password);
                let prepared = prepare_service
                    .lock()
                    .map_err(|_| MobileError::Internal)?
                    .prepare_save(operation_id, &current_path, &candidate_path, &credential)?;
                Ok(PreparedSourceCandidate {
                    baseline: prepared.baseline.clone(),
                    candidate: prepared.candidate.clone(),
                    context: (credential, prepared),
                })
            })
            .await
            .map_err(|_| MobileError::Internal)?
        },
        move |(credential, prepared), read_back| async move {
            tauri::async_runtime::spawn_blocking(move || {
                verify_service
                    .lock()
                    .map_err(|_| MobileError::SaveUncertain)?
                    .mark_verified_saved(&prepared, &read_back, &credential)
            })
            .await
            .map_err(|_| MobileError::SaveUncertain)?
        },
    )
    .await;
    finish(&service, operation.id);
    result
}

pub(super) async fn reload(
    password: String,
    source: AndroidVaultSource,
    service: Arc<Mutex<MobileVaultService>>,
) -> Result<MobileVaultSnapshotDto, MobileError> {
    let operation = service
        .lock()
        .map_err(|_| MobileError::Internal)?
        .begin_reload()?;
    let (read_token, staged_path) = match source.stage_current(&operation.source_token).await {
        Ok(value) => value,
        Err(error) => {
            finish(&service, operation.id);
            return Err(error);
        }
    };
    let service_for_reload = service.clone();
    let operation_id = operation.id;
    let joined = tauri::async_runtime::spawn_blocking(move || {
        let credential = SecretString::new(password);
        service_for_reload
            .lock()
            .map_err(|_| MobileError::ReloadFailed)?
            .reload_candidate(operation_id, &staged_path, &credential)
    })
    .await;
    source
        .finish_read(&operation.source_token, &read_token)
        .await;
    finish(&service, operation.id);
    joined.map_err(|_| MobileError::ReloadFailed)?
}

fn finish(service: &Arc<Mutex<MobileVaultService>>, operation: u64) {
    if let Ok(mut service) = service.lock() {
        service.finish_operation(operation);
    }
}
