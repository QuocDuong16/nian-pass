use std::{fs, io::Read, path::Path};

use tauri::{AppHandle, State};
use tauri_plugin_dialog::{DialogExt, FilePath};
use vault_core::SecretBytes;

use crate::{
    dto::SelectedKeyfileDto,
    errors::DesktopErrorDto,
    state::{AppState, DesktopError},
};

const MAX_KEYFILE_BYTES: usize = 1024 * 1024;

#[tauri::command]
pub async fn select_keyfile<R: tauri::Runtime>(
    app: AppHandle<R>,
    state: State<'_, AppState>,
) -> Result<Option<SelectedKeyfileDto>, DesktopErrorDto> {
    select_keyfile_with_picker(state, move || app.dialog().file().blocking_pick_file()).await
}

async fn select_keyfile_with_picker(
    state: State<'_, AppState>,
    picker: impl FnOnce() -> Option<FilePath> + Send + 'static,
) -> Result<Option<SelectedKeyfileDto>, DesktopErrorDto> {
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
        let (file_name, keyfile) = read_keyfile(&path)?;
        let mut service = service.lock().map_err(|_| DesktopError::Internal)?;
        service.set_pending_keyfile(SecretBytes::new(keyfile))?;
        Ok::<Option<SelectedKeyfileDto>, DesktopError>(Some(SelectedKeyfileDto { file_name }))
    })
    .await
    .map_err(|_| DesktopErrorDto::from(DesktopError::Internal))?
    .map_err(Into::into)
}

#[tauri::command]
pub fn clear_keyfile(state: State<'_, AppState>) -> Result<(), DesktopErrorDto> {
    let _operation = state
        .begin_vault_operation()
        .map_err(DesktopErrorDto::from)?;
    let mut service = state
        .service
        .lock()
        .map_err(|_| DesktopErrorDto::from(DesktopError::Internal))?;
    service.clear_pending_keyfile().map_err(Into::into)
}

#[tauri::command]
pub fn credential_has_keyfile(state: State<'_, AppState>) -> Result<bool, DesktopErrorDto> {
    let service = state
        .service
        .lock()
        .map_err(|_| DesktopErrorDto::from(DesktopError::Internal))?;
    service.credential_has_keyfile().map_err(Into::into)
}

#[tauri::command]
pub fn credential_has_password(state: State<'_, AppState>) -> Result<bool, DesktopErrorDto> {
    let service = state
        .service
        .lock()
        .map_err(|_| DesktopErrorDto::from(DesktopError::Internal))?;
    service.credential_has_password().map_err(Into::into)
}

#[tauri::command]
pub async fn replace_keyfile<R: tauri::Runtime>(
    app: AppHandle<R>,
    state: State<'_, AppState>,
) -> Result<Option<SelectedKeyfileDto>, DesktopErrorDto> {
    replace_keyfile_with_picker(state, move || app.dialog().file().blocking_pick_file()).await
}

async fn replace_keyfile_with_picker(
    state: State<'_, AppState>,
    picker: impl FnOnce() -> Option<FilePath> + Send + 'static,
) -> Result<Option<SelectedKeyfileDto>, DesktopErrorDto> {
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
        let (file_name, keyfile) = read_keyfile(&path)?;
        let mut service = service.lock().map_err(|_| DesktopError::Internal)?;
        service.replace_keyfile(SecretBytes::new(keyfile))?;
        Ok::<Option<SelectedKeyfileDto>, DesktopError>(Some(SelectedKeyfileDto { file_name }))
    })
    .await
    .map_err(|_| DesktopErrorDto::from(DesktopError::Internal))?
    .map_err(Into::into)
}

#[tauri::command]
pub async fn remove_keyfile(state: State<'_, AppState>) -> Result<(), DesktopErrorDto> {
    let operation = state
        .begin_vault_operation()
        .map_err(DesktopErrorDto::from)?;
    let service = state.service.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let _operation = operation;
        let mut service = service.lock().map_err(|_| DesktopError::Internal)?;
        service.remove_keyfile()
    })
    .await
    .map_err(|_| DesktopErrorDto::from(DesktopError::Internal))?
    .map_err(Into::into)
}

