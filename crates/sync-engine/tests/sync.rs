use std::{
    fs,
    io::Cursor,
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
};

use kdbx::KdbxDocument;
use sync_engine::{
    ConflictOperation, LocalCommitError, LocalSnapshot, LocalVault, ProfileId, SourceBinding,
    StoreError, SyncCompletion, SyncEngine, SyncError, SyncOutcome, SyncStore, TargetBinding,
};
use sync_provider_core::{
    CiphertextDigest, ProviderError, RemoteObject, RemoteObjectProvider, RemoteRead, RemoteRevision,
};
use vault_core::{EntryId, SecretString, SummaryText};

const PASSWORD: &str = "demopass";

struct TestDirectory(PathBuf);

impl TestDirectory {
    fn new() -> Self {
        let path = std::env::temp_dir().join(format!("nian-pass-m7-{}", uuid::Uuid::new_v4()));
        fs::create_dir(&path).expect("test directory should be created");
        Self(path)
    }
}

impl Drop for TestDirectory {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

struct FakeRemoteState {
    object: Option<Vec<u8>>,
    revision: u64,
    write_count: usize,
    read_count: usize,
    reject_next_write: bool,
    fail_next_write_before_mutation: bool,
    fail_next_read: bool,
    lose_next_response: bool,
    after_write: Option<Box<dyn FnOnce() + Send>>,
}

struct FakeProvider {
    state: Mutex<FakeRemoteState>,
}

impl FakeProvider {
    fn new(object: Option<Vec<u8>>) -> Self {
        Self {
            state: Mutex::new(FakeRemoteState {
                object,
                revision: 1,
                write_count: 0,
                read_count: 0,
                reject_next_write: false,
                fail_next_write_before_mutation: false,
                fail_next_read: false,
                lose_next_response: false,
                after_write: None,
            }),
        }
    }

    fn revision(state: &FakeRemoteState) -> RemoteRevision {
        RemoteRevision::new(format!("r{}", state.revision)).expect("revision should be valid")
    }

    fn bytes(&self) -> Option<Vec<u8>> {
        self.state.lock().expect("remote lock").object.clone()
    }

    fn current_revision(&self) -> RemoteRevision {
        let state = self.state.lock().expect("remote lock");
        Self::revision(&state)
    }

    fn write_count(&self) -> usize {
        self.state.lock().expect("remote lock").write_count
    }

    fn read_count(&self) -> usize {
        self.state.lock().expect("remote lock").read_count
    }

    fn externally_replace(&self, ciphertext: Vec<u8>) {
        let mut state = self.state.lock().expect("remote lock");
        state.object = Some(ciphertext);
        state.revision += 1;
    }

    fn change_revision_only(&self) {
        self.state.lock().expect("remote lock").revision += 1;
    }

    fn replace_without_revision_change(&self, ciphertext: Vec<u8>) {
        self.state.lock().expect("remote lock").object = Some(ciphertext);
    }

    fn restore(&self, ciphertext: Vec<u8>, revision: u64) {
        let mut state = self.state.lock().expect("remote lock");
        state.object = Some(ciphertext);
        state.revision = revision;
    }

    fn reject_next_write(&self) {
        self.state.lock().expect("remote lock").reject_next_write = true;
    }

    fn fail_next_write_before_mutation(&self) {
        self.state
            .lock()
            .expect("remote lock")
            .fail_next_write_before_mutation = true;
    }

    fn fail_next_read(&self) {
        self.state.lock().expect("remote lock").fail_next_read = true;
    }

    fn lose_next_response(&self) {
        self.state.lock().expect("remote lock").lose_next_response = true;
    }

    fn after_write(&self, hook: impl FnOnce() + Send + 'static) {
        self.state.lock().expect("remote lock").after_write = Some(Box::new(hook));
    }

    fn write(
        &self,
        expected: Option<&RemoteRevision>,
        ciphertext: &[u8],
    ) -> Result<RemoteRevision, ProviderError> {
        let (revision, lost, hook) = {
            let mut state = self.state.lock().map_err(|_| ProviderError::Transport)?;
            state.write_count += 1;
            if std::mem::take(&mut state.fail_next_write_before_mutation) {
                return Err(ProviderError::Transport);
            }
            if state.reject_next_write {
                state.reject_next_write = false;
                state.revision += 1;
                state.object = Some(b"concurrent ciphertext".to_vec());
                return Err(ProviderError::RemoteChanged);
            }
            let matches = match (expected, state.object.as_ref()) {
                (None, None) => true,
                (Some(expected), Some(_)) => expected == &Self::revision(&state),
                _ => false,
            };
            if !matches {
                return Err(ProviderError::RemoteChanged);
            }
            state.object = Some(ciphertext.to_vec());
            state.revision += 1;
            let revision = Self::revision(&state);
            let lost = std::mem::take(&mut state.lose_next_response);
            let hook = state.after_write.take();
            (revision, lost, hook)
        };
        if let Some(hook) = hook {
            hook();
        }
        if lost {
            Err(ProviderError::WriteResultUncertain)
        } else {
            Ok(revision)
        }
    }
}

impl RemoteObjectProvider for FakeProvider {
    async fn read(&self) -> Result<RemoteRead, ProviderError> {
        let mut state = self.state.lock().map_err(|_| ProviderError::Transport)?;
        state.read_count += 1;
        if std::mem::take(&mut state.fail_next_read) {
            return Err(ProviderError::Transport);
        }
        match state.object.clone() {
            Some(ciphertext) => {
                RemoteObject::new(ciphertext, Self::revision(&state)).map(RemoteRead::Present)
            }
            None => Ok(RemoteRead::Missing),
        }
    }

