use std::{fs, io, path::Path};

/// Atomically replaces `destination` with a same-filesystem prepared file.
///
/// No implementation may remove `destination` first. On Unix this maps to
/// `rename(2)`. On Windows, Rust 1.97 maps replacement rename to
/// `FileRenameInfoEx` where supported and otherwise `MoveFileExW` with replace
/// semantics. Both paths keep the dangerous operation centralized here.
pub(crate) fn atomic_replace(prepared: &Path, destination: &Path) -> io::Result<()> {
    fs::rename(prepared, destination)
}

#[cfg(unix)]
pub(crate) fn sync_parent(parent: &Path) -> io::Result<()> {
    fs::File::open(parent)?.sync_all()
}

#[cfg(windows)]
pub(crate) fn sync_parent(_parent: &Path) -> io::Result<()> {
    // Windows has no stable Rust API equivalent to syncing a directory handle.
    // The replacement primitive still provides atomic namespace replacement;
    // crash durability is reported as best effort on this platform.
    Ok(())
}

#[cfg(not(any(unix, windows)))]
compile_error!("vault-session supports only Unix and Windows targets");
