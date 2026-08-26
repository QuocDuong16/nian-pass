use serde::Serialize;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum MobileError {
    PickerFailed,
    NoVaultSelected,
    UnlockFailed,
    UnsupportedVault,
    EntryNotFound,
    Locked,
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
    Locked,
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
            MobileError::Locked => MobileErrorCode::Locked,
            MobileError::Internal => MobileErrorCode::Internal,
        };
        Self { code }
    }
}
