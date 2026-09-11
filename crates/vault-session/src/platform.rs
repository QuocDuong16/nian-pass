use std::{fs, io, path::Path};

#[cfg(any(windows, test))]
use super::{FileFingerprint, SessionError};

#[cfg(any(windows, test))]
pub(crate) const PRIOR_BACKUP_TEMP_PREFIX: &str = ".nian-pass-prior-backup-";

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
    replace_windows_with_backup_transaction(
        prepared,
        destination,
        backup,
        expected_source,
        replace_existing_with_backup,
    )
}

#[cfg(any(windows, test))]
fn replace_windows_with_backup_transaction(
    prepared: &Path,
    destination: &Path,
    backup: &Path,
    expected_source: &FileFingerprint,
    replace: impl FnOnce(&Path, &Path, &Path) -> io::Result<()>,
) -> Result<(), SessionError> {
    super::reject_symlink_if_present(backup).map_err(SessionError::BackupFailed)?;
    let prior_backup = if backup.exists() {
        let parent = backup.parent().ok_or(SessionError::UnsupportedPath)?;
        let path = parent.join(super::random_temp_name(PRIOR_BACKUP_TEMP_PREFIX)?);
        fs::rename(backup, &path).map_err(SessionError::BackupFailed)?;
        Some(path)
    } else {
        None
    };

    match replace(prepared, destination, backup) {
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

#[cfg(test)]
mod tests {
    use std::{
        fs, io,
        path::{Path, PathBuf},
        time::{SystemTime, UNIX_EPOCH},
    };

    use super::{
        super::{FileFingerprint, SessionError},
        replace_windows_with_backup_transaction,
    };

    fn temp_dir() -> PathBuf {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("clock")
            .as_nanos();
        let path = std::env::temp_dir().join(format!("nian-pass-windows-replace-{nonce}"));
        fs::create_dir(&path).expect("create temp directory");
        path
    }

    fn fingerprint(path: &Path) -> FileFingerprint {
        super::super::fingerprint_path(path).expect("fingerprint")
    }

    fn assert_no_prior_backup(directory: &Path) {
        assert!(
            fs::read_dir(directory)
                .expect("read directory")
                .all(|entry| {
                    !entry
                        .expect("entry")
                        .file_name()
                        .to_string_lossy()
                        .starts_with(super::PRIOR_BACKUP_TEMP_PREFIX)
                })
        );
    }

    #[test]
    fn existing_backup_success_rotates_only_after_replacement() {
        let directory = temp_dir();
        let primary = directory.join("vault.kdbx");
        let backup = directory.join("vault.kdbx.bak");
        let prepared = directory.join("prepared.kdbx");
        fs::write(&primary, b"A").expect("primary");
        fs::write(&backup, b"Z").expect("backup");
        fs::write(&prepared, b"B").expect("prepared");
        let expected = fingerprint(&primary);
        replace_windows_with_backup_transaction(
            &prepared,
            &primary,
            &backup,
            &expected,
            |prepared, destination, backup| {
                fs::rename(destination, backup)?;
                fs::rename(prepared, destination)
            },
        )
        .expect("replacement succeeds");
        assert_eq!(fs::read(&primary).expect("primary"), b"B");
        assert_eq!(fs::read(&backup).expect("backup"), b"A");
        assert_no_prior_backup(&directory);
        fs::remove_dir_all(directory).expect("cleanup");
    }

    #[test]
    fn replacement_failure_restores_existing_backup_before_primary_changes() {
        let directory = temp_dir();
        let primary = directory.join("vault.kdbx");
        let backup = directory.join("vault.kdbx.bak");
        let prepared = directory.join("prepared.kdbx");
        fs::write(&primary, b"A").expect("primary");
        fs::write(&backup, b"Z").expect("backup");
        fs::write(&prepared, b"B").expect("prepared");
        let expected = fingerprint(&primary);
        assert!(matches!(
            replace_windows_with_backup_transaction(
                &prepared,
                &primary,
                &backup,
                &expected,
                |_, _, _| Err(io::Error::other("injected"))
            ),
            Err(SessionError::AtomicReplaceFailed(_))
        ));
        assert_eq!(fs::read(&primary).expect("primary"), b"A");
        assert_eq!(fs::read(&backup).expect("backup"), b"Z");
        assert_no_prior_backup(&directory);
        fs::remove_dir_all(directory).expect("cleanup");
    }

    #[test]
    fn partial_replacement_failure_restores_primary_and_existing_backup() {
        let directory = temp_dir();
        let primary = directory.join("vault.kdbx");
        let backup = directory.join("vault.kdbx.bak");
        let prepared = directory.join("prepared.kdbx");
        fs::write(&primary, b"A").expect("primary");
        fs::write(&backup, b"Z").expect("backup");
        fs::write(&prepared, b"B").expect("prepared");
        let expected = fingerprint(&primary);
        assert!(matches!(
            replace_windows_with_backup_transaction(
                &prepared,
                &primary,
                &backup,
                &expected,
                |_, destination, backup| {
                    fs::rename(destination, backup)?;
                    Err(io::Error::other("partial"))
                }
            ),
            Err(SessionError::AtomicReplaceFailed(_))
        ));
        assert_eq!(fs::read(&primary).expect("primary"), b"A");
        assert_eq!(fs::read(&backup).expect("backup"), b"Z");
        assert_no_prior_backup(&directory);
        fs::remove_dir_all(directory).expect("cleanup");
    }
}

#[cfg(not(any(unix, windows)))]
compile_error!("vault-session supports only Unix and Windows targets");
