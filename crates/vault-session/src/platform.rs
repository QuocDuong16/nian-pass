#[cfg(unix)]
use std::fs;
use std::{io, path::Path};

#[cfg(unix)]
pub(crate) const SAVE_SUPPORTED: bool = true;

#[cfg(windows)]
pub(crate) const SAVE_SUPPORTED: bool = false;

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

#[cfg(not(any(unix, windows)))]
compile_error!("vault-session supports only Unix and Windows targets");
