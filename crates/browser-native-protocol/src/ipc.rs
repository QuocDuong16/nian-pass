use std::{
    io,
    path::{Path, PathBuf},
};

#[cfg(unix)]
use std::{env, fs};

use interprocess::local_socket::{GenericFilePath, ListenerOptions, traits::Stream as _};

pub type DesktopListener = interprocess::local_socket::Listener;
pub type DesktopStream = interprocess::local_socket::Stream;

#[cfg(unix)]
const UNIX_SUBDIRECTORY: &str = "nian-pass";
#[cfg(unix)]
const UNIX_SOCKET_NAME: &str = "browser-v1.sock";
#[cfg(any(windows, test))]
const WINDOWS_PIPE_NAME: &str = r"\\.\pipe\LOCAL\nian-pass-browser-v1";
#[cfg(any(windows, test))]
const WINDOWS_PIPE_SECURITY_DESCRIPTOR: &str = "D:P(A;;GA;;;OW)";

pub fn desktop_endpoint_description() -> io::Result<String> {
    endpoint_path().map(|path| path.to_string_lossy().into_owned())
}

pub fn connect_desktop() -> io::Result<DesktopStream> {
    let endpoint = endpoint_path()?;
    connect_endpoint(&endpoint)
}

pub fn bind_desktop_listener() -> io::Result<DesktopListener> {
    let endpoint = endpoint_path()?;
    #[cfg(unix)]
    prepare_unix_parent(&endpoint)?;
    bind_endpoint(&endpoint)
}

#[cfg(unix)]
pub fn bind_desktop_listener_in(runtime: &Path) -> io::Result<DesktopListener> {
    let endpoint = unix_endpoint_from(runtime)?;
    prepare_unix_parent(&endpoint)?;
    bind_endpoint(&endpoint)
}

#[cfg(unix)]
pub fn connect_desktop_in(runtime: &Path) -> io::Result<DesktopStream> {
    connect_endpoint(&unix_endpoint_from(runtime)?)
}

fn endpoint_path() -> io::Result<PathBuf> {
    #[cfg(unix)]
    {
        let runtime = env::var_os("XDG_RUNTIME_DIR").ok_or_else(|| {
            io::Error::new(io::ErrorKind::NotFound, "XDG_RUNTIME_DIR is unavailable")
        })?;
        unix_endpoint_from(Path::new(&runtime))
    }
    #[cfg(windows)]
    {
        Ok(PathBuf::from(WINDOWS_PIPE_NAME))
    }
    #[cfg(not(any(unix, windows)))]
    {
        Err(io::Error::new(
            io::ErrorKind::Unsupported,
            "unsupported local IPC platform",
        ))
    }
}

#[cfg(unix)]
fn unix_endpoint_from(runtime: &Path) -> io::Result<PathBuf> {
    use std::os::unix::fs::{MetadataExt, PermissionsExt};

    if !runtime.is_absolute() {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "runtime directory must be absolute",
        ));
    }
    let metadata = fs::symlink_metadata(runtime)?;
    if !metadata.file_type().is_dir()
        || metadata.permissions().mode() & 0o077 != 0
        || metadata.uid() != rustix::process::getuid().as_raw()
    {
        return Err(io::Error::new(
            io::ErrorKind::PermissionDenied,
            "runtime directory is not user-private",
        ));
    }
    Ok(runtime.join(UNIX_SUBDIRECTORY).join(UNIX_SOCKET_NAME))
}

#[cfg(unix)]
fn prepare_unix_parent(endpoint: &Path) -> io::Result<()> {
    use std::os::unix::fs::{DirBuilderExt, MetadataExt, PermissionsExt};

    let parent = endpoint
        .parent()
        .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidInput, "endpoint has no parent"))?;
    let mut builder = fs::DirBuilder::new();
    builder.mode(0o700).recursive(false);
    match builder.create(parent) {
        Ok(()) => {}
        Err(error) if error.kind() == io::ErrorKind::AlreadyExists => {}
        Err(error) => return Err(error),
    }
    let metadata = fs::symlink_metadata(parent)?;
    if !metadata.file_type().is_dir()
        || metadata.permissions().mode() & 0o077 != 0
        || metadata.uid() != rustix::process::getuid().as_raw()
    {
        return Err(io::Error::new(
            io::ErrorKind::PermissionDenied,
            "IPC directory is not user-private",
        ));
    }
    Ok(())
}

