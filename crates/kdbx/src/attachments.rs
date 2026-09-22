use keepass::db::Value;
use vault_core::{EntryId, SecretBytes};

use crate::{KdbxDocument, KdbxError};

/// Secret-free metadata for one entry attachment.
pub struct EntryAttachmentSummary {
    name: String,
    size_bytes: u64,
    protected: bool,
}

impl EntryAttachmentSummary {
    #[must_use]
    pub fn name(&self) -> &str {
        &self.name
    }

    #[must_use]
    pub const fn size_bytes(&self) -> u64 {
        self.size_bytes
    }

    #[must_use]
    pub const fn protected(&self) -> bool {
        self.protected
    }
}

impl KdbxDocument {
    /// Lists attachment metadata without copying attachment bytes.
    pub fn entry_attachments(
        &self,
        id: &EntryId,
    ) -> Result<Vec<EntryAttachmentSummary>, KdbxError> {
        let upstream_id = self.find_entry_id(id)?;
        let entry = self
            .database
            .entry(upstream_id)
            .ok_or(KdbxError::EntryNotFound)?;
        let mut attachments = entry
            .attachments_named()
            .map(|(name, attachment)| EntryAttachmentSummary {
                name: name.to_owned(),
                size_bytes: u64::try_from(attachment.data.get().len()).unwrap_or(u64::MAX),
                protected: attachment.data.is_protected(),
            })
            .collect::<Vec<_>>();
        attachments.sort_by(|left, right| left.name.cmp(&right.name));
        Ok(attachments)
    }

    /// Copies exactly one attachment into zeroizing binary storage for an explicit export.
    pub fn entry_attachment_bytes(
        &self,
        id: &EntryId,
        name: &str,
    ) -> Result<SecretBytes, KdbxError> {
        let upstream_id = self.find_entry_id(id)?;
        let entry = self
            .database
            .entry(upstream_id)
            .ok_or(KdbxError::EntryNotFound)?;
        let attachment = entry
            .attachment_by_name(name)
            .ok_or(KdbxError::AttachmentNotFound)?;
        Ok(SecretBytes::new(attachment.data.get().to_vec()))
    }

    /// Adds one protected attachment and records the previous entry state in history.
    /// Existing names are rejected so replacement can never occur implicitly.
    pub fn add_entry_attachment(
        &mut self,
        id: &EntryId,
        name: &str,
        bytes: &SecretBytes,
    ) -> Result<(), KdbxError> {
        if name.is_empty() {
            return Err(KdbxError::InvalidAttachmentName);
        }
        let upstream_id = self.find_entry_id(id)?;
        let entry = self
            .database
            .entry(upstream_id)
            .ok_or(KdbxError::EntryNotFound)?;
        if entry.attachment_by_name(name).is_some() {
            return Err(KdbxError::AttachmentAlreadyExists);
        }

        {
            let mut entry = self
                .database
                .entry_mut(upstream_id)
                .ok_or(KdbxError::EntryNotFound)?;
            entry
                .track_changes()
                .add_attachment(name, Value::protected(bytes.expose_secret().to_vec()));
        }
        self.enforce_history_policy_for_entry(upstream_id)?;
        self.mark_changed();
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use vault_core::{EntryId, GroupId, NewEntry, SecretBytes};

    use super::KdbxDocument;
    use crate::KdbxError;

    fn document_with_entry() -> (KdbxDocument, EntryId) {
        let mut document = KdbxDocument::new("Attachment tests");
        let root = GroupId::new(document.database.root().id().to_string());
        let entry = document
            .create_entry(
                &root,
                NewEntry {
                    title: "Entry",
                    username: "",
                    url: "",
                    password: None,
                },
            )
            .expect("entry creation should succeed");
        (document, entry)
    }

    #[test]
    fn attachment_metadata_and_explicit_bytes_are_separate() {
        let (mut document, entry) = document_with_entry();
        let bytes = SecretBytes::new(vec![1, 2, 3, 4]);
        let before_revision = document.revision();
        document
            .add_entry_attachment(&entry, "private.bin", &bytes)
            .expect("attachment add should succeed");
        assert_eq!(document.revision(), before_revision + 1);

        let summaries = document
            .entry_attachments(&entry)
            .expect("attachment metadata should list");
        assert_eq!(summaries.len(), 1);
        assert_eq!(summaries[0].name(), "private.bin");
        assert_eq!(summaries[0].size_bytes(), 4);
        assert!(summaries[0].protected());
        assert_eq!(
            document
                .entry_attachment_bytes(&entry, "private.bin")
                .expect("explicit bytes should load")
                .expose_secret(),
            &[1, 2, 3, 4]
        );
    }

    #[test]
    fn attachment_add_tracks_history_and_rejects_implicit_replace() {
        let (mut document, entry) = document_with_entry();
        let bytes = SecretBytes::new(vec![5, 6, 7]);
        document
            .add_entry_attachment(&entry, "a.bin", &bytes)
            .expect("attachment add should succeed");
        let after_add = document.revision();
        assert!(matches!(
            document.add_entry_attachment(&entry, "a.bin", &bytes),
            Err(KdbxError::AttachmentAlreadyExists)
        ));
        assert_eq!(document.revision(), after_add);
        assert_eq!(
            document
                .entry_history(&entry)
                .expect("history should list")
                .items()
                .len(),
            1
        );
        assert_eq!(
            document
                .entry_attachment_bytes(&entry, "a.bin")
                .expect("attachment should remain after rejected replace")
                .expose_secret(),
            &[5, 6, 7]
        );
    }
}