    async fn create_if_absent(&self, ciphertext: &[u8]) -> Result<RemoteRevision, ProviderError> {
        self.write(None, ciphertext)
    }

    async fn replace_if_revision(
        &self,
        expected: &RemoteRevision,
        ciphertext: &[u8],
    ) -> Result<RemoteRevision, ProviderError> {
        self.write(Some(expected), ciphertext)
    }
}

struct FakeLocalState {
    source: SourceBinding,
    authority: String,
    ciphertext: Vec<u8>,
    dirty: bool,
    locked: bool,
}

struct FakeLocal {
    state: Mutex<FakeLocalState>,
}

impl FakeLocal {
    fn new(ciphertext: Vec<u8>) -> Self {
        Self {
            state: Mutex::new(FakeLocalState {
                source: source("source-a"),
                authority: "session-a".to_owned(),
                ciphertext,
                dirty: false,
                locked: false,
            }),
        }
    }

    fn bytes(&self) -> Vec<u8> {
        self.state.lock().expect("local lock").ciphertext.clone()
    }

    fn externally_save(&self, ciphertext: Vec<u8>) {
        let mut state = self.state.lock().expect("local lock");
        state.ciphertext = ciphertext;
        state.authority = format!("session-after-save-{}", uuid::Uuid::new_v4());
    }

    fn switch_source(&self) {
        let mut state = self.state.lock().expect("local lock");
        state.source = source("source-b");
        state.authority = "session-b".to_owned();
    }

    fn lock(&self) {
        self.state.lock().expect("local lock").locked = true;
    }
}

impl LocalVault for FakeLocal {
    fn capture_clean(&self) -> Result<LocalSnapshot, LocalCommitError> {
        let state = self.state.lock().map_err(|_| LocalCommitError::Failed)?;
        if state.locked {
            return Err(LocalCommitError::Locked);
        }
        if state.dirty {
            return Err(LocalCommitError::Dirty);
        }
        Ok(LocalSnapshot::new(
            state.source.clone(),
            state.authority.clone(),
            state.ciphertext.clone(),
        ))
    }

