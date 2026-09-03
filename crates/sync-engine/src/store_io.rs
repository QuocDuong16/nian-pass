use std::{fs, io, io::Write as _, path::Path};

use atomic_write_file::AtomicWriteFile;
use serde::{Serialize, de::DeserializeOwned};

use crate::StoreError;

pub(crate) fn create_private_directory(path: &Path) -> Result<(), StoreError> {
    fs::create_dir_all(path).map_err(StoreError::Io)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt as _;
        fs::set_permissions(path, fs::Permissions::from_mode(0o700)).map_err(StoreError::Io)?;
    }
    Ok(())
}

pub(crate) fn atomic_write_json(path: &Path, value: &impl Serialize) -> Result<(), StoreError> {
    let bytes = serde_json::to_vec(value).map_err(|_| StoreError::InvalidMetadata)?;
    atomic_write(path, &bytes)
}

pub(crate) fn atomic_write(path: &Path, bytes: &[u8]) -> Result<(), StoreError> {
    let options = AtomicWriteFile::options();
    #[cfg(unix)]
    let options = {
        use std::os::unix::fs::OpenOptionsExt as _;
        let mut options = options;
        options.mode(0o600);
        options
    };
    let mut file = options.open(path).map_err(StoreError::Io)?;
    file.write_all(bytes).map_err(StoreError::Io)?;
    file.flush().map_err(StoreError::Io)?;
    file.commit().map_err(StoreError::Io)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt as _;
        fs::set_permissions(path, fs::Permissions::from_mode(0o600)).map_err(StoreError::Io)?;
    }
    Ok(())
}

pub(crate) fn read_optional_json<T: DeserializeOwned>(
    path: &Path,
) -> Result<Option<T>, StoreError> {
    match fs::read(path) {
        Ok(bytes) => serde_json::from_slice(&bytes)
            .map(Some)
            .map_err(|_| StoreError::InvalidMetadata),
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(StoreError::Io(error)),
    }
}

pub(crate) fn read_private_file(path: &Path) -> Result<Vec<u8>, StoreError> {
    let metadata = fs::symlink_metadata(path).map_err(StoreError::Io)?;
    if metadata.file_type().is_symlink() || !metadata.file_type().is_file() {
        return Err(StoreError::InvalidMetadata);
    }
    fs::read(path).map_err(StoreError::Io)
}

pub(crate) fn remove_if_file(path: &Path) -> Result<(), StoreError> {
    match fs::symlink_metadata(path) {
        Ok(metadata) if metadata.file_type().is_file() => {
            fs::remove_file(path).map_err(StoreError::Io)
        }
        Ok(_) => Err(StoreError::InvalidMetadata),
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(StoreError::Io(error)),
    }
}

pub(crate) fn sync_directory(path: &Path) -> Result<(), StoreError> {
    #[cfg(unix)]
    fs::File::open(path)
        .and_then(|directory| directory.sync_all())
        .map_err(StoreError::Io)?;
    #[cfg(windows)]
    let _ = path;
    Ok(())
}
