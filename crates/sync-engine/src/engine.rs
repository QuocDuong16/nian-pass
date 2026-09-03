use std::sync::Mutex;

use sync_provider_core::{
    CiphertextDigest, ProviderError, RemoteObjectProvider, RemoteRead, RemoteRevision,
};
use uuid::Uuid;
use vault_core::SecretString;
use vault_sync::MergeOutcome;

use crate::{
    ConflictChoice, ConflictDescriptor, ConflictOperation, LocalSnapshot, LocalVault, SyncError,
    SyncStore,
    codec::{open_document, serialize_verified},
    commit::{CommitPlan, CommitRemote},
    conflict::describe,
    store::BaseState,
};

/// Successfully proven synchronization path.
#[derive(Clone, Copy, Eq, PartialEq)]
pub enum SyncCompletion {
    CreatedRemote,
    EstablishedBase,
    Equivalent,
    UploadedLocal,
    AppliedRemote,
    Merged,
    Recovered,
}

/// User-triggered sync result.
pub enum SyncOutcome {
    Done(SyncCompletion),
    Conflict(ConflictOperation),
}

/// One profile-scoped engine with at most one pending process-local conflict.
pub struct SyncEngine {
    pub(crate) store: SyncStore,
    pending_conflict: Mutex<Option<PendingConflict>>,
}

impl SyncEngine {
    /// Creates an engine for one already source-bound profile.
    #[must_use]
    pub fn new(store: SyncStore) -> Self {
        Self {
            store,
            pending_conflict: Mutex::new(None),
        }
    }

    /// Performs one explicit BASE/LOCAL/REMOTE synchronization attempt.
    pub async fn sync<P: RemoteObjectProvider, L: LocalVault>(
        &self,
        provider: &P,
        local: &L,
        master_password: SecretString,
    ) -> Result<SyncOutcome, SyncError> {
        let local_snapshot = local.capture_clean()?;
        if self
            .recover_loaded(provider, local, &master_password, &local_snapshot)
            .await?
        {
            return Ok(SyncOutcome::Done(SyncCompletion::Recovered));
        }

        let base = self.store.load_base()?;
        let remote = provider.read().await?;
        match (base, remote) {
            (None, RemoteRead::Missing) => {
                self.commit_candidate(
                    provider,
                    local,
                    &master_password,
                    CommitPlan::new(
                        local_snapshot,
                        None,
                        CommitRemote::Create,
                        SyncCompletion::CreatedRemote,
                    ),
                )
                .await
            }
            (None, RemoteRead::Present(remote)) => {
                let (remote_bytes, remote_revision) = remote.into_parts();
                let local_document = open_document(local_snapshot.ciphertext(), &master_password)?;
                let remote_document = open_document(&remote_bytes, &master_password)?;
                if local_document.semantically_equals(&remote_document) {
                    self.require_local_unchanged(local, &local_snapshot)?;
                    self.store.write_base(&remote_bytes, remote_revision)?;
                    Ok(SyncOutcome::Done(SyncCompletion::EstablishedBase))
                } else {
                    self.install_conflict(
                        local_snapshot,
                        remote_bytes,
                        remote_revision,
                        None,
                        true,
                        Vec::new(),
                    )
                }
            }
            (Some(_), RemoteRead::Missing) => Err(SyncError::RemoteChanged),
            (Some(base), RemoteRead::Present(remote)) => {
                self.merge_existing(
                    provider,
                    local,
                    &master_password,
                    local_snapshot,
                    base,
                    remote,
                )
                .await
            }
        }
    }

