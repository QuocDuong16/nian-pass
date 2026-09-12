use credential_provider_core::ProviderError;
use vault_session::SessionError;

use crate::clipboard::ClipboardFailure;

/// Stable public failures. No variant carries a path, parser detail, or secret.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum DesktopError {
    AlreadyUnlocked,
    Locked,
    NoVaultSelected,
    UnlockFailed,
    UnsupportedVault,
    VaultCreateFailed,
    VaultAlreadyExists,
    EntryNotFound,
    GroupNotFound,
    InvalidRequest,
    InvalidMove,
    ReservedField,
    SecretUnavailable,
    UnsavedChanges,
    SaveFailed,
    SaveAuthenticationFailed,
    SaveUncertain,
    UnsupportedWriteFormat,
    UnsupportedPersistencePlatform,
    ReadOnlySource,
    ExternalChange,
    ReloadFailed,
    ClipboardFailed,
    Internal,
    OperationInProgress,
    SyncFailed,
    SyncRemoteChanged,
    SyncLocalChanged,
    SyncLocalChangedDuringRecovery,
    SyncRecoveryRequired,
    SyncStateUnsupported,
    SyncStateCorrupt,
    SyncUnsupportedProvider,
    SyncUnsafeProvider,
    SyncCredentialsRequired,
}

pub(crate) fn map_mutation_error(error: SessionError) -> DesktopError {
    if error.is_entry_not_found() {
        DesktopError::EntryNotFound
    } else if error.is_group_not_found() {
        DesktopError::GroupNotFound
    } else if error.is_invalid_group_operation() {
        DesktopError::InvalidMove
    } else if error.is_reserved_field() {
        DesktopError::ReservedField
    } else {
        DesktopError::Internal
    }
}

pub(super) fn map_create_error(error: SessionError) -> DesktopError {
    match error {
        SessionError::CreateTarget(source)
            if source.kind() == std::io::ErrorKind::AlreadyExists =>
        {
            DesktopError::VaultAlreadyExists
        }
        SessionError::UnsupportedPersistencePlatform => {
            DesktopError::UnsupportedPersistencePlatform
        }
        SessionError::Kdbx(kdbx::KdbxError::UnsupportedWriteFormat) => {
            DesktopError::UnsupportedWriteFormat
        }
        _ => DesktopError::VaultCreateFailed,
    }
}

pub(super) fn map_save_error(error: SessionError) -> DesktopError {
    match error {
        SessionError::ExternalModificationDetected
        | SessionError::FinalExternalModificationDetected
        | SessionError::UnsupportedPath
        | SessionError::ReadSource(_) => DesktopError::ExternalChange,
        SessionError::CredentialMismatch => DesktopError::SaveAuthenticationFailed,
        SessionError::UnsupportedPersistencePlatform => {
            DesktopError::UnsupportedPersistencePlatform
        }
        SessionError::Kdbx(kdbx::KdbxError::UnsupportedWriteFormat) => {
            DesktopError::UnsupportedWriteFormat
        }
        SessionError::FinalVerificationFailed(_)
        | SessionError::FinalReadFailed(_)
        | SessionError::SavedButBackupUpdateFailed(_)
        | SessionError::SavedButBackupDurabilityUncertain(_)
        | SessionError::DurabilityUncertain(_) => DesktopError::SaveUncertain,
        _ => DesktopError::SaveFailed,
    }
}

pub(super) fn map_open_error(error: SessionError) -> DesktopError {
    if error.is_open_credential_rejected() {
        DesktopError::UnlockFailed
    } else if error.is_unsupported_open_target() {
        DesktopError::UnsupportedVault
    } else {
        DesktopError::Internal
    }
}

pub(super) fn map_clipboard_error(_error: ClipboardFailure) -> DesktopError {
    DesktopError::ClipboardFailed
}

pub(super) fn map_provider_error(error: ProviderError) -> DesktopError {
    match error {
        ProviderError::InvalidTarget => DesktopError::InvalidRequest,
        ProviderError::CredentialUnavailable => DesktopError::SecretUnavailable,
        ProviderError::Internal => DesktopError::Internal,
    }
}

#[cfg(test)]
mod tests {
    use credential_provider_core::ProviderError;
    use kdbx::KdbxError;
    use vault_session::SessionError;

    use super::{
        DesktopError, map_clipboard_error, map_create_error, map_mutation_error, map_open_error,
        map_provider_error, map_save_error,
    };
    use crate::clipboard::ClipboardFailure;

    #[test]
    fn all_stable_error_mappers_are_secret_free_and_specific() {
        for (error, expected) in [
            (
                SessionError::Kdbx(KdbxError::EntryNotFound),
                DesktopError::EntryNotFound,
            ),
            (
                SessionError::Kdbx(KdbxError::GroupNotFound),
                DesktopError::GroupNotFound,
            ),
            (
                SessionError::Kdbx(KdbxError::InvalidGroupMove),
                DesktopError::InvalidMove,
            ),
            (
                SessionError::Kdbx(KdbxError::ReservedField),
                DesktopError::ReservedField,
            ),
            (
                SessionError::Kdbx(KdbxError::InvalidKdbx),
                DesktopError::Internal,
            ),
        ] {
            assert_eq!(map_mutation_error(error), expected);
        }
        assert_eq!(
            map_create_error(SessionError::CreateTarget(std::io::Error::new(
                std::io::ErrorKind::AlreadyExists,
                "synthetic",
            ))),
            DesktopError::VaultAlreadyExists
        );
        assert_eq!(
            map_create_error(SessionError::UnsupportedPersistencePlatform),
            DesktopError::UnsupportedPersistencePlatform
        );
        assert_eq!(
            map_create_error(SessionError::Kdbx(KdbxError::UnsupportedWriteFormat)),
            DesktopError::UnsupportedWriteFormat
        );
        assert_eq!(
            map_create_error(SessionError::CreateTarget(std::io::Error::other(
                "synthetic"
            ))),
            DesktopError::VaultCreateFailed
        );
        assert_eq!(
            map_save_error(SessionError::UnsupportedPersistencePlatform),
            DesktopError::UnsupportedPersistencePlatform
        );
        assert_eq!(
            map_save_error(SessionError::Kdbx(KdbxError::UnsupportedWriteFormat)),
            DesktopError::UnsupportedWriteFormat
        );
        assert_eq!(
            map_save_error(SessionError::CredentialMismatch),
            DesktopError::SaveAuthenticationFailed
        );
        assert_eq!(
            map_save_error(SessionError::ExternalModificationDetected),
            DesktopError::ExternalChange
        );
        assert_eq!(
            map_save_error(SessionError::FinalReadFailed(std::io::Error::other(
                "synthetic",
            ))),
            DesktopError::SaveUncertain
        );
        assert_eq!(
            map_open_error(SessionError::Kdbx(KdbxError::InvalidKdbx)),
            DesktopError::UnsupportedVault
        );
        assert_eq!(
            map_open_error(SessionError::AtomicReplaceFailed(std::io::Error::other(
                "synthetic",
            ))),
            DesktopError::Internal
        );
        assert_eq!(
            map_clipboard_error(ClipboardFailure::Unavailable),
            DesktopError::ClipboardFailed
        );
        assert_eq!(
            map_provider_error(ProviderError::InvalidTarget),
            DesktopError::InvalidRequest
        );
        assert_eq!(
            map_provider_error(ProviderError::CredentialUnavailable),
            DesktopError::SecretUnavailable
        );
        assert_eq!(
            map_provider_error(ProviderError::Internal),
            DesktopError::Internal
        );
    }
}
