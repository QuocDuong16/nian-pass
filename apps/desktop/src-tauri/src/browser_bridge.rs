use std::{
    collections::HashMap,
    io,
    sync::{
        Arc, Mutex,
        atomic::{AtomicBool, Ordering},
        mpsc::{self, SyncSender},
    },
    thread::{self, JoinHandle},
    time::Duration,
};

use browser_native_protocol::bind_desktop_listener;
use browser_native_protocol::{
    BrowserRequest, BrowserResponse, Candidate, CandidateText, DesktopListener, DesktopStream,
    ErrorCode, MAX_CANDIDATE_SUMMARY_BYTES, MAX_CANDIDATES, MAX_CREDENTIAL_FIELD_BYTES,
    PROTOCOL_VERSION, VaultState, read_request, write_message,
};
use credential_provider_core::CredentialTarget;
use interprocess::local_socket::{ListenerNonblockingMode, traits::Listener as _};
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, Runtime};
use zeroize::Zeroizing;

use crate::state::{AppState, DesktopError};

const APPROVAL_TIMEOUT: Duration = Duration::from_secs(60);
const LISTENER_POLL: Duration = Duration::from_millis(25);

#[derive(Clone, Serialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct BrowserApprovalEvent<'a> {
    request_id: &'a str,
}

trait ApprovalNotifier: Send + Sync {
    fn notify(&self, request_id: &str) -> bool;
}

struct TauriApprovalNotifier<R: Runtime> {
    app: AppHandle<R>,
}

impl<R: Runtime> ApprovalNotifier for TauriApprovalNotifier<R> {
    fn notify(&self, request_id: &str) -> bool {
        let Some(window) = self.app.get_webview_window("main") else {
            return false;
        };
        if !window.is_visible().unwrap_or(false) {
            return false;
        }
        if window.is_minimized().unwrap_or(true) && window.unminimize().is_err() {
            return false;
        }
        let emitted = window
            .emit(
                "browser-connection-request",
                BrowserApprovalEvent { request_id },
            )
            .is_ok();
        emitted && window.set_focus().is_ok()
    }
}

struct ApprovalBroker {
    pending: Mutex<HashMap<String, SyncSender<bool>>>,
    notifier: Arc<dyn ApprovalNotifier>,
    timeout: Duration,
}

impl ApprovalBroker {
    fn new(notifier: Arc<dyn ApprovalNotifier>, timeout: Duration) -> Self {
        Self {
            pending: Mutex::new(HashMap::new()),
            notifier,
            timeout,
        }
    }

    fn request(&self) -> bool {
        let request_id = match random_token() {
            Ok(value) => value,
            Err(_) => return false,
        };
        let (sender, receiver) = mpsc::sync_channel(1);
        let inserted = self
            .pending
            .lock()
            .map(|mut pending| pending.insert(request_id.clone(), sender).is_none())
            .unwrap_or(false);
        if !inserted || !self.notifier.notify(&request_id) {
            self.remove(&request_id);
            return false;
        }
        let allowed = receiver.recv_timeout(self.timeout).unwrap_or(false);
        self.remove(&request_id);
        allowed
    }

    fn resolve(&self, request_id: &str, allow: bool) -> bool {
        let sender = self
            .pending
            .lock()
            .ok()
            .and_then(|mut pending| pending.remove(request_id));
        sender.is_some_and(|sender| sender.try_send(allow).is_ok())
    }

    fn remove(&self, request_id: &str) {
        if let Ok(mut pending) = self.pending.lock() {
            pending.remove(request_id);
        }
    }
}

struct BrowserBridgeRuntime {
    stop: Arc<AtomicBool>,
    listener_thread: Option<JoinHandle<()>>,
}

impl BrowserBridgeRuntime {
    fn start(app_state: AppState, broker: Arc<ApprovalBroker>) -> io::Result<Self> {
        let listener = bind_desktop_listener()?;
        Self::start_with_listener(listener, app_state, broker)
    }

