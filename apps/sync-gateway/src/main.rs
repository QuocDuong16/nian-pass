use std::{
    env, fs, io,
    net::SocketAddr,
    path::{Path, PathBuf},
    process::ExitCode,
    sync::Arc,
};

use clap::Parser;
use nian_pass_sync_gateway::{GatewayState, MAX_TOKEN_BYTES, Storage, TokenVerifier, serve};
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
        Err(()) => ExitCode::FAILURE,
    }
}

async fn run() -> Result<(), ()> {
    let arguments = Arguments::try_parse().map_err(|_| ())?;
    let mut token = load_token(arguments.token_file.as_deref()).map_err(|_| ())?;
    let verifier = TokenVerifier::new(&token).map_err(|_| ())?;
    token.zeroize();
    let storage = Storage::open(&arguments.storage_dir).map_err(|_| ())?;
    let listener = TcpListener::bind(arguments.listen).await.map_err(|_| ())?;
    let state = Arc::new(GatewayState::new(verifier, storage));
    serve(listener, state, shutdown_signal())
        .await
        .map_err(|_| ())
}

fn load_token(command_file: Option<&Path>) -> Result<String, io::Error> {
    let environment_token = env::var("NIAN_PASS_GATEWAY_TOKEN").ok();
    let environment_file = env::var_os("NIAN_PASS_GATEWAY_TOKEN_FILE").map(PathBuf::from);
    let file = match (command_file, environment_file.as_deref()) {
        (Some(_), Some(_)) => return Err(io::Error::other("multiple token files configured")),
        (Some(path), None) => Some(path),
        (None, Some(path)) => Some(path),
        (None, None) => None,
    };
    match (environment_token, file) {
        (Some(_), Some(_)) => Err(io::Error::other("multiple token sources configured")),
        (Some(token), None) => Ok(token),
        (None, Some(path)) => read_token_file(path),
        (None, None) => Err(io::Error::other("gateway token is not configured")),
    }
}

fn read_token_file(path: &Path) -> Result<String, io::Error> {
    let metadata = fs::symlink_metadata(path)?;
    if metadata.file_type().is_symlink()
        || !metadata.file_type().is_file()
        || metadata.len() > (MAX_TOKEN_BYTES + 2) as u64
    {
        return Err(io::Error::other("gateway token file is invalid"));
    }
    let token = fs::read_to_string(path)?;
    Ok(token
        .strip_suffix("\r\n")
        .or_else(|| token.strip_suffix('\n'))
        .unwrap_or(&token)
        .to_owned())
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
