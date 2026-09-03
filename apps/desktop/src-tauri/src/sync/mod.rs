mod local;
mod profile;
mod provider;

use std::{
    collections::HashMap,
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
};

use serde::{Deserialize, Serialize};
use sync_engine::{
    ConflictChoice, ConflictOperation, ProfileId, RecoveryStatus, SourceBinding, SyncCompletion,
    SyncEngine, SyncError, SyncOutcome, SyncStore,
};
use sync_provider_core::{ProviderError, RemoteObjectProvider, RemoteRead};
use vault_core::SecretString;

use crate::{
    dto::VaultSnapshotDto,
    state::{AppState, DesktopError},
};

use profile::{ProfileRepository, StoredProfile};
pub use profile::{SaveSyncProfileRequestDto, SyncProfileDto};
use provider::DesktopProvider;
pub use provider::ProviderCredentialsDto;

/// Process-local engine registry plus private profile repository.
pub struct SyncRuntime {
    application_data: PathBuf,
    profiles: ProfileRepository,
    engines: Mutex<HashMap<String, EngineEntry>>,
}

struct EngineEntry {
    source_binding: String,
    engine: Arc<SyncEngine>,
}

impl SyncRuntime {
    pub fn new(application_data: PathBuf) -> Result<Self, DesktopError> {
        Ok(Self {
            profiles: ProfileRepository::open(&application_data)?,
            application_data,
            engines: Mutex::new(HashMap::new()),
        })
    }

    pub fn profiles(&self, state: &AppState) -> Result<Vec<SyncProfileDto>, DesktopError> {
        let current_source = state
            .service
            .lock()
            .map_err(|_| DesktopError::Internal)?
            .sync_source_binding()
            .ok();
        self.profiles
            .list(current_source.as_deref(), &self.application_data)
    }

    pub fn save_profile(
        &self,
        state: &AppState,
        request: SaveSyncProfileRequestDto,
    ) -> Result<SyncProfileDto, DesktopError> {
        let source = state
            .service
            .lock()
            .map_err(|_| DesktopError::Internal)?
            .sync_source_binding()?;
        let profile = self
            .profiles
            .save(request, source, &self.application_data)?;
        self.engines
            .lock()
            .map_err(|_| DesktopError::Internal)?
            .remove(&profile.profile_id);
        Ok(profile)
    }

    pub fn delete_profile(&self, profile_id: &str) -> Result<(), DesktopError> {
        self.profiles.delete(profile_id, &self.application_data)?;
        self.engines
            .lock()
            .map_err(|_| DesktopError::Internal)?
            .remove(profile_id);
        Ok(())
    }

    pub async fn test_provider(
        &self,
        profile_id: &str,
        credentials: ProviderCredentialsDto,
    ) -> Result<TestProviderResultDto, DesktopError> {
        let profile = self.profiles.load(profile_id)?;
        let provider = DesktopProvider::new(&profile.target, credentials)?;
        match provider.read().await.map_err(map_provider_error)? {
            RemoteRead::Missing => Ok(TestProviderResultDto { status: "missing" }),
            RemoteRead::Present(_) => Ok(TestProviderResultDto { status: "present" }),
        }
    }

    pub async fn sync_now(
        &self,
        state: &AppState,
        profile_id: &str,
        credentials: ProviderCredentialsDto,
        master_password: String,
    ) -> Result<SyncResultDto, DesktopError> {
        let profile = self.profiles.load(profile_id)?;
        let local = local::DesktopLocal::new(state.service.clone());
        let captured = state
            .service
            .lock()
            .map_err(|_| DesktopError::Internal)?
            .sync_capture()?;
        if captured.source_binding != profile.source_binding {
            return Err(DesktopError::InvalidRequest);
        }
        let provider = DesktopProvider::new(&profile.target, credentials)?;
        let engine = self.engine(&profile)?;
        let outcome = engine
            .sync(&provider, &local, SecretString::new(master_password))
            .await
            .map_err(map_sync_error)?;
        self.result(state, outcome)
    }

    pub async fn resolve_conflict(
        &self,
        state: &AppState,
        request: ResolveSyncConflictRequestDto,
    ) -> Result<SyncResultDto, DesktopError> {
        let profile = self.profiles.load(&request.profile_id)?;
        let provider = DesktopProvider::new(&profile.target, request.credentials)?;
        let engine = self.engine(&profile)?;
        let local = local::DesktopLocal::new(state.service.clone());
        let outcome = engine
            .resolve(
                &request.conflict_operation_id,
                request.choice.into(),
                &provider,
                &local,
                SecretString::new(request.master_password),
            )
            .await
            .map_err(map_sync_error)?;
        self.result(state, outcome)
    }

