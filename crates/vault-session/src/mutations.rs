use kdbx::{EntryAttachmentSummary, EntryHistory, EntryTotpCode, KdbxError, PasswordHealthReport};
use vault_core::{
    EntryId, EntryUpdate, FieldProtection, GroupId, NewEntry, SecretBytes, SecretString,
};

use crate::{SessionError, VaultSession};

impl VaultSession {
    /// Returns whether recycle-bin operations are enabled by database policy.
    #[must_use]
    pub fn recycle_bin_enabled(&self) -> bool {
        self.document.recycle_bin_enabled()
    }

    /// Returns the stable recycle-bin group identifier when one currently exists.
    #[must_use]
    pub fn recycle_bin_group_id(&self) -> Option<GroupId> {
        self.document.recycle_bin_group_id()
    }

    /// Returns whether one group currently belongs to the recycle-bin subtree.
    pub fn group_is_recycled(&self, id: &GroupId) -> Result<bool, SessionError> {
        self.document
            .group_is_recycled(id)
            .map_err(SessionError::Kdbx)
    }

    /// Applies one atomic standard-field entry update in unlocked memory.
    pub fn update_entry(
        &mut self,
        id: &EntryId,
        update: EntryUpdate<'_>,
    ) -> Result<(), SessionError> {
        self.document
            .update_entry(id, update)
            .map_err(SessionError::Kdbx)
    }

    /// Replaces one entry's complete tag set as one tracked in-memory mutation.
    pub fn set_entry_tags(&mut self, id: &EntryId, tags: &[String]) -> Result<(), SessionError> {
        self.document
            .set_entry_tags(id, tags)
            .map_err(SessionError::Kdbx)
    }

    /// Creates one entry in unlocked memory and returns its stable identifier.
    pub fn create_entry(
        &mut self,
        group: &GroupId,
        input: NewEntry<'_>,
        notes: Option<&SecretString>,
    ) -> Result<EntryId, SessionError> {
        self.document
            .create_entry_with_notes(group, input, notes)
            .map_err(SessionError::Kdbx)
    }

    /// Duplicates one entry entirely inside the unlocked session.
    pub fn duplicate_entry(&mut self, id: &EntryId) -> Result<EntryId, SessionError> {
        self.document
            .duplicate_entry(id)
            .map_err(SessionError::Kdbx)
    }

    /// Generates one current TOTP code without exposing provisioning material.
    pub fn entry_totp_code(&self, id: &EntryId) -> Result<EntryTotpCode, SessionError> {
        self.document
            .entry_totp_code(id)
            .map_err(SessionError::Kdbx)
    }

    /// Builds one secret-free local password-health report for active entries.
    #[must_use]
    pub fn password_health_report(&self) -> PasswordHealthReport {
        self.document.password_health_report()
    }

    /// Lists secret-free historical revisions for one entry.
    pub fn entry_history(&self, id: &EntryId) -> Result<EntryHistory, SessionError> {
        self.document.entry_history(id).map_err(SessionError::Kdbx)
    }

    /// Restores one historical revision after exact document-revision revalidation.
    pub fn restore_entry_history(
        &mut self,
        id: &EntryId,
        history_index: usize,
        expected_document_revision: u64,
    ) -> Result<(), SessionError> {
        self.document
            .restore_entry_history(id, history_index, expected_document_revision)
            .map_err(SessionError::Kdbx)
    }

    /// Lists attachment metadata without returning attachment bytes.
    pub fn entry_attachments(
        &self,
        id: &EntryId,
    ) -> Result<Vec<EntryAttachmentSummary>, SessionError> {
        self.document
            .entry_attachments(id)
            .map_err(SessionError::Kdbx)
    }

    /// Loads one exact attachment into zeroizing binary storage for explicit native export.
    pub fn entry_attachment_bytes(
        &self,
        id: &EntryId,
        name: &str,
    ) -> Result<SecretBytes, SessionError> {
        self.document
            .entry_attachment_bytes(id, name)
            .map_err(SessionError::Kdbx)
    }

    /// Adds one protected attachment without implicitly replacing an existing name.
    pub fn add_entry_attachment(
        &mut self,
        id: &EntryId,
        name: &str,
        bytes: &SecretBytes,
    ) -> Result<(), SessionError> {
        self.document
            .add_entry_attachment(id, name, bytes)
            .map_err(SessionError::Kdbx)
    }

