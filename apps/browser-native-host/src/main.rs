mod installer;
#[cfg(any(windows, test))]
mod installer_transaction;
mod proxy;

use std::{
    env,
    io::{self, Write},
    process::ExitCode,
};

fn main() -> ExitCode {
    let command = env::args_os().nth(1);
    let result = match command.as_deref().and_then(|value| value.to_str()) {
        Some("--version" | "-V") => {
            let _output = writeln!(
                io::stdout().lock(),
                "nian-pass-browser-host {}",
                env!("CARGO_PKG_VERSION")
            );
            return ExitCode::SUCCESS;
        }
        Some("install") => installer::run(installer::Command::Install, env::args_os().skip(2)),
        Some("uninstall") => installer::run(installer::Command::Uninstall, env::args_os().skip(2)),
        Some("doctor") | Some("status") => {
            installer::run(installer::Command::Doctor, env::args_os().skip(2))
        }
        _ => proxy::run(io::stdin().lock(), io::stdout().lock()),
    };
    match result {
        Ok(()) => ExitCode::SUCCESS,
        Err(error) => {
            let _diagnostic = writeln!(io::stderr().lock(), "Nian Pass browser host: {error}");
            ExitCode::FAILURE
        }
    }
}