    fn engine(&self, profile: &StoredProfile) -> Result<Arc<SyncEngine>, DesktopError> {
        let mut engines = self.engines.lock().map_err(|_| DesktopError::Internal)?;
        if let Some(entry) = engines.get(&profile.profile_id) {
            if entry.source_binding == profile.source_binding {
                return Ok(entry.engine.clone());
            }
            return Err(DesktopError::InvalidRequest);
        }
        let profile_id =
            ProfileId::parse(&profile.profile_id).map_err(|_| DesktopError::InvalidRequest)?;
        let source = SourceBinding::from_sha256(profile.source_binding.clone())
            .map_err(|_| DesktopError::InvalidRequest)?;
        let store = SyncStore::open(&self.application_data, profile_id, source)
            .map_err(|_| DesktopError::SyncRecoveryRequired)?;
        let engine = Arc::new(SyncEngine::new(store));
        engines.insert(
            profile.profile_id.clone(),
            EngineEntry {
                source_binding: profile.source_binding.clone(),
                engine: engine.clone(),
            },
        );
        Ok(engine)
    }

    fn result(
        &self,
        state: &AppState,
        outcome: SyncOutcome,
    ) -> Result<SyncResultDto, DesktopError> {
        let snapshot = state
            .service
            .lock()
            .map_err(|_| DesktopError::Internal)?
            .snapshot()?;
        Ok(match outcome {
            SyncOutcome::Done(completion) => SyncResultDto {
                status: completion_status(completion),
                conflict: None,
                snapshot,
            },
            SyncOutcome::Conflict(conflict) => SyncResultDto {
                status: "waitingForConflictDecision",
                conflict: Some(conflict),
                snapshot,
            },
        })
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncResultDto {
    status: &'static str,
    conflict: Option<ConflictOperation>,
    snapshot: VaultSnapshotDto,
}

#[derive(Serialize)]
pub struct TestProviderResultDto {
    status: &'static str,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ResolveSyncConflictRequestDto {
    profile_id: String,
    conflict_operation_id: String,
    choice: ConflictChoiceDto,
    credentials: ProviderCredentialsDto,
    master_password: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
enum ConflictChoiceDto {
    KeepLocal,
    KeepRemote,
}

impl From<ConflictChoiceDto> for ConflictChoice {
    fn from(value: ConflictChoiceDto) -> Self {
        match value {
            ConflictChoiceDto::KeepLocal => Self::KeepLocal,
            ConflictChoiceDto::KeepRemote => Self::KeepRemote,
        }
    }
}

fn completion_status(completion: SyncCompletion) -> &'static str {
    match completion {
        SyncCompletion::CreatedRemote
        | SyncCompletion::EstablishedBase
        | SyncCompletion::Equivalent
        | SyncCompletion::UploadedLocal
        | SyncCompletion::AppliedRemote
        | SyncCompletion::Merged
        | SyncCompletion::Recovered => "done",
    }
}

fn map_provider_error(error: ProviderError) -> DesktopError {
    match error {
        ProviderError::AuthenticationFailed => DesktopError::SyncCredentialsRequired,
        ProviderError::UnsupportedProvider => DesktopError::SyncUnsupportedProvider,
        ProviderError::UnsafeProvider | ProviderError::InvalidConfiguration => {
            DesktopError::SyncUnsafeProvider
        }
        ProviderError::RemoteChanged => DesktopError::SyncRemoteChanged,
        ProviderError::WriteResultUncertain => DesktopError::SyncRecoveryRequired,
        _ => DesktopError::SyncFailed,
    }
}

fn map_sync_error(error: SyncError) -> DesktopError {
    match error {
        SyncError::RemoteChanged => DesktopError::SyncRemoteChanged,
        SyncError::LocalChanged => DesktopError::SyncLocalChanged,
        SyncError::LocalChangedDuringRecovery => DesktopError::SyncLocalChangedDuringRecovery,
        SyncError::UncertainState => DesktopError::SyncRecoveryRequired,
        SyncError::VaultAuthenticationFailed => DesktopError::SyncCredentialsRequired,
        SyncError::Local(sync_engine::LocalCommitError::Dirty) => DesktopError::UnsavedChanges,
        SyncError::Local(sync_engine::LocalCommitError::Locked) => DesktopError::Locked,
        SyncError::Provider(provider) => map_provider_error(provider),
        _ => DesktopError::SyncFailed,
    }
}

pub fn recovery_status(
    application_data: &Path,
    profile: &StoredProfile,
) -> Result<RecoveryStatus, DesktopError> {
    let id = ProfileId::parse(&profile.profile_id).map_err(|_| DesktopError::InvalidRequest)?;
    let source = SourceBinding::from_sha256(profile.source_binding.clone())
        .map_err(|_| DesktopError::InvalidRequest)?;
    SyncStore::open(application_data, id, source)
        .and_then(|store| store.recovery_status())
        .map_err(|_| DesktopError::SyncRecoveryRequired)
}

#[cfg(test)]
mod tests {
    use std::{
        fs,
        io::Cursor,
        path::{Path, PathBuf},
        sync::{Arc, Mutex},
    };

    use kdbx::KdbxDocument;
    use serde::de::DeserializeOwned;
    use serde_json::{Value, json};
    use sync_engine::{LocalCommitError, SyncError};
    use sync_provider_core::ProviderError;
    use tokio::{
        io::{AsyncReadExt as _, AsyncWriteExt as _},
        net::TcpListener,
        task::JoinHandle,
    };
    use vault_core::{EntryId, SecretString};

    use super::profile::SyncProfileTargetDto;
    use super::{
        ConflictChoiceDto, DesktopProvider, ProviderCredentialsDto, ResolveSyncConflictRequestDto,
        SyncCompletion, SyncRuntime, completion_status, map_provider_error, map_sync_error,
    };
    use crate::{clipboard::ClipboardPort, state::AppState};

    const PASSWORD: &str = "demopass";

    struct TestDirectory(PathBuf);

    impl TestDirectory {
        fn new() -> Self {
            let path = std::env::temp_dir().join(format!(
                "nian-pass-desktop-sync-test-{}",
                uuid::Uuid::new_v4()
            ));
            fs::create_dir(&path).expect("test directory");
            Self(path)
        }
    }

    impl Drop for TestDirectory {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    struct NoClipboard;

    impl ClipboardPort for NoClipboard {
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

    struct RemoteState {
        bytes: Option<Vec<u8>>,
        revision: u64,
    }

    fn decode<T: DeserializeOwned>(value: Value) -> T {
        serde_json::from_value(value).expect("synthetic DTO")
    }

    fn credentials() -> ProviderCredentialsDto {
        decode(json!({
            "webdav": {
                "username": "synthetic-user",
                "password": "SECRET_WEBDAV_PASSWORD"
            }
        }))
    }

    fn fixture() -> Vec<u8> {
        fs::read(
            Path::new(env!("CARGO_MANIFEST_DIR"))
                .join("../../../fixtures/kdbx/keepassxc-2.7.12-kdbx41.kdbx"),
        )
        .expect("fixture")
    }

    fn changed(bytes: &[u8], title: &str) -> Vec<u8> {
        let mut document =
            KdbxDocument::open_reader(&mut Cursor::new(bytes), PASSWORD).expect("open fixture");
        let entry: EntryId = document.projection().expect("projection").root().entries()[0]
            .id()
            .clone();
        document.set_entry_title(&entry, title).expect("mutation");
        let mut output = Vec::new();
        document
            .save_to_writer(&mut output, PASSWORD)
            .expect("save changed fixture");
        output
    }

    fn unlocked_state(directory: &TestDirectory) -> AppState {
        let path = directory.0.join("vault.kdbx");
        fs::write(&path, fixture()).expect("fixture copy");
        let state = AppState::new(Arc::new(NoClipboard));
        {
            let mut service = state.service.lock().expect("service lock");
            service.select_path(path).expect("select");
            service
                .unlock(SecretString::new(PASSWORD.to_owned()))
                .expect("unlock");
        }
        state
    }

    async fn webdav_server() -> (String, Arc<Mutex<RemoteState>>, JoinHandle<()>) {
        let listener = TcpListener::bind("127.0.0.1:0").await.expect("bind");
        let address = listener.local_addr().expect("address");
        let state = Arc::new(Mutex::new(RemoteState {
            bytes: None,
            revision: 1,
        }));
        let server_state = state.clone();
        let task = tokio::spawn(async move {
            loop {
                let Ok((mut stream, _)) = listener.accept().await else {
                    return;
                };
                let mut request = Vec::new();
                let mut buffer = vec![0_u8; 64 * 1024];
                let header_end = loop {
                    let count = stream.read(&mut buffer).await.expect("read request");
                    if count == 0 {
                        return;
                    }
                    request.extend_from_slice(&buffer[..count]);
                    if let Some(index) = request.windows(4).position(|part| part == b"\r\n\r\n") {
                        break index + 4;
                    }
                };
                let headers = String::from_utf8_lossy(&request[..header_end]).into_owned();
                let content_length = headers
                    .lines()
                    .find_map(|line| {
                        line.to_ascii_lowercase()
                            .strip_prefix("content-length: ")
                            .map(str::to_owned)
                    })
                    .and_then(|value| value.parse::<usize>().ok())
                    .unwrap_or(0);
                while request.len() < header_end + content_length {
                    let count = stream.read(&mut buffer).await.expect("read body");
                    if count == 0 {
                        break;
                    }
                    request.extend_from_slice(&buffer[..count]);
                }
                let method = headers.split_whitespace().next().unwrap_or("");
                let response = if method == "GET" {
                    let remote = server_state.lock().expect("remote lock");
                    match remote.bytes.as_ref() {
                        Some(bytes) => http_response(200, remote.revision, bytes),
                        None => http_response(404, remote.revision, b""),
                    }
                } else {
                    let body = &request[header_end..header_end + content_length];
                    let lower = headers.to_ascii_lowercase();
                    let mut remote = server_state.lock().expect("remote lock");
                    let allowed = if lower.contains("if-none-match: *") {
                        remote.bytes.is_none()
                    } else {
                        lower.contains(&format!("if-match: \"r{}\"", remote.revision))
                            && remote.bytes.is_some()
                    };
                    if allowed {
                        remote.bytes = Some(body.to_vec());
                        remote.revision += 1;
                        http_response(201, remote.revision, b"")
                    } else {
                        http_response(412, remote.revision, b"")
                    }
                };
                stream.write_all(&response).await.expect("write response");
            }
        });
        (format!("http://{address}/vault.kdbx"), state, task)
    }

    fn http_response(status: u16, revision: u64, body: &[u8]) -> Vec<u8> {
        let reason = match status {
            200 => "OK",
            201 => "Created",
            404 => "Not Found",
            _ => "Precondition Failed",
        };
        let mut response = format!(
            "HTTP/1.1 {status} {reason}\r\nETag: \"r{revision}\"\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
            body.len()
        )
        .into_bytes();
        response.extend_from_slice(body);
        response
    }

    async fn runtime_syncs_both_directions_and_resolves_conflict_case() {
        let directory = TestDirectory::new();
        let state = unlocked_state(&directory);
        let runtime = SyncRuntime::new(directory.0.clone()).expect("runtime");
        let (url, remote, server) = webdav_server().await;
        let saved = runtime
            .save_profile(
                &state,
                decode(json!({
                    "target": { "provider": "webdav", "resourceUrl": url }
                })),
            )
            .expect("save profile");
        assert_eq!(runtime.profiles(&state).expect("profiles").len(), 1);

        let created = runtime
            .sync_now(
                &state,
                &saved.profile_id,
                credentials(),
                PASSWORD.to_owned(),
            )
            .await
            .expect("create remote");
        assert_eq!(created.status, "done");
        assert_eq!(
            runtime
                .test_provider(&saved.profile_id, credentials())
                .await
                .expect("test provider")
                .status,
            "present"
        );

        {
            let mut service = state.service.lock().expect("service lock");
            let entry = service.snapshot().expect("snapshot").entries[0].id.clone();
            service
                .session_mut()
                .expect("session")
                .document_mut()
                .set_entry_title(&EntryId::new(entry), "local upload")
                .expect("mutate local");
            service
                .save(SecretString::new(PASSWORD.to_owned()))
                .expect("save local");
        }
        runtime
            .sync_now(
                &state,
                &saved.profile_id,
                credentials(),
                PASSWORD.to_owned(),
            )
            .await
            .expect("conditional replace");

        let common = remote
            .lock()
            .expect("remote lock")
            .bytes
            .clone()
            .expect("remote bytes");
        let remote_next = changed(&common, "remote download");
        {
            let mut value = remote.lock().expect("remote lock");
            value.bytes = Some(remote_next.clone());
            value.revision += 1;
        }
        runtime
            .sync_now(
                &state,
                &saved.profile_id,
                credentials(),
                PASSWORD.to_owned(),
            )
            .await
            .expect("apply remote");

        {
            let mut service = state.service.lock().expect("service lock");
            let entry = service.snapshot().expect("snapshot").entries[0].id.clone();
            service
                .session_mut()
                .expect("session")
                .document_mut()
                .set_entry_title(&EntryId::new(entry), "local conflict")
                .expect("mutate local");
            service
                .save(SecretString::new(PASSWORD.to_owned()))
                .expect("save conflict");
        }
        let remote_conflict = changed(&remote_next, "remote conflict");
        {
            let mut value = remote.lock().expect("remote lock");
            value.bytes = Some(remote_conflict);
            value.revision += 1;
        }
        let conflict = runtime
            .sync_now(
                &state,
                &saved.profile_id,
                credentials(),
                PASSWORD.to_owned(),
            )
            .await
            .expect("structured conflict")
            .conflict
            .expect("conflict token");
        runtime
            .resolve_conflict(
                &state,
                ResolveSyncConflictRequestDto {
                    profile_id: saved.profile_id.clone(),
                    conflict_operation_id: conflict.id().to_owned(),
                    choice: ConflictChoiceDto::KeepRemote,
                    credentials: credentials(),
                    master_password: PASSWORD.to_owned(),
                },
            )
            .await
            .expect("keep remote");
        runtime
            .delete_profile(&saved.profile_id)
            .expect("delete profile");
        let s3_profile = runtime
            .save_profile(
                &state,
                decode(json!({
                    "target": {
                        "provider": "s3",
                        "endpoint": "http://127.0.0.1:9000",
                        "region": "us-east-1",
                        "bucket": "synthetic-bucket",
                        "objectKey": "vault.kdbx",
                        "pathStyle": true
                    }
                })),
            )
            .expect("save S3 profile");
        runtime
            .delete_profile(&s3_profile.profile_id)
            .expect("delete S3 profile");
        server.abort();
    }

    #[test]
    fn runtime_syncs_both_directions_and_resolves_conflict() {
        std::thread::Builder::new()
            .name("desktop-sync-integration".to_owned())
            .stack_size(8 * 1024 * 1024)
            .spawn(|| {
                let runtime = tokio::runtime::Builder::new_current_thread()
                    .enable_all()
                    .build()
                    .expect("test runtime");
                runtime.block_on(runtime_syncs_both_directions_and_resolves_conflict_case());
            })
            .expect("test thread")
            .join()
            .expect("desktop sync integration test");
    }

    #[test]
    fn desktop_mapping_is_stable_and_s3_uses_explicit_credentials() {
        for completion in [
            SyncCompletion::CreatedRemote,
            SyncCompletion::EstablishedBase,
            SyncCompletion::Equivalent,
            SyncCompletion::UploadedLocal,
            SyncCompletion::AppliedRemote,
            SyncCompletion::Merged,
            SyncCompletion::Recovered,
        ] {
            assert_eq!(completion_status(completion), "done");
        }
        assert!(matches!(
            map_provider_error(ProviderError::AuthenticationFailed),
            crate::state::DesktopError::SyncCredentialsRequired
        ));
        assert!(matches!(
            map_provider_error(ProviderError::UnsafeProvider),
            crate::state::DesktopError::SyncUnsafeProvider
        ));
        assert!(matches!(
            map_sync_error(SyncError::LocalChanged),
            crate::state::DesktopError::SyncLocalChanged
        ));
        assert!(matches!(
            map_sync_error(SyncError::Local(LocalCommitError::Dirty)),
            crate::state::DesktopError::UnsavedChanges
        ));

        let target = SyncProfileTargetDto::S3 {
            endpoint: Some("http://127.0.0.1:9000".to_owned()),
            region: "us-east-1".to_owned(),
            bucket: "bucket".to_owned(),
            object_key: "vault.kdbx".to_owned(),
            path_style: true,
        };
        let provider = DesktopProvider::new(
            &target,
            decode(json!({
                "s3": {
                    "accessKeyId": "SYNTHETIC_ACCESS_KEY",
                    "secretAccessKey": "SECRET_S3_ACCESS_SECRET",
                    "sessionToken": "SYNTHETIC_SESSION_TOKEN"
                }
            })),
        )
        .expect("explicit S3 provider");
        assert!(matches!(provider, DesktopProvider::S3(_)));
        let choice: sync_engine::ConflictChoice = ConflictChoiceDto::KeepLocal.into();
        assert!(matches!(choice, sync_engine::ConflictChoice::KeepLocal));
    }
}