    /// Replaces one entry icon with a database-owned PNG custom icon.
    pub fn set_entry_custom_icon_png(
        &mut self,
        id: &EntryId,
        bytes: &SecretBytes,
    ) -> Result<(), SessionError> {
        self.document
            .set_entry_custom_icon_png(id, bytes)
            .map_err(SessionError::Kdbx)
    }

    /// Moves one entry into the database recycle bin.
    pub fn trash_entry(&mut self, id: &EntryId) -> Result<(), SessionError> {
        self.document.trash_entry(id).map_err(SessionError::Kdbx)
    }

    /// Restores one recycled entry and returns its selected destination group.
    pub fn restore_entry(&mut self, id: &EntryId) -> Result<GroupId, SessionError> {
        self.document.restore_entry(id).map_err(SessionError::Kdbx)
    }

    /// Permanently removes one entry that is already inside the recycle bin.
    pub fn permanently_delete_recycled_entry(&mut self, id: &EntryId) -> Result<(), SessionError> {
        self.document
            .permanently_delete_recycled_entry(id)
            .map_err(SessionError::Kdbx)
    }

    /// Permanently deletes one entry and records its tombstone in memory.
    pub fn permanently_delete_entry(&mut self, id: &EntryId) -> Result<(), SessionError> {
        self.document
            .permanently_delete_entry(id)
            .map_err(SessionError::Kdbx)
    }

    /// Moves one entry to a stable destination group in memory.
    pub fn move_entry(
        &mut self,
        entry: &EntryId,
        destination: &GroupId,
    ) -> Result<(), SessionError> {
        self.document
            .move_entry(entry, destination)
            .map_err(SessionError::Kdbx)
    }

    /// Moves multiple entries to one destination as a single in-memory document mutation.
    pub fn move_entries(
        &mut self,
        entries: &[EntryId],
        destination: &GroupId,
    ) -> Result<(), SessionError> {
        self.document
            .move_entries(entries, destination)
            .map_err(SessionError::Kdbx)
    }

    /// Moves multiple entries into the recycle bin as one atomic in-memory mutation.
    pub fn trash_entries(&mut self, entries: &[EntryId]) -> Result<(), SessionError> {
        self.document
            .trash_entries(entries)
            .map_err(SessionError::Kdbx)
    }

    /// Restores multiple recycled entries as one atomic in-memory mutation.
    pub fn restore_entries(&mut self, entries: &[EntryId]) -> Result<(), SessionError> {
        self.document
            .restore_entries(entries)
            .map_err(SessionError::Kdbx)
    }

    /// Permanently removes multiple recycled entries as one atomic in-memory mutation.
    pub fn permanently_delete_recycled_entries(
        &mut self,
        entries: &[EntryId],
    ) -> Result<(), SessionError> {
        self.document
            .permanently_delete_recycled_entries(entries)
            .map_err(SessionError::Kdbx)
    }

    /// Moves one group subtree into the database recycle bin.
    pub fn trash_group(&mut self, id: &GroupId) -> Result<(), SessionError> {
        self.document.trash_group(id).map_err(SessionError::Kdbx)
    }

    /// Restores one recycled group and returns its selected destination parent.
    pub fn restore_group(&mut self, id: &GroupId) -> Result<GroupId, SessionError> {
        self.document.restore_group(id).map_err(SessionError::Kdbx)
    }

    /// Permanently removes one group subtree already inside the recycle bin.
    pub fn permanently_delete_recycled_group(&mut self, id: &GroupId) -> Result<(), SessionError> {
        self.document
            .permanently_delete_recycled_group(id)
            .map_err(SessionError::Kdbx)
    }

    /// Creates one child group in memory.
    pub fn create_group(&mut self, parent: &GroupId, name: &str) -> Result<GroupId, SessionError> {
        self.document
            .create_group(parent, name)
            .map_err(SessionError::Kdbx)
    }

    /// Renames one group in memory.
    pub fn rename_group(&mut self, id: &GroupId, name: &str) -> Result<(), SessionError> {
        self.document
            .rename_group(id, name)
            .map_err(SessionError::Kdbx)
    }

    /// Moves one group beneath another group in memory.
    pub fn move_group(
        &mut self,
        group: &GroupId,
        destination: &GroupId,
    ) -> Result<(), SessionError> {
        self.document
            .move_group(group, destination)
            .map_err(SessionError::Kdbx)
    }

    /// Permanently deletes one group subtree and records tombstones in memory.
    pub fn permanently_delete_group(&mut self, id: &GroupId) -> Result<(), SessionError> {
        self.document
            .permanently_delete_group(id)
            .map_err(SessionError::Kdbx)
    }

