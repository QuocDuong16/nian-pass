#![cfg(unix)]

use std::{
    fs, io,
    os::unix::fs::DirBuilderExt,
    path::PathBuf,
    process::{Command, Stdio},
    sync::atomic::{AtomicU64, Ordering},
    thread,
};

use browser_native_protocol::{
    BrowserRequest, BrowserResponse, Candidate, CandidateText, PROTOCOL_VERSION, VaultState,
    bind_desktop_listener_in, read_request, read_response, write_message,
};
use interprocess::local_socket::traits::Listener as _;
use zeroize::Zeroizing;

static DIRECTORY_SEQUENCE: AtomicU64 = AtomicU64::new(0);

struct TestDir(PathBuf);

impl TestDir {
    fn create() -> Self {
        for _ in 0..128 {
            let path = std::env::temp_dir().join(format!(
                "nian-pass-browser-host-test-{}-{}",
                std::process::id(),
                DIRECTORY_SEQUENCE.fetch_add(1, Ordering::Relaxed)
            ));
            let mut builder = fs::DirBuilder::new();
            builder.mode(0o700);
            match builder.create(&path) {
                Ok(()) => return Self(path),
                Err(error) if error.kind() == io::ErrorKind::AlreadyExists => continue,
                Err(error) => panic!("could not create test runtime directory: {error}"),
            }
        }
        panic!("could not allocate test runtime directory");
    }
}

impl Drop for TestDir {
    fn drop(&mut self) {
        let _removed = fs::remove_dir_all(&self.0);
    }
}

#[test]
fn actual_host_process_proxies_approval_candidates_and_one_credential() {
    let runtime = TestDir::create();
    let listener = bind_desktop_listener_in(&runtime.0)
        .unwrap_or_else(|error| panic!("test listener must bind: {error}"));
    let server = thread::spawn(move || {
        let mut stream = listener
            .accept()
            .unwrap_or_else(|error| panic!("host must connect: {error}"));
        let connect = read_request(&mut stream)
            .unwrap_or_else(|_| panic!("connect frame must parse"))
            .unwrap_or_else(|| panic!("connect frame must exist"));
        let request_id = connect.request_id().to_owned();
        assert!(matches!(connect, BrowserRequest::Connect { .. }));
        write_message(
            &mut stream,
            &BrowserResponse::ApprovalPending {
                version: PROTOCOL_VERSION,
                request_id: request_id.clone(),
            },
        )
        .unwrap_or_else(|_| panic!("pending response must frame"));
        write_message(
            &mut stream,
            &BrowserResponse::Connected {
                version: PROTOCOL_VERSION,
                request_id,
                vault_state: VaultState::Ready,
            },
        )
        .unwrap_or_else(|_| panic!("connected response must frame"));

        let candidates = read_request(&mut stream)
            .unwrap_or_else(|_| panic!("candidate frame must parse"))
            .unwrap_or_else(|| panic!("candidate frame must exist"));
        write_message(
            &mut stream,
            &BrowserResponse::Candidates {
                version: PROTOCOL_VERSION,
                request_id: candidates.request_id().to_owned(),
                vault_session_id: "a".repeat(32),
                candidates: vec![Candidate {
                    entry_id: "synthetic-entry".to_owned(),
                    title: CandidateText::Visible {
                        value: "Synthetic".to_owned(),
                    },
                    username: CandidateText::Protected,
                }],
                truncated: false,
            },
        )
        .unwrap_or_else(|_| panic!("candidate response must frame"));

        let credential = read_request(&mut stream)
            .unwrap_or_else(|_| panic!("credential frame must parse"))
            .unwrap_or_else(|| panic!("credential frame must exist"));
        write_message(
            &mut stream,
            &BrowserResponse::Credential {
                version: PROTOCOL_VERSION,
                request_id: credential.request_id().to_owned(),
                username: Zeroizing::new("synthetic-user".to_owned()),
                password: Zeroizing::new("synthetic-password".to_owned()),
            },
        )
        .unwrap_or_else(|_| panic!("credential response must frame"));
    });

    let mut child = Command::new(env!("CARGO_BIN_EXE_nian-pass-browser-host"))
        .env("XDG_RUNTIME_DIR", &runtime.0)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .unwrap_or_else(|error| panic!("host process must spawn: {error}"));
    let mut stdin = child
        .stdin
        .take()
        .unwrap_or_else(|| panic!("host stdin missing"));
    let mut stdout = child
        .stdout
        .take()
        .unwrap_or_else(|| panic!("host stdout missing"));

    write_message(
        &mut stdin,
        &BrowserRequest::Connect {
            version: 1,
            request_id: "00112233445566778899aabbccddeeff".to_owned(),
        },
    )
    .unwrap_or_else(|_| panic!("browser connect must frame"));
    assert!(matches!(
        read_response(&mut stdout),
        Ok(Some(BrowserResponse::ApprovalPending { .. }))
    ));
    assert!(matches!(
        read_response(&mut stdout),
        Ok(Some(BrowserResponse::Connected { .. }))
    ));

    write_message(
        &mut stdin,
        &BrowserRequest::Candidates {
            version: 1,
            request_id: "102132435465768798a9bacbdcedfe0f".to_owned(),
            origin: "https://example.com".to_owned(),
        },
    )
    .unwrap_or_else(|_| panic!("browser candidates must frame"));
    assert!(matches!(
        read_response(&mut stdout),
        Ok(Some(BrowserResponse::Candidates { .. }))
    ));

    write_message(
        &mut stdin,
        &BrowserRequest::Credential {
            version: 1,
            request_id: "ffeeddccbbaa99887766554433221100".to_owned(),
            origin: "https://example.com".to_owned(),
            vault_session_id: "a".repeat(32),
            entry_id: "synthetic-entry".to_owned(),
        },
    )
    .unwrap_or_else(|_| panic!("browser credential must frame"));
    assert!(matches!(
        read_response(&mut stdout),
        Ok(Some(BrowserResponse::Credential { .. }))
    ));
    drop(stdin);
    assert!(matches!(read_response(&mut stdout), Ok(None)));
    let status = child
        .wait()
        .unwrap_or_else(|error| panic!("host must exit: {error}"));
    assert!(status.success());
    assert!(server.join().is_ok());
}

