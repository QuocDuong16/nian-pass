#![cfg_attr(not(target_os = "android"), allow(dead_code))]

use serde::Serialize;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum MobileError {
    PickerFailed,
    #[cfg_attr(target_os = "android", allow(dead_code))]
    SourceUnavailable,
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
    AutofillUnavailable,
    #[cfg_attr(target_os = "android", allow(dead_code))]
    AutofillNotConfigured,
    #[cfg_attr(target_os = "android", allow(dead_code))]
    AutofillRefreshFailed,
    CredentialUnavailable,
    Internal,
}

#[derive(Serialize)]
#[serde(rename_all = "snake_case")]
enum MobileErrorCode {
    PickerFailed,
    SourceUnavailable,
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
    AutofillUnavailable,
    AutofillNotConfigured,
    AutofillRefreshFailed,
    CredentialUnavailable,
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
            MobileError::SourceUnavailable => MobileErrorCode::SourceUnavailable,
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
            MobileError::AutofillUnavailable => MobileErrorCode::AutofillUnavailable,
            MobileError::AutofillNotConfigured => MobileErrorCode::AutofillNotConfigured,
            MobileError::AutofillRefreshFailed => MobileErrorCode::AutofillRefreshFailed,
            MobileError::CredentialUnavailable => MobileErrorCode::CredentialUnavailable,
            MobileError::Internal => MobileErrorCode::Internal,
        };
        Self { code }
    }
}