    fn start_with_listener(
        listener: DesktopListener,
        app_state: AppState,
        broker: Arc<ApprovalBroker>,
    ) -> io::Result<Self> {
        listener.set_nonblocking(ListenerNonblockingMode::Accept)?;
        let stop = Arc::new(AtomicBool::new(false));
        let thread_stop = stop.clone();
        let listener_thread = thread::Builder::new()
            .name("nian-pass-browser-listener".to_owned())
            .spawn(move || {
                while !thread_stop.load(Ordering::Acquire) {
                    match listener.accept() {
                        Ok(stream) => {
                            let connection_state = app_state.clone();
                            let connection_broker = broker.clone();
                            let _connection = thread::Builder::new()
                                .name("nian-pass-browser-connection".to_owned())
                                .spawn(move || {
                                    let _result = handle_connection(
                                        stream,
                                        &connection_state,
                                        &connection_broker,
                                    );
                                });
                        }
                        Err(error) if error.kind() == io::ErrorKind::WouldBlock => {
                            thread::park_timeout(LISTENER_POLL);
                        }
                        Err(_) => break,
                    }
                }
            })?;
        Ok(Self {
            stop,
            listener_thread: Some(listener_thread),
        })
    }
}

impl Drop for BrowserBridgeRuntime {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::Release);
        if let Some(handle) = self.listener_thread.take() {
            let _joined = handle.join();
        }
    }
}

pub struct BrowserBridgeState {
    broker: Arc<ApprovalBroker>,
    _runtime: Option<BrowserBridgeRuntime>,
}

impl BrowserBridgeState {
    pub fn start<R: Runtime>(app: AppHandle<R>, app_state: AppState) -> io::Result<Self> {
        let notifier = Arc::new(TauriApprovalNotifier { app });
        let broker = Arc::new(ApprovalBroker::new(notifier, APPROVAL_TIMEOUT));
        let runtime = BrowserBridgeRuntime::start(app_state, broker.clone())?;
        Ok(Self {
            broker,
            _runtime: Some(runtime),
        })
    }

    #[cfg(test)]
    pub fn without_listener() -> Self {
        struct Unavailable;
        impl ApprovalNotifier for Unavailable {
            fn notify(&self, _request_id: &str) -> bool {
                false
            }
        }
        Self {
            broker: Arc::new(ApprovalBroker::new(Arc::new(Unavailable), APPROVAL_TIMEOUT)),
            _runtime: None,
        }
    }

    #[cfg(test)]
    pub fn with_pending_request(request_id: &str) -> (Self, mpsc::Receiver<bool>) {
        struct Available;
        impl ApprovalNotifier for Available {
            fn notify(&self, _request_id: &str) -> bool {
                true
            }
        }
        let broker = Arc::new(ApprovalBroker::new(Arc::new(Available), APPROVAL_TIMEOUT));
        let (sender, receiver) = mpsc::sync_channel(1);
        broker
            .pending
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .insert(request_id.to_owned(), sender);
        (
            Self {
                broker,
                _runtime: None,
            },
            receiver,
        )
    }

    pub fn resolve(&self, request_id: &str, allow: bool) -> bool {
        self.broker.resolve(request_id, allow)
    }
}

fn handle_connection(
    mut stream: DesktopStream,
    app_state: &AppState,
    broker: &ApprovalBroker,
) -> Result<(), ()> {
    let Some(first) = read_request(&mut stream).map_err(|_| ())? else {
        return Ok(());
    };
    let BrowserRequest::Connect { request_id, .. } = first else {
        let response = BrowserResponse::Error {
            version: PROTOCOL_VERSION,
            request_id: first.request_id().to_owned(),
            code: ErrorCode::ApprovalRequired,
        };
        write_message(&mut stream, &response).map_err(|_| ())?;
        return Err(());
    };
    write_message(
        &mut stream,
        &BrowserResponse::ApprovalPending {
            version: PROTOCOL_VERSION,
            request_id: request_id.clone(),
        },
    )
    .map_err(|_| ())?;
    if !broker.request() {
        write_message(
            &mut stream,
            &BrowserResponse::Error {
                version: PROTOCOL_VERSION,
                request_id,
                code: ErrorCode::Denied,
            },
        )
        .map_err(|_| ())?;
        return Err(());
    }
    let vault_state = app_state
        .service
        .lock()
        .ok()
        .filter(|service| service.browser_vault_is_unlocked())
        .map_or(VaultState::Locked, |_| VaultState::Ready);
    write_message(
        &mut stream,
        &BrowserResponse::Connected {
            version: PROTOCOL_VERSION,
            request_id,
            vault_state,
        },
    )
    .map_err(|_| ())?;

    while let Some(request) = read_request(&mut stream).map_err(|_| ())? {
        let response = handle_authorized_request(request, app_state);
        write_message(&mut stream, &response).map_err(|_| ())?;
    }
    Ok(())
}

