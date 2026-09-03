use sync_provider_core::ProviderError;
use thiserror::Error;
use vault_sync::MergeError;

use crate::{LocalCommitError, StoreError};

/// Stable orchestration failure.
#[derive(Debug, Error)]
#[non_exhaustive]
pub enum SyncError {
    #[error("the provider request failed")]
    Provider(#[source] ProviderError),
    #[error("synchronization metadata failed")]
    Store(#[source] StoreError),
    #[error("the local vault operation failed")]
    Local(#[source] LocalCommitError),
    #[error("the vault generations could not be merged safely")]
    Merge(#[source] MergeError),
    #[error("the master password was rejected")]
    VaultAuthenticationFailed,
    #[error("a synchronized generation is not a supported KDBX vault")]
    InvalidVault,
    #[error("the remote vault changed; synchronize again")]
    RemoteChanged,
    #[error("the local vault changed; synchronize again")]
    LocalChanged,
    #[error("local vault changed while sync recovery was pending")]
    LocalChangedDuringRecovery,
    #[error("sync state is uncertain and requires recovery")]
    UncertainState,
    #[error("the conflict operation is stale or already consumed")]
    StaleConflict,
    #[error("the synchronization service failed")]
    Internal,
}

impl From<ProviderError> for SyncError {
    fn from(error: ProviderError) -> Self {
        match error {
            ProviderError::RemoteChanged => Self::RemoteChanged,
            other => Self::Provider(other),
        }
    }
}

impl From<StoreError> for SyncError {
    fn from(error: StoreError) -> Self {
        Self::Store(error)
    }
}

impl From<LocalCommitError> for SyncError {
    fn from(error: LocalCommitError) -> Self {
        Self::Local(error)
    }
}

impl From<MergeError> for SyncError {
    fn from(error: MergeError) -> Self {
        Self::Merge(error)
    }
}

#[cfg(test)]
mod tests {
    use sync_provider_core::ProviderError;
    use vault_sync::MergeError;

    use super::SyncError;

    #[test]
    fn source_errors_preserve_remote_change_and_merge_categories() {
        assert!(matches!(
            SyncError::from(ProviderError::RemoteChanged),
            SyncError::RemoteChanged
        ));
        assert!(matches!(
            SyncError::from(ProviderError::AuthenticationFailed),
            SyncError::Provider(ProviderError::AuthenticationFailed)
        ));
        assert!(matches!(
            SyncError::from(MergeError::UnsupportedVersion),
            SyncError::Merge(MergeError::UnsupportedVersion)
        ));
    }
}
