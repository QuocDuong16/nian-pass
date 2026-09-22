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
            Err(io::Error::other(format!(
                "icacls could not set the test DACL (status {}): {} {}",
                output.status,
                String::from_utf8_lossy(&output.stdout).trim(),
                String::from_utf8_lossy(&output.stderr).trim(),
            )))
        }
    }

    fn dacl_sddl(path: &Path) -> io::Result<String> {
        use std::{ffi::c_void, os::windows::ffi::OsStrExt as _, ptr};
        use windows_sys::Win32::{
            Foundation::LocalFree,
            Security::{
                Authorization::{
                    ConvertSecurityDescriptorToStringSecurityDescriptorW, GetNamedSecurityInfoW,
                    SDDL_REVISION_1, SE_FILE_OBJECT,
                },
                DACL_SECURITY_INFORMATION,
            },
        };

        // Both returned buffers belong to Windows, including on later failures.
        struct LocalAllocation(*mut c_void);

        impl Drop for LocalAllocation {
            fn drop(&mut self) {
                // SAFETY: this pointer was allocated by a Windows security API
                // that explicitly transfers ownership to the caller.
                unsafe { LocalFree(self.0) };
            }
        }

        let path_wide: Vec<u16> = path.as_os_str().encode_wide().chain(Some(0)).collect();
        let mut raw_descriptor = ptr::null_mut();
        // SAFETY: the UTF-16 path is NUL-terminated and the output pointer is
        // valid. Only the DACL is requested, so no SACL privilege is needed.
        let status = unsafe {
            GetNamedSecurityInfoW(
                path_wide.as_ptr(),
                SE_FILE_OBJECT,
                DACL_SECURITY_INFORMATION,
                ptr::null_mut(),
                ptr::null_mut(),
                ptr::null_mut(),
                ptr::null_mut(),
                &mut raw_descriptor,
            )
        };
        let descriptor = LocalAllocation(raw_descriptor);
        if status != 0 {
            return Err(io::Error::from_raw_os_error(status as i32));
        }
        if descriptor.0.is_null() {
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                "missing DACL descriptor",
            ));
        }

        let mut raw_sddl = ptr::null_mut();
        let mut length = 0;
        // SAFETY: the descriptor remains owned and alive until after the
        // conversion, and both output pointers are valid for Windows to fill.
        let converted = unsafe {
            ConvertSecurityDescriptorToStringSecurityDescriptorW(
                descriptor.0,
                SDDL_REVISION_1,
                DACL_SECURITY_INFORMATION,
                &mut raw_sddl,
                &mut length,
            )
        };
        let sddl = LocalAllocation(raw_sddl.cast());
        if converted == 0 {
            return Err(io::Error::last_os_error());
        }
        if sddl.0.is_null() || length == 0 {
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                "empty DACL SDDL",
            ));
        }
        // SAFETY: the API supplies the number of UTF-16 units in its live
        // allocation. LocalAllocation frees it after conversion is complete.
        let units = unsafe { std::slice::from_raw_parts(raw_sddl, length as usize) };
        String::from_utf16(units)
            .map_err(|_| io::Error::new(io::ErrorKind::InvalidData, "invalid DACL SDDL UTF-16"))
    }

    #[test]
    fn dacl_reader_reports_native_error_for_missing_file() -> io::Result<()> {
        let directory = TestDir::create()?;
        let error = dacl_sddl(&directory.0.join("nonexistent.kdbx"))
            .expect_err("reading a missing file DACL must fail closed");
        assert!(
            error.raw_os_error().is_some(),
            "expected native Windows error: {error}"
        );
        Ok(())
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
