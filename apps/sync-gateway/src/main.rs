use std::{
    env, fs, io,
    io::{Read as _, Write as _},
    net::SocketAddr,
    path::{Path, PathBuf},
    process::ExitCode,
    sync::Arc,
};

use clap::{Parser, error::ErrorKind};
use nian_pass_sync_gateway::{GatewayState, Storage, StorageError, TokenVerifier, serve};
use sync_gateway_protocol::MAX_GATEWAY_TOKEN_BYTES;
use thiserror::Error;
use tokio::{net::TcpListener, signal};
use zeroize::Zeroize as _;

#[derive(Parser)]
#[command(name = "nian-pass-sync-gateway", version)]
struct Arguments {
    #[arg(long, default_value = "127.0.0.1:8080")]
    listen: SocketAddr,
    #[arg(long, default_value = "/data")]
    storage_dir: PathBuf,
    #[arg(long)]
    token_file: Option<PathBuf>,
}

#[tokio::main(flavor = "current_thread")]
async fn main() -> ExitCode {
    match run().await {
        Ok(()) => ExitCode::SUCCESS,
        Err(error) => {
            let _ = writeln!(io::stderr().lock(), "gateway startup failed: {error}");
            ExitCode::FAILURE
        }
    }
}

async fn run() -> Result<(), StartupError> {
    let arguments = match Arguments::try_parse() {
        Ok(arguments) => arguments,
        Err(error)
            if matches!(
                error.kind(),
                ErrorKind::DisplayHelp | ErrorKind::DisplayVersion
            ) =>
        {
            error.print().map_err(|_| StartupError::InvalidArguments)?;
            return Ok(());
        }
        Err(_) => return Err(StartupError::InvalidArguments),
    };
    let mut token = load_token(arguments.token_file.as_deref())?;
    let verifier = TokenVerifier::new(&token).map_err(|_| StartupError::TokenInvalid)?;
    token.zeroize();
    let storage = Storage::open(&arguments.storage_dir).map_err(|error| match error {
        StorageError::AlreadyRunning => StartupError::StorageAlreadyInUse,
        _ => StartupError::StorageInitialization,
    })?;
    let listener = TcpListener::bind(arguments.listen)
        .await
        .map_err(|_| StartupError::ListenBind)?;
    let state = Arc::new(GatewayState::new(verifier, storage));
    serve(listener, state, shutdown_signal())
        .await
        .map_err(|_| StartupError::Server)
}

fn load_token(command_file: Option<&Path>) -> Result<String, StartupError> {
    let environment_token = env::var("NIAN_PASS_GATEWAY_TOKEN").ok();
    let environment_file = env::var_os("NIAN_PASS_GATEWAY_TOKEN_FILE").map(PathBuf::from);
    let file = match (command_file, environment_file.as_deref()) {
        (Some(_), Some(_)) => return Err(StartupError::TokenSourceAmbiguous),
        (Some(path), None) => Some(path),
        (None, Some(path)) => Some(path),
        (None, None) => None,
    };
    match (environment_token, file) {
        (Some(_), Some(_)) => Err(StartupError::TokenSourceAmbiguous),
        (Some(token), None) => Ok(token),
        (None, Some(path)) => read_token_file(path),
        (None, None) => Err(StartupError::TokenSourceMissing),
    }
}

fn read_token_file(path: &Path) -> Result<String, StartupError> {
    let file = open_token_file(path)?;
    let metadata = file
        .metadata()
        .map_err(|_| StartupError::TokenFileUnreadable)?;
    if !metadata.file_type().is_file() {
        return Err(StartupError::TokenFileUnreadable);
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt as _;
        if metadata.permissions().mode() & 0o077 != 0 {
            return Err(StartupError::TokenFilePermissions);
        }
    }
    if metadata.len() > (MAX_GATEWAY_TOKEN_BYTES + 2) as u64 {
        return Err(StartupError::TokenInvalid);
    }
    let mut token = String::new();
    file.take((MAX_GATEWAY_TOKEN_BYTES + 3) as u64)
        .read_to_string(&mut token)
        .map_err(|_| StartupError::TokenFileUnreadable)?;
    if token.ends_with("\r\n") {
        token.truncate(token.len() - 2);
    } else if token.ends_with('\n') {
        token.truncate(token.len() - 1);
    }
    Ok(token)
}