    /// Consumes one exact conflict token and applies an explicit whole-vault choice.
    pub async fn resolve<P: RemoteObjectProvider, L: LocalVault>(
        &self,
        conflict_operation_id: &str,
        choice: ConflictChoice,
        provider: &P,
        local: &L,
        master_password: SecretString,
    ) -> Result<SyncOutcome, SyncError> {
        let pending = {
            let mut slot = self
                .pending_conflict
                .lock()
                .map_err(|_| SyncError::Internal)?;
            let Some(pending) = slot.as_ref() else {
                return Err(SyncError::StaleConflict);
            };
            if pending.operation.id() != conflict_operation_id {
                return Err(SyncError::StaleConflict);
            }
            slot.take().ok_or(SyncError::StaleConflict)?
        };

        self.require_local_unchanged(local, &pending.local)?;
        let remote = match provider.read().await? {
            RemoteRead::Present(remote) if remote.revision() == &pending.remote_revision => remote,
            _ => return Err(SyncError::RemoteChanged),
        };
        if CiphertextDigest::of(remote.ciphertext()) != pending.remote_digest {
            return Err(SyncError::RemoteChanged);
        }

        match choice {
            ConflictChoice::KeepLocal => {
                self.commit_candidate(
                    provider,
                    local,
                    &master_password,
                    CommitPlan::new(
                        pending.local,
                        Some(pending.remote_revision),
                        CommitRemote::Replace,
                        SyncCompletion::UploadedLocal,
                    ),
                )
                .await
            }
            ConflictChoice::KeepRemote => {
                self.commit_candidate(
                    provider,
                    local,
                    &master_password,
                    CommitPlan::new(
                        pending.local,
                        Some(pending.remote_revision),
                        CommitRemote::AlreadyCommitted(pending.remote_bytes),
                        SyncCompletion::AppliedRemote,
                    ),
                )
                .await
            }
        }
    }

    async fn merge_existing<P: RemoteObjectProvider, L: LocalVault>(
        &self,
        provider: &P,
        local: &L,
        password: &SecretString,
        local_snapshot: LocalSnapshot,
        base: BaseState,
        remote: sync_provider_core::RemoteObject,
    ) -> Result<SyncOutcome, SyncError> {
        let (remote_bytes, remote_revision) = remote.into_parts();
        let base_document = open_document(&base.ciphertext, password)?;
        let local_document = open_document(local_snapshot.ciphertext(), password)?;
        let remote_document = open_document(&remote_bytes, password)?;
        match vault_sync::merge(&base_document, &local_document, &remote_document)? {
            MergeOutcome::Equivalent => {
                self.require_local_unchanged(local, &local_snapshot)?;
                self.store.write_base(&remote_bytes, remote_revision)?;
                Ok(SyncOutcome::Done(SyncCompletion::Equivalent))
            }
            MergeOutcome::FastForwardLocal => {
                self.commit_candidate(
                    provider,
                    local,
                    password,
                    CommitPlan::new(
                        local_snapshot,
                        Some(remote_revision),
                        CommitRemote::Replace,
                        SyncCompletion::UploadedLocal,
                    ),
                )
                .await
            }
            MergeOutcome::FastForwardRemote => {
                self.commit_candidate(
                    provider,
                    local,
                    password,
                    CommitPlan::new(
                        local_snapshot,
                        Some(remote_revision),
                        CommitRemote::AlreadyCommitted(remote_bytes),
                        SyncCompletion::AppliedRemote,
                    ),
                )
                .await
            }
            MergeOutcome::Merged(merged) => {
                let candidate = serialize_verified(merged.document(), password)?;
                self.commit_candidate_bytes(
                    provider,
                    local,
                    password,
                    candidate,
                    CommitPlan::new(
                        local_snapshot,
                        Some(remote_revision),
                        CommitRemote::Replace,
                        SyncCompletion::Merged,
                    ),
                )
                .await
            }
            MergeOutcome::Conflicted(conflicts) => {
                let descriptors = conflicts.iter().map(describe).collect();
                self.install_conflict(
                    local_snapshot,
                    remote_bytes,
                    remote_revision,
                    Some(base.digest),
                    false,
                    descriptors,
                )
            }
        }
    }

    async fn commit_candidate<P: RemoteObjectProvider, L: LocalVault>(
        &self,
        provider: &P,
        local: &L,
        password: &SecretString,
        plan: CommitPlan,
    ) -> Result<SyncOutcome, SyncError> {
        let candidate = match &plan.remote_action {
            CommitRemote::AlreadyCommitted(bytes) => bytes.clone(),
            CommitRemote::Create | CommitRemote::Replace => {
                plan.local_snapshot.ciphertext().to_vec()
            }
        };
        open_document(&candidate, password)?;
        self.commit_candidate_bytes(provider, local, password, candidate, plan)
            .await
    }

