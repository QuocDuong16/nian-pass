use sync_provider_core::RemoteRevision;

use crate::{LocalSnapshot, SyncCompletion};

pub(crate) enum CommitRemote {
    Create,
    Replace,
    AlreadyCommitted(Vec<u8>),
}

pub(crate) struct CommitPlan {
    pub(crate) local_snapshot: LocalSnapshot,
    pub(crate) expected_remote: Option<RemoteRevision>,
    pub(crate) remote_action: CommitRemote,
    pub(crate) completion: SyncCompletion,
}

impl CommitPlan {
    pub(crate) const fn new(
        local_snapshot: LocalSnapshot,
        expected_remote: Option<RemoteRevision>,
        remote_action: CommitRemote,
        completion: SyncCompletion,
    ) -> Self {
        Self {
            local_snapshot,
            expected_remote,
            remote_action,
            completion,
        }
    }
}
