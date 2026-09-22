use std::path::PathBuf;

use tauri::{AppHandle, State};
use tauri_plugin_dialog::{DialogExt, FilePath};

use crate::{
    errors::DesktopErrorDto,
    state::{AppState, DesktopError},
};

#[tauri::command]
pub async fn export_vault_copy<R: tauri::Runtime>(
    app: AppHandle<R>,
    state: State<'_, AppState>,
) -> Result<bool, DesktopErrorDto> {
    let dialog = app
        .dialog()
        .file()
        .add_filter("KeePass database", &["kdbx"])
        .set_file_name("vault-copy.kdbx");
    export_vault_copy_with_picker(state.inner().clone(), move || dialog.blocking_save_file()).await
}

async fn export_vault_copy_with_picker(
    state: AppState,
    picker: impl FnOnce() -> Option<FilePath> + Send + 'static,
) -> Result<bool, DesktopErrorDto> {
    let operation = state
        .begin_vault_operation()
        .map_err(DesktopErrorDto::from)?;
    let selected = tauri::async_runtime::spawn_blocking(picker)
        .await
        .map_err(|_| DesktopErrorDto::from(DesktopError::Internal))?;
    let Some(path) = selected.map(local_path).transpose()? else {
        return Ok(false);
    };
    let service = state.service.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let _operation = operation;
        let service = service.lock().map_err(|_| DesktopError::Internal)?;
        service.export_copy(path)?;
        Ok::<bool, DesktopError>(true)
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

#[cfg(test)]
mod tests {
    use std::{fs, sync::Arc};

    use tauri::{
        Manager,
        test::{mock_builder, mock_context, noop_assets},
    };
    use tauri_plugin_dialog::FilePath;
    use vault_core::SecretString;

    use super::{export_vault_copy, export_vault_copy_with_picker};
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

    #[test]
    fn export_picker_cancellation_is_harmless_and_success_keeps_source_selected() {
        let runtime = tauri::async_runtime::block_on(async {
            let app = mock_builder()
                .build(mock_context(noop_assets()))
                .expect("mock app");
            let state = AppState::new(Arc::new(NoopClipboard));
            let directory = std::env::temp_dir()
                .join(format!("nian-pass-export-command-{}", std::process::id()));
            let _ = fs::remove_dir_all(&directory);
            fs::create_dir_all(&directory).expect("temp dir");
            let source = directory.join("source.kdbx");
            let copy = directory.join("copy.kdbx");
            {
                let mut service = state.service.lock().expect("service");
                service
                    .create(
                        source.clone(),
                        "Export",
                        SecretString::new("fixture".to_owned()),
                    )
                    .expect("create vault");
            }
            let cancelled = export_vault_copy_with_picker(state.clone(), || None).await;
            assert!(matches!(cancelled, Ok(false)));
            let exported = export_vault_copy_with_picker(state.clone(), move || {
                Some(FilePath::Path(copy.clone()))
            })
            .await;
            assert!(matches!(exported, Ok(true)));
            assert!(directory.join("copy.kdbx").is_file());
            let snapshot = state
                .service
                .lock()
                .expect("service")
                .snapshot()
                .expect("snapshot");
            assert_eq!(snapshot.file_name, "source.kdbx");
            let _ = fs::remove_dir_all(directory);
            app
        });
        drop(runtime);
    }

    #[test]
    fn export_command_builds_native_save_dialog_but_honors_gate_before_picker() {
        let runtime = tauri::async_runtime::block_on(async {
            let app = mock_builder()
                .plugin(tauri_plugin_dialog::init())
                .build(mock_context(noop_assets()))
                .expect("dialog plugin should compose with mock runtime");
            let state = AppState::new(Arc::new(NoopClipboard));
            app.manage(state.clone());
            let lease = state
                .begin_vault_operation()
                .expect("test operation should acquire gate");
            let result = export_vault_copy(app.handle().clone(), app.state::<AppState>()).await;
            drop(lease);
            assert!(result.is_err());
            app
        });
        drop(runtime);
    }
}
