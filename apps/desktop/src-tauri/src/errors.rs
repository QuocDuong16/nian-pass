use serde::Serialize;

use crate::state::DesktopError;

#[derive(Serialize)]
#[serde(rename_all = "snake_case")]
enum DesktopErrorCode {
    AlreadyUnlocked,
    Locked,
    NoVaultSelected,
    UnlockFailed,
    UnsupportedVault,
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

/// Stable IPC error payload without dependency, path, or secret details.
#[derive(Serialize)]
pub struct DesktopErrorDto {
    code: DesktopErrorCode,
}

impl From<DesktopError> for DesktopErrorDto {
    fn from(value: DesktopError) -> Self {
        let code = match value {
            DesktopError::AlreadyUnlocked => DesktopErrorCode::AlreadyUnlocked,
            DesktopError::Locked => DesktopErrorCode::Locked,
            DesktopError::NoVaultSelected => DesktopErrorCode::NoVaultSelected,
            DesktopError::UnlockFailed => DesktopErrorCode::UnlockFailed,
            DesktopError::UnsupportedVault => DesktopErrorCode::UnsupportedVault,
            DesktopError::EntryNotFound => DesktopErrorCode::EntryNotFound,
            DesktopError::GroupNotFound => DesktopErrorCode::GroupNotFound,
            DesktopError::InvalidRequest => DesktopErrorCode::InvalidRequest,
            DesktopError::InvalidMove => DesktopErrorCode::InvalidMove,
            DesktopError::ReservedField => DesktopErrorCode::ReservedField,
            DesktopError::SecretUnavailable => DesktopErrorCode::SecretUnavailable,
            DesktopError::UnsavedChanges => DesktopErrorCode::UnsavedChanges,
            DesktopError::SaveFailed => DesktopErrorCode::SaveFailed,
            DesktopError::SaveAuthenticationFailed => DesktopErrorCode::SaveAuthenticationFailed,
            DesktopError::SaveUncertain => DesktopErrorCode::SaveUncertain,
            DesktopError::ExternalChange => DesktopErrorCode::ExternalChange,
            DesktopError::ReloadFailed => DesktopErrorCode::ReloadFailed,
            DesktopError::ClipboardFailed => DesktopErrorCode::ClipboardFailed,
            DesktopError::Internal => DesktopErrorCode::Internal,
            DesktopError::OperationInProgress => DesktopErrorCode::OperationInProgress,
            DesktopError::SyncFailed => DesktopErrorCode::SyncFailed,
            DesktopError::SyncRemoteChanged => DesktopErrorCode::SyncRemoteChanged,
            DesktopError::SyncLocalChanged => DesktopErrorCode::SyncLocalChanged,
            DesktopError::SyncLocalChangedDuringRecovery => {
                DesktopErrorCode::SyncLocalChangedDuringRecovery
            }
            DesktopError::SyncRecoveryRequired => DesktopErrorCode::SyncRecoveryRequired,
            DesktopError::SyncStateUnsupported => DesktopErrorCode::SyncStateUnsupported,
            DesktopError::SyncStateCorrupt => DesktopErrorCode::SyncStateCorrupt,
            DesktopError::SyncUnsupportedProvider => DesktopErrorCode::SyncUnsupportedProvider,
            DesktopError::SyncUnsafeProvider => DesktopErrorCode::SyncUnsafeProvider,
            DesktopError::SyncCredentialsRequired => DesktopErrorCode::SyncCredentialsRequired,
        };
        Self { code }
    }
}
