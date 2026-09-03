use std::{
    fs,
    io::Cursor,
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
};

use kdbx::KdbxDocument;
use sync_engine::{
    LocalCommitError, LocalSnapshot, LocalVault, ProfileId, SourceBinding, SyncCompletion,
    SyncEngine, SyncError, SyncOutcome, SyncStore,
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

    fn externally_replace(&self, ciphertext: Vec<u8>) {
        let mut state = self.state.lock().expect("remote lock");
        state.object = Some(ciphertext);
        state.revision += 1;
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
        state.authority = "session-after-save".to_owned();
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
    let store =
        SyncStore::open(&directory.0, profile, source("source-a")).expect("store should open");
    (
        directory,
        SyncEngine::new(store),
        Arc::new(FakeLocal::new(local_bytes)),
        Arc::new(FakeProvider::new(remote_bytes)),
        profile,
    )
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
        "schema_version": 1,
        "profile_id": profile.to_canonical_string(),
        "source": source("source-a").as_str(),
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

async fn sync(
    engine: &SyncEngine,
    provider: &FakeProvider,
    local: &FakeLocal,
) -> Result<SyncOutcome, SyncError> {
    engine
        .sync(provider, local, SecretString::new(PASSWORD.to_owned()))
        .await
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
