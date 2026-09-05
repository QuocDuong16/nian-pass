use std::{
    fs,
    io::Cursor,
    path::{Path, PathBuf},
    sync::{
        Arc, Mutex,
        atomic::{AtomicBool, Ordering},
    },
};

use kdbx::KdbxDocument;
use nian_pass_sync_gateway::{GatewayState, Storage, TokenVerifier, serve};
use sync_engine::{
    ConflictChoice, LocalCommitError, LocalSnapshot, LocalVault, ProfileId, SourceBinding,
    SyncCompletion, SyncEngine, SyncError, SyncOutcome, SyncStore, TargetBinding,
};
use sync_provider_core::{
    CiphertextDigest, ProviderError, RemoteObjectProvider, RemoteRead, RemoteRevision,
};
use sync_provider_gateway::{GatewayConfig, GatewayProvider};
use tokio::{
    net::TcpListener,
    sync::{Barrier, oneshot},
    task::JoinHandle,
};
use uuid::Uuid;
use vault_core::{EntryId, SecretString};

const PASSWORD: &str = "demopass";
const TOKEN: &str = "synthetic-high-entropy-sync-integration-token";

struct TestDirectory(PathBuf);

impl TestDirectory {
    fn new(label: &str) -> Self {
        let path =
            std::env::temp_dir().join(format!("nian-pass-gateway-sync-{label}-{}", Uuid::new_v4()));
        fs::create_dir(&path).expect("test directory");
        Self(path)
    }
}

impl Drop for TestDirectory {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

struct TestServer {
    base_url: String,
    shutdown: oneshot::Sender<()>,
    task: JoinHandle<()>,
}

impl TestServer {
    async fn start(storage: &Path) -> Self {
        let listener = TcpListener::bind("127.0.0.1:0").await.expect("bind");
        let address = listener.local_addr().expect("address");
        let state = Arc::new(GatewayState::new(
            TokenVerifier::new(TOKEN).expect("token"),
            Storage::open(storage).expect("storage"),
        ));
        let (shutdown, receiver) = oneshot::channel();
        let task = tokio::spawn(async move {
            serve(listener, state, async {
                let _ = receiver.await;
            })
            .await
            .expect("serve");
        });
        Self {
            base_url: format!("http://{address}/"),
            shutdown,
            task,
        }
    }

    async fn stop(self) {
        let _ = self.shutdown.send(());
        self.task.await.expect("server task");
    }
}

struct LocalState {
    bytes: Vec<u8>,
    authority: String,
}
struct TestLocal {
    source: SourceBinding,
    state: Mutex<LocalState>,
}

impl TestLocal {
    fn new(label: &str, bytes: Vec<u8>) -> Self {
        Self {
            source: source(label),
            state: Mutex::new(LocalState {
                bytes,
                authority: Uuid::new_v4().to_string(),
            }),
        }
    }

    fn bytes(&self) -> Vec<u8> {
        self.state.lock().expect("local").bytes.clone()
    }

    fn save(&self, bytes: Vec<u8>) {
        let mut state = self.state.lock().expect("local");
        state.bytes = bytes;
        state.authority = Uuid::new_v4().to_string();
    }
}

impl LocalVault for TestLocal {
    fn capture_clean(&self) -> Result<LocalSnapshot, LocalCommitError> {
        let state = self.state.lock().map_err(|_| LocalCommitError::Failed)?;
        Ok(LocalSnapshot::new(
            self.source.clone(),
            state.authority.clone(),
            state.bytes.clone(),
        ))
    }