    fn replace_if_unchanged(
        &self,
        expected: &LocalSnapshot,
        ciphertext: &[u8],
        _master_password: &SecretString,
    ) -> Result<(), LocalCommitError> {
        let mut state = self.state.lock().map_err(|_| LocalCommitError::Failed)?;
        if state.locked {
            return Err(LocalCommitError::Locked);
        }
        if state.dirty {
            return Err(LocalCommitError::Dirty);
        }
        if &state.source != expected.source()
            || state.authority != expected.authority_token()
            || CiphertextDigest::of(&state.ciphertext) != *expected.digest()
        {
            return Err(LocalCommitError::Changed);
        }
        state.ciphertext = ciphertext.to_vec();
        state.authority = format!("session-{}", uuid::Uuid::new_v4());
        Ok(())
    }
}

fn fixture() -> Vec<u8> {
    fs::read(
        Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../../fixtures/kdbx/keepassxc-2.7.12-kdbx41.kdbx"),
    )
    .expect("fixture should be readable")
}

fn changed(bytes: &[u8], title: &str) -> Vec<u8> {
    let mut document =
        KdbxDocument::open_reader(&mut Cursor::new(bytes), PASSWORD).expect("fixture should open");
    let entry: EntryId = document
        .projection()
        .expect("fixture should project")
        .root()
        .entries()[0]
        .id()
        .clone();
    document
        .set_entry_title(&entry, title)
        .expect("title should mutate");
    let mut output = Vec::new();
    document
        .save_to_writer(&mut output, PASSWORD)
        .expect("changed document should save");
    output
}

fn changed_username(bytes: &[u8], username: &str) -> Vec<u8> {
    let mut document =
        KdbxDocument::open_reader(&mut Cursor::new(bytes), PASSWORD).expect("fixture should open");
    let entry = document
        .projection()
        .expect("fixture should project")
        .root()
        .entries()[0]
        .id()
        .clone();
    document
        .set_entry_username(&entry, username)
        .expect("username should mutate");
    let mut output = Vec::new();
    document
        .save_to_writer(&mut output, PASSWORD)
        .expect("changed document should save");
    output
}

fn source(value: &str) -> SourceBinding {
    SourceBinding::from_sha256(CiphertextDigest::of(value.as_bytes()).as_str().to_owned())
        .expect("source should be valid")
}

fn target(value: &str) -> TargetBinding {
    TargetBinding::from_sha256(CiphertextDigest::of(value.as_bytes()).as_str().to_owned())
        .expect("target should be valid")
}

fn setup(
    local_bytes: Vec<u8>,
    remote_bytes: Option<Vec<u8>>,
) -> (
    TestDirectory,
    SyncEngine,
    Arc<FakeLocal>,
    Arc<FakeProvider>,
    ProfileId,
) {
    let directory = TestDirectory::new();
    let profile = ProfileId::random();
    let store = SyncStore::open(
        &directory.0,
        profile,
        source("source-a"),
        target("target-a"),
    )
    .expect("store should open");
    (
        directory,
        SyncEngine::new(store),
        Arc::new(FakeLocal::new(local_bytes)),
        Arc::new(FakeProvider::new(remote_bytes)),
        profile,
    )
}

fn profile_directory(directory: &TestDirectory, profile: ProfileId) -> PathBuf {
    directory.0.join("sync").join(profile.to_canonical_string())
}

fn open_store(directory: &TestDirectory, profile: ProfileId) -> SyncStore {
    SyncStore::open(
        &directory.0,
        profile,
        source("source-a"),
        target("target-a"),
    )
    .expect("store should open")
}

fn write_schema_only(directory: &Path, filename: &str, schema_version: u32) {
    fs::write(
        directory.join(filename),
        serde_json::to_vec(&serde_json::json!({ "schema_version": schema_version }))
            .expect("metadata should serialize"),
    )
    .expect("metadata should write");
}

fn install_journal(
    directory: &TestDirectory,
    profile: ProfileId,
    phase: &str,
    expected_local: &[u8],
    expected_remote: Option<&RemoteRevision>,
    candidate: &[u8],
    committed_remote: Option<&RemoteRevision>,
) {
    let profile_directory = directory.0.join("sync").join(profile.to_canonical_string());
    let operation_id = uuid::Uuid::new_v4();
    let candidate_file = format!("candidate-{operation_id}.kdbx");
    let candidate_path = profile_directory.join(&candidate_file);
    fs::write(&candidate_path, candidate).expect("candidate should write");
    let journal = serde_json::json!({
        "schema_version": 2,
        "profile_id": profile.to_canonical_string(),
        "source": source("source-a").as_str(),
        "target": target("target-a").as_str(),
        "operation_id": operation_id,
        "phase": phase,
        "expected_local_sha256": CiphertextDigest::of(expected_local).as_str(),
        "expected_remote_revision": expected_remote.map(RemoteRevision::as_provider_token),
        "candidate_file": candidate_file,
        "candidate_sha256": CiphertextDigest::of(candidate).as_str(),
        "committed_remote_revision": committed_remote.map(RemoteRevision::as_provider_token),
    });
    fs::write(
        profile_directory.join("journal.json"),
        serde_json::to_vec(&journal).expect("journal should serialize"),
    )
    .expect("journal should write");
}

#[test]
fn recovery_status_distinguishes_current_unsupported_and_corrupt_state() {
    let directory = TestDirectory::new();
    let profile = ProfileId::random();
    let store = open_store(&directory, profile);
    assert_eq!(
        store.recovery_status().expect("empty status"),
        sync_engine::RecoveryStatus::None
    );

    let bytes = fixture();
    install_journal(&directory, profile, "prepared", &bytes, None, &bytes, None);
    assert_eq!(
        store.recovery_status().expect("current journal status"),
        sync_engine::RecoveryStatus::Required
    );

    let profile_dir = profile_directory(&directory, profile);
    fs::remove_file(profile_dir.join("journal.json")).expect("remove current journal");
    write_schema_only(&profile_dir, "journal.json", 1);
    assert_eq!(
        store.recovery_status().expect("legacy journal status"),
        sync_engine::RecoveryStatus::Unsupported
    );

    write_schema_only(&profile_dir, "journal.json", 99);
    assert_eq!(
        store.recovery_status().expect("future journal status"),
        sync_engine::RecoveryStatus::Unsupported
    );

    fs::write(profile_dir.join("journal.json"), b"not-json").expect("malformed journal");
    assert!(matches!(
        store.recovery_status(),
        Err(StoreError::CorruptJournal)
    ));
}

#[tokio::test(flavor = "current_thread")]
async fn unsupported_base_is_never_loaded_or_silently_upgraded() {
    for schema_version in [1, 99] {
        let bytes = fixture();
        let (directory, engine, local, provider, profile) =
            setup(bytes.clone(), Some(bytes.clone()));
        write_schema_only(
            &profile_directory(&directory, profile),
            "base.json",
            schema_version,
        );
        assert!(matches!(
            sync(&engine, &provider, &local).await,
            Err(SyncError::Store(StoreError::UnsupportedSchema))
        ));
        assert_eq!(provider.read_count(), 0);
        assert_eq!(provider.write_count(), 0);
    }
}

#[tokio::test(flavor = "current_thread")]
async fn explicit_reset_removes_only_sync_state_and_reestablishes_normally() {
    let bytes = fixture();
    let directory = TestDirectory::new();
    let profile = ProfileId::random();
    let store = open_store(&directory, profile);
    let profile_dir = profile_directory(&directory, profile);
    let base_file = format!("base-{}.kdbx", uuid::Uuid::new_v4());
    let candidate_file = format!("candidate-{}.kdbx", uuid::Uuid::new_v4());
    fs::write(profile_dir.join(&base_file), &bytes).expect("legacy base");
    fs::write(profile_dir.join(&candidate_file), &bytes).expect("legacy candidate");
    write_schema_only(&profile_dir, "base.json", 1);
    write_schema_only(&profile_dir, "journal.json", 1);
    let local = FakeLocal::new(bytes.clone());
    let provider = FakeProvider::new(Some(bytes.clone()));

    store.reset_state().expect("explicit reset should succeed");
    store.reset_state().expect("reset should be idempotent");
    assert!(!profile_dir.join("base.json").exists());
    assert!(!profile_dir.join("journal.json").exists());
    assert!(!profile_dir.join(base_file).exists());
    assert!(!profile_dir.join(candidate_file).exists());
    assert_eq!(local.bytes(), bytes);
    assert_eq!(provider.bytes(), Some(bytes.clone()));
    assert_eq!(provider.read_count(), 0);
    assert_eq!(provider.write_count(), 0);
    assert_eq!(
        store.recovery_status().expect("reset status"),
        sync_engine::RecoveryStatus::None
    );

    let engine = SyncEngine::new(store);
    assert!(matches!(
        sync(&engine, &provider, &local)
            .await
            .expect("equal initial sync"),
        SyncOutcome::Done(SyncCompletion::EstablishedBase)
    ));
    assert!(profile_dir.join("base.json").is_file());
}

#[tokio::test(flavor = "current_thread")]
async fn post_reset_difference_uses_initial_conflict_rules() {
    let base = fixture();
    let local_bytes = changed(&base, "local-after-reset");
    let remote_bytes = changed(&base, "remote-after-reset");
    let directory = TestDirectory::new();
    let profile = ProfileId::random();
    let store = open_store(&directory, profile);
    write_schema_only(&profile_directory(&directory, profile), "base.json", 1);
    store.reset_state().expect("legacy state reset");
    let engine = SyncEngine::new(store);
    let local = FakeLocal::new(local_bytes);
    let provider = FakeProvider::new(Some(remote_bytes));
    let SyncOutcome::Conflict(conflict) = sync(&engine, &provider, &local)
        .await
        .expect("initial sync should classify conflict")
    else {
        panic!("different generations without BASE must conflict");
    };
    assert!(conflict.is_initial());
    assert_eq!(provider.write_count(), 0);
}

#[cfg(unix)]
#[test]
fn reset_rejects_symlink_state_without_following_it() {
    use std::os::unix::fs::symlink;

    let directory = TestDirectory::new();
    let profile = ProfileId::random();
    let store = open_store(&directory, profile);
    let outside = directory.0.join("outside.kdbx");
    fs::write(&outside, b"preserve me").expect("outside file");
    symlink(
        &outside,
        profile_directory(&directory, profile).join("base.json"),
    )
    .expect("metadata symlink");
    assert!(matches!(
        store.recovery_status(),
        Err(StoreError::CorruptBase)
    ));
    assert!(matches!(
        store.reset_state(),
        Err(StoreError::InvalidMetadata)
    ));
    assert_eq!(fs::read(outside).expect("outside remains"), b"preserve me");
}

#[test]
fn recovery_status_reports_metadata_io_failures() {
    let directory = TestDirectory::new();
    let profile = ProfileId::random();
    let store = open_store(&directory, profile);
    let profile_dir = profile_directory(&directory, profile);
    fs::remove_dir(&profile_dir).expect("remove profile directory");
    fs::write(&profile_dir, b"not a directory").expect("replace directory with file");
    assert!(matches!(store.recovery_status(), Err(StoreError::Io(_))));
}

async fn sync(
    engine: &SyncEngine,
    provider: &FakeProvider,
    local: &FakeLocal,
) -> Result<SyncOutcome, SyncError> {
    engine
        .sync(provider, local, SecretString::new(PASSWORD.to_owned()))
        .await
}

async fn create_semantic_conflict() -> (
    TestDirectory,
    SyncEngine,
    Arc<FakeLocal>,
    Arc<FakeProvider>,
    ProfileId,
    Vec<u8>,
    ConflictOperation,
) {
    let base = fixture();
    let (directory, engine, local, provider, profile) = setup(base.clone(), None);
    sync(&engine, &provider, &local).await.expect("seed base");
    local.externally_save(changed(&base, "local-title"));
    let remote = changed(&base, "remote-title");
    provider.externally_replace(remote.clone());
    let conflict = match sync(&engine, &provider, &local).await.expect("conflict") {
        SyncOutcome::Conflict(conflict) => conflict,
        SyncOutcome::Done(_) => panic!("same-field divergence must conflict"),
    };
    (
        directory, engine, local, provider, profile, remote, conflict,
    )
}

#[tokio::test(flavor = "current_thread")]
async fn initial_missing_creates_exact_remote_and_private_base() {
    let bytes = fixture();
    let (directory, engine, local, provider, profile) = setup(bytes.clone(), None);
    assert!(matches!(
        sync(&engine, &provider, &local)
            .await
            .expect("sync should succeed"),
        SyncOutcome::Done(SyncCompletion::CreatedRemote)
    ));
    assert_eq!(provider.bytes(), Some(bytes));
    let profile_dir = directory.0.join("sync").join(profile.to_canonical_string());
    assert!(profile_dir.join("base.json").is_file());
    assert!(!profile_dir.join("journal.json").exists());
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt as _;
        assert_eq!(
            fs::metadata(&profile_dir)
                .expect("metadata")
                .permissions()
                .mode()
                & 0o777,
            0o700
        );
        assert_eq!(
            fs::metadata(profile_dir.join("base.json"))
                .expect("metadata")
                .permissions()
                .mode()
                & 0o777,
            0o600
        );
    }
}