fn connect_endpoint(endpoint: &Path) -> io::Result<DesktopStream> {
    use interprocess::local_socket::ToFsName;

    let name = endpoint.as_os_str().to_fs_name::<GenericFilePath>()?;
    DesktopStream::connect(name)
}

fn bind_endpoint(endpoint: &Path) -> io::Result<DesktopListener> {
    use interprocess::local_socket::ToFsName;

    let name = endpoint.as_os_str().to_fs_name::<GenericFilePath>()?;
    let options = ListenerOptions::new().name(name);
    #[cfg(unix)]
    let options = {
        use interprocess::os::unix::local_socket::ListenerOptionsExt;
        options.mode(0o600)
    };
    #[cfg(windows)]
    let options = {
        use interprocess::os::windows::{
            local_socket::ListenerOptionsExt, security_descriptor::SecurityDescriptor,
        };
        use widestring::U16CString;

        let descriptor_text = U16CString::from_str(WINDOWS_PIPE_SECURITY_DESCRIPTOR)
            .map_err(|_| io::Error::new(io::ErrorKind::InvalidInput, "invalid pipe policy"))?;
        let descriptor = SecurityDescriptor::deserialize(&descriptor_text)?;
        options.security_descriptor(descriptor)
    };
    match options.create_sync() {
        Ok(listener) => Ok(listener),
        #[cfg(unix)]
        Err(error) if error.kind() == io::ErrorKind::AddrInUse => {
            cleanup_stale_unix_socket(endpoint)?;
            let retry_name = endpoint.as_os_str().to_fs_name::<GenericFilePath>()?;
            use interprocess::os::unix::local_socket::ListenerOptionsExt;
            ListenerOptions::new()
                .name(retry_name)
                .mode(0o600)
                .create_sync()
        }
        Err(error) => Err(error),
    }
}

#[cfg(unix)]
fn cleanup_stale_unix_socket(endpoint: &Path) -> io::Result<()> {
    use std::os::unix::{fs::FileTypeExt, net::UnixStream};

    if UnixStream::connect(endpoint).is_ok() {
        return Err(io::Error::new(
            io::ErrorKind::AddrInUse,
            "desktop IPC listener is active",
        ));
    }
    let metadata = fs::symlink_metadata(endpoint)?;
    if !metadata.file_type().is_socket() {
        return Err(io::Error::new(
            io::ErrorKind::PermissionDenied,
            "stale endpoint is not a socket",
        ));
    }
    fs::remove_file(endpoint)
}

#[cfg(test)]
mod tests {
    #[cfg(unix)]
    use std::{
        fs, io,
        os::unix::fs::{DirBuilderExt, PermissionsExt},
        path::PathBuf,
        sync::atomic::{AtomicU64, Ordering},
    };

    use super::{WINDOWS_PIPE_NAME, WINDOWS_PIPE_SECURITY_DESCRIPTOR};
    #[cfg(unix)]
    use super::{bind_endpoint, prepare_unix_parent, unix_endpoint_from};

    #[cfg(unix)]
    static DIRECTORY_SEQUENCE: AtomicU64 = AtomicU64::new(0);

    #[cfg(unix)]
    struct TestDir(PathBuf);

    #[cfg(unix)]
    impl TestDir {
        fn create(mode: u32) -> Self {
            for _ in 0..128 {
                let path = std::env::temp_dir().join(format!(
                    "nian-pass-browser-ipc-test-{}-{}",
                    std::process::id(),
                    DIRECTORY_SEQUENCE.fetch_add(1, Ordering::Relaxed)
                ));
                let mut builder = fs::DirBuilder::new();
                builder.mode(mode);
                match builder.create(&path) {
                    Ok(()) => return Self(path),
                    Err(error) if error.kind() == io::ErrorKind::AlreadyExists => continue,
                    Err(error) => panic!("could not create test runtime: {error}"),
                }
            }
            panic!("could not allocate test runtime");
        }
    }

