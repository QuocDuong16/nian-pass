use serde::Serialize;

/// Filename metadata returned after a native vault-file selection.
#[derive(Clone, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SelectedVaultDto {
    pub file_name: String,
}

/// Filename-only receipt for a native keyfile selection. Keyfile contents and
/// its filesystem path remain entirely on the Rust side.
#[derive(Clone, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SelectedKeyfileDto {
    pub file_name: String,
}
