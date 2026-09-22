use serde::Serialize;

use super::SummaryTextDto;

/// Secret-free history list tied to one exact in-memory document revision.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EntryHistoryDto {
    pub document_revision: String,
    pub items: Vec<EntryHistoryItemDto>,
}

/// One historical entry revision. Secret-bearing values are represented only by presence.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EntryHistoryItemDto {
    pub index: usize,
    pub modified_at_unix_seconds: Option<i64>,
    pub title: SummaryTextDto,
    pub username: SummaryTextDto,
    pub url: SummaryTextDto,
    pub password_present: bool,
    pub notes_present: bool,
    pub totp_present: bool,
    pub tags: Vec<String>,
    pub expires_at_unix_seconds: Option<i64>,
    pub restorable: bool,
}

impl EntryHistoryDto {
    #[must_use]
    pub fn from_history(history: &kdbx::EntryHistory) -> Self {
        Self {
            document_revision: history.document_revision().to_string(),
            items: history
                .items()
                .iter()
                .map(|item| {
                    let summary = item.summary();
                    EntryHistoryItemDto {
                        index: item.index(),
                        modified_at_unix_seconds: item.modified_at_unix_seconds(),
                        title: summary.title().into(),
                        username: summary.username().into(),
                        url: summary.url().into(),
                        password_present: summary.has_password(),
                        notes_present: summary.has_notes(),
                        totp_present: summary.has_totp(),
                        tags: summary.tags().to_vec(),
                        expires_at_unix_seconds: summary.expires_at_unix_seconds(),
                        restorable: item.restorable(),
                    }
                })
                .collect(),
        }
    }
}