    fn replace_if_unchanged(
        &self,
        expected: &LocalSnapshot,
        ciphertext: &[u8],
        _master_password: &SecretString,
    ) -> Result<(), LocalCommitError> {
        let mut state = self.state.lock().map_err(|_| LocalCommitError::Failed)?;
        if expected.source() != &self.source
            || expected.authority_token() != state.authority
            || expected.digest() != &CiphertextDigest::of(&state.bytes)
        {
            return Err(LocalCommitError::Changed);
        }
        state.bytes = ciphertext.to_vec();
        state.authority = Uuid::new_v4().to_string();
        Ok(())
    }
}

fn fixture() -> Vec<u8> {
    fs::read(
        Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../../fixtures/kdbx/keepassxc-2.7.12-kdbx41.kdbx"),
    )
    .expect("fixture")
}

fn mutate(bytes: &[u8], title: Option<&str>, username: Option<&str>) -> Vec<u8> {
    let mut document = KdbxDocument::open_reader(&mut Cursor::new(bytes), PASSWORD).expect("open");
    let entry: EntryId = document.projection().expect("projection").root().entries()[0]
        .id()
        .clone();
    if let Some(title) = title {
        document.set_entry_title(&entry, title).expect("title");
    }
    if let Some(username) = username {
        document
            .set_entry_username(&entry, username)
            .expect("username");
    }
    let mut output = Vec::new();
    document
        .save_to_writer(&mut output, PASSWORD)
        .expect("save");
    output
}

fn source(label: &str) -> SourceBinding {
    SourceBinding::from_sha256(CiphertextDigest::of(label.as_bytes()).as_str().to_owned())
        .expect("source")
}

fn target(base_url: &str, vault_id: Uuid) -> TargetBinding {
    TargetBinding::from_sha256(
        CiphertextDigest::of(format!("{base_url}{vault_id}").as_bytes())
            .as_str()
            .to_owned(),
    )
    .expect("target")
}

fn engine(directory: &Path, label: &str, base_url: &str, vault_id: Uuid) -> SyncEngine {
    let store = SyncStore::open(
        directory,
        ProfileId::random(),
        source(label),
        target(base_url, vault_id),
    )
    .expect("store");
    SyncEngine::new(store)
}

fn provider(base_url: &str, vault_id: Uuid) -> GatewayProvider {
    GatewayProvider::new(
        GatewayConfig::new(base_url, &vault_id.hyphenated().to_string()).expect("config"),
        SecretString::new(TOKEN.to_owned()),
    )
    .expect("provider")
}

async fn sync<P: RemoteObjectProvider>(
    engine: &SyncEngine,
    provider: &P,
    local: &TestLocal,
) -> Result<SyncOutcome, SyncError> {
    engine
        .sync(provider, local, SecretString::new(PASSWORD.to_owned()))
        .await
}

#[tokio::test(flavor = "current_thread")]
async fn two_real_clients_create_fast_forward_merge_conflict_and_converge() {
    let storage = TestDirectory::new("storage");
    let client_a_data = TestDirectory::new("client-a");
    let client_b_data = TestDirectory::new("client-b");
    let server = TestServer::start(&storage.0).await;
    let vault_id = Uuid::new_v4();
    let provider_a = provider(&server.base_url, vault_id);
    let provider_b = provider(&server.base_url, vault_id);
    let original = fixture();
    let local_a = TestLocal::new("client-a", original.clone());
    let local_b = TestLocal::new("client-b", original.clone());
    let engine_a = engine(&client_a_data.0, "client-a", &server.base_url, vault_id);
    let engine_b = engine(&client_b_data.0, "client-b", &server.base_url, vault_id);

    assert!(matches!(
        sync(&engine_a, &provider_a, &local_a)
            .await
            .expect("create"),
        SyncOutcome::Done(SyncCompletion::CreatedRemote)
    ));
    assert!(matches!(
        sync(&engine_b, &provider_b, &local_b).await.expect("base"),
        SyncOutcome::Done(SyncCompletion::EstablishedBase)
    ));

    local_a.save(mutate(&original, Some("uploaded-title"), None));
    assert!(matches!(
        sync(&engine_a, &provider_a, &local_a)
            .await
            .expect("upload"),
        SyncOutcome::Done(SyncCompletion::UploadedLocal)
    ));
    assert!(matches!(
        sync(&engine_b, &provider_b, &local_b)
            .await
            .expect("download"),
        SyncOutcome::Done(SyncCompletion::AppliedRemote)
    ));
    assert_eq!(local_a.bytes(), local_b.bytes());

    let shared = local_a.bytes();
    local_a.save(mutate(&shared, Some("local-title"), None));
    local_b.save(mutate(&shared, None, Some("remote-username")));
    assert!(matches!(
        sync(&engine_b, &provider_b, &local_b)
            .await
            .expect("remote upload"),
        SyncOutcome::Done(SyncCompletion::UploadedLocal)
    ));
    assert!(matches!(
        sync(&engine_a, &provider_a, &local_a).await.expect("merge"),
        SyncOutcome::Done(SyncCompletion::Merged)
    ));
    assert!(matches!(
        sync(&engine_b, &provider_b, &local_b)
            .await
            .expect("merged download"),
        SyncOutcome::Done(SyncCompletion::AppliedRemote)
    ));
    assert_eq!(local_a.bytes(), local_b.bytes());

    let shared = local_a.bytes();
    local_a.save(mutate(&shared, Some("keep-local"), None));
    local_b.save(mutate(&shared, Some("other-remote"), None));
    sync(&engine_b, &provider_b, &local_b)
        .await
        .expect("remote divergence");
    let SyncOutcome::Conflict(conflict) = sync(&engine_a, &provider_a, &local_a)
        .await
        .expect("conflict")
    else {
        panic!("expected conflict")
    };
    assert!(!conflict.conflicts().is_empty());
    assert!(matches!(
        engine_a
            .resolve(
                conflict.id(),
                ConflictChoice::KeepLocal,
                &provider_a,
                &local_a,
                SecretString::new(PASSWORD.to_owned())
            )
            .await
            .expect("keep local"),
        SyncOutcome::Done(SyncCompletion::UploadedLocal)
    ));
    sync(&engine_b, &provider_b, &local_b)
        .await
        .expect("download local choice");
    assert_eq!(local_a.bytes(), local_b.bytes());

    let shared = local_a.bytes();
    local_a.save(mutate(&shared, Some("discard-local"), None));
    local_b.save(mutate(&shared, Some("keep-remote"), None));
    sync(&engine_b, &provider_b, &local_b)
        .await
        .expect("remote choice source");
    let SyncOutcome::Conflict(conflict) = sync(&engine_a, &provider_a, &local_a)
        .await
        .expect("second conflict")
    else {
        panic!("expected conflict")
    };
    assert!(matches!(
        engine_a
            .resolve(
                conflict.id(),
                ConflictChoice::KeepRemote,
                &provider_a,
                &local_a,
                SecretString::new(PASSWORD.to_owned())
            )
            .await
            .expect("keep remote"),
        SyncOutcome::Done(SyncCompletion::AppliedRemote)
    ));
    assert_eq!(local_a.bytes(), local_b.bytes());
    server.stop().await;
}

struct BarrierProvider<'a> {
    inner: &'a GatewayProvider,
    barrier: Arc<Barrier>,
}

