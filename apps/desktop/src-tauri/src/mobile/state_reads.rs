use kdbx::EntryTotpCode;
use vault_core::SecretString;

use crate::dto::{
    EntryAttachmentSummaryDto, EntryDetailDto, EntryHistoryDto, MobileVaultSnapshotDto,
};

use super::{
    MobileError,
    state::{MobileSecretKind, MobileVaultService},
};

impl MobileVaultService {
    pub(crate) fn snapshot(&self) -> Result<MobileVaultSnapshotDto, MobileError> {
        self.session.as_ref().ok_or(MobileError::Locked)?.snapshot()
    }

    pub(crate) fn entry_detail(&self, entry_id: &str) -> Result<EntryDetailDto, MobileError> {
        self.session
            .as_ref()
            .ok_or(MobileError::Locked)?
            .entry_detail(entry_id)
    }

    pub(crate) fn entry_history(&self, entry_id: &str) -> Result<EntryHistoryDto, MobileError> {
        self.session
            .as_ref()
            .ok_or(MobileError::Locked)?
            .entry_history(entry_id)
    }

    pub(crate) fn entry_attachments(
        &self,
        entry_id: &str,
    ) -> Result<Vec<EntryAttachmentSummaryDto>, MobileError> {
        self.session
            .as_ref()
            .ok_or(MobileError::Locked)?
            .entry_attachments(entry_id)
    }

    pub(crate) fn entry_totp_code(&self, entry_id: &str) -> Result<EntryTotpCode, MobileError> {
        self.session
            .as_ref()
            .ok_or(MobileError::Locked)?
            .entry_totp_code(entry_id)
    }

    pub(crate) fn entry_secret(
        &self,
        entry_id: &str,
        kind: MobileSecretKind,
    ) -> Result<SecretString, MobileError> {
        let session = self.session.as_ref().ok_or(MobileError::Locked)?;
        match kind {
            MobileSecretKind::Title => {
                session.entry_secret(entry_id, |document, id| document.entry_title(id))
            }
            MobileSecretKind::Username => {
                session.entry_secret(entry_id, |document, id| document.entry_username(id))
            }
            MobileSecretKind::Url => {
                session.entry_secret(entry_id, |document, id| document.entry_url(id))
            }
            MobileSecretKind::Notes => {
                session.entry_secret(entry_id, |document, id| document.entry_notes(id))
            }
        }
    }

    pub(crate) fn entry_custom_field(
        &self,
        entry_id: &str,
        name: &str,
    ) -> Result<SecretString, MobileError> {
        self.session
            .as_ref()
            .ok_or(MobileError::Locked)?
            .entry_custom_field(entry_id, name)
    }
}