fn handle_authorized_request(request: BrowserRequest, app_state: &AppState) -> BrowserResponse {
    match request {
        BrowserRequest::Connect { request_id, .. } => error(request_id, ErrorCode::InvalidRequest),
        BrowserRequest::Candidates {
            request_id, origin, ..
        } => candidate_response(request_id, &origin, app_state),
        BrowserRequest::Credential {
            request_id,
            origin,
            vault_session_id,
            entry_id,
            ..
        } => credential_response(request_id, &origin, &vault_session_id, &entry_id, app_state),
    }
}

fn candidate_response(request_id: String, origin: &str, app_state: &AppState) -> BrowserResponse {
    let target = match CredentialTarget::browser_origin(origin) {
        Ok(value) => value,
        Err(_) => return error(request_id, ErrorCode::UnsupportedTarget),
    };
    let service = match app_state.service.lock() {
        Ok(value) => value,
        Err(_) => return error(request_id, ErrorCode::Internal),
    };
    let (vault_session_id, source) = match service.browser_candidates(&target) {
        Ok(value) => value,
        Err(DesktopError::Locked) => return error(request_id, ErrorCode::Locked),
        Err(_) => return error(request_id, ErrorCode::Internal),
    };
    let truncated = source.len() > MAX_CANDIDATES;
    let candidates = source
        .into_iter()
        .take(MAX_CANDIDATES)
        .map(|candidate| Candidate {
            entry_id: candidate.entry_id().to_owned(),
            title: summary(candidate.title()),
            username: summary(candidate.username()),
        })
        .collect();
    BrowserResponse::Candidates {
        version: PROTOCOL_VERSION,
        request_id,
        vault_session_id: vault_session_id.to_owned(),
        candidates,
        truncated,
    }
}

fn credential_response(
    request_id: String,
    origin: &str,
    vault_session_id: &str,
    entry_id: &str,
    app_state: &AppState,
) -> BrowserResponse {
    let target = match CredentialTarget::browser_origin(origin) {
        Ok(value) => value,
        Err(_) => return error(request_id, ErrorCode::UnsupportedTarget),
    };
    let credential = match app_state.browser_credential(vault_session_id, entry_id, &target) {
        Ok(value) => value,
        Err(DesktopError::Locked) => return error(request_id, ErrorCode::Locked),
        Err(DesktopError::SecretUnavailable | DesktopError::EntryNotFound) => {
            return error(request_id, ErrorCode::NoMatches);
        }
        Err(_) => return error(request_id, ErrorCode::Internal),
    };
    let (username, password) = credential.into_secrets();
    if username.expose_secret().len() > MAX_CREDENTIAL_FIELD_BYTES
        || password.expose_secret().len() > MAX_CREDENTIAL_FIELD_BYTES
    {
        return error(request_id, ErrorCode::Internal);
    }
    BrowserResponse::Credential {
        version: PROTOCOL_VERSION,
        request_id,
        username: Zeroizing::new(username.expose_secret().to_owned()),
        password: Zeroizing::new(password.expose_secret().to_owned()),
    }
}

fn summary(value: &vault_core::SummaryText) -> CandidateText {
    value
        .visible()
        .map_or(CandidateText::Protected, |visible| CandidateText::Visible {
            value: bounded_summary(visible),
        })
}

fn bounded_summary(value: &str) -> String {
    if value.len() <= MAX_CANDIDATE_SUMMARY_BYTES {
        return value.to_owned();
    }
    let mut boundary = MAX_CANDIDATE_SUMMARY_BYTES;
    while !value.is_char_boundary(boundary) {
        boundary -= 1;
    }
    value[..boundary].to_owned()
}

fn error(request_id: String, code: ErrorCode) -> BrowserResponse {
    BrowserResponse::Error {
        version: PROTOCOL_VERSION,
        request_id,
        code,
    }
}

fn random_token() -> Result<String, getrandom::Error> {
    let mut bytes = [0_u8; 16];
    getrandom::fill(&mut bytes)?;
    let mut token = String::with_capacity(32);
    const HEX: &[u8; 16] = b"0123456789abcdef";
    for byte in bytes {
        token.push(char::from(HEX[usize::from(byte >> 4)]));
        token.push(char::from(HEX[usize::from(byte & 0x0f)]));
    }
    Ok(token)
}