#[tokio::test(flavor = "current_thread")]
async fn initial_equal_establishes_base_but_initial_difference_conflicts() {
    let bytes = fixture();
    let (_directory, engine, local, provider, _profile) = setup(bytes.clone(), Some(bytes.clone()));
    assert!(matches!(
        sync(&engine, &provider, &local).await.expect("equal sync"),
        SyncOutcome::Done(SyncCompletion::EstablishedBase)
    ));

    let remote = changed(&bytes, "remote-only");
    let (_directory, engine, local, provider, _profile) = setup(bytes, Some(remote));
    let conflict = match sync(&engine, &provider, &local)
        .await
        .expect("conflict result")
    {
        SyncOutcome::Conflict(conflict) => conflict,
        SyncOutcome::Done(_) => panic!("different initial generations must conflict"),
    };
    assert!(conflict.is_initial());
    assert!(matches!(
        engine
            .resolve(
                conflict.id(),
                sync_engine::ConflictChoice::KeepLocal,
                provider.as_ref(),
                local.as_ref(),
                SecretString::new(PASSWORD.to_owned()),
            )
            .await
            .expect("explicit keep-local choice"),
        SyncOutcome::Done(SyncCompletion::UploadedLocal)
    ));
    assert_eq!(provider.bytes(), Some(local.bytes()));
}

