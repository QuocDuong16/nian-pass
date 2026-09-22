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

#[cfg(all(test, windows))]
mod windows_tests {
    use std::{
        fs, io,
        path::{Path, PathBuf},
        process::Command,
        sync::atomic::{AtomicU64, Ordering},
    };

    use super::replace_existing_with_backup;

    static TEST_SEQUENCE: AtomicU64 = AtomicU64::new(0);

    struct TestDir(PathBuf);

    impl TestDir {
        fn create() -> io::Result<Self> {
            let parent = std::env::temp_dir();
            for _ in 0..128 {
                let sequence = TEST_SEQUENCE.fetch_add(1, Ordering::Relaxed);
                let path = parent.join(format!(
                    "nian-pass-replacefile-test-{}-{sequence}",
                    std::process::id()
                ));
                match fs::create_dir(&path) {
                    Ok(()) => return Ok(Self(path)),
                    Err(error) if error.kind() == io::ErrorKind::AlreadyExists => continue,
                    Err(error) => return Err(error),
                }
            }
            Err(io::Error::new(
                io::ErrorKind::AlreadyExists,
                "could not allocate Windows replacement test directory",
            ))
        }
    }

    impl Drop for TestDir {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    fn set_builtin_users_access(path: &Path, rights: &str) -> io::Result<()> {
        let grant = format!("*S-1-5-32-545:{rights}");
        let output = Command::new("icacls.exe")
            .arg(path)
            .arg("/grant:r")
            .arg(grant)
            .output()?;
        if output.status.success() {
            Ok(())
        } else {
            Err(io::Error::other("icacls could not set the test DACL"))
        }
    }

    fn dacl_sddl(path: &Path) -> io::Result<String> {
        let output = Command::new("powershell.exe")
            .args([
                "-NoProfile",
                "-NonInteractive",
                "-Command",
                "(Get-Acl -LiteralPath $env:NIAN_PASS_ACL_PATH).GetSecurityDescriptorSddlForm([System.Security.AccessControl.AccessControlSections]::Access)",
            ])
            .env("NIAN_PASS_ACL_PATH", path)
            .output()?;
        if !output.status.success() {
            return Err(io::Error::other("PowerShell could not read the test DACL"));
        }
        String::from_utf8(output.stdout)
            .map(|value| value.trim().to_owned())
            .map_err(|_| io::Error::new(io::ErrorKind::InvalidData, "DACL output was not UTF-8"))
    }

    #[test]
    fn replace_file_w_installs_prepared_and_preserves_exact_previous_generation() -> io::Result<()>
    {
        let directory = TestDir::create()?;
        let destination = directory.0.join("vault.kdbx");
        let prepared = directory.0.join("prepared.kdbx");
        let backup = directory.0.join("vault.kdbx.bak");
        fs::write(&destination, b"generation-a")?;
        fs::write(&prepared, b"generation-b")?;

        replace_existing_with_backup(&prepared, &destination, &backup)?;

        assert_eq!(fs::read(&destination)?, b"generation-b");
        assert_eq!(fs::read(&backup)?, b"generation-a");
        assert!(!prepared.exists());
        Ok(())
    }

    #[test]
    fn replace_file_w_preserves_primary_dacl_on_result_and_first_backup() -> io::Result<()> {
        let directory = TestDir::create()?;
        let destination = directory.0.join("vault.kdbx");
        let prepared = directory.0.join("prepared.kdbx");
        let backup = directory.0.join("vault.kdbx.bak");
        fs::write(&destination, b"generation-a")?;
        fs::write(&prepared, b"generation-b")?;

        set_builtin_users_access(&destination, "R")?;
        set_builtin_users_access(&prepared, "F")?;
        let destination_dacl = dacl_sddl(&destination)?;
        let prepared_dacl = dacl_sddl(&prepared)?;
        assert_ne!(
            destination_dacl, prepared_dacl,
            "test setup must prove the two source DACLs differ"
        );

        replace_existing_with_backup(&prepared, &destination, &backup)?;

        assert_eq!(dacl_sddl(&destination)?, destination_dacl);
        assert_eq!(dacl_sddl(&backup)?, destination_dacl);
        Ok(())
    }

    #[test]
    fn replace_file_w_missing_prepared_file_keeps_primary_and_creates_no_backup() -> io::Result<()>
    {
        let directory = TestDir::create()?;
        let destination = directory.0.join("vault.kdbx");
        let prepared = directory.0.join("missing-prepared.kdbx");
        let backup = directory.0.join("vault.kdbx.bak");
        fs::write(&destination, b"generation-a")?;

        assert!(replace_existing_with_backup(&prepared, &destination, &backup).is_err());
        assert_eq!(fs::read(&destination)?, b"generation-a");
        assert!(!backup.exists());
        Ok(())
    }
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
