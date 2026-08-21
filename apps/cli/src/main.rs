// This binary's stdout/stderr is its explicit user-facing command interface,
// not application logging or telemetry. Output remains metadata-only and sanitized.
#![allow(clippy::print_stderr, clippy::print_stdout)]

use std::{borrow::Cow, path::PathBuf, process::ExitCode};

use clap::{Parser, Subcommand};
use vault_core::{Group, SummaryText};
use zeroize::Zeroizing;

const PROTECTED_TITLE_MARKER: &str = "[protected]";

#[derive(Parser)]
#[command(
    name = "nian-pass",
    version,
    about = "Inspect KDBX vault metadata safely"
)]
struct Cli {
    #[command(subcommand)]
    command: Command,
}

#[derive(Subcommand)]
enum Command {
    /// Open a database and show counts without printing vault metadata.
    Info { file: PathBuf },
    /// List group names and entry titles only.
    List { file: PathBuf },
}

fn main() -> ExitCode {
    match run(Cli::parse()) {
        Ok(()) => ExitCode::SUCCESS,
        Err(error) => {
            eprintln!("Error: {error}");
            ExitCode::FAILURE
        }
    }
}

fn run(cli: Cli) -> Result<(), CliError> {
    let password = Zeroizing::new(
        rpassword::prompt_password("Master password: ").map_err(CliError::PasswordPrompt)?,
    );

    match cli.command {
        Command::Info { file } => {
            let opened = kdbx::open(file, password.as_str()).map_err(CliError::Open)?;
            let vault = opened.vault();
            println!("Database opened successfully.");
            println!("KDBX: {}", opened.version());
            println!("Groups: {} (including root)", vault.group_count());
            println!("Entries: {}", vault.entry_count());
        }
        Command::List { file } => {
            let opened = kdbx::open(file, password.as_str()).map_err(CliError::Open)?;
            print_group(opened.vault().root(), 0);
        }
    }

    Ok(())
}

fn print_group(group: &Group, depth: usize) {
    let indent = "  ".repeat(depth);
    let group_name = terminal_safe(group.name(), "(unnamed group)");
    println!("{indent}{group_name}/");

    for entry in group.entries() {
        let title = projected_title(entry.title());
        println!("{indent}  {title}");
    }

    for child in group.groups() {
        print_group(child, depth + 1);
    }
}

fn projected_title(title: &SummaryText) -> Cow<'_, str> {
    match title {
        SummaryText::Missing => Cow::Borrowed("(untitled entry)"),
        SummaryText::Visible(value) => terminal_safe(value, "(untitled entry)"),
        SummaryText::Protected => Cow::Borrowed(PROTECTED_TITLE_MARKER),
    }
}

fn terminal_safe<'a>(value: &'a str, empty_fallback: &'static str) -> Cow<'a, str> {
    if value.is_empty() {
        return Cow::Borrowed(empty_fallback);
    }

    if value.chars().any(char::is_control) {
        return Cow::Owned(
            value
                .chars()
                .map(|character| {
                    if character.is_control() {
                        '\u{fffd}'
                    } else {
                        character
                    }
                })
                .collect(),
        );
    }

    Cow::Borrowed(value)
}

#[derive(Debug, thiserror::Error)]
enum CliError {
    #[error("could not read the master password from the terminal")]
    PasswordPrompt(#[source] std::io::Error),

    #[error(transparent)]
    Open(#[from] kdbx::KdbxError),
}

#[cfg(test)]
mod tests {
    use std::path::Path;

    use super::{Cli, Command, PROTECTED_TITLE_MARKER, projected_title, terminal_safe};
    use clap::Parser;
    use vault_core::SummaryText;

    #[test]
    fn parses_info_without_a_password_argument() {
        let cli = Cli::try_parse_from(["nian-pass", "info", "fixture.kdbx"])
            .expect("info command should parse");

        assert!(matches!(
            cli.command,
            Command::Info { file } if file.as_path() == Path::new("fixture.kdbx")
        ));
    }

    #[test]
    fn rejects_password_argument() {
        let result = Cli::try_parse_from([
            "nian-pass",
            "info",
            "fixture.kdbx",
            "--password",
            "do-not-accept-this",
        ]);

        assert!(result.is_err());
    }

    #[test]
    fn neutralizes_terminal_control_characters() {
        assert_eq!(terminal_safe("safe title", "fallback"), "safe title");
        assert_eq!(
            terminal_safe("line\n\u{1b}[31mred", "fallback"),
            "line\u{fffd}\u{fffd}[31mred"
        );
        assert_eq!(terminal_safe("", "fallback"), "fallback");
    }

    #[test]
    fn list_uses_a_fixed_marker_for_protected_titles() {
        assert_eq!(
            projected_title(&SummaryText::Protected),
            PROTECTED_TITLE_MARKER
        );
        assert_eq!(projected_title(&SummaryText::Missing), "(untitled entry)");
        assert_eq!(
            projected_title(&SummaryText::Visible(String::new())),
            "(untitled entry)"
        );
        assert_eq!(
            projected_title(&SummaryText::Visible("visible title".to_owned())),
            "visible title"
        );
    }
}
