use std::{fs::File, io, path::Path};

#[cfg(unix)]
use std::fs;

/// Stable identity of a filesystem object, separate from its encrypted bytes.
#[derive(Clone, Copy, Eq, PartialEq)]
pub(crate) struct FileIdentity {
    #[cfg(unix)]
    device: u64,
    #[cfg(unix)]
    inode: u64,
    #[cfg(windows)]
    native: windows_safe_replace::FileIdentity,
}

impl FileIdentity {
    pub(crate) fn from_file(file: &File) -> io::Result<Self> {
        let metadata = file.metadata()?;
        if !metadata.file_type().is_file() {
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                "identity source is not a regular file",
            ));
        }

        #[cfg(unix)]
        {
            use std::os::unix::fs::MetadataExt as _;
            Ok(Self {
                device: metadata.dev(),
                inode: metadata.ino(),
            })
        }

        #[cfg(windows)]
        {
            Ok(Self {
                native: windows_safe_replace::file_identity(file)?,
            })
        }

        #[cfg(not(any(unix, windows)))]
        {
            Err(io::Error::new(
                io::ErrorKind::Unsupported,
                "stable file identity is unavailable on this platform",
            ))
        }
    }

    pub(crate) fn at_path(path: &Path) -> io::Result<Option<Self>> {
        #[cfg(unix)]
        {
            use std::os::unix::fs::MetadataExt as _;

            let metadata = match fs::symlink_metadata(path) {
                Ok(metadata) => metadata,
                Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(None),
                Err(error) => return Err(error),
            };
            if !metadata.file_type().is_file() {
                return Ok(None);
            }
            Ok(Some(Self {
                device: metadata.dev(),
                inode: metadata.ino(),
            }))
        }

        #[cfg(windows)]
        {
            windows_safe_replace::file_identity_at_path(path)
                .map(|native| native.map(|native| Self { native }))
        }

        #[cfg(not(any(unix, windows)))]
        {
            let _ = path;
            Ok(None)
        }
    }
}

/// Compares an open regular file with the regular file currently named by a
/// path without following a symlink or Windows reparse point.
pub(crate) fn matches_open_file(file: &File, path: &Path) -> io::Result<bool> {
    let Some(named) = FileIdentity::at_path(path)? else {
        return Ok(false);
    };
    Ok(FileIdentity::from_file(file)? == named)
}

#[cfg(all(test, unix))]
mod tests {
    use std::{
        fs::{self, File},
        io,
        os::unix::fs::symlink,
        path::PathBuf,
    };

    use super::{FileIdentity, matches_open_file};

    struct TestDir(PathBuf);

    impl TestDir {
        fn create() -> Self {
            let name = crate::random_temp_name("nian-pass-file-identity-")
                .expect("test randomness should be available");
            let path = std::env::temp_dir().join(name);
            fs::create_dir(&path).expect("identity test directory should be created");
            Self(path)
        }
    }

    impl Drop for TestDir {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    #[test]
    fn same_bytes_do_not_make_a_replacement_the_same_file() -> io::Result<()> {
        let directory = TestDir::create();
        let original = directory.0.join("original");
        let replacement = directory.0.join("replacement");
        fs::write(&original, b"same bytes")?;
        fs::write(&replacement, b"same bytes")?;

        assert!(!matches_open_file(&File::open(&original)?, &replacement)?);
        Ok(())
    }

    #[test]
    fn symlink_substitution_has_no_file_identity() -> io::Result<()> {
        let directory = TestDir::create();
        let original = directory.0.join("original");
        let target = directory.0.join("target");
        let symlink_path = directory.0.join("substituted");
        fs::write(&original, b"owned file")?;
        fs::write(&target, b"external file")?;
        symlink(&target, &symlink_path)?;

        assert!(FileIdentity::at_path(&symlink_path)?.is_none());
        assert!(!matches_open_file(&File::open(&original)?, &symlink_path)?);
        assert_eq!(fs::read(&target)?, b"external file");
        Ok(())
    }
}
