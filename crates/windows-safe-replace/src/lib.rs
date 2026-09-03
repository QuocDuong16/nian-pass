//! Narrow safe wrapper over Windows `ReplaceFileW`.
//!
//! The caller supplies a non-existent backup path. Windows merges the replaced
//! file's DACL, attributes, encryption state, and named streams into the
//! replacement. No ignore-ACL or ignore-merge flag is ever used.

use std::{io, path::Path};

/// Replaces `destination` with `prepared` and moves the exact former
/// destination generation to the non-existent `backup` path.
#[cfg(windows)]
pub fn replace_existing_with_backup(
    prepared: &Path,
    destination: &Path,
    backup: &Path,
) -> io::Result<()> {
    use std::os::windows::ffi::OsStrExt as _;
    use windows_sys::Win32::Storage::FileSystem::ReplaceFileW;

    fn wide(path: &Path) -> Vec<u16> {
        path.as_os_str().encode_wide().chain(Some(0)).collect()
    }

    let destination = wide(destination);
    let prepared = wide(prepared);
    let backup = wide(backup);
    // SAFETY: each pointer references a live, NUL-terminated UTF-16 buffer for
    // the duration of the call. Reserved pointers are null as required. Flags
    // are zero so ACL/attribute merge errors fail closed.
    let replaced = unsafe {
        ReplaceFileW(
            destination.as_ptr(),
            prepared.as_ptr(),
            backup.as_ptr(),
            0,
            std::ptr::null(),
            std::ptr::null(),
        )
    };
    if replaced == 0 {
        Err(io::Error::last_os_error())
    } else {
        Ok(())
    }
}

/// Non-Windows workspace builds never call the Windows boundary.
#[cfg(not(windows))]
pub fn replace_existing_with_backup(
    _prepared: &Path,
    _destination: &Path,
    _backup: &Path,
) -> io::Result<()> {
    Err(io::Error::new(
        io::ErrorKind::Unsupported,
        "ReplaceFileW is available only on Windows",
    ))
}

#[cfg(all(test, not(windows)))]
mod tests {
    use std::{io, path::Path};

    use super::replace_existing_with_backup;

    #[test]
    fn non_windows_boundary_fails_closed() {
        let error = replace_existing_with_backup(
            Path::new("prepared"),
            Path::new("destination"),
            Path::new("backup"),
        )
        .expect_err("ReplaceFileW must never be emulated on non-Windows");
        assert_eq!(error.kind(), io::ErrorKind::Unsupported);
    }
}
