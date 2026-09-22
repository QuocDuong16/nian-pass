use std::{fs, io::Read, path::Path};

use tauri::{AppHandle, State};
use tauri_plugin_dialog::{DialogExt, FilePath};
use vault_core::SecretBytes;

use crate::{
    dto::VaultSnapshotDto,
    errors::DesktopErrorDto,
    state::{AppState, DesktopError},
};

const MAX_CUSTOM_ICON_BYTES: usize = 4 * 1024 * 1024;

#[tauri::command]
pub async fn import_entry_custom_icon<R: tauri::Runtime>(
    app: AppHandle<R>,
    entry_id: String,
    state: State<'_, AppState>,
) -> Result<Option<VaultSnapshotDto>, DesktopErrorDto> {
    let dialog = app.dialog().file().add_filter("PNG image", &["png"]);
    import_entry_custom_icon_with_picker(entry_id, state, move || dialog.blocking_pick_file()).await
}

async fn import_entry_custom_icon_with_picker(
    entry_id: String,
    state: State<'_, AppState>,
    picker: impl FnOnce() -> Option<FilePath> + Send + 'static,
) -> Result<Option<VaultSnapshotDto>, DesktopErrorDto> {
    if entry_id.is_empty() {
        return Err(DesktopError::InvalidRequest.into());
    }
    let operation = state
        .begin_vault_operation()
        .map_err(DesktopErrorDto::from)?;
    let selected = tauri::async_runtime::spawn_blocking(picker)
        .await
        .map_err(|_| DesktopErrorDto::from(DesktopError::Internal))?;
    let Some(selected) = selected else {
        return Ok(None);
    };
    let path = match selected {
        FilePath::Path(path) => path,
        FilePath::Url(_) => return Err(DesktopError::InvalidRequest.into()),
    };
    let service = state.service.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let _operation = operation;
        let bytes = SecretBytes::new(read_custom_icon(&path)?);
        let mut service = service.lock().map_err(|_| DesktopError::Internal)?;
        service
            .set_entry_custom_icon_png(&entry_id, &bytes)
            .map(Some)
    })
    .await
    .map_err(|_| DesktopErrorDto::from(DesktopError::Internal))?
    .map_err(Into::into)
}

fn read_custom_icon(path: &Path) -> Result<Vec<u8>, DesktopError> {
    let metadata = fs::symlink_metadata(path).map_err(|_| DesktopError::InvalidRequest)?;
    if metadata.file_type().is_symlink() || !metadata.is_file() {
        return Err(DesktopError::InvalidRequest);
    }
    if metadata.len() == 0 || metadata.len() > MAX_CUSTOM_ICON_BYTES as u64 {
        return Err(DesktopError::InvalidRequest);
    }
    let file = fs::File::open(path).map_err(|_| DesktopError::InvalidRequest)?;
    let opened = file.metadata().map_err(|_| DesktopError::InvalidRequest)?;
    if !opened.is_file() || opened.len() == 0 || opened.len() > MAX_CUSTOM_ICON_BYTES as u64 {
        return Err(DesktopError::InvalidRequest);
    }
    let mut bytes = Vec::with_capacity(opened.len() as usize);
    file.take((MAX_CUSTOM_ICON_BYTES + 1) as u64)
        .read_to_end(&mut bytes)
        .map_err(|_| DesktopError::InvalidRequest)?;
    if bytes.is_empty() || bytes.len() > MAX_CUSTOM_ICON_BYTES {
        return Err(DesktopError::InvalidRequest);
    }
    Ok(bytes)
}

#[cfg(test)]
mod tests {
    use std::{
        fs,
        sync::{
            Arc,
            atomic::{AtomicU64, Ordering},
        },
    };

    use serde_json::{json, to_value};
    use tauri::{
        Manager,
        test::{mock_builder, mock_context, noop_assets},
    };
    use tauri_plugin_dialog::FilePath;
    use vault_core::{GroupId, NewEntry, SecretString};

    use super::{
        MAX_CUSTOM_ICON_BYTES, import_entry_custom_icon, import_entry_custom_icon_with_picker,
        read_custom_icon,
    };
    use crate::{clipboard::ClipboardPort, dto::EntryIconDto, state::AppState};

