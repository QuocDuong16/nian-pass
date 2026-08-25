use keepass::db::fields;
use vault_core::{EntryId, SecretString};

use crate::{KdbxDocument, KdbxError};

impl KdbxDocument {
    /// Fetches one entry title explicitly, including protected titles.
    pub fn entry_title(&self, id: &EntryId) -> Result<Option<SecretString>, KdbxError> {
        self.entry_secret(id, fields::TITLE)
    }

    /// Fetches one entry username by stable identifier as a secret-bearing value.
    ///
    /// This narrow read handles visible and protected storage identically without
    /// adding plaintext to the bulk projection. Missing and empty stay distinct.
    pub fn entry_username(&self, id: &EntryId) -> Result<Option<SecretString>, KdbxError> {
        self.entry_secret(id, fields::USERNAME)
    }

    /// Fetches one entry URL explicitly, including protected URLs.
    pub fn entry_url(&self, id: &EntryId) -> Result<Option<SecretString>, KdbxError> {
        self.entry_secret(id, fields::URL)
    }

    /// Fetches one entry password by stable identifier.
    ///
    /// A missing field remains distinct from an explicitly empty field. The
    /// returned owned copy is wrapped immediately in [`SecretString`]. No entry
    /// metadata or secret plaintext is included in errors.
    pub fn entry_password(&self, id: &EntryId) -> Result<Option<SecretString>, KdbxError> {
        self.entry_secret(id, fields::PASSWORD)
    }

    /// Fetches one entry's notes by stable identifier as a secret-bearing value.
    ///
    /// Notes may contain recovery codes or other credentials and are therefore
    /// excluded from the bulk projection. Missing and explicitly empty fields
    /// remain distinct.
    pub fn entry_notes(&self, id: &EntryId) -> Result<Option<SecretString>, KdbxError> {
        self.entry_secret(id, fields::NOTES)
    }

    pub(super) fn entry_secret(
        &self,
        id: &EntryId,
        field: &str,
    ) -> Result<Option<SecretString>, KdbxError> {
        let upstream_id = self.find_entry_id(id)?;
        let entry = self
            .database
            .entry(upstream_id)
            .ok_or(KdbxError::EntryNotFound)?;

        Ok(entry
            .fields
            .get(field)
            .map(|value| SecretString::new(value.get().to_owned())))
    }
}
