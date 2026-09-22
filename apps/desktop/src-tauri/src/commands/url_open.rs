use std::{
    io,
    process::{Command, Stdio},
};

use tauri::State;
use url::Url;

use crate::{
    dto::SummaryTextDto,
    errors::DesktopErrorDto,
    state::{AppState, DesktopError},
};

#[tauri::command]
pub fn open_entry_url(entry_id: String, state: State<'_, AppState>) -> Result<(), DesktopErrorDto> {
    open_entry_url_with(state.inner(), &entry_id, launch_url).map_err(Into::into)
}

fn open_entry_url_with(
    state: &AppState,
    entry_id: &str,
    launcher: impl FnOnce(&str) -> io::Result<()>,
) -> Result<(), DesktopError> {
    let raw = {
        let service = state.service.lock().map_err(|_| DesktopError::Internal)?;
        let detail = service.entry_detail(entry_id)?;
        match detail.url {
            SummaryTextDto::Visible { value } => value,
            SummaryTextDto::Missing | SummaryTextDto::Protected => {
                return Err(DesktopError::SecretUnavailable);
            }
        }
    };
    let canonical = validate_openable_url(&raw)?;
    launcher(canonical.as_str()).map_err(|_| DesktopError::Internal)
}

fn validate_openable_url(raw: &str) -> Result<Url, DesktopError> {
    let url = Url::parse(raw).map_err(|_| DesktopError::InvalidRequest)?;
    if !matches!(url.scheme(), "http" | "https")
        || url.host_str().is_none()
        || !url.username().is_empty()
        || url.password().is_some()
    {
        return Err(DesktopError::InvalidRequest);
    }
    Ok(url)
}

fn launch_url(url: &str) -> io::Result<()> {
    launch_url_with(platform_opener(), url)
}

fn launch_url_with(program: &str, url: &str) -> io::Result<()> {
    let mut command = Command::new(program);
    #[cfg(target_os = "windows")]
    if program.eq_ignore_ascii_case("rundll32.exe") {
        command.arg("url.dll,FileProtocolHandler");
    }
    command
        .arg(url)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    let mut child = command.spawn()?;
    drop(std::thread::spawn(move || {
        let _ = child.wait();
    }));
    Ok(())
}

#[cfg(target_os = "windows")]
const fn platform_opener() -> &'static str {
    "rundll32.exe"
}

#[cfg(target_os = "macos")]
const fn platform_opener() -> &'static str {
    "open"
}

#[cfg(target_os = "linux")]
const fn platform_opener() -> &'static str {
    "xdg-open"
}

#[cfg(not(any(target_os = "windows", target_os = "macos", target_os = "linux")))]
const fn platform_opener() -> &'static str {
    "false"
}

#[cfg(test)]
mod tests {
    use std::sync::{Arc, Mutex};

    use tauri::{
        Manager,
        test::{mock_builder, mock_context, noop_assets},
    };
    use vault_core::SecretString;

    use super::{open_entry_url, open_entry_url_with, validate_openable_url};
    use crate::{clipboard::ClipboardPort, state::AppState};

    struct NoopClipboard;

    impl ClipboardPort for NoopClipboard {
        fn write_text(&self, _value: &str) -> Result<(), ()> {
            Ok(())
        }
        fn read_text(&self) -> Result<Option<String>, ()> {
            Ok(None)
        }
        fn clear(&self) -> Result<(), ()> {
            Ok(())
        }
    }

    #[test]
    fn url_validation_accepts_only_network_urls_without_embedded_authority_secrets() {
        assert_eq!(
            validate_openable_url("https://example.test/a b?x=1")
                .expect("https URL")
                .as_str(),
            "https://example.test/a%20b?x=1"
        );
        assert!(validate_openable_url("http://localhost:8080/").is_ok());
        for rejected in [
            "file:///tmp/vault.kdbx",
            "javascript:alert(1)",
            "https://user:pass@example.test/",
            "https://",
            "not a URL",
        ] {
            assert!(validate_openable_url(rejected).is_err(), "{rejected}");
        }
    }

    #[test]
    fn entry_url_open_uses_rust_projection_and_passes_only_canonical_visible_url() {
        let state = AppState::new(Arc::new(NoopClipboard));
        let directory =
            std::env::temp_dir().join(format!("nian-pass-open-url-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&directory);
        std::fs::create_dir_all(&directory).expect("temp dir");
        let entry_id = {
            let mut service = state.service.lock().expect("service");
            service
                .create(
                    directory.join("vault.kdbx"),
                    "URL opening",
                    SecretString::new("fixture".to_owned()),
                )
                .expect("create");
            let snapshot = service.snapshot().expect("snapshot");
            let root = snapshot.root_group_id;
            let request = serde_json::from_value::<crate::mutations::CreateEntryRequestDto>(
                serde_json::json!({
                    "groupId": root,
                    "title": "Visible URL",
                    "username": "",
                    "url": "https://example.test/a b",
                    "password": null,
                    "notes": null
                }),
            )
            .expect("request");
            service
                .create_entry(request)
                .expect("entry")
                .created_entry_id
        };
        let seen = Arc::new(Mutex::new(None::<String>));
        let capture = seen.clone();
        open_entry_url_with(&state, &entry_id, move |url| {
            *capture.lock().expect("capture") = Some(url.to_owned());
            Ok(())
        })
        .expect("open URL");
        assert_eq!(
            seen.lock().expect("seen").as_deref(),
            Some("https://example.test/a%20b")
        );
        let _ = std::fs::remove_dir_all(directory);
    }

    #[cfg(unix)]
    #[test]
    fn launcher_uses_direct_argv_without_a_shell() {
        super::launch_url_with("/bin/true", "https://example.test/").expect("direct launch");
    }

    #[test]
    fn invalid_or_missing_entry_url_never_reaches_launcher() {
        let state = AppState::new(Arc::new(NoopClipboard));
        let called = Arc::new(Mutex::new(false));
        let flag = called.clone();
        assert!(
            open_entry_url_with(&state, "missing-entry", move |_| {
                *flag.lock().expect("flag") = true;
                Ok(())
            })
            .is_err()
        );
        assert!(!*called.lock().expect("called"));
    }

    #[test]
    fn command_wrapper_maps_missing_entry_without_launching_the_platform_opener() {
        let app = mock_builder()
            .build(mock_context(noop_assets()))
            .expect("mock app");
        app.manage(AppState::new(Arc::new(NoopClipboard)));
        assert!(open_entry_url("missing-entry".to_owned(), app.state::<AppState>()).is_err());
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn linux_platform_opener_is_the_direct_xdg_open_executable() {
        assert_eq!(super::platform_opener(), "xdg-open");
    }
}
