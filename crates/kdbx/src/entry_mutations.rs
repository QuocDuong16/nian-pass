use keepass::db::fields;
use vault_core::{EntryId, EntryUpdate, SecretString};

use crate::{KdbxDocument, KdbxError, MissingFieldProtection};

impl KdbxDocument {
    /// Changes one entry's notes while preserving its protection mode.
    ///
    /// Missing non-empty notes follow the database Notes memory-protection
    /// policy. Missing plus empty is a no-op, matching the other setters.
    pub fn set_entry_notes(&mut self, id: &EntryId, notes: &SecretString) -> Result<(), KdbxError> {
        self.set_standard_field(
            id,
            fields::NOTES,
            notes.expose_secret(),
            MissingFieldProtection::DatabaseNotesPolicy,
        )
    }

    /// Applies one logical multi-field entry edit atomically.
    ///
    /// All lookup and change decisions complete before the tracked edit starts.
    /// A real update appends exactly one prior-state history item and advances
    /// the document revision once, regardless of the number of changed fields.
    pub fn update_entry(&mut self, id: &EntryId, update: EntryUpdate<'_>) -> Result<(), KdbxError> {
        let upstream_id = self.find_entry_id(id)?;
        let current = self
            .database
            .entry(upstream_id)
            .ok_or(KdbxError::EntryNotFound)?;
        if update.is_empty() {
            return Ok(());
        }
        let candidates = [
            (
                fields::TITLE,
                update.title,
                MissingFieldProtection::DatabaseTitlePolicy,
            ),
            (
                fields::USERNAME,
                update.username,
                MissingFieldProtection::DatabaseUsernamePolicy,
            ),
            (
                fields::URL,
                update.url,
                MissingFieldProtection::DatabaseUrlPolicy,
            ),
            (
                fields::PASSWORD,
                update.password.map(SecretString::expose_secret),
                MissingFieldProtection::AlwaysProtected,
            ),
            (
                fields::NOTES,
                update.notes.map(SecretString::expose_secret),
                MissingFieldProtection::DatabaseNotesPolicy,
            ),
        ];
        let changes = candidates
            .into_iter()
            .filter_map(|(field, value, policy)| {
                let value = value?;
                let existing = current.fields.get(field);
                if existing.is_some_and(|current| current.get() == value)
                    || (existing.is_none() && value.is_empty())
                {
                    return None;
                }
                let protected = existing.map_or_else(
                    || self.missing_field_is_protected(policy),
                    keepass::db::Value::is_protected,
                );
                Some((field, value, protected))
            })
            .collect::<Vec<_>>();

        if changes.is_empty() {
            return Ok(());
        }

        let mut entry = self
            .database
            .entry_mut(upstream_id)
            .ok_or(KdbxError::EntryNotFound)?;
        let mut tracked = entry.track_changes();
        for (field, value, protected) in changes {
            if protected {
                tracked.set_protected(field, value);
            } else {
                tracked.set_unprotected(field, value);
            }
        }
        drop(tracked);
        self.mark_changed();
        Ok(())
    }
}
