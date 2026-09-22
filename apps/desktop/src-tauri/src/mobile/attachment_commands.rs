#![cfg(target_os = "android")]

use std::fs;

use tauri::State;

use crate::dto::{AttachmentExportReceiptDto, MobileVaultSnapshotDto};

use super::{
    MobileAppState, commands::lock_service, errors::MobileErrorDto, source::AndroidVaultSource,
};

#[tauri::command]
pub(crate) async fn mobile_import_entry_attachment(
    entry_id: String,
    source: State<'_, AndroidVaultSource>,
    state: State<'_, MobileAppState>,
) -> Result<Option<MobileVaultSnapshotDto>, MobileErrorDto> {
    let operation = lock_service(&state)?
        .begin_attachment_import()
        .map_err(MobileErrorDto::from)?;
    let selected = match source.select_attachment_import().await {
        Ok(value) => value,
        Err(error) => {
            lock_service(&state)?.finish_operation(operation.id);
            return Err(error.into());
        }
    };
    let Some((token, staged_path, file_name)) = selected else {
        lock_service(&state)?.finish_operation(operation.id);
        return Ok(None);
    };

    let result = lock_service(&state)?.complete_attachment_import(
        operation.id,
        &entry_id,
        &file_name,
        &staged_path,
    );
    let _ = fs::remove_file(&staged_path);
    source.finish_attachment_import(&token).await;
    lock_service(&state)?.finish_operation(operation.id);
    result.map(Some).map_err(Into::into)
}

#[tauri::command]
pub(crate) async fn mobile_export_entry_attachment(
    entry_id: String,
    name: String,
    source: State<'_, AndroidVaultSource>,
    state: State<'_, MobileAppState>,
) -> Result<Option<AttachmentExportReceiptDto>, MobileErrorDto> {
    let operation = lock_service(&state)?
        .begin_attachment_export()
        .map_err(MobileErrorDto::from)?;
    let (token, candidate_path) = match source.prepare_attachment_export().await {
        Ok(value) => value,
        Err(error) => {
            lock_service(&state)?.finish_operation(operation.id);
            return Err(error.into());
        }
    };

    let prepared = {
        let service = lock_service(&state)?;
        service.prepare_attachment_export(operation.id, &entry_id, &name, &candidate_path)
    };
    if let Err(error) = prepared {
        let _ = fs::remove_file(&candidate_path);
        source.abort_attachment_export(&token).await;
        lock_service(&state)?.finish_operation(operation.id);
        return Err(error.into());
    }

    let exported = source.export_attachment(&token, &name).await;
    if exported.is_err() {
        source.abort_attachment_export(&token).await;
    }
    lock_service(&state)?.finish_operation(operation.id);
    match exported.map_err(MobileErrorDto::from)? {
        true => Ok(Some(AttachmentExportReceiptDto { exported: true })),
        false => Ok(None),
    }
}
