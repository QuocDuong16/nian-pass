#[cfg(unix)]
use std::fs;
use std::{io, path::Path};

#[cfg(windows)]
use std::fs;

#[cfg(windows)]
use super::{FileFingerprint, SessionError};

#[cfg(unix)]
pub(crate) const SAVE_SUPPORTED: bool = true;

#[cfg(windows)]
pub(crate) const SAVE_SUPPORTED: bool = true;

pub(crate) const SYNC_REPLACE_SUPPORTED: bool = true;

/// Atomically replaces an existing destination with a same-filesystem file.
///
/// Unix rename preserves an always-present destination namespace entry. M3
/// deliberately fails closed on Windows until a safe-Rust replacement path can
/// preserve the destination security descriptor and related metadata.
#[cfg(unix)]
pub(crate) fn replace_existing(prepared: &Path, destination: &Path) -> io::Result<()> {
    fs::rename(prepared, destination)
}

#[cfg(windows)]
pub(crate) fn replace_existing(_prepared: &Path, _destination: &Path) -> io::Result<()> {
    Err(io::Error::new(
        io::ErrorKind::Unsupported,
        "safe Windows replacement is unavailable",
    ))
}

/// Installs a first backup or atomically replaces an existing one.
#[cfg(unix)]
pub(crate) fn install_or_replace(prepared: &Path, destination: &Path) -> io::Result<()> {
    fs::rename(prepared, destination)
}

#[cfg(windows)]
pub(crate) fn install_or_replace(_prepared: &Path, _destination: &Path) -> io::Result<()> {
    Err(io::Error::new(
        io::ErrorKind::Unsupported,
        "safe Windows replacement is unavailable",
    ))
}

#[cfg(unix)]
pub(crate) fn sync_parent(parent: &Path) -> io::Result<()> {
    fs::File::open(parent)?.sync_all()
}

#[cfg(windows)]
pub(crate) fn sync_parent(_parent: &Path) -> io::Result<()> {
    Ok(())
}

/// Windows-only atomic replacement used by sync. `ReplaceFileW` receives a
/// backup path, preserves the destination security state, and is never called
/// with an ignore-ACL/merge flag.
#[cfg(windows)]
pub(crate) fn replace_existing_with_backup(
    prepared: &Path,
    destination: &Path,
    backup: &Path,
) -> io::Result<()> {
    windows_safe_replace::replace_existing_with_backup(prepared, destination, backup)
}

/// Shared Windows replacement transaction for ordinary save and sync. It keeps
/// an existing backup until ReplaceFileW succeeds, then proves the new backup
/// is the exact primary generation that was replaced.
#[cfg(windows)]
pub(crate) fn replace_windows_with_backup(
    prepared: &Path,
    destination: &Path,
    backup: &Path,
    expected_source: &FileFingerprint,
) -> Result<(), SessionError> {
    super::reject_symlink_if_present(backup).map_err(SessionError::BackupFailed)?;
    let prior_backup = if backup.exists() {
        let parent = backup.parent().ok_or(SessionError::UnsupportedPath)?;
        let path = parent.join(super::random_temp_name(".nian-pass-prior-backup-")?);
        fs::rename(backup, &path).map_err(SessionError::BackupFailed)?;
        Some(path)
    } else {
        None
    };

    match replace_existing_with_backup(prepared, destination, backup) {
        Ok(()) => {
            if super::fingerprint_path_for_backup(backup)? != *expected_source {
                return Err(SessionError::SavedButBackupUpdateFailed(io::Error::other(
                    "Windows replacement backup did not preserve the expected source generation",
                )));
            }
            if let Some(path) = prior_backup {
                fs::remove_file(path).map_err(SessionError::SavedButBackupUpdateFailed)?;
            }
            Ok(())
        }
        Err(replace_error) => {
            // ReplaceFileW can move the former primary to backup before a
            // reported failure; restore primary first, then the prior backup.
            if !destination.exists() && backup.exists() {
                fs::rename(backup, destination).map_err(SessionError::AtomicReplaceFailed)?;
            }
            if let Some(path) = prior_backup {
                if backup.exists() {
                    return Err(SessionError::AtomicReplaceFailed(replace_error));
                }
                fs::rename(path, backup).map_err(SessionError::AtomicReplaceFailed)?;
            }
            Err(SessionError::AtomicReplaceFailed(replace_error))
        }
    }
}

#[cfg(not(any(unix, windows)))]
compile_error!("vault-session supports only Unix and Windows targets");