    #[cfg(unix)]
    impl Drop for TestDir {
        fn drop(&mut self) {
            let _removed = fs::remove_dir_all(&self.0);
        }
    }

    #[test]
    fn windows_pipe_name_is_local_and_session_scoped() {
        assert_eq!(WINDOWS_PIPE_NAME, r"\\.\pipe\LOCAL\nian-pass-browser-v1");
        assert_eq!(WINDOWS_PIPE_SECURITY_DESCRIPTOR, "D:P(A;;GA;;;OW)");
    }

    #[cfg(unix)]
    #[test]
    fn unix_runtime_and_endpoint_permissions_fail_closed() {
        assert!(matches!(
            unix_endpoint_from(std::path::Path::new("relative")),
            Err(error) if error.kind() == io::ErrorKind::InvalidInput
        ));
        let insecure = TestDir::create(0o755);
        assert!(matches!(
            unix_endpoint_from(&insecure.0),
            Err(error) if error.kind() == io::ErrorKind::PermissionDenied
        ));

        let runtime = TestDir::create(0o700);
        let endpoint = unix_endpoint_from(&runtime.0)
            .unwrap_or_else(|error| panic!("private runtime must be accepted: {error}"));
        let parent = endpoint
            .parent()
            .unwrap_or_else(|| panic!("endpoint must have a parent"));
        fs::create_dir(parent).unwrap_or_else(|error| panic!("parent must be created: {error}"));
        fs::set_permissions(parent, fs::Permissions::from_mode(0o755))
            .unwrap_or_else(|error| panic!("parent mode must change: {error}"));
        assert!(matches!(
            prepare_unix_parent(&endpoint),
            Err(error) if error.kind() == io::ErrorKind::PermissionDenied
        ));
    }

    #[cfg(unix)]
    #[test]
    fn live_and_non_socket_endpoints_are_never_replaced() {
        let runtime = TestDir::create(0o700);
        let endpoint = unix_endpoint_from(&runtime.0)
            .unwrap_or_else(|error| panic!("private runtime must be accepted: {error}"));
        prepare_unix_parent(&endpoint)
            .unwrap_or_else(|error| panic!("private parent must be prepared: {error}"));
        let listener = bind_endpoint(&endpoint)
            .unwrap_or_else(|error| panic!("first listener must bind: {error}"));
        assert!(matches!(
            bind_endpoint(&endpoint),
            Err(error) if error.kind() == io::ErrorKind::AddrInUse
        ));
        drop(listener);
        let _removed = fs::remove_file(&endpoint);
        fs::write(&endpoint, b"not a socket")
            .unwrap_or_else(|error| panic!("sentinel file must be created: {error}"));
        assert!(matches!(
            bind_endpoint(&endpoint),
            Err(error) if error.kind() == io::ErrorKind::PermissionDenied
        ));
        assert_eq!(
            fs::read(&endpoint).unwrap_or_else(|error| panic!("sentinel must remain: {error}")),
            b"not a socket"
        );

        let stale_runtime = TestDir::create(0o700);
        let stale_endpoint = unix_endpoint_from(&stale_runtime.0)
            .unwrap_or_else(|error| panic!("private runtime must be accepted: {error}"));
        prepare_unix_parent(&stale_endpoint)
            .unwrap_or_else(|error| panic!("private parent must be prepared: {error}"));
        let stale = std::os::unix::net::UnixListener::bind(&stale_endpoint)
            .unwrap_or_else(|error| panic!("stale socket must bind: {error}"));
        drop(stale);
        assert!(stale_endpoint.exists());
        let replacement = bind_endpoint(&stale_endpoint)
            .unwrap_or_else(|error| panic!("dead stale socket must be replaced: {error}"));
        drop(replacement);
    }
}
