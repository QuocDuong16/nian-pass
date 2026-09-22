use serde::Serialize;

use super::VaultSnapshotDto;

#[derive(Clone, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DatabaseMetadataDto {
    pub name: String,
    pub description: String,
    pub default_username: String,
}

#[derive(Clone, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HistoryPolicyDto {
    pub max_items: Option<usize>,
    pub maximum_editable_items: usize,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HistoryPolicyUpdateReceiptDto {
    pub policy: HistoryPolicyDto,
    pub snapshot: VaultSnapshotDto,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DatabaseMetadataUpdateReceiptDto {
    pub metadata: DatabaseMetadataDto,
    pub snapshot: VaultSnapshotDto,
}

impl From<kdbx::DatabaseMetadata> for DatabaseMetadataDto {
    fn from(value: kdbx::DatabaseMetadata) -> Self {
        Self {
            name: value.name().to_owned(),
            description: value.description().to_owned(),
            default_username: value.default_username().to_owned(),
        }
    }
}
