use std::{
    fs::{self, File, OpenOptions},
    io::{Read, Write},
    path::{Path, PathBuf},
};

#[cfg(unix)]
use std::os::unix::fs::{OpenOptionsExt, PermissionsExt};
use vault_core::{EntryId, SecretBytes};

use super::{DesktopError, DesktopVaultService};
use crate::{
    dto::{EntryAttachmentSummaryDto, VaultSnapshotDto},
    state::map_mutation_error,
};

pub const MAX_ATTACHMENT_IMPORT_BYTES: u64 = 64 * 1024 * 1024;

impl DesktopVaultService {
    pub fn entry_attachments(
        &self,
        entry_id: &str,
    ) -> Result<Vec<EntryAttachmentSummaryDto>, DesktopError> {
        let session = self.session.as_ref().ok_or(DesktopError::Locked)?;
        session
            .entry_attachments(&EntryId::new(entry_id))
            .map(|items| items.iter().map(Into::into).collect())
            .map_err(map_mutation_error)
    }

    pub fn import_entry_attachment(
        &mut self,
        entry_id: &str,
        source: PathBuf,
    ) -> Result<VaultSnapshotDto, DesktopError> {
        self.require_writable()?;
        let session_path = self
            .session
            .as_ref()
            .ok_or(DesktopError::Locked)?
            .path()
            .to_owned();
        if paths_refer_to_same_file(&source, &session_path)? {
            return Err(DesktopError::InvalidRequest);
        }
        let name = source
            .file_name()
            .and_then(|value| value.to_str())
            .filter(|value| !value.is_empty())
            .ok_or(DesktopError::InvalidRequest)?
            .to_owned();
        let secret = SecretBytes::new(read_import_file(&source)?);
        let session = self.session.as_mut().ok_or(DesktopError::Locked)?;
        session
            .add_entry_attachment(&EntryId::new(entry_id), &name, &secret)
            .map_err(map_mutation_error)?;
        self.snapshot()
    }

    pub fn export_entry_attachment(
        &self,
        entry_id: &str,
        name: &str,
        target: PathBuf,
    ) -> Result<(), DesktopError> {
        let session = self.session.as_ref().ok_or(DesktopError::Locked)?;
        if paths_refer_to_same_file(&target, session.path())? {
            return Err(DesktopError::InvalidRequest);
        }
        let bytes = session
            .entry_attachment_bytes(&EntryId::new(entry_id), name)
            .map_err(map_mutation_error)?;
        write_export_file(&target, bytes.expose_secret())
    }
}

fn read_import_file(path: &Path) -> Result<Vec<u8>, DesktopError> {
    let metadata = fs::metadata(path).map_err(|_| DesktopError::AttachmentIoFailed)?;
    if !metadata.is_file() {
        return Err(DesktopError::AttachmentIoFailed);
    }
    if metadata.len() > MAX_ATTACHMENT_IMPORT_BYTES {
        return Err(DesktopError::AttachmentTooLarge);
    }

    let file = File::open(path).map_err(|_| DesktopError::AttachmentIoFailed)?;
    let mut bytes = Vec::with_capacity(usize::try_from(metadata.len()).unwrap_or(0));
    file.take(MAX_ATTACHMENT_IMPORT_BYTES + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| DesktopError::AttachmentIoFailed)?;
    if u64::try_from(bytes.len()).unwrap_or(u64::MAX) > MAX_ATTACHMENT_IMPORT_BYTES {
        return Err(DesktopError::AttachmentTooLarge);
    }
    Ok(bytes)
}

fn write_export_file(path: &Path, bytes: &[u8]) -> Result<(), DesktopError> {
    let mut options = OpenOptions::new();
    options.write(true).create(true).truncate(true);
    #[cfg(unix)]
    options.mode(0o600);
    let mut file = options
        .open(path)
        .map_err(|_| DesktopError::AttachmentIoFailed)?;
    #[cfg(unix)]
    {
        let mut permissions = file
            .metadata()
            .map_err(|_| DesktopError::AttachmentIoFailed)?
            .permissions();
        permissions.set_mode(0o600);
        file.set_permissions(permissions)
            .map_err(|_| DesktopError::AttachmentIoFailed)?;
    }
    file.write_all(bytes)
        .and_then(|()| file.sync_all())
        .map_err(|_| DesktopError::AttachmentIoFailed)
}

fn paths_refer_to_same_file(left: &Path, right: &Path) -> Result<bool, DesktopError> {
    let right = fs::canonicalize(right).map_err(|_| DesktopError::AttachmentIoFailed)?;
    if left.exists() {
        return fs::canonicalize(left)
            .map(|value| value == right)
            .map_err(|_| DesktopError::AttachmentIoFailed);
    }
    let parent = left.parent().ok_or(DesktopError::AttachmentIoFailed)?;
    let file_name = left.file_name().ok_or(DesktopError::AttachmentIoFailed)?;
    let parent = fs::canonicalize(parent).map_err(|_| DesktopError::AttachmentIoFailed)?;
    Ok(parent.join(file_name) == right)
}

#[cfg(test)]
mod tests {
    use std::{
        fs::{self, File},
        process,
        time::{SystemTime, UNIX_EPOCH},
    };

    use super::{DesktopError, MAX_ATTACHMENT_IMPORT_BYTES, read_import_file};

    #[test]
    fn oversized_import_is_rejected_before_allocation() {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system clock")
            .as_nanos();
        let path = std::env::temp_dir().join(format!(
            "nian-pass-attachment-limit-{}-{nonce}.bin",
            process::id()
        ));
        let file = File::create(&path).expect("file create");
        file.set_len(MAX_ATTACHMENT_IMPORT_BYTES + 1)
            .expect("sparse size");
        assert!(matches!(
            read_import_file(&path),
            Err(DesktopError::AttachmentTooLarge)
        ));
        fs::remove_file(path).expect("test file cleanup");
    }
}