#[cfg(test)]
mod tests {
    use std::{
        sync::{Arc, Mutex, mpsc},
        thread,
        time::Duration,
    };

    #[cfg(unix)]
    use std::{
        fs, io,
        path::PathBuf,
        sync::atomic::{AtomicU64, Ordering},
    };

    #[cfg(unix)]
    use std::os::unix::fs::DirBuilderExt;

    #[cfg(unix)]
    use browser_native_protocol::{
        BrowserRequest, BrowserResponse, bind_desktop_listener_in, connect_desktop_in,
        read_response, write_message,
    };
    #[cfg(unix)]
    use interprocess::local_socket::traits::Listener as _;

    #[cfg(unix)]
    use super::handle_connection;
    use super::{ApprovalBroker, ApprovalNotifier, BrowserBridgeState, TauriApprovalNotifier};
    #[cfg(unix)]
    use super::{
        BrowserBridgeRuntime, CandidateText, CredentialTarget, ErrorCode, PROTOCOL_VERSION,
        bounded_summary, candidate_response, credential_response, handle_authorized_request,
        summary,
    };
    #[cfg(unix)]
    use crate::{clipboard::ClipboardPort, mutations::CreateEntryRequestDto, state::AppState};
    #[cfg(unix)]
    use serde_json::json;
    #[cfg(unix)]
    use vault_core::{SecretString, SummaryText};

    #[cfg(unix)]
    static DIRECTORY_SEQUENCE: AtomicU64 = AtomicU64::new(0);

    struct CapturingNotifier {
        requests: mpsc::Sender<String>,
        available: bool,
    }

    impl ApprovalNotifier for CapturingNotifier {
        fn notify(&self, request_id: &str) -> bool {
            self.requests.send(request_id.to_owned()).is_ok() && self.available
        }
    }

    #[cfg(unix)]
    struct TestDir(PathBuf);

    #[cfg(unix)]
    impl TestDir {
        fn create() -> Self {
            for _ in 0..128 {
                let path = std::env::temp_dir().join(format!(
                    "nian-pass-browser-bridge-test-{}-{}",
                    std::process::id(),
                    DIRECTORY_SEQUENCE.fetch_add(1, Ordering::Relaxed)
                ));
                let mut builder = fs::DirBuilder::new();
                builder.mode(0o700);
                match builder.create(&path) {
                    Ok(()) => return Self(path),
                    Err(error) if error.kind() == io::ErrorKind::AlreadyExists => continue,
                    Err(error) => panic!("could not create test directory: {error}"),
                }
            }
            panic!("could not allocate test directory");
        }
    }

    #[cfg(unix)]
    impl Drop for TestDir {
        fn drop(&mut self) {
            let _removed = fs::remove_dir_all(&self.0);
        }
    }

    #[cfg(unix)]
    struct NullClipboard;

    #[cfg(unix)]
    impl ClipboardPort for NullClipboard {
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

    #[cfg(unix)]
    fn unlocked_browser_state() -> (AppState, String, String) {
        let state = AppState::new(Arc::new(NullClipboard));
        let (session_id, entry_id) = {
            let mut service = state
                .service
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner());
            let path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
                .join("../../../fixtures/kdbx/keepassxc-2.7.12-kdbx41.kdbx");
            service
                .select_path(path)
                .unwrap_or_else(|error| panic!("fixture must be selectable: {error:?}"));
            service
                .unlock(SecretString::new("demopass".to_owned()))
                .unwrap_or_else(|error| panic!("fixture must unlock: {error:?}"));
            let root_group_id = service
                .snapshot()
                .unwrap_or_else(|error| panic!("fixture must project: {error:?}"))
                .root_group_id;
            let request: CreateEntryRequestDto = serde_json::from_value(json!({
                "groupId": root_group_id,
                "title": "Browser bridge",
                "username": "bridge-user",
                "url": "https://login.example.test/account",
                "password": "bridge-password",
                "notes": null
            }))
            .unwrap_or_else(|error| panic!("request must deserialize: {error}"));
            let entry_id = service
                .create_entry(request)
                .unwrap_or_else(|error| panic!("entry must be created: {error:?}"))
                .created_entry_id;
            let target = CredentialTarget::browser_origin("https://login.example.test")
                .unwrap_or_else(|_| panic!("test target must parse"));
            let session_id = service
                .browser_candidates(&target)
                .unwrap_or_else(|error| panic!("candidate lookup must succeed: {error:?}"))
                .0
                .to_owned();
            (session_id, entry_id)
        };
        (state, session_id, entry_id)
    }