#[tokio::test(flavor = "current_thread")]
async fn normal_fast_forwards_both_directions() {
    let base = fixture();
    let (_directory, engine, local, provider, _profile) = setup(base.clone(), None);
    sync(&engine, &provider, &local).await.expect("seed base");
    assert!(matches!(
        sync(&engine, &provider, &local)
            .await
            .expect("equal proven generations"),
        SyncOutcome::Done(SyncCompletion::Equivalent)
    ));
    let local_next = changed(&base, "local-next");
    local.externally_save(local_next.clone());
    assert!(matches!(
        sync(&engine, &provider, &local).await.expect("upload"),
        SyncOutcome::Done(SyncCompletion::UploadedLocal)
    ));
    assert_eq!(provider.bytes(), Some(local_next.clone()));

    let remote_next = changed(&local_next, "remote-next");
    provider.externally_replace(remote_next.clone());
    assert!(matches!(
        sync(&engine, &provider, &local).await.expect("download"),
        SyncOutcome::Done(SyncCompletion::AppliedRemote)
    ));
    assert_eq!(local.bytes(), remote_next);
}

#[tokio::test(flavor = "current_thread")]
async fn divergent_non_overlapping_changes_auto_merge_through_vault_sync() {
    let base = fixture();
    let (_directory, engine, local, provider, _profile) = setup(base.clone(), None);
    sync(&engine, &provider, &local).await.expect("seed base");
    local.externally_save(changed(&base, "local-title"));
    provider.externally_replace(changed_username(&base, "remote-username"));
    assert!(matches!(
        sync(&engine, &provider, &local)
            .await
            .expect("merge should succeed"),
        SyncOutcome::Done(SyncCompletion::Merged)
    ));
    assert_eq!(provider.bytes(), Some(local.bytes()));
}

#[tokio::test(flavor = "current_thread")]
async fn semantic_conflict_uses_single_use_revalidated_whole_vault_token() {
    let base = fixture();
    let (_directory, engine, local, provider, _profile) = setup(base.clone(), None);
    sync(&engine, &provider, &local).await.expect("seed base");
    local.externally_save(changed(&base, "local-title"));
    let remote = changed(&base, "remote-title");
    provider.externally_replace(remote.clone());
    let conflict = match sync(&engine, &provider, &local).await.expect("conflict") {
        SyncOutcome::Conflict(conflict) => conflict,
        SyncOutcome::Done(_) => panic!("same-field divergence must conflict"),
    };
    assert!(!conflict.is_initial());
    assert!(!conflict.conflicts().is_empty());
    let token = conflict.id().to_owned();
    assert!(matches!(
        engine
            .resolve(
                &token,
                sync_engine::ConflictChoice::KeepRemote,
                provider.as_ref(),
                local.as_ref(),
                SecretString::new(PASSWORD.to_owned()),
            )
            .await
            .expect("explicit remote choice"),
        SyncOutcome::Done(SyncCompletion::AppliedRemote)
    ));
    assert_eq!(local.bytes(), remote);
    assert!(matches!(
        engine
            .resolve(
                &token,
                sync_engine::ConflictChoice::KeepRemote,
                provider.as_ref(),
                local.as_ref(),
                SecretString::new(PASSWORD.to_owned()),
            )
            .await,
        Err(SyncError::StaleConflict)
    ));
}

#[tokio::test(flavor = "current_thread")]
async fn newer_sync_conflict_replaces_the_old_random_authority() {
    let (_directory, engine, local, provider, _profile, _remote, first) =
        create_semantic_conflict().await;
    let second = match sync(&engine, &provider, &local)
        .await
        .expect("newer sync should produce the current conflict")
    {
        SyncOutcome::Conflict(conflict) => conflict,
        SyncOutcome::Done(_) => panic!("divergence must still conflict"),
    };
    assert_ne!(first.id(), second.id());
    assert!(uuid::Uuid::parse_str(first.id()).is_ok());
    assert!(uuid::Uuid::parse_str(second.id()).is_ok());
    assert!(matches!(
        engine
            .resolve(
                first.id(),
                sync_engine::ConflictChoice::KeepRemote,
                provider.as_ref(),
                local.as_ref(),
                SecretString::new(PASSWORD.to_owned()),
            )
            .await,
        Err(SyncError::StaleConflict)
    ));
}

#[tokio::test(flavor = "current_thread")]
async fn even_a_failed_new_sync_attempt_invalidates_the_old_conflict() {
    let (_directory, engine, local, provider, _profile, _remote, conflict) =
        create_semantic_conflict().await;
    provider.fail_next_read();
    assert!(matches!(
        sync(&engine, &provider, &local).await,
        Err(SyncError::Provider(ProviderError::Transport))
    ));
    assert!(matches!(
        engine
            .resolve(
                conflict.id(),
                sync_engine::ConflictChoice::KeepRemote,
                provider.as_ref(),
                local.as_ref(),
                SecretString::new(PASSWORD.to_owned()),
            )
            .await,
        Err(SyncError::StaleConflict)
    ));
}