    static TEST_SEQUENCE: AtomicU64 = AtomicU64::new(0);

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
        let sequence = TEST_SEQUENCE.fetch_add(1, Ordering::Relaxed);
        let directory = std::env::temp_dir().join(format!(
            "nian-pass-custom-icon-command-{}-{sequence}",
            std::process::id()
        ));
        let _ = fs::remove_dir_all(&directory);
        fs::create_dir(&directory).expect("test directory");
        directory
    }

    fn png_bytes() -> Vec<u8> {
        let mut bytes = Vec::new();
        bytes.extend_from_slice(b"\x89PNG\r\n\x1a\n");
        bytes.extend_from_slice(&13_u32.to_be_bytes());
        bytes.extend_from_slice(b"IHDR");
        bytes.extend_from_slice(&32_u32.to_be_bytes());
        bytes.extend_from_slice(&32_u32.to_be_bytes());
        bytes.extend_from_slice(&[8, 6, 0, 0, 0]);
        bytes.extend_from_slice(&[0; 4]);
        bytes.extend_from_slice(&1_u32.to_be_bytes());
        bytes.extend_from_slice(b"IDAT");
        bytes.push(1);
        bytes.extend_from_slice(&[0; 4]);
        bytes.extend_from_slice(&0_u32.to_be_bytes());
        bytes.extend_from_slice(b"IEND");
        bytes.extend_from_slice(&[0; 4]);
        bytes
    }

    fn unlocked_state(directory: &std::path::Path) -> (AppState, String) {
        let state = AppState::new(Arc::new(NoopClipboard));
        let entry_id = {
            let mut service = state.service.lock().expect("vault service");
            let snapshot = service
                .create(
                    directory.join("custom-icons.kdbx"),
                    "Custom icons",
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
                        title: "Icon entry",
                        username: "",
                        url: "",
                        password: None,
                    },
                )
                .expect("entry create")
                .as_str()
                .to_owned()
        };
        (state, entry_id)
    }

    #[test]
    fn native_custom_icon_read_is_regular_bounded_and_nonempty() {
        let root = test_directory();
        let valid = root.join("icon.png");
        fs::write(&valid, [1_u8, 2, 3]).expect("valid fixture");
        assert_eq!(read_custom_icon(&valid).expect("regular file"), [1, 2, 3]);
        let empty = root.join("empty.png");
        fs::write(&empty, []).expect("empty fixture");
        assert!(read_custom_icon(&empty).is_err());
        let oversized = root.join("oversized.png");
        let file = fs::File::create(&oversized).expect("oversized fixture");
        file.set_len((MAX_CUSTOM_ICON_BYTES + 1) as u64)
            .expect("oversized length");
        assert!(read_custom_icon(&oversized).is_err());
        fs::remove_dir_all(root).expect("test cleanup");
    }

    #[cfg(unix)]
    #[test]
    fn native_custom_icon_read_rejects_final_symlink() {
        use std::os::unix::fs::symlink;

        let root = test_directory();
        let real = root.join("real.png");
        let link = root.join("link.png");
        fs::write(&real, png_bytes()).expect("real icon");
        symlink(&real, &link).expect("symlink fixture");
        assert!(read_custom_icon(&link).is_err());
        fs::remove_dir_all(root).expect("test cleanup");
    }

    #[cfg(unix)]
    #[test]
    fn picker_flow_is_gated_cancelable_and_applies_only_valid_png() {
        let directory = test_directory();
        let (state, entry_id) = unlocked_state(&directory);
        let icon = directory.join("icon.png");
        fs::write(&icon, png_bytes()).expect("png fixture");

        let app = mock_builder()
            .plugin(tauri_plugin_dialog::init())
            .build(mock_context(noop_assets()))
            .expect("dialog plugin should compose with mock runtime");
        app.manage(state.clone());
        let managed = app.state::<AppState>();

        let Ok(cancelled) = tauri::async_runtime::block_on(import_entry_custom_icon_with_picker(
            entry_id.clone(),
            managed.clone(),
            || None,
        )) else {
            panic!("picker cancellation should be harmless");
        };
        assert!(cancelled.is_none());

        let lease = managed
            .begin_vault_operation()
            .expect("test operation should acquire gate");
        let busy = tauri::async_runtime::block_on(import_entry_custom_icon_with_picker(
            entry_id.clone(),
            managed.clone(),
            || panic!("busy custom-icon request must not invoke picker"),
        ));
        drop(lease);
        let Err(busy) = busy else {
            panic!("busy custom-icon request should fail");
        };
        assert_eq!(
            to_value(busy).expect("busy error serializes"),
            json!({ "code": "operation_in_progress" })
        );

        let Ok(Some(imported)) = tauri::async_runtime::block_on(
            import_entry_custom_icon_with_picker(entry_id.clone(), managed.clone(), {
                let icon = icon.clone();
                move || Some(FilePath::Path(icon))
            }),
        ) else {
            panic!("valid custom icon should return a snapshot");
        };
        assert!(imported.dirty);
        let detail = managed
            .service
            .lock()
            .expect("vault service")
            .entry_detail(&entry_id)
            .expect("entry detail");
        assert!(matches!(detail.icon, EntryIconDto::Custom));

        let invalid = directory.join("invalid.png");
        fs::write(&invalid, [1_u8, 2, 3]).expect("invalid png fixture");
        let invalid_result = tauri::async_runtime::block_on(import_entry_custom_icon_with_picker(
            entry_id.clone(),
            managed.clone(),
            move || Some(FilePath::Path(invalid)),
        ));
        let Err(error) = invalid_result else {
            panic!("invalid PNG must be rejected");
        };
        assert_eq!(
            to_value(error).expect("invalid icon error serializes"),
            json!({ "code": "invalid_request" })
        );

        let gate = managed
            .begin_vault_operation()
            .expect("test operation should acquire gate");
        let command_busy = tauri::async_runtime::block_on(import_entry_custom_icon(
            app.handle().clone(),
            entry_id,
            managed,
        ));
        drop(gate);
        let Err(command_busy) = command_busy else {
            panic!("busy public custom-icon command should fail before picker use");
        };
        assert_eq!(
            to_value(command_busy).expect("busy command error serializes"),
            json!({ "code": "operation_in_progress" })
        );

        fs::remove_dir_all(directory).expect("test cleanup");
    }
}