    #[test]
    fn approval_is_explicit_single_use_and_connection_local() {
        let (sender, receiver) = mpsc::channel();
        let broker = Arc::new(ApprovalBroker::new(
            Arc::new(CapturingNotifier {
                requests: sender,
                available: true,
            }),
            Duration::from_secs(1),
        ));
        let result = Arc::new(Mutex::new(None));
        let worker_broker = broker.clone();
        let worker_result = result.clone();
        let worker = thread::spawn(move || {
            if let Ok(mut result) = worker_result.lock() {
                *result = Some(worker_broker.request());
            }
        });
        let request_id = receiver.recv().unwrap_or_default();
        assert_eq!(request_id.len(), 32);
        assert!(broker.resolve(&request_id, true));
        assert!(!broker.resolve(&request_id, true));
        assert!(worker.join().is_ok());
        assert_eq!(result.lock().ok().and_then(|value| *value), Some(true));
    }

    #[test]
    fn unavailable_ui_and_timeout_deny_by_default() {
        let (sender, _receiver) = mpsc::channel();
        let unavailable = ApprovalBroker::new(
            Arc::new(CapturingNotifier {
                requests: sender,
                available: false,
            }),
            Duration::ZERO,
        );
        assert!(!unavailable.request());

        let (sender, _receiver) = mpsc::channel();
        let timeout = ApprovalBroker::new(
            Arc::new(CapturingNotifier {
                requests: sender,
                available: true,
            }),
            Duration::ZERO,
        );
        assert!(!timeout.request());
    }

    #[test]
    fn tauri_notifier_denies_when_the_security_window_is_unavailable() {
        let app = tauri::test::mock_app();
        let notifier = TauriApprovalNotifier {
            app: app.handle().clone(),
        };
        assert!(!notifier.notify("00112233445566778899aabbccddeeff"));
    }

    #[test]
    fn production_startup_entrypoint_remains_typed_for_the_tauri_runtime() {
        let _start = BrowserBridgeState::start::<tauri::test::MockRuntime>;
    }

    #[test]
    fn explicit_deny_completes_only_the_pending_request_as_denied() {
        let (sender, receiver) = mpsc::channel();
        let broker = Arc::new(ApprovalBroker::new(
            Arc::new(CapturingNotifier {
                requests: sender,
                available: true,
            }),
            Duration::from_secs(1),
        ));
        let worker_broker = broker.clone();
        let worker = thread::spawn(move || worker_broker.request());
        let request_id = receiver.recv().unwrap_or_default();
        assert!(broker.resolve(&request_id, false));
        assert!(matches!(worker.join(), Ok(false)));
    }

    #[cfg(unix)]
    #[test]
    fn authorized_requests_project_candidates_and_release_only_revalidated_secrets() {
        let (state, session_id, entry_id) = unlocked_browser_state();
        let candidates = candidate_response("1".repeat(32), "https://login.example.test", &state);
        assert!(matches!(
            candidates,
            BrowserResponse::Candidates {
                ref vault_session_id,
                ref candidates,
                truncated: false,
                ..
            } if vault_session_id == &session_id
                && candidates.iter().any(|candidate| candidate.entry_id == entry_id)
        ));

        let credential = credential_response(
            "2".repeat(32),
            "https://login.example.test",
            &session_id,
            &entry_id,
            &state,
        );
        assert!(matches!(
            credential,
            BrowserResponse::Credential {
                ref username,
                ref password,
                ..
            } if username.as_str() == "bridge-user" && password.as_str() == "bridge-password"
        ));
        assert!(matches!(
            credential_response(
                "3".repeat(32),
                "https://login.example.test",
                &"f".repeat(32),
                &entry_id,
                &state,
            ),
            BrowserResponse::Error {
                code: ErrorCode::NoMatches,
                ..
            }
        ));

        assert!(matches!(
            handle_authorized_request(
                BrowserRequest::Connect {
                    version: PROTOCOL_VERSION,
                    request_id: "4".repeat(32),
                },
                &state,
            ),
            BrowserResponse::Error {
                code: ErrorCode::InvalidRequest,
                ..
            }
        ));
        assert!(matches!(
            candidate_response("5".repeat(32), "http://example.com", &state),
            BrowserResponse::Error {
                code: ErrorCode::UnsupportedTarget,
                ..
            }
        ));
        assert!(matches!(
            credential_response(
                "6".repeat(32),
                "http://example.com",
                &session_id,
                &entry_id,
                &state,
            ),
            BrowserResponse::Error {
                code: ErrorCode::UnsupportedTarget,
                ..
            }
        ));
    }