fn read_keyfile(path: &Path) -> Result<(String, Vec<u8>), DesktopError> {
    let metadata = fs::symlink_metadata(path).map_err(|_| DesktopError::InvalidRequest)?;
    if metadata.file_type().is_symlink() || !metadata.is_file() {
        return Err(DesktopError::InvalidRequest);
    }

    let file_name = path
        .file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .filter(|name| !name.is_empty())
        .ok_or(DesktopError::InvalidRequest)?;
    let file = fs::File::open(path).map_err(|_| DesktopError::InvalidRequest)?;
    let opened_metadata = file.metadata().map_err(|_| DesktopError::InvalidRequest)?;
    if !opened_metadata.is_file() || opened_metadata.len() == 0 {
        return Err(DesktopError::InvalidRequest);
    }
    if opened_metadata.len() > MAX_KEYFILE_BYTES as u64 {
        return Err(DesktopError::InvalidRequest);
    }

    let mut bytes = Vec::with_capacity(opened_metadata.len() as usize);
    file.take((MAX_KEYFILE_BYTES + 1) as u64)
        .read_to_end(&mut bytes)
        .map_err(|_| DesktopError::InvalidRequest)?;
    if bytes.is_empty() || bytes.len() > MAX_KEYFILE_BYTES {
        return Err(DesktopError::InvalidRequest);
    }
    Ok((file_name, bytes))
}

#[cfg(test)]
mod tests {
    use std::{
        fs, io,
        path::PathBuf,
        sync::atomic::{AtomicU64, Ordering},
        sync::{Arc, Mutex},
    };

    use serde_json::{json, to_value};
    use tauri::{Manager, test::mock_app};
    use tauri_plugin_dialog::FilePath;
    use vault_core::SecretString;

    use super::{
        MAX_KEYFILE_BYTES, read_keyfile, replace_keyfile_with_picker, select_keyfile_with_picker,
    };
    use crate::{clipboard::ClipboardPort, state::AppState};

    static TEST_SEQUENCE: AtomicU64 = AtomicU64::new(0);

    struct FakeClipboard(Mutex<Option<String>>);

    impl ClipboardPort for FakeClipboard {
        fn write_text(&self, value: &str) -> Result<(), ()> {
            *self.0.lock().map_err(|_| ())? = Some(value.to_owned());
            Ok(())
        }

        fn read_text(&self) -> Result<Option<String>, ()> {
            self.0.lock().map_err(|_| ()).map(|value| value.clone())
        }

        fn clear(&self) -> Result<(), ()> {
            *self.0.lock().map_err(|_| ())? = None;
            Ok(())
        }
    }

    struct TestDir(PathBuf);

    impl TestDir {
        fn create() -> Self {
            let parent = std::env::temp_dir();
            for _ in 0..128 {
                let sequence = TEST_SEQUENCE.fetch_add(1, Ordering::Relaxed);
                let path = parent.join(format!(
                    "nian-pass-keyfile-test-{}-{sequence}",
                    std::process::id()
                ));
                match fs::create_dir(&path) {
                    Ok(()) => return Self(path),
                    Err(error) if error.kind() == io::ErrorKind::AlreadyExists => continue,
                    Err(error) => panic!("could not create keyfile test directory: {error}"),
                }
            }
            panic!("could not allocate keyfile test directory");
        }
    }

    impl Drop for TestDir {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    fn test_app() -> tauri::App<tauri::test::MockRuntime> {
        let app = mock_app();
        app.manage(AppState::new(Arc::new(FakeClipboard(Mutex::new(None)))));
        app
    }

    #[test]
    fn keyfile_picker_flow_is_gated_cancelable_and_requires_a_selected_vault() {
        let app = test_app();
        let state = app.state::<AppState>();

        let active = state
            .begin_vault_operation()
            .expect("first operation should acquire gate");
        let busy =
            tauri::async_runtime::block_on(select_keyfile_with_picker(state.clone(), || {
                panic!("busy request must not invoke picker")
            }));
        drop(active);
        let Err(busy) = busy else {
            panic!("busy keyfile selection should fail");
        };
        assert_eq!(
            to_value(busy).expect("stable busy error"),
            json!({ "code": "operation_in_progress" })
        );

        let cancelled =
            tauri::async_runtime::block_on(select_keyfile_with_picker(state.clone(), || None));
        let Ok(cancelled) = cancelled else {
            panic!("picker cancellation should be harmless");
        };
        assert!(cancelled.is_none());

        let directory = TestDir::create();
        let keyfile = directory.0.join("unlock.keyx");
        fs::write(&keyfile, b"public-keyfile-bytes").expect("keyfile write");
        let no_vault =
            tauri::async_runtime::block_on(select_keyfile_with_picker(state.clone(), move || {
                Some(FilePath::Path(keyfile))
            }));
        let Err(no_vault) = no_vault else {
            panic!("keyfile selection without a vault must fail");
        };
        assert_eq!(
            to_value(no_vault).expect("stable no-vault error"),
            json!({ "code": "no_vault_selected" })
        );
    }

