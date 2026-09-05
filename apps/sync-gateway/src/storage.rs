use std::{
    collections::HashMap,
    fs::{self, File, OpenOptions},
    io::{self, Read as _, Write as _},
    path::{Path, PathBuf},
    sync::{Arc, Mutex, Weak},
};

use sha2::{Digest, Sha256};
use sync_provider_core::MAX_REMOTE_CIPHERTEXT_BYTES;
use thiserror::Error;
use tokio::sync::Mutex as AsyncMutex;
use uuid::Uuid;

pub struct StoredObject {
    pub bytes: Vec<u8>,
    pub revision: String,
}

pub struct Storage {
    root: PathBuf,
    temporary: PathBuf,
    locks: Mutex<HashMap<Uuid, Weak<AsyncMutex<()>>>>,
    _process_lock: File,
}

impl Storage {
    pub fn open(root: impl AsRef<Path>) -> Result<Self, StorageError> {
        let root = root.as_ref().to_path_buf();
        create_private_directory(&root)?;
        ensure_directory(&root)?;
        let process_lock = open_private_lock(&root.join(".gateway.lock"))?;
        process_lock.try_lock().map_err(|error| match error {
            fs::TryLockError::WouldBlock => StorageError::AlreadyRunning,
            fs::TryLockError::Error(_) => StorageError::Io,
        })?;
        let temporary = root.join(".tmp");
        create_private_directory(&temporary)?;
        ensure_directory(&temporary)?;
        cleanup_temporary(&temporary)?;
        Ok(Self {
            root,
            temporary,
            locks: Mutex::new(HashMap::new()),
            _process_lock: process_lock,
        })
    }

    pub async fn read(&self, vault_id: Uuid) -> Result<Option<StoredObject>, StorageError> {
        let lock = self.object_lock(vault_id)?;
        let _guard = lock.lock().await;
        let path = self.object_path(vault_id);
        tokio::task::spawn_blocking(move || read_object(&path))
            .await
            .map_err(|_| StorageError::Io)?
    }

    pub async fn create(&self, vault_id: Uuid, bytes: Vec<u8>) -> Result<String, StorageError> {
        self.write(vault_id, WriteCondition::Create, bytes).await
    }

    pub async fn replace(
        &self,
        vault_id: Uuid,
        expected: String,
        bytes: Vec<u8>,
    ) -> Result<String, StorageError> {
        self.write(vault_id, WriteCondition::Replace(expected), bytes)
            .await
    }

    async fn write(
        &self,
        vault_id: Uuid,
        condition: WriteCondition,
        bytes: Vec<u8>,
    ) -> Result<String, StorageError> {
        if bytes.len() > MAX_REMOTE_CIPHERTEXT_BYTES {
            return Err(StorageError::TooLarge);
        }
        let temporary = self.temporary.clone();
        let prepared = tokio::task::spawn_blocking(move || prepare_upload(&temporary, &bytes))
            .await
            .map_err(|_| StorageError::Io)??;
        let lock = self.object_lock(vault_id)?;
        let _guard = lock.lock().await;
        let path = self.object_path(vault_id);
        let root = self.root.clone();
        tokio::task::spawn_blocking(move || install_upload(prepared, &path, &root, condition))
            .await
            .map_err(|_| StorageError::Io)?
    }

    fn object_path(&self, vault_id: Uuid) -> PathBuf {
        self.root.join(format!("{}.kdbx", vault_id.hyphenated()))
    }

    fn object_lock(&self, vault_id: Uuid) -> Result<Arc<AsyncMutex<()>>, StorageError> {
        let mut locks = self.locks.lock().map_err(|_| StorageError::Io)?;
        locks.retain(|_, lock| lock.strong_count() > 0);
        if let Some(lock) = locks.get(&vault_id).and_then(Weak::upgrade) {
            return Ok(lock);
        }
        let lock = Arc::new(AsyncMutex::new(()));
        locks.insert(vault_id, Arc::downgrade(&lock));
        Ok(lock)
    }
}

enum WriteCondition {
    Create,
    Replace(String),
}

struct PreparedUpload {
    path: PathBuf,
    revision: String,
}

impl Drop for PreparedUpload {
    fn drop(&mut self) {
        let _ = fs::remove_file(&self.path);
    }
}