    #[cfg(unix)]
    #[test]
    fn locked_requests_and_candidate_summaries_are_bounded_and_secret_free() {
        let state = AppState::new(Arc::new(NullClipboard));
        assert!(matches!(
            candidate_response("7".repeat(32), "https://example.com", &state),
            BrowserResponse::Error {
                code: ErrorCode::Locked,
                ..
            }
        ));
        assert!(matches!(
            credential_response(
                "8".repeat(32),
                "https://example.com",
                &"a".repeat(32),
                "missing",
                &state,
            ),
            BrowserResponse::Error {
                code: ErrorCode::Locked,
                ..
            }
        ));
        assert_eq!(bounded_summary("short"), "short");
        let unicode = "a".repeat(127) + "é";
        assert_eq!(bounded_summary(&unicode).len(), 127);
        assert!(matches!(
            summary(&SummaryText::Protected),
            CandidateText::Protected
        ));
        assert!(matches!(
            summary(&SummaryText::Visible("visible".to_owned())),
            CandidateText::Visible { ref value } if value == "visible"
        ));
    }

    #[cfg(unix)]
    #[test]
    fn local_ipc_rejects_preapproval_requests_and_allow_is_stream_scoped() {
        let runtime = TestDir::create();
        let listener = bind_desktop_listener_in(&runtime.0)
            .unwrap_or_else(|error| panic!("listener must bind: {error}"));
        let (sender, receiver) = mpsc::channel();
        let broker = Arc::new(ApprovalBroker::new(
            Arc::new(CapturingNotifier {
                requests: sender,
                available: true,
            }),
            Duration::from_secs(1),
        ));
        let state = AppState::new(Arc::new(NullClipboard));

        let rejected_state = state.clone();
        let rejected_broker = broker.clone();
        let rejected = thread::spawn(move || {
            let stream = listener
                .accept()
                .unwrap_or_else(|error| panic!("client must connect: {error}"));
            handle_connection(stream, &rejected_state, &rejected_broker)
        });
        let mut client = connect_desktop_in(&runtime.0)
            .unwrap_or_else(|error| panic!("client must connect: {error}"));
        write_message(
            &mut client,
            &BrowserRequest::Candidates {
                version: 1,
                request_id: "a".repeat(32),
                origin: "https://example.com".to_owned(),
            },
        )
        .unwrap_or_else(|_| panic!("request must frame"));
        assert!(matches!(
            read_response(&mut client),
            Ok(Some(BrowserResponse::Error { .. }))
        ));
        drop(client);
        assert!(rejected.join().is_ok());

        let listener = bind_desktop_listener_in(&runtime.0)
            .unwrap_or_else(|error| panic!("second listener must bind: {error}"));
        let allowed_state = state.clone();
        let allowed_broker = broker.clone();
        let allowed = thread::spawn(move || {
            let stream = listener
                .accept()
                .unwrap_or_else(|error| panic!("client must connect: {error}"));
            handle_connection(stream, &allowed_state, &allowed_broker)
        });
        let mut client = connect_desktop_in(&runtime.0)
            .unwrap_or_else(|error| panic!("client must connect: {error}"));
        write_message(
            &mut client,
            &BrowserRequest::Connect {
                version: 1,
                request_id: "b".repeat(32),
            },
        )
        .unwrap_or_else(|_| panic!("connect must frame"));
        assert!(matches!(
            read_response(&mut client),
            Ok(Some(BrowserResponse::ApprovalPending { .. }))
        ));
        let approval_id = receiver.recv().unwrap_or_default();
        assert!(broker.resolve(&approval_id, true));
        assert!(matches!(
            read_response(&mut client),
            Ok(Some(BrowserResponse::Connected { .. }))
        ));
        write_message(
            &mut client,
            &BrowserRequest::Candidates {
                version: 1,
                request_id: "c".repeat(32),
                origin: "https://example.com".to_owned(),
            },
        )
        .unwrap_or_else(|_| panic!("candidate request must frame"));
        assert!(matches!(
            read_response(&mut client),
            Ok(Some(BrowserResponse::Error { .. }))
        ));
        drop(client);
        assert!(allowed.join().is_ok());
    }