#[tokio::test(flavor = "current_thread")]
async fn changed_base_invalidates_conflict_even_if_remote_identity_repeats() {
    let (directory, engine, local, provider, profile, remote, conflict) =
        create_semantic_conflict().await;
    let conflict_revision = provider.current_revision();
    let conflict_revision_number = provider.state.lock().expect("remote lock").revision;

    let advancing_store = SyncStore::open(
        &directory.0,
        profile,
        source("source-a"),
        target("target-a"),
    )
    .expect("advancing store");
    let advancing_engine = SyncEngine::new(advancing_store);
    let advancing_local = FakeLocal::new(remote.clone());
    assert!(matches!(
        sync(&advancing_engine, &provider, &advancing_local)
            .await
            .expect("equal local and remote should advance BASE"),
        SyncOutcome::Done(SyncCompletion::Equivalent)
    ));

    provider.externally_replace(changed(&remote, "temporary-remote"));
    provider.restore(remote, conflict_revision_number);
    assert!(provider.current_revision() == conflict_revision);
    assert!(matches!(
        engine
            .resolve(
                conflict.id(),
                sync_engine::ConflictChoice::KeepRemote,
                provider.as_ref(),
                local.as_ref(),
                SecretString::new(PASSWORD.to_owned()),
            )
            .await,
        Err(SyncError::StaleConflict)
    ));
}

#[tokio::test(flavor = "current_thread")]
async fn initial_conflict_is_stale_once_a_base_is_established() {
    let local_bytes = fixture();
    let remote_bytes = changed(&local_bytes, "remote-only");
    let (directory, engine, local, provider, profile) =
        setup(local_bytes, Some(remote_bytes.clone()));
    let conflict = match sync(&engine, &provider, &local).await.expect("conflict") {
        SyncOutcome::Conflict(conflict) => conflict,
        SyncOutcome::Done(_) => panic!("initial divergence must conflict"),
    };

    let establishing_store = SyncStore::open(
        &directory.0,
        profile,
        source("source-a"),
        target("target-a"),
    )
    .expect("establishing store");
    let establishing_engine = SyncEngine::new(establishing_store);
    let establishing_local = FakeLocal::new(remote_bytes);
    assert!(matches!(
        sync(&establishing_engine, &provider, &establishing_local)
            .await
            .expect("BASE should establish"),
        SyncOutcome::Done(SyncCompletion::EstablishedBase)
    ));
    assert!(matches!(
        engine
            .resolve(
                conflict.id(),
                sync_engine::ConflictChoice::KeepLocal,
                provider.as_ref(),
                local.as_ref(),
                SecretString::new(PASSWORD.to_owned()),
            )
            .await,
        Err(SyncError::StaleConflict)
    ));
}

#[tokio::test(flavor = "current_thread")]
async fn conflict_resolution_revalidates_local_and_both_remote_authorities() {
    let (_directory, engine, local, provider, _profile, _remote, conflict) =
        create_semantic_conflict().await;
    local.externally_save(local.bytes());
    assert!(matches!(
        engine
            .resolve(
                conflict.id(),
                sync_engine::ConflictChoice::KeepRemote,
                provider.as_ref(),
                local.as_ref(),
                SecretString::new(PASSWORD.to_owned()),
            )
            .await,
        Err(SyncError::LocalChanged)
    ));

    let (_directory, engine, local, provider, _profile, _remote, conflict) =
        create_semantic_conflict().await;
    provider.change_revision_only();
    assert!(matches!(
        engine
            .resolve(
                conflict.id(),
                sync_engine::ConflictChoice::KeepRemote,
                provider.as_ref(),
                local.as_ref(),
                SecretString::new(PASSWORD.to_owned()),
            )
            .await,
        Err(SyncError::RemoteChanged)
    ));

    let (_directory, engine, local, provider, _profile, remote, conflict) =
        create_semantic_conflict().await;
    provider.replace_without_revision_change(changed(&remote, "same-revision-rewrite"));
    assert!(matches!(
        engine
            .resolve(
                conflict.id(),
                sync_engine::ConflictChoice::KeepRemote,
                provider.as_ref(),
                local.as_ref(),
                SecretString::new(PASSWORD.to_owned()),
            )
            .await,
        Err(SyncError::RemoteChanged)
    ));
}

#[tokio::test(flavor = "current_thread")]
async fn base_and_journal_reject_a_different_remote_target_binding() {
    let base = fixture();
    let (directory, engine, local, provider, profile) = setup(base.clone(), None);
    sync(&engine, &provider, &local).await.expect("seed BASE");
    let wrong_target_engine = SyncEngine::new(
        SyncStore::open(
            &directory.0,
            profile,
            source("source-a"),
            target("target-b"),
        )
        .expect("wrong-target store opens before metadata validation"),
    );
    let other_provider = FakeProvider::new(Some(base.clone()));
    assert!(matches!(
        sync(&wrong_target_engine, &other_provider, &local).await,
        Err(SyncError::Store(StoreError::WrongTarget))
    ));
    assert_eq!(other_provider.write_count(), 0);

    let candidate = changed(&base, "journal-candidate");
    let expected_revision = provider.current_revision();
    install_journal(
        &directory,
        profile,
        "prepared",
        &base,
        Some(&expected_revision),
        &candidate,
        None,
    );
    let wrong_target_recovery = SyncEngine::new(
        SyncStore::open(
            &directory.0,
            profile,
            source("source-a"),
            target("target-b"),
        )
        .expect("wrong-target recovery store"),
    );
    assert!(matches!(
        sync(&wrong_target_recovery, &other_provider, &local).await,
        Err(SyncError::Store(StoreError::WrongTarget))
    ));
    assert_eq!(other_provider.write_count(), 0);
}