#[test]
fn linux_per_user_install_doctor_and_uninstall_use_only_the_test_root() {
    let root = TestDir::create();
    let config = root.0.join("config");
    let executable = env!("CARGO_BIN_EXE_nian-pass-browser-host");
    let run = |command: &str| {
        Command::new(executable)
            .arg(command)
            .arg("chromium")
            .env("HOME", &root.0)
            .env("XDG_CONFIG_HOME", &config)
            .output()
            .unwrap_or_else(|error| panic!("maintenance command must run: {error}"))
    };
    assert!(run("install").status.success());
    let manifest = config
        .join("chromium/NativeMessagingHosts")
        .join("io.nianpass.browser.json");
    let installed = fs::read_to_string(&manifest)
        .unwrap_or_else(|error| panic!("installed manifest must exist: {error}"));
    assert!(installed.contains("allowed_origins"));
    assert!(!installed.contains("allowed_extensions"));
    let doctor = run("doctor");
    assert!(doctor.status.success());
    let diagnostic = String::from_utf8(doctor.stdout)
        .unwrap_or_else(|error| panic!("doctor output must be UTF-8: {error}"));
    assert!(diagnostic.contains("Chromium manifest installed: true"));
    assert!(run("uninstall").status.success());
    assert!(!manifest.exists());
    assert!(
        manifest
            .parent()
            .is_some_and(|directory| directory.exists())
    );
}

#[test]
fn direct_host_eof_and_invalid_first_request_fail_without_stdout_corruption() {
    let executable = env!("CARGO_BIN_EXE_nian-pass-browser-host");
    let eof = Command::new(executable)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output()
        .unwrap_or_else(|error| panic!("EOF host must run: {error}"));
    assert!(eof.status.success());
    assert!(eof.stdout.is_empty());

    let mut child = Command::new(executable)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .unwrap_or_else(|error| panic!("invalid host must run: {error}"));
    let mut stdin = child
        .stdin
        .take()
        .unwrap_or_else(|| panic!("host stdin missing"));
    write_message(
        &mut stdin,
        &BrowserRequest::Candidates {
            version: PROTOCOL_VERSION,
            request_id: "a".repeat(32),
            origin: "https://example.com".to_owned(),
        },
    )
    .unwrap_or_else(|_| panic!("invalid first request must frame"));
    drop(stdin);
    let output = child
        .wait_with_output()
        .unwrap_or_else(|error| panic!("invalid host must exit: {error}"));
    assert!(!output.status.success());
    assert!(output.stdout.is_empty());
    assert!(String::from_utf8_lossy(&output.stderr).contains("Nian Pass browser host"));
}

#[test]
fn unavailable_desktop_returns_one_bounded_native_error_frame() {
    let runtime = TestDir::create();
    let mut child = Command::new(env!("CARGO_BIN_EXE_nian-pass-browser-host"))
        .env("XDG_RUNTIME_DIR", &runtime.0)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .unwrap_or_else(|error| panic!("host process must spawn: {error}"));
    let mut stdin = child
        .stdin
        .take()
        .unwrap_or_else(|| panic!("host stdin missing"));
    let mut stdout = child
        .stdout
        .take()
        .unwrap_or_else(|| panic!("host stdout missing"));
    write_message(
        &mut stdin,
        &BrowserRequest::Connect {
            version: PROTOCOL_VERSION,
            request_id: "b".repeat(32),
        },
    )
    .unwrap_or_else(|_| panic!("connect must frame"));
    drop(stdin);
    assert!(matches!(
        read_response(&mut stdout),
        Ok(Some(BrowserResponse::Error {
            code: browser_native_protocol::ErrorCode::DesktopUnavailable,
            ..
        }))
    ));
    assert!(matches!(read_response(&mut stdout), Ok(None)));
    assert!(
        child
            .wait()
            .unwrap_or_else(|error| panic!("host must exit: {error}"))
            .success()
    );
}