    #[cfg(unix)]
    #[test]
    fn empty_and_denied_local_streams_never_gain_authority() {
        let runtime = TestDir::create();
        let state = AppState::new(Arc::new(NullClipboard));
        let (sender, receiver) = mpsc::channel();
        let broker = Arc::new(ApprovalBroker::new(
            Arc::new(CapturingNotifier {
                requests: sender,
                available: true,
            }),
            Duration::from_secs(1),
        ));

        let listener = bind_desktop_listener_in(&runtime.0)
            .unwrap_or_else(|error| panic!("listener must bind: {error}"));
        let empty_state = state.clone();
        let empty_broker = broker.clone();
        let empty = thread::spawn(move || {
            let stream = listener
                .accept()
                .unwrap_or_else(|error| panic!("empty client must connect: {error}"));
            handle_connection(stream, &empty_state, &empty_broker)
        });
        let client = connect_desktop_in(&runtime.0)
            .unwrap_or_else(|error| panic!("empty client must connect: {error}"));
        drop(client);
        assert!(matches!(empty.join(), Ok(Ok(()))));

        let listener = bind_desktop_listener_in(&runtime.0)
            .unwrap_or_else(|error| panic!("second listener must bind: {error}"));
        let denied_state = state.clone();
        let denied_broker = broker.clone();
        let denied = thread::spawn(move || {
            let stream = listener
                .accept()
                .unwrap_or_else(|error| panic!("denied client must connect: {error}"));
            handle_connection(stream, &denied_state, &denied_broker)
        });
        let mut client = connect_desktop_in(&runtime.0)
            .unwrap_or_else(|error| panic!("denied client must connect: {error}"));
        write_message(
            &mut client,
            &BrowserRequest::Connect {
                version: PROTOCOL_VERSION,
                request_id: "9".repeat(32),
            },
        )
        .unwrap_or_else(|_| panic!("connect must frame"));
        assert!(matches!(
            read_response(&mut client),
            Ok(Some(BrowserResponse::ApprovalPending { .. }))
        ));
        let approval_id = receiver.recv().unwrap_or_default();
        assert!(broker.resolve(&approval_id, false));
        assert!(matches!(
            read_response(&mut client),
            Ok(Some(BrowserResponse::Error {
                code: ErrorCode::Denied,
                ..
            }))
        ));
        drop(client);
        assert!(matches!(denied.join(), Ok(Err(()))));
    }

    #[cfg(unix)]
    #[test]
    fn listener_runtime_accepts_streams_and_stops_with_its_owner() {
        let runtime_directory = TestDir::create();
        let listener = bind_desktop_listener_in(&runtime_directory.0)
            .unwrap_or_else(|error| panic!("listener must bind: {error}"));
        let (sender, _receiver) = mpsc::channel();
        let broker = Arc::new(ApprovalBroker::new(
            Arc::new(CapturingNotifier {
                requests: sender,
                available: false,
            }),
            Duration::ZERO,
        ));
        let runtime = BrowserBridgeRuntime::start_with_listener(
            listener,
            AppState::new(Arc::new(NullClipboard)),
            broker,
        )
        .unwrap_or_else(|error| panic!("listener runtime must start: {error}"));
        let mut client = connect_desktop_in(&runtime_directory.0)
            .unwrap_or_else(|error| panic!("runtime client must connect: {error}"));
        write_message(
            &mut client,
            &BrowserRequest::Candidates {
                version: PROTOCOL_VERSION,
                request_id: "c".repeat(32),
                origin: "https://example.com".to_owned(),
            },
        )
        .unwrap_or_else(|_| panic!("preapproval request must frame"));
        assert!(matches!(
            read_response(&mut client),
            Ok(Some(BrowserResponse::Error {
                code: ErrorCode::ApprovalRequired,
                ..
            }))
        ));
        drop(client);
        drop(runtime);
    }
}
