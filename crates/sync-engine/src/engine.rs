use sync_provider_core::{CiphertextDigest, ProviderError, RemoteObjectProvider, RemoteRead};
use vault_core::SecretString;
use vault_sync::MergeOutcome;

use crate::{
    ConflictChoice, ConflictOperation, LocalSnapshot, LocalVault, SyncError, SyncStore,
    codec::{open_document, serialize_verified},
    commit::{CommitPlan, CommitRemote},
    conflict::describe,
    conflict_authority::ConflictAuthority,
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
    conflict_authority: ConflictAuthority,
}

impl SyncEngine {
    /// Creates an engine for one already source-bound profile.
    #[must_use]
    pub fn new(store: SyncStore) -> Self {
        Self {
            store,
            conflict_authority: ConflictAuthority::new(),
        }
    }

    /// Performs one explicit BASE/LOCAL/REMOTE synchronization attempt.
    pub async fn sync<P: RemoteObjectProvider, L: LocalVault>(
        &self,
        provider: &P,
        local: &L,
        master_password: SecretString,
    ) -> Result<SyncOutcome, SyncError> {
        self.conflict_authority.invalidate_pending_conflict()?;
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
                    self.conflict_authority
                        .install(
                            local_snapshot,
                            remote_bytes,
                            remote_revision,
                            None,
                            true,
                            Vec::new(),
                        )
                        .map(SyncOutcome::Conflict)
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
        let pending = self.conflict_authority.take(conflict_operation_id)?;

        self.require_base_unchanged(pending.base_digest.as_ref())?;
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
                self.conflict_authority
                    .install(
                        local_snapshot,
                        remote_bytes,
                        remote_revision,
                        Some(base.digest),
                        false,
                        descriptors,
                    )
                    .map(SyncOutcome::Conflict)
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

    fn require_base_unchanged(
        &self,
        expected_digest: Option<&CiphertextDigest>,
    ) -> Result<(), SyncError> {
        let current = self.store.load_base()?;
        match (expected_digest, current) {
            (None, None) => Ok(()),
            (Some(expected), Some(base)) if expected == &base.digest => Ok(()),
            _ => Err(SyncError::StaleConflict),
        }
    }
}