#[tokio::test(flavor = "current_thread")]
async fn remote_cas_race_never_blindly_overwrites() {
    let base = fixture();
    let (directory, engine, local, provider, profile) = setup(base.clone(), None);
    sync(&engine, &provider, &local).await.expect("seed base");
    let local_next = changed(&base, "local-next");
    local.externally_save(local_next.clone());
    provider.reject_next_write();
    assert!(matches!(
        sync(&engine, &provider, &local).await,
        Err(SyncError::RemoteChanged)
    ));
    assert_eq!(local.bytes(), local_next);
    assert_eq!(provider.bytes(), Some(b"concurrent ciphertext".to_vec()));
    assert!(
        !directory
            .0
            .join("sync")
            .join(profile.to_canonical_string())
            .join("journal.json")
            .exists()
    );
}

#[tokio::test(flavor = "current_thread")]
async fn lost_write_response_is_proven_by_read_and_recovered_without_second_put() {
    let base = fixture();
    let (_directory, engine, local, provider, _profile) = setup(base.clone(), None);
    sync(&engine, &provider, &local).await.expect("seed base");
    let next = changed(&base, "local-next");
    local.externally_save(next.clone());
    provider.lose_next_response();
    assert!(matches!(
        sync(&engine, &provider, &local)
            .await
            .expect("recovery should finish"),
        SyncOutcome::Done(SyncCompletion::Recovered)
    ));
    assert_eq!(provider.bytes(), Some(next));
}

#[tokio::test(flavor = "current_thread")]
async fn crash_after_journal_prepare_replans_from_proven_unchanged_remote() {
    let base = fixture();
    let (directory, engine, local, provider, profile) = setup(base.clone(), Some(base.clone()));
    sync(&engine, &provider, &local)
        .await
        .expect("equal generations establish base");
    let candidate = changed(&base, "prepared-candidate");
    local.externally_save(candidate.clone());
    let expected_remote = provider.current_revision();
    install_journal(
        &directory,
        profile,
        "prepared",
        &candidate,
        Some(&expected_remote),
        &candidate,
        None,
    );

    assert!(matches!(
        sync(&engine, &provider, &local)
            .await
            .expect("unchanged remote can be replanned"),
        SyncOutcome::Done(SyncCompletion::UploadedLocal)
    ));
    assert_eq!(provider.bytes(), Some(candidate));
    assert_eq!(provider.write_count(), 1);
}

#[tokio::test(flavor = "current_thread")]
async fn write_failure_before_mutation_keeps_private_journal_then_replans() {
    let base = fixture();
    let (directory, engine, local, provider, profile) = setup(base.clone(), Some(base.clone()));
    sync(&engine, &provider, &local).await.expect("seed base");
    let candidate = changed(&base, "retry-after-no-mutation");
    local.externally_save(candidate.clone());
    provider.fail_next_write_before_mutation();
    assert!(matches!(
        sync(&engine, &provider, &local).await,
        Err(SyncError::Provider(ProviderError::Transport))
    ));

    let profile_directory = directory.0.join("sync").join(profile.to_canonical_string());
    assert!(profile_directory.join("journal.json").is_file());
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt as _;
        assert_eq!(
            fs::metadata(profile_directory.join("journal.json"))
                .expect("journal metadata")
                .permissions()
                .mode()
                & 0o777,
            0o600
        );
        let candidate_path = fs::read_dir(&profile_directory)
            .expect("profile directory")
            .map(|entry| entry.expect("directory entry").path())
            .find(|path| {
                path.file_name()
                    .and_then(|name| name.to_str())
                    .is_some_and(|name| name.starts_with("candidate-"))
            })
            .expect("candidate path");
        assert_eq!(
            fs::metadata(candidate_path)
                .expect("candidate metadata")
                .permissions()
                .mode()
                & 0o777,
            0o600
        );
    }

    assert!(matches!(
        sync(&engine, &provider, &local)
            .await
            .expect("retry should replan"),
        SyncOutcome::Done(SyncCompletion::UploadedLocal)
    ));
    assert_eq!(provider.bytes(), Some(candidate));
}

#[tokio::test(flavor = "current_thread")]
async fn crash_recovery_converges_after_remote_and_local_commit_phases() {
    let base = fixture();

    let (directory, engine, local, provider, profile) = setup(base.clone(), Some(base.clone()));
    sync(&engine, &provider, &local).await.expect("seed base");
    let local_before_merge = changed(&base, "local-before-merge");
    let candidate = changed_username(&local_before_merge, "merged-username");
    local.externally_save(local_before_merge.clone());
    let expected_remote = provider.current_revision();
    provider.externally_replace(candidate.clone());
    let committed_remote = provider.current_revision();
    install_journal(
        &directory,
        profile,
        "remoteCommitted",
        &local_before_merge,
        Some(&expected_remote),
        &candidate,
        Some(&committed_remote),
    );
    assert!(matches!(
        sync(&engine, &provider, &local)
            .await
            .expect("remote-confirmed recovery"),
        SyncOutcome::Done(SyncCompletion::Recovered)
    ));
    assert_eq!(local.bytes(), candidate);

    for phase in ["remoteCommitted", "localCommitted"] {
        let candidate = changed(&base, phase);
        let (directory, engine, local, provider, profile) =
            setup(candidate.clone(), Some(candidate.clone()));
        sync(&engine, &provider, &local)
            .await
            .expect("base already reflects candidate");
        let revision = provider.current_revision();
        install_journal(
            &directory,
            profile,
            phase,
            &base,
            Some(&revision),
            &candidate,
            Some(&revision),
        );
        assert!(matches!(
            sync(&engine, &provider, &local)
                .await
                .expect("post-local or post-base recovery"),
            SyncOutcome::Done(SyncCompletion::Recovered)
        ));
        assert!(
            !directory
                .0
                .join("sync")
                .join(profile.to_canonical_string())
                .join("journal.json")
                .exists()
        );
    }
}

