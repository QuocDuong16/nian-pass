use std::path::{Path, PathBuf};

use tauri::{AppHandle, State};
use tauri_plugin_dialog::{DialogExt, FilePath};

use crate::{
    command_support::with_service,
    dto::{AttachmentExportReceiptDto, EntryAttachmentSummaryDto, VaultSnapshotDto},
    errors::DesktopErrorDto,
    state::{AppState, DesktopError},
};

#[tauri::command]
pub fn entry_attachments(
    entry_id: String,
    state: State<'_, AppState>,
) -> Result<Vec<EntryAttachmentSummaryDto>, DesktopErrorDto> {
    with_service(state, |service| service.entry_attachments(&entry_id))
}

#[tauri::command]
pub async fn import_entry_attachment<R: tauri::Runtime>(
    app: AppHandle<R>,
    entry_id: String,
    state: State<'_, AppState>,
) -> Result<Option<VaultSnapshotDto>, DesktopErrorDto> {
    let dialog = app.dialog().file();
    import_entry_attachment_with_picker(entry_id, state.inner().clone(), move || {
        dialog.blocking_pick_file()
    })
    .await
}

async fn import_entry_attachment_with_picker(
    entry_id: String,
    state: AppState,
    picker: impl FnOnce() -> Option<FilePath> + Send + 'static,
) -> Result<Option<VaultSnapshotDto>, DesktopErrorDto> {
    let operation = state
        .begin_vault_operation()
        .map_err(DesktopErrorDto::from)?;
    let selected = tauri::async_runtime::spawn_blocking(picker)
        .await
        .map_err(|_| DesktopErrorDto::from(DesktopError::Internal))?;
    let Some(path) = selected.map(local_path).transpose()? else {
        return Ok(None);
    };
    let service = state.service.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let _operation = operation;
        let mut service = service.lock().map_err(|_| DesktopError::Internal)?;
        service.import_entry_attachment(&entry_id, path).map(Some)
    })
    .await
    .map_err(|_| DesktopErrorDto::from(DesktopError::Internal))?
    .map_err(Into::into)
}

#[tauri::command]
pub async fn export_entry_attachment<R: tauri::Runtime>(
    app: AppHandle<R>,
    entry_id: String,
    name: String,
    state: State<'_, AppState>,
) -> Result<Option<AttachmentExportReceiptDto>, DesktopErrorDto> {
    let dialog = app.dialog().file().set_file_name(safe_export_name(&name));
    export_entry_attachment_with_picker(entry_id, name, state.inner().clone(), move || {
        dialog.blocking_save_file()
    })
    .await
}

async fn export_entry_attachment_with_picker(
    entry_id: String,
    name: String,
    state: AppState,
    picker: impl FnOnce() -> Option<FilePath> + Send + 'static,
) -> Result<Option<AttachmentExportReceiptDto>, DesktopErrorDto> {
    let operation = state
        .begin_vault_operation()
        .map_err(DesktopErrorDto::from)?;
    let selected = tauri::async_runtime::spawn_blocking(picker)
        .await
        .map_err(|_| DesktopErrorDto::from(DesktopError::Internal))?;
    let Some(path) = selected.map(local_path).transpose()? else {
        return Ok(None);
    };
    let service = state.service.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let _operation = operation;
        let service = service.lock().map_err(|_| DesktopError::Internal)?;
        service.export_entry_attachment(&entry_id, &name, path)?;
        Ok::<Option<AttachmentExportReceiptDto>, DesktopError>(Some(AttachmentExportReceiptDto {
            exported: true,
        }))
    })
    .await
    .map_err(|_| DesktopErrorDto::from(DesktopError::Internal))?
    .map_err(Into::into)
}

fn local_path(value: FilePath) -> Result<PathBuf, DesktopErrorDto> {
    match value {
        FilePath::Path(path) => Ok(path),
        FilePath::Url(_) => Err(DesktopError::InvalidRequest.into()),
    }
}

fn safe_export_name(name: &str) -> String {
    let leaf = Path::new(name)
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("attachment.bin");
    let sanitized = leaf
        .chars()
        .map(|character| {
            if character.is_control()
                || matches!(
                    character,
                    '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|'
                )
            {
                '_'
            } else {
                character
            }
        })
        .take(120)
        .collect::<String>();
    if sanitized.is_empty() || sanitized == "." || sanitized == ".." {
        "attachment.bin".to_owned()
    } else {
        sanitized
    }
}

#[cfg(test)]
mod tests {
    use std::{
        fs, process,
        sync::Arc,
        time::{SystemTime, UNIX_EPOCH},
    };

    use serde_json::{json, to_value};
    use tauri::{
        Manager,
        test::{mock_builder, mock_context, noop_assets},
    };
    use tauri_plugin_dialog::FilePath;
    use vault_core::{GroupId, NewEntry, SecretString};

    use super::{
        entry_attachments, export_entry_attachment, export_entry_attachment_with_picker,
        import_entry_attachment, import_entry_attachment_with_picker, safe_export_name,
    };
    use crate::{clipboard::ClipboardPort, state::AppState};

    struct NoopClipboard;

    impl ClipboardPort for NoopClipboard {
        fn write_text(&self, _value: &str) -> Result<(), ()> {
            Ok(())
        }

        fn read_text(&self) -> Result<Option<String>, ()> {
            Ok(None)
        }

        fn clear(&self) -> Result<(), ()> {
            Ok(())
        }
    }