fn prepare_upload(directory: &Path, bytes: &[u8]) -> Result<PreparedUpload, StorageError> {
    let path = directory.join(format!("upload-{}.tmp", Uuid::new_v4().hyphenated()));
    let mut file = private_create_new(&path)?;
    file.write_all(bytes).map_err(|_| StorageError::Io)?;
    file.flush().map_err(|_| StorageError::Io)?;
    file.sync_all().map_err(|_| StorageError::Io)?;
    Ok(PreparedUpload {
        path,
        revision: revision(bytes),
    })
}

fn install_upload(
    prepared: PreparedUpload,
    object: &Path,
    root: &Path,
    condition: WriteCondition,
) -> Result<String, StorageError> {
    let current = read_object(object)?;
    match (condition, current.as_ref()) {
        (WriteCondition::Create, None) => {}
        (WriteCondition::Create, Some(_)) => return Err(StorageError::PreconditionFailed),
        (WriteCondition::Replace(_), None) => return Err(StorageError::PreconditionFailed),
        (WriteCondition::Replace(expected), Some(current)) if expected == current.revision => {}
        (WriteCondition::Replace(_), Some(_)) => return Err(StorageError::PreconditionFailed),
    }
    fs::rename(&prepared.path, object).map_err(|_| StorageError::Io)?;
    sync_directory(root)?;
    Ok(prepared.revision.clone())
}

fn read_object(path: &Path) -> Result<Option<StoredObject>, StorageError> {
    let metadata = match fs::symlink_metadata(path) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(None),
        Err(_) => return Err(StorageError::Io),
    };
    if metadata.file_type().is_symlink() || !metadata.file_type().is_file() {
        return Err(StorageError::UnsafeFile);
    }
    if metadata.len() > MAX_REMOTE_CIPHERTEXT_BYTES as u64 {
        return Err(StorageError::TooLarge);
    }
    let file = File::open(path).map_err(|_| StorageError::Io)?;
    let mut bytes = Vec::with_capacity(metadata.len() as usize);
    file.take((MAX_REMOTE_CIPHERTEXT_BYTES + 1) as u64)
        .read_to_end(&mut bytes)
        .map_err(|_| StorageError::Io)?;
    if bytes.len() > MAX_REMOTE_CIPHERTEXT_BYTES {
        return Err(StorageError::TooLarge);
    }
    Ok(Some(StoredObject {
        revision: revision(&bytes),
        bytes,
    }))
}

fn revision(bytes: &[u8]) -> String {
    let digest = Sha256::digest(bytes);
    let mut output = String::with_capacity(66);
    output.push('"');
    for byte in digest {
        use std::fmt::Write as _;
        write!(&mut output, "{byte:02x}").expect("writing to String cannot fail");
    }
    output.push('"');
    output
}

fn create_private_directory(path: &Path) -> Result<(), StorageError> {
    fs::create_dir_all(path).map_err(|_| StorageError::Io)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt as _;
        fs::set_permissions(path, fs::Permissions::from_mode(0o700))
            .map_err(|_| StorageError::Io)?;
    }
    Ok(())
}

fn ensure_directory(path: &Path) -> Result<(), StorageError> {
    let metadata = fs::symlink_metadata(path).map_err(|_| StorageError::Io)?;
    if metadata.file_type().is_symlink() || !metadata.file_type().is_dir() {
        return Err(StorageError::UnsafeFile);
    }
    Ok(())
}

fn cleanup_temporary(path: &Path) -> Result<(), StorageError> {
    for entry in fs::read_dir(path).map_err(|_| StorageError::Io)? {
        let entry = entry.map_err(|_| StorageError::Io)?;
        let name = entry.file_name();
        let Some(name) = name.to_str() else {
            return Err(StorageError::UnsafeFile);
        };
        let metadata = fs::symlink_metadata(entry.path()).map_err(|_| StorageError::Io)?;
        if !name.starts_with("upload-")
            || !name.ends_with(".tmp")
            || metadata.file_type().is_symlink()
            || !metadata.file_type().is_file()
        {
            return Err(StorageError::UnsafeFile);
        }
        fs::remove_file(entry.path()).map_err(|_| StorageError::Io)?;
    }
    sync_directory(path)
}

