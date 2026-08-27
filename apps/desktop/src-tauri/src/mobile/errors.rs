#![cfg_attr(not(target_os = "android"), allow(dead_code))]

use serde::Serialize;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum MobileError {
    PickerFailed,
    NoVaultSelected,
    UnlockFailed,
    UnsupportedVault,
    EntryNotFound,
    GroupNotFound,
    InvalidRequest,
    Conflict,
    SecretUnavailable,
    Locked,
    UnsavedChanges,
    Busy,
    SaveFailed,
    SaveAuthenticationFailed,
    ExternalChange,
    SaveUncertain,
    PersistenceUnsupported,
    RecoveryRequired,
    ReloadFailed,
    ReloadAuthenticationFailed,
    Internal,
}

#[derive(Serialize)]
#[serde(rename_all = "snake_case")]
enum MobileErrorCode {
    PickerFailed,
    NoVaultSelected,
    UnlockFailed,
    UnsupportedVault,
    EntryNotFound,
    GroupNotFound,
    InvalidRequest,
    Conflict,
    SecretUnavailable,
    Locked,
    UnsavedChanges,
    Busy,
    SaveFailed,
    SaveAuthenticationFailed,
    ExternalChange,
    SaveUncertain,
    PersistenceUnsupported,
    RecoveryRequired,
    ReloadFailed,
    ReloadAuthenticationFailed,
    Internal,
}

/// Stable mobile IPC error payload. Native and parser details stay private.
#[derive(Serialize)]
pub(crate) struct MobileErrorDto {
    code: MobileErrorCode,
}

impl From<MobileError> for MobileErrorDto {
    fn from(value: MobileError) -> Self {
        let code = match value {
            MobileError::PickerFailed => MobileErrorCode::PickerFailed,
            MobileError::NoVaultSelected => MobileErrorCode::NoVaultSelected,
            MobileError::UnlockFailed => MobileErrorCode::UnlockFailed,
            MobileError::UnsupportedVault => MobileErrorCode::UnsupportedVault,
            MobileError::EntryNotFound => MobileErrorCode::EntryNotFound,
            MobileError::GroupNotFound => MobileErrorCode::GroupNotFound,
            MobileError::InvalidRequest => MobileErrorCode::InvalidRequest,
            MobileError::Conflict => MobileErrorCode::Conflict,
            MobileError::SecretUnavailable => MobileErrorCode::SecretUnavailable,
            MobileError::Locked => MobileErrorCode::Locked,
            MobileError::UnsavedChanges => MobileErrorCode::UnsavedChanges,
            MobileError::Busy => MobileErrorCode::Busy,
            MobileError::SaveFailed => MobileErrorCode::SaveFailed,
            MobileError::SaveAuthenticationFailed => MobileErrorCode::SaveAuthenticationFailed,
            MobileError::ExternalChange => MobileErrorCode::ExternalChange,
            MobileError::SaveUncertain => MobileErrorCode::SaveUncertain,
            MobileError::PersistenceUnsupported => MobileErrorCode::PersistenceUnsupported,
            MobileError::RecoveryRequired => MobileErrorCode::RecoveryRequired,
            MobileError::ReloadFailed => MobileErrorCode::ReloadFailed,
            MobileError::ReloadAuthenticationFailed => MobileErrorCode::ReloadAuthenticationFailed,
            MobileError::Internal => MobileErrorCode::Internal,
        };
        Self { code }
    }
}
