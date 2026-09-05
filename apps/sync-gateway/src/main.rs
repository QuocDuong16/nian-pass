use std::{
    env, fs, io,
    io::Write as _,
    net::SocketAddr,
    path::{Path, PathBuf},
    process::ExitCode,
    sync::Arc,
};

use clap::Parser;
use nian_pass_sync_gateway::{GatewayState, Storage, StorageError, TokenVerifier, serve};
use sync_gateway_protocol::MAX_GATEWAY_TOKEN_BYTES;
use thiserror::Error;
use tokio::{net::TcpListener, signal};
use zeroize::Zeroize as _;

#[derive(Parser)]
#[command(name = "nian-pass-sync-gateway")]
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
    let arguments = Arguments::try_parse().map_err(|_| StartupError::InvalidArguments)?;
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
    let metadata = fs::symlink_metadata(path).map_err(|_| StartupError::TokenFileUnreadable)?;
    if metadata.file_type().is_symlink() || !metadata.file_type().is_file() {
        return Err(StartupError::TokenFileUnreadable);
    }
    if metadata.len() > (MAX_GATEWAY_TOKEN_BYTES + 2) as u64 {
        return Err(StartupError::TokenInvalid);
    }
    let token = fs::read_to_string(path).map_err(|_| StartupError::TokenFileUnreadable)?;
    Ok(token
        .strip_suffix("\r\n")
        .or_else(|| token.strip_suffix('\n'))
        .unwrap_or(&token)
        .to_owned())
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