    #[test]
    fn keyfile_picker_retains_native_bytes_and_returns_filename_only() {
        let app = test_app();
        let state = app.state::<AppState>();
        let directory = TestDir::create();
        state
            .service
            .lock()
            .expect("service lock")
            .select_path(directory.0.join("vault.kdbx"))
            .expect("vault selection");

        let keyfile = directory.0.join("unlock.keyx");
        fs::write(&keyfile, b"public-keyfile-bytes").expect("keyfile write");
        let receipt =
            tauri::async_runtime::block_on(select_keyfile_with_picker(state.clone(), move || {
                Some(FilePath::Path(keyfile))
            }));
        let Ok(Some(receipt)) = receipt else {
            panic!("keyfile selection should return a receipt");
        };
        assert_eq!(receipt.file_name, "unlock.keyx");
        assert!(super::clear_keyfile(state).is_ok());
    }

    #[cfg(unix)]
    #[test]
    fn unlocked_keyfile_replacement_is_gated_cancelable_and_returns_filename_only() {
        let app = test_app();
        let state = app.state::<AppState>();
        let directory = TestDir::create();
        let vault = directory.0.join("vault.kdbx");
        state
            .service
            .lock()
            .expect("service lock")
            .create(
                vault,
                "Keyfile replacement",
                SecretString::new("public-password".to_owned()),
            )
            .expect("vault create");

        let active = state
            .begin_vault_operation()
            .expect("first operation should acquire gate");
        let busy =
            tauri::async_runtime::block_on(replace_keyfile_with_picker(state.clone(), || {
                panic!("busy request must not invoke picker")
            }));
        drop(active);
        let Err(busy) = busy else {
            panic!("busy keyfile replacement should fail");
        };
        assert_eq!(
            to_value(busy).expect("stable busy error"),
            json!({ "code": "operation_in_progress" })
        );

        let cancelled =
            tauri::async_runtime::block_on(replace_keyfile_with_picker(state.clone(), || None));
        let Ok(cancelled) = cancelled else {
            panic!("picker cancellation should be harmless");
        };
        assert!(cancelled.is_none());

        let keyfile = directory.0.join("replacement.keyx");
        fs::write(&keyfile, b"public-replacement-keyfile").expect("keyfile write");
        let receipt =
            tauri::async_runtime::block_on(replace_keyfile_with_picker(state.clone(), move || {
                Some(FilePath::Path(keyfile))
            }));
        let Ok(Some(receipt)) = receipt else {
            panic!("keyfile replacement should return filename receipt");
        };
        assert_eq!(receipt.file_name, "replacement.keyx");

        let keyfile_status = super::credential_has_keyfile(state.clone());
        let Ok(keyfile_status) = keyfile_status else {
            panic!("keyfile status should be available");
        };
        assert!(keyfile_status);

        let removed = tauri::async_runtime::block_on(super::remove_keyfile(state));
        if removed.is_err() {
            panic!("keyfile removal should succeed");
        }
    }

    #[test]
    fn native_keyfile_read_is_filename_only_bounded_and_nonempty() {
        let directory = TestDir::create();
        let valid = directory.0.join("unlock.keyx");
        fs::write(&valid, b"public-keyfile-bytes").expect("valid keyfile write");
        let (name, bytes) = read_keyfile(&valid).expect("valid keyfile should read");
        assert_eq!(name, "unlock.keyx");
        assert_eq!(bytes, b"public-keyfile-bytes");

        let empty = directory.0.join("empty.keyx");
        fs::write(&empty, []).expect("empty keyfile write");
        assert!(read_keyfile(&empty).is_err());

        let oversized = directory.0.join("oversized.keyx");
        fs::write(&oversized, vec![0x41; MAX_KEYFILE_BYTES + 1]).expect("oversized keyfile write");
        assert!(read_keyfile(&oversized).is_err());
    }

    #[cfg(unix)]
    #[test]
    fn native_keyfile_read_rejects_final_symlinks() {
        use std::os::unix::fs::symlink;

        let directory = TestDir::create();
        let target = directory.0.join("target.keyx");
        let link = directory.0.join("link.keyx");
        fs::write(&target, b"public-keyfile-bytes").expect("target write");
        symlink(&target, &link).expect("symlink create");
        assert!(read_keyfile(&link).is_err());
    }
}