impl RemoteObjectProvider for BarrierProvider<'_> {
    async fn read(&self) -> Result<RemoteRead, ProviderError> {
        self.inner.read().await
    }
    async fn create_if_absent(&self, bytes: &[u8]) -> Result<RemoteRevision, ProviderError> {
        self.inner.create_if_absent(bytes).await
    }
    async fn replace_if_revision(
        &self,
        expected: &RemoteRevision,
        bytes: &[u8],
    ) -> Result<RemoteRevision, ProviderError> {
        self.barrier.wait().await;
        self.inner.replace_if_revision(expected, bytes).await
    }
}

struct UncertainOnce<'a> {
    inner: &'a GatewayProvider,
    uncertain: AtomicBool,
}

impl RemoteObjectProvider for UncertainOnce<'_> {
    async fn read(&self) -> Result<RemoteRead, ProviderError> {
        self.inner.read().await
    }
    async fn create_if_absent(&self, bytes: &[u8]) -> Result<RemoteRevision, ProviderError> {
        let revision = self.inner.create_if_absent(bytes).await?;
        if self.uncertain.swap(false, Ordering::SeqCst) {
            Err(ProviderError::WriteResultUncertain)
        } else {
            Ok(revision)
        }
    }
    async fn replace_if_revision(
        &self,
        expected: &RemoteRevision,
        bytes: &[u8],
    ) -> Result<RemoteRevision, ProviderError> {
        self.inner.replace_if_revision(expected, bytes).await
    }
}