#[cfg(unix)]
fn open_token_file(path: &Path) -> Result<fs::File, StartupError> {
    use rustix::fs::{CWD, Mode, OFlags, openat};

    openat(
        CWD,
        path,
        OFlags::RDONLY | OFlags::CLOEXEC | OFlags::NOFOLLOW,
        Mode::empty(),
    )
    .map(fs::File::from)
    .map_err(|_| StartupError::TokenFileUnreadable)
}

#[cfg(not(unix))]
fn open_token_file(path: &Path) -> Result<fs::File, StartupError> {
    fs::File::open(path).map_err(|_| StartupError::TokenFileUnreadable)
}

#[derive(Debug, Error, Eq, PartialEq)]
enum StartupError {
    #[error("invalid arguments")]
    InvalidArguments,
    #[error("token source is missing")]
    TokenSourceMissing,
    #[error("token source is ambiguous")]
    TokenSourceAmbiguous,
    #[error("token file could not be read")]
    TokenFileUnreadable,
    #[error("token file permissions are not private")]
    TokenFilePermissions,
    #[error("token format is invalid")]
    TokenInvalid,
    #[error("storage initialization failed")]
    StorageInitialization,
    #[error("storage directory is already in use")]
    StorageAlreadyInUse,
    #[error("listen address could not be bound")]
    ListenBind,
    #[error("server failed")]
    Server,
}

async fn shutdown_signal() {
    #[cfg(unix)]
    {
        let mut terminate = match signal::unix::signal(signal::unix::SignalKind::terminate()) {
            Ok(signal) => signal,
            Err(_) => return,
        };
        tokio::select! {
            result = signal::ctrl_c() => { let _ = result; }
            value = terminate.recv() => { let _ = value; }
        }
    }
    #[cfg(not(unix))]
    {
        let _ = signal::ctrl_c().await;
    }
}

#[cfg(all(test, unix))]
mod tests {
    use std::{
        fs,
        os::unix::fs::{PermissionsExt as _, symlink},
        path::PathBuf,
    };

    use uuid::Uuid;

    use super::{StartupError, read_token_file};

    struct TestDirectory(PathBuf);

    impl TestDirectory {
        fn new() -> Self {
            let path = std::env::temp_dir().join(format!("nian-pass-token-{}", Uuid::new_v4()));
            fs::create_dir(&path).expect("test directory");
            Self(path)
        }
    }

    impl Drop for TestDirectory {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    #[test]
    fn token_file_requires_private_permissions() {
        let directory = TestDirectory::new();
        let path = directory.0.join("token");
        fs::write(&path, "0123456789abcdef0123456789abcdef\n").expect("token fixture");
        fs::set_permissions(&path, fs::Permissions::from_mode(0o644)).expect("permissions");
        assert_eq!(
            read_token_file(&path),
            Err(StartupError::TokenFilePermissions)
        );
        fs::set_permissions(&path, fs::Permissions::from_mode(0o600)).expect("permissions");
        assert_eq!(
            read_token_file(&path).expect("private token"),
            "0123456789abcdef0123456789abcdef"
        );
    }

    #[test]
    fn token_file_symlink_is_rejected_at_open() {
        let directory = TestDirectory::new();
        let target = directory.0.join("target");
        let link = directory.0.join("link");
        fs::write(&target, "0123456789abcdef0123456789abcdef").expect("target");
        fs::set_permissions(&target, fs::Permissions::from_mode(0o600)).expect("permissions");
        symlink(&target, &link).expect("link");
        assert_eq!(
            read_token_file(&link),
            Err(StartupError::TokenFileUnreadable)
        );
    }
}