    /// Creates or updates one custom field in memory.
    pub fn set_entry_custom_field(
        &mut self,
        entry: &EntryId,
        name: &str,
        value: &SecretString,
        protection: FieldProtection,
    ) -> Result<(), SessionError> {
        self.document
            .set_entry_custom_field(entry, name, value, protection)
            .map_err(SessionError::Kdbx)
    }

    /// Checks exact custom-field identity without reading its value.
    pub fn has_entry_custom_field(
        &self,
        entry: &EntryId,
        name: &str,
    ) -> Result<bool, SessionError> {
        self.document
            .custom_fields(entry)
            .map(|fields| fields.iter().any(|field| field.name() == name))
            .map_err(SessionError::Kdbx)
    }

    /// Deletes one custom field in memory.
    pub fn delete_entry_custom_field(
        &mut self,
        entry: &EntryId,
        name: &str,
    ) -> Result<(), SessionError> {
        self.document
            .delete_entry_custom_field(entry, name)
            .map_err(SessionError::Kdbx)
    }

    /// Explicitly reads one custom-field value without bulk projection.
    pub fn entry_custom_field(
        &self,
        entry: &EntryId,
        name: &str,
    ) -> Result<Option<SecretString>, SessionError> {
        self.document
            .entry_custom_field(entry, name)
            .map_err(SessionError::Kdbx)
    }
}

impl SessionError {
    /// Returns whether a mutation targeted an unknown entry.
    #[must_use]
    pub const fn is_entry_not_found(&self) -> bool {
        matches!(self, Self::Kdbx(KdbxError::EntryNotFound))
    }

    /// Returns whether a mutation targeted an unknown group.
    #[must_use]
    pub const fn is_group_not_found(&self) -> bool {
        matches!(self, Self::Kdbx(KdbxError::GroupNotFound))
    }

    /// Returns whether a group operation violates root/cycle constraints.
    #[must_use]
    pub const fn is_invalid_group_operation(&self) -> bool {
        matches!(
            self,
            Self::Kdbx(KdbxError::CannotDeleteRootGroup | KdbxError::InvalidGroupMove)
        )
    }

    /// Returns whether a generic custom-field operation targeted a reserved name.
    #[must_use]
    pub const fn is_reserved_field(&self) -> bool {
        matches!(self, Self::Kdbx(KdbxError::ReservedField))
    }

    /// Returns whether an entry tag set violated the reviewed bounds or uniqueness rules.
    #[must_use]
    pub const fn is_invalid_entry_tags(&self) -> bool {
        matches!(self, Self::Kdbx(KdbxError::InvalidEntryTags))
    }

    /// Returns whether a recycle-bin operation was unavailable or invalid.
    #[must_use]
    pub const fn is_recycle_bin_operation(&self) -> bool {
        matches!(
            self,
            Self::Kdbx(KdbxError::RecycleBinDisabled | KdbxError::InvalidRecycleBinOperation)
        )
    }

    /// Returns whether a TOTP read or mutation targeted missing, malformed, or unsupported data.
    #[must_use]
    pub const fn is_totp_operation(&self) -> bool {
        matches!(
            self,
            Self::Kdbx(
                KdbxError::TotpNotConfigured
                    | KdbxError::InvalidTotp
                    | KdbxError::UnsupportedTotpFormat
            )
        )
    }

    /// Returns whether an expiry timestamp was invalid.
    #[must_use]
    pub const fn is_invalid_expiry(&self) -> bool {
        matches!(self, Self::Kdbx(KdbxError::InvalidExpiry))
    }

    /// Returns whether a requested standard entry icon identifier was invalid.
    #[must_use]
    pub const fn is_invalid_icon(&self) -> bool {
        matches!(self, Self::Kdbx(KdbxError::InvalidIcon))
    }

    /// Returns whether an exact attachment name was missing.
    #[must_use]
    pub const fn is_attachment_not_found(&self) -> bool {
        matches!(self, Self::Kdbx(KdbxError::AttachmentNotFound))
    }

    /// Returns whether adding an attachment would implicitly replace an existing name.
    #[must_use]
    pub const fn is_attachment_already_exists(&self) -> bool {
        matches!(self, Self::Kdbx(KdbxError::AttachmentAlreadyExists))
    }

    /// Returns whether an attachment name is invalid for mutation.
    #[must_use]
    pub const fn is_invalid_attachment_name(&self) -> bool {
        matches!(self, Self::Kdbx(KdbxError::InvalidAttachmentName))
    }
}
