use sync_provider_core::{CiphertextDigest, RemoteObjectProvider, RemoteRead};
use vault_core::SecretString;

use crate::{
    LocalSnapshot, LocalVault, SyncEngine, SyncError,
    codec::open_document,
    store::{JournalPhase, JournalRecord, LoadedJournal},
};

impl SyncEngine {
    pub(crate) async fn recover_loaded<P: RemoteObjectProvider, L: LocalVault>(
        &self,
        provider: &P,
        local: &L,
        password: &SecretString,
        current_local: &LocalSnapshot,
    ) -> Result<bool, SyncError> {
        let Some(LoadedJournal {
            mut record,
            candidate,
        }) = self.store.load_journal()?
        else {
            return Ok(false);
        };
        open_document(&candidate, password)?;
        let remote = provider.read().await?;
        let (remote_matches_candidate, remote_unchanged, current_revision) = match remote {
            RemoteRead::Missing => (false, record.expected_remote_revision.is_none(), None),
            RemoteRead::Present(remote) => (
                CiphertextDigest::of(remote.ciphertext()) == record.candidate_sha256,
                record
                    .expected_remote_revision
                    .as_ref()
                    .is_some_and(|expected| expected == remote.revision()),
                Some(remote.revision().clone()),
            ),
        };

        if record.phase == JournalPhase::Prepared {
            if remote_matches_candidate {
                self.store.mark_remote_committed(
                    &mut record,
                    current_revision.clone().ok_or(SyncError::UncertainState)?,
                )?;
            } else if remote_unchanged {
                if local_matches_persisted(current_local, &record) {
                    self.store.remove_journal(&record)?;
                    return Ok(false);
                }
                return Err(SyncError::LocalChangedDuringRecovery);
            } else {
                return Err(SyncError::UncertainState);
            }
        }

        if record.phase == JournalPhase::RemoteCommitted {
            if !remote_matches_candidate {
                return Err(SyncError::UncertainState);
            }
            if current_local.digest() != &record.candidate_sha256 {
                if !local_matches_persisted(current_local, &record) {
                    return Err(SyncError::LocalChangedDuringRecovery);
                }
                local.replace_if_unchanged(current_local, &candidate, password)?;
            }
            self.store.mark_local_committed(&mut record)?;
        }

        let refreshed = local.capture_clean()?;
        if refreshed.digest() != &record.candidate_sha256 || !remote_matches_candidate {
            return Err(SyncError::UncertainState);
        }
        let revision = current_revision
            .or(record.committed_remote_revision.clone())
            .ok_or(SyncError::UncertainState)?;
        self.store.write_base(&candidate, revision)?;
        self.store.remove_journal(&record)?;
        Ok(true)
    }
}

fn local_matches_persisted(local: &LocalSnapshot, journal: &JournalRecord) -> bool {
    local.source() == &journal.source && local.digest() == &journal.expected_local_sha256
}
