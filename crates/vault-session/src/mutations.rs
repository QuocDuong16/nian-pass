use kdbx::KdbxError;
use vault_core::{EntryId, EntryUpdate, FieldProtection, GroupId, NewEntry, SecretString};

use crate::{SessionError, VaultSession};

impl VaultSession {
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
}