    fn test_directory() -> std::path::PathBuf {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system clock")
            .as_nanos();
        let directory = std::env::temp_dir().join(format!(
            "nian-pass-attachment-command-{}-{nonce}",
            process::id()
        ));
        fs::create_dir(&directory).expect("test directory");
        directory
    }

    fn unlocked_state(directory: &std::path::Path) -> (AppState, String, std::path::PathBuf) {
        let state = AppState::new(Arc::new(NoopClipboard));
        let vault_path = directory.join("attachments.kdbx");
        let entry_id = {
            let mut service = state.service.lock().expect("vault service");
            let snapshot = service
                .create(
                    vault_path.clone(),
                    "Attachments",
                    SecretString::new("demopass".to_owned()),
                )
                .expect("vault create");
            service
                .session_mut()
                .expect("writable session")
                .document_mut()
                .create_entry(
                    &GroupId::new(snapshot.root_group_id),
                    NewEntry {
                        title: "Attachment entry",
                        username: "",
                        url: "",
                        password: None,
                    },
                )
                .expect("entry create")
                .as_str()
                .to_owned()
        };
        (state, entry_id, vault_path)
    }

    #[test]
    fn export_name_is_leaf_only_bounded_and_cross_platform_safe() {
        assert_eq!(safe_export_name("../../private.txt"), "private.txt");
        assert_eq!(safe_export_name("bad:name?.txt"), "bad_name_.txt");
        assert_eq!(safe_export_name(".."), "attachment.bin");
        assert!(safe_export_name(&"x".repeat(300)).len() <= 120);
    }

    #[cfg(unix)]
    #[test]
    fn picker_helpers_cancel_gate_import_and_export_without_exposing_bytes() {
        let directory = test_directory();
        let (state, entry_id, vault_path) = unlocked_state(&directory);
        let source = directory.join("manual.bin");
        fs::write(&source, [1_u8, 3, 3, 7]).expect("attachment source");

        let Ok(cancelled) = tauri::async_runtime::block_on(import_entry_attachment_with_picker(
            entry_id.clone(),
            state.clone(),
            || None,
        )) else {
            panic!("import cancellation should succeed");
        };
        assert!(cancelled.is_none());

        let lease = state
            .begin_vault_operation()
            .expect("test operation should acquire gate");
        let busy = tauri::async_runtime::block_on(import_entry_attachment_with_picker(
            entry_id.clone(),
            state.clone(),
            || panic!("busy import must not invoke picker"),
        ));
        drop(lease);
        let Err(busy) = busy else {
            panic!("busy import should fail");
        };
        assert_eq!(
            to_value(busy).expect("busy error serializes"),
            json!({ "code": "operation_in_progress" })
        );

        let Ok(Some(imported)) = tauri::async_runtime::block_on(
            import_entry_attachment_with_picker(entry_id.clone(), state.clone(), {
                let source = source.clone();
                move || Some(FilePath::Path(source))
            }),
        ) else {
            panic!("attachment import should return a snapshot");
        };
        assert!(imported.dirty);
        let summaries = state
            .service
            .lock()
            .expect("vault service")
            .entry_attachments(&entry_id)
            .expect("attachment metadata");
        assert_eq!(summaries.len(), 1);
        assert_eq!(summaries[0].name, "manual.bin");
        assert_eq!(summaries[0].size_bytes, 4);
        assert!(summaries[0].protected);

        let app = mock_builder()
            .plugin(tauri_plugin_dialog::init())
            .build(mock_context(noop_assets()))
            .expect("dialog plugin should compose with mock runtime");
        app.manage(state.clone());
        let Ok(listed) = entry_attachments(entry_id.clone(), app.state::<AppState>()) else {
            panic!("attachment command should return metadata");
        };
        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].name, "manual.bin");

        let managed = app.state::<AppState>();
        let gate = managed
            .begin_vault_operation()
            .expect("test operation should acquire gate");
        let import_busy = tauri::async_runtime::block_on(import_entry_attachment(
            app.handle().clone(),
            entry_id.clone(),
            managed.clone(),
        ));
        let export_busy = tauri::async_runtime::block_on(export_entry_attachment(
            app.handle().clone(),
            entry_id.clone(),
            "manual.bin".to_owned(),
            managed,
        ));
        drop(gate);
        for result in [import_busy.map(|_| ()), export_busy.map(|_| ())] {
            let Err(error) = result else {
                panic!("busy native attachment command should fail before picker use");
            };
            assert_eq!(
                to_value(error).expect("busy command error serializes"),
                json!({ "code": "operation_in_progress" })
            );
        }

        let target = directory.join("exported.bin");
        let Ok(Some(receipt)) =
            tauri::async_runtime::block_on(export_entry_attachment_with_picker(
                entry_id.clone(),
                "manual.bin".to_owned(),
                state.clone(),
                {
                    let target = target.clone();
                    move || Some(FilePath::Path(target))
                },
            ))
        else {
            panic!("attachment export should return a receipt");
        };
        assert!(receipt.exported);
        assert_eq!(fs::read(&target).expect("exported bytes"), [1_u8, 3, 3, 7]);

        let export_to_vault = tauri::async_runtime::block_on(export_entry_attachment_with_picker(
            entry_id,
            "manual.bin".to_owned(),
            state,
            move || Some(FilePath::Path(vault_path)),
        ));
        let Err(error) = export_to_vault else {
            panic!("export must never overwrite the open vault");
        };
        assert_eq!(
            to_value(error).expect("invalid export error serializes"),
            json!({ "code": "invalid_request" })
        );

        fs::remove_dir_all(directory).expect("test cleanup");
    }
}