fn open_private_lock(path: &Path) -> Result<File, StorageError> {
    if fs::symlink_metadata(path)
        .is_ok_and(|metadata| metadata.file_type().is_symlink() || !metadata.file_type().is_file())
    {
        return Err(StorageError::UnsafeFile);
    }
    let mut options = OpenOptions::new();
    options.read(true).write(true).create(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt as _;
        options.mode(0o600);
    }
    options.open(path).map_err(|_| StorageError::Io)
}

fn private_create_new(path: &Path) -> Result<File, StorageError> {
    let mut options = OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt as _;
        options.mode(0o600);
    }
    options.open(path).map_err(|_| StorageError::Io)
}

fn sync_directory(path: &Path) -> Result<(), StorageError> {
    File::open(path)
        .and_then(|directory| directory.sync_all())
        .map_err(|_| StorageError::Io)
}

#[derive(Debug, Error, Eq, PartialEq)]
pub enum StorageError {
    #[error("gateway storage operation failed")]
    Io,
    #[error("gateway storage contains an unsafe file")]
    UnsafeFile,
    #[error("gateway data directory is already in use")]
    AlreadyRunning,
    #[error("gateway object precondition failed")]
    PreconditionFailed,
    #[error("gateway object exceeds the configured bound")]
    TooLarge,
}

#[cfg(test)]
mod tests {
    use std::{fs, path::PathBuf};

    use super::{Storage, StorageError};
    use uuid::Uuid;

    struct TestDirectory(PathBuf);

    impl TestDirectory {
        fn new() -> Self {
            let path = std::env::temp_dir().join(format!("nian-pass-gateway-{}", Uuid::new_v4()));
            fs::create_dir(&path).expect("test directory");
            Self(path)
        }
    }

    impl Drop for TestDirectory {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    #[tokio::test(flavor = "current_thread")]
    async fn exact_bytes_revision_and_preconditions_stay_together() {
        let directory = TestDirectory::new();
        let storage = Storage::open(&directory.0).expect("storage");
        let id = Uuid::new_v4();
        let first = storage
            .create(id, b"encrypted-a".to_vec())
            .await
            .expect("create");
        let object = storage.read(id).await.expect("read").expect("present");
        assert_eq!(object.bytes, b"encrypted-a");
        assert_eq!(object.revision, first);
        assert_eq!(
            storage.create(id, b"duplicate".to_vec()).await,
            Err(StorageError::PreconditionFailed)
        );
        assert_eq!(
            storage
                .replace(id, "\"stale\"".to_owned(), b"bad".to_vec())
                .await,
            Err(StorageError::PreconditionFailed)
        );
        let second = storage
            .replace(id, first, b"encrypted-b".to_vec())
            .await
            .expect("replace");
        let object = storage.read(id).await.expect("read").expect("present");
        assert_eq!(object.bytes, b"encrypted-b");
        assert_eq!(object.revision, second);
    }

    #[test]
    fn a_second_process_owner_is_rejected() {
        let directory = TestDirectory::new();
        let _first = Storage::open(&directory.0).expect("first storage owner");
        assert!(matches!(
            Storage::open(&directory.0),
            Err(StorageError::AlreadyRunning)
        ));
    }

    #[cfg(unix)]
    #[tokio::test(flavor = "current_thread")]
    async fn permissions_are_private_and_symlink_objects_are_rejected() {
        use std::os::unix::fs::{PermissionsExt as _, symlink};

        let directory = TestDirectory::new();
        let storage = Storage::open(&directory.0).expect("storage");
        assert_eq!(
            fs::metadata(&directory.0)
                .expect("root")
                .permissions()
                .mode()
                & 0o777,
            0o700
        );
        let id = Uuid::new_v4();
        storage
            .create(id, b"encrypted".to_vec())
            .await
            .expect("create");
        let object = directory.0.join(format!("{}.kdbx", id.hyphenated()));
        assert_eq!(
            fs::metadata(&object).expect("object").permissions().mode() & 0o777,
            0o600
        );
        fs::remove_file(&object).expect("remove object");
        symlink("/dev/null", &object).expect("synthetic symlink");
        assert!(matches!(
            storage.read(id).await,
            Err(StorageError::UnsafeFile)
        ));
    }
}