#[tokio::test(flavor = "current_thread")]
async fn real_gateway_stale_cas_and_uncertain_commit_use_m7_recovery() {
    let storage = TestDirectory::new("race-storage");
    let server = TestServer::start(&storage.0).await;
    let vault_id = Uuid::new_v4();
    let base = fixture();
    let seed_data = TestDirectory::new("seed");
    let seed_local = TestLocal::new("seed", base.clone());
    let seed_engine = engine(&seed_data.0, "seed", &server.base_url, vault_id);
    let seed_provider = provider(&server.base_url, vault_id);
    sync(&seed_engine, &seed_provider, &seed_local)
        .await
        .expect("seed");

    let left_data = TestDirectory::new("left");
    let right_data = TestDirectory::new("right");
    let left = TestLocal::new("left", base.clone());
    let right = TestLocal::new("right", base.clone());
    let left_engine = engine(&left_data.0, "left", &server.base_url, vault_id);
    let right_engine = engine(&right_data.0, "right", &server.base_url, vault_id);
    let left_provider = provider(&server.base_url, vault_id);
    let right_provider = provider(&server.base_url, vault_id);
    sync(&left_engine, &left_provider, &left)
        .await
        .expect("left base");
    sync(&right_engine, &right_provider, &right)
        .await
        .expect("right base");
    left.save(mutate(&base, Some("left-race"), None));
    right.save(mutate(&base, Some("right-race"), None));
    let barrier = Arc::new(Barrier::new(2));
    let left_barrier = BarrierProvider {
        inner: &left_provider,
        barrier: barrier.clone(),
    };
    let right_barrier = BarrierProvider {
        inner: &right_provider,
        barrier,
    };
    let (left_result, right_result) = tokio::join!(
        sync(&left_engine, &left_barrier, &left),
        sync(&right_engine, &right_barrier, &right)
    );
    let results = [left_result, right_result];
    assert_eq!(
        results
            .iter()
            .filter(|result| matches!(result, Ok(SyncOutcome::Done(SyncCompletion::UploadedLocal))))
            .count(),
        1
    );
    assert_eq!(
        results
            .iter()
            .filter(|result| matches!(result, Err(SyncError::RemoteChanged)))
            .count(),
        1
    );

    let recovery_storage = TestDirectory::new("recovery-storage");
    let recovery_server = TestServer::start(&recovery_storage.0).await;
    let recovery_id = Uuid::new_v4();
    let recovery_data = TestDirectory::new("recovery-client");
    let recovery_local = TestLocal::new("recovery", fixture());
    let recovery_engine = engine(
        &recovery_data.0,
        "recovery",
        &recovery_server.base_url,
        recovery_id,
    );
    let recovery_provider = provider(&recovery_server.base_url, recovery_id);
    let uncertain = UncertainOnce {
        inner: &recovery_provider,
        uncertain: AtomicBool::new(true),
    };
    assert!(matches!(
        sync(&recovery_engine, &uncertain, &recovery_local)
            .await
            .expect("recover"),
        SyncOutcome::Done(SyncCompletion::Recovered)
    ));
    assert!(matches!(
        recovery_provider.read().await.expect("remote"),
        RemoteRead::Present(_)
    ));
    recovery_server.stop().await;
    server.stop().await;
}