#[tokio::test(flavor = "current_thread")]
async fn readback_failure_keeps_uncertain_journal_and_never_repeats_write() {
    let base = fixture();
    let (_directory, engine, local, provider, _profile) = setup(base.clone(), Some(base.clone()));
    sync(&engine, &provider, &local).await.expect("seed base");
    let candidate = changed(&base, "lost-response-and-readback");
    local.externally_save(candidate.clone());
    provider.lose_next_response();
    let provider_for_hook = provider.clone();
    provider.after_write(move || provider_for_hook.fail_next_read());
    assert!(matches!(
        sync(&engine, &provider, &local).await,
        Err(SyncError::Provider(ProviderError::Transport))
    ));
    let writes_after_commit = provider.write_count();
    assert!(
        provider.bytes().as_deref().map(CiphertextDigest::of)
            == Some(CiphertextDigest::of(&candidate))
    );
    assert!(matches!(
        sync(&engine, &provider, &local)
            .await
            .expect("later read proves the uncertain write"),
        SyncOutcome::Done(SyncCompletion::Recovered)
    ));
    assert_eq!(provider.write_count(), writes_after_commit);
    assert!(
        provider.bytes().as_deref().map(CiphertextDigest::of)
            == Some(CiphertextDigest::of(&candidate))
    );
}

#[tokio::test(flavor = "current_thread")]
async fn save_source_switch_and_lock_win_after_remote_commit() {
    for scenario in ["save", "switch", "lock"] {
        let base = fixture();
        let (_directory, engine, local, provider, _profile) = setup(base.clone(), None);
        sync(&engine, &provider, &local).await.expect("seed base");
        let local_next = changed(&base, "sync-candidate");
        local.externally_save(local_next);
        let local_for_hook = local.clone();
        match scenario {
            "save" => {
                let saved = changed(&base, "save-wins");
                provider.after_write(move || local_for_hook.externally_save(saved));
            }
            "switch" => provider.after_write(move || local_for_hook.switch_source()),
            "lock" => provider.after_write(move || local_for_hook.lock()),
            _ => unreachable!(),
        }
        assert!(sync(&engine, &provider, &local).await.is_err());
        if scenario == "save" {
            let document = KdbxDocument::open_reader(&mut Cursor::new(local.bytes()), PASSWORD)
                .expect("saved generation remains valid");
            let projection = document.projection().expect("projection");
            assert!(matches!(
                projection.root().entries()[0].title(),
                SummaryText::Visible(title) if title == "save-wins"
            ));
            assert!(matches!(
                sync(&engine, &provider, &local).await,
                Err(SyncError::LocalChangedDuringRecovery)
            ));
            let document = KdbxDocument::open_reader(&mut Cursor::new(local.bytes()), PASSWORD)
                .expect("recovery must preserve the saved generation");
            let projection = document.projection().expect("projection");
            assert!(matches!(
                projection.root().entries()[0].title(),
                SummaryText::Visible(title) if title == "save-wins"
            ));
        }
    }
}

#[tokio::test(flavor = "current_thread")]
async fn corrupt_base_fails_closed() {
    let base = fixture();
    let (directory, engine, local, provider, profile) = setup(base, None);
    sync(&engine, &provider, &local).await.expect("seed base");
    let profile_dir = directory.0.join("sync").join(profile.to_canonical_string());
    let metadata: serde_json::Value = serde_json::from_slice(
        &fs::read(profile_dir.join("base.json")).expect("metadata should read"),
    )
    .expect("metadata should parse");
    let file = metadata["ciphertext_file"].as_str().expect("base filename");
    fs::write(profile_dir.join(file), b"tampered").expect("tamper should write");
    assert!(sync(&engine, &provider, &local).await.is_err());
}

#[tokio::test(flavor = "current_thread")]
async fn base_metadata_for_another_profile_fails_closed() {
    let base = fixture();
    let (directory, engine, local, provider, profile) = setup(base, None);
    sync(&engine, &provider, &local).await.expect("seed base");
    let metadata_path = directory
        .0
        .join("sync")
        .join(profile.to_canonical_string())
        .join("base.json");
    let mut metadata: serde_json::Value =
        serde_json::from_slice(&fs::read(&metadata_path).expect("metadata should read"))
            .expect("metadata should parse");
    metadata["profile_id"] = serde_json::Value::String(ProfileId::random().to_canonical_string());
    fs::write(
        metadata_path,
        serde_json::to_vec(&metadata).expect("metadata should serialize"),
    )
    .expect("metadata should write");
    assert!(sync(&engine, &provider, &local).await.is_err());
}