    async fn commit_candidate_bytes<P: RemoteObjectProvider, L: LocalVault>(
        &self,
        provider: &P,
        local: &L,
        password: &SecretString,
        candidate: Vec<u8>,
        plan: CommitPlan,
    ) -> Result<SyncOutcome, SyncError> {
        let CommitPlan {
            local_snapshot,
            expected_remote,
            remote_action,
            completion,
        } = plan;
        let mut journal =
            self.store
                .prepare_journal(&local_snapshot, expected_remote.clone(), &candidate)?;
        let remote_revision = match remote_action {
            CommitRemote::Create => provider.create_if_absent(&candidate).await,
            CommitRemote::Replace => {
                provider
                    .replace_if_revision(
                        expected_remote.as_ref().ok_or(SyncError::Internal)?,
                        &candidate,
                    )
                    .await
            }
            CommitRemote::AlreadyCommitted(_) => Ok(expected_remote.ok_or(SyncError::Internal)?),
        };
        let remote_revision = match remote_revision {
            Ok(revision) => revision,
            Err(ProviderError::WriteResultUncertain) => {
                let current = local.capture_clean()?;
                if self
                    .recover_loaded(provider, local, password, &current)
                    .await?
                {
                    return Ok(SyncOutcome::Done(SyncCompletion::Recovered));
                }
                return Err(SyncError::RemoteChanged);
            }
            Err(ProviderError::RemoteChanged) => {
                // A CAS rejection proves that this candidate was not
                // committed. Discard it even if LOCAL also advanced; the next
                // explicit sync will capture both newer generations.
                self.store.remove_journal(&journal)?;
                return Err(SyncError::RemoteChanged);
            }
            Err(error) => return Err(SyncError::Provider(error)),
        };
        self.store
            .mark_remote_committed(&mut journal, remote_revision.clone())?;

        if candidate != local_snapshot.ciphertext() {
            local.replace_if_unchanged(&local_snapshot, &candidate, password)?;
        } else {
            self.require_local_unchanged(local, &local_snapshot)?;
        }
        self.store.mark_local_committed(&mut journal)?;
        self.store.write_base(&candidate, remote_revision)?;
        self.store.remove_journal(&journal)?;
        Ok(SyncOutcome::Done(completion))
    }

    fn require_local_unchanged<L: LocalVault>(
        &self,
        local: &L,
        expected: &LocalSnapshot,
    ) -> Result<(), SyncError> {
        let current = local.capture_clean()?;
        if current.source() == expected.source()
            && current.digest() == expected.digest()
            && current.authority_token() == expected.authority_token()
        {
            Ok(())
        } else {
            Err(SyncError::LocalChanged)
        }
    }

    fn install_conflict(
        &self,
        local: LocalSnapshot,
        remote_bytes: Vec<u8>,
        remote_revision: RemoteRevision,
        base_digest: Option<CiphertextDigest>,
        initial_conflict: bool,
        conflicts: Vec<ConflictDescriptor>,
    ) -> Result<SyncOutcome, SyncError> {
        let operation = ConflictOperation {
            conflict_operation_id: Uuid::new_v4().hyphenated().to_string(),
            initial_conflict,
            conflicts,
        };
        let pending = PendingConflict {
            operation: operation.clone(),
            local,
            remote_digest: CiphertextDigest::of(&remote_bytes),
            remote_bytes,
            remote_revision,
            _base_digest: base_digest,
        };
        let mut slot = self
            .pending_conflict
            .lock()
            .map_err(|_| SyncError::Internal)?;
        *slot = Some(pending);
        Ok(SyncOutcome::Conflict(operation))
    }
}

struct PendingConflict {
    operation: ConflictOperation,
    local: LocalSnapshot,
    remote_bytes: Vec<u8>,
    remote_digest: CiphertextDigest,
    remote_revision: RemoteRevision,
    _base_digest: Option<CiphertextDigest>,
}
