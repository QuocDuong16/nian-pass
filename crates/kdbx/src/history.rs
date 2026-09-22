use keepass::db::Icon;
use vault_core::{EntryId, EntrySummary};

use crate::{KdbxDocument, KdbxError, project_entry_summary};

/// One secret-free historical entry revision suitable for review UI.
pub struct EntryHistoryItem {
    index: usize,
    modified_at_unix_seconds: Option<i64>,
    summary: EntrySummary,
    restorable: bool,
}

impl EntryHistoryItem {
    #[must_use]
    pub const fn index(&self) -> usize {
        self.index
    }

    #[must_use]
    pub const fn modified_at_unix_seconds(&self) -> Option<i64> {
        self.modified_at_unix_seconds
    }

    #[must_use]
    pub const fn summary(&self) -> &EntrySummary {
        &self.summary
    }

    #[must_use]
    pub const fn restorable(&self) -> bool {
        self.restorable
    }
}

/// Secret-free history listing tied to one exact in-memory document revision.
pub struct EntryHistory {
    document_revision: u64,
    items: Vec<EntryHistoryItem>,
}

impl EntryHistory {
    #[must_use]
    pub const fn document_revision(&self) -> u64 {
        self.document_revision
    }

    #[must_use]
    pub fn items(&self) -> &[EntryHistoryItem] {
        &self.items
    }
}

impl KdbxDocument {
    /// Lists entry history without copying protected standard-field plaintext or
    /// any password, notes, TOTP seed, custom-field value, or attachment bytes.
    pub fn entry_history(&self, id: &EntryId) -> Result<EntryHistory, KdbxError> {
        let upstream_id = self.find_entry_id(id)?;
        let current = self
            .database
            .entry(upstream_id)
            .ok_or(KdbxError::EntryNotFound)?;
        let current_restore_supported = restore_shape_supported(&current);
        let count = current
            .history
            .as_ref()
            .map_or(0, |history| history.get_entries().len());
        let mut items = Vec::with_capacity(count);

        for index in 0..count {
            let historical = current
                .historical(index)
                .ok_or(KdbxError::HistoryRevisionNotFound)?;
            let restorable = current_restore_supported && restore_shape_supported(&historical);
            items.push(EntryHistoryItem {
                index,
                modified_at_unix_seconds: historical
                    .times
                    .last_modification
                    .map(|value| value.and_utc().timestamp()),
                summary: project_entry_summary(historical),
                restorable,
            });
        }

        Ok(EntryHistory {
            document_revision: self.revision(),
            items,
        })
    }

    /// Restores one historical revision after revalidating the exact in-memory
    /// document revision used to list it. Current identity, parent/location and
    /// existing history remain authoritative; the pre-restore current state is
    /// appended as one new history item.
    pub fn restore_entry_history(
        &mut self,
        id: &EntryId,
        history_index: usize,
        expected_document_revision: u64,
    ) -> Result<(), KdbxError> {
        if self.revision() != expected_document_revision {
            return Err(KdbxError::StaleHistory);
        }

        let upstream_id = self.find_entry_id(id)?;
        let current = self
            .database
            .entry(upstream_id)
            .ok_or(KdbxError::EntryNotFound)?;
        let historical = current
            .historical(history_index)
            .ok_or(KdbxError::HistoryRevisionNotFound)?;
        if !restore_shape_supported(&current) || !restore_shape_supported(&historical) {
            return Err(KdbxError::HistoryRestoreUnsupported);
        }

        let source = historical.clone();
        let source_builtin_icon = match historical.icon() {
            None => None,
            Some(Icon::BuiltIn(icon_id)) => Some(*icon_id),
            Some(Icon::Custom(_)) => return Err(KdbxError::HistoryRestoreUnsupported),
        };
        let current_location_changed = current.times.location_changed;

        {
            let mut entry = self
                .database
                .entry_mut(upstream_id)
                .ok_or(KdbxError::EntryNotFound)?;
            let mut tracked = entry.track_changes();
            tracked.edit(|value| {
                value.fields = source.fields;
                value.autotype = source.autotype;
                value.tags = source.tags;
                value.times = source.times;
                value.times.location_changed = current_location_changed;
                value.custom_data = source.custom_data;
                value.foreground_color = source.foreground_color;
                value.background_color = source.background_color;
                value.override_url = source.override_url;
                value.quality_check = source.quality_check;
            });
            match source_builtin_icon {
                None => tracked.set_icon_none(),
                Some(icon_id) => tracked.set_icon_builtin(icon_id),
            }
        }

        self.enforce_history_policy_for_entry(upstream_id)?;
        self.mark_changed();
        Ok(())
    }
}

fn restore_shape_supported(entry: &keepass::db::EntryRef<'_>) -> bool {
    entry.attachments_named().next().is_none() && entry.custom_icon().is_none()
}

#[cfg(test)]
mod tests {
    use keepass::db::Value;
    use vault_core::{EntryId, EntryUpdate, GroupId, NewEntry, SecretString, SummaryText};

    use super::KdbxDocument;
    use crate::KdbxError;

    fn document_with_history() -> (KdbxDocument, EntryId) {
        let mut document = KdbxDocument::new("History tests");
        let root = GroupId::new(document.database.root().id().to_string());
        let old_password = SecretString::new("history-old-password".to_owned());
        let entry = document
            .create_entry(
                &root,
                NewEntry {
                    title: "Before",
                    username: "before-user",
                    url: "https://before.example",
                    password: Some(&old_password),
                },
            )
            .expect("entry creation should succeed");
        let new_password = SecretString::new("history-new-password".to_owned());
        let notes = SecretString::new("history-new-notes".to_owned());
        document
            .update_entry(
                &entry,
                EntryUpdate {
                    title: Some("After"),
                    username: Some("after-user"),
                    url: None,
                    password: Some(&new_password),
                    notes: Some(&notes),
                    expiry: None,
                    totp: None,
                    icon: None,
                },
            )
            .expect("entry update should succeed");
        (document, entry)
    }

    #[test]
    fn history_list_is_secret_free_and_restore_tracks_current_state_once() {
        let (mut document, entry) = document_with_history();
        let listed = document.entry_history(&entry).expect("history should list");
        assert_eq!(listed.items().len(), 1);
        let item = &listed.items()[0];
        assert_eq!(item.index(), 0);
        assert!(item.restorable());
        assert!(matches!(
            item.summary().title(),
            SummaryText::Visible(value) if value == "Before"
        ));
        assert!(item.summary().has_password());
        assert!(!item.summary().has_notes());

        let revision = listed.document_revision();
        document
            .restore_entry_history(&entry, item.index(), revision)
            .expect("history restore should succeed");
        assert_eq!(document.revision(), revision + 1);

        let projection = document.projection().expect("projection should succeed");
        let restored = projection.find_entry(&entry).expect("entry should remain");
        assert!(matches!(
            restored.title(),
            SummaryText::Visible(value) if value == "Before"
        ));
        assert!(!restored.has_notes());
        assert_eq!(
            document
                .entry_password(&entry)
                .expect("password read should succeed")
                .expect("password should exist")
                .expose_secret(),
            "history-old-password"
        );

        let relisted = document
            .entry_history(&entry)
            .expect("history should relist");
        assert_eq!(relisted.items().len(), 2);
        assert!(matches!(
            relisted.items()[0].summary().title(),
            SummaryText::Visible(value) if value == "After"
        ));
        assert!(relisted.items()[0].summary().has_notes());
    }

    #[test]
    fn stale_or_unknown_history_requests_never_mutate() {
        let (mut document, entry) = document_with_history();
        let listed = document.entry_history(&entry).expect("history should list");
        let stale_revision = listed.document_revision();
        document
            .set_entry_title(&entry, "Newer")
            .expect("newer edit should succeed");
        let revision_after_edit = document.revision();

        assert!(matches!(
            document.restore_entry_history(&entry, 0, stale_revision),
            Err(KdbxError::StaleHistory)
        ));
        assert_eq!(document.revision(), revision_after_edit);
        assert!(matches!(
            document.restore_entry_history(&entry, usize::MAX, revision_after_edit),
            Err(KdbxError::HistoryRevisionNotFound)
        ));
        assert_eq!(document.revision(), revision_after_edit);
    }

    #[test]
    fn attachment_or_custom_icon_history_fails_closed() {
        let (mut document, entry) = document_with_history();
        let upstream = document
            .find_entry_id(&entry)
            .expect("entry id should resolve");
        document
            .database
            .entry_mut(upstream)
            .expect("entry should exist")
            .add_attachment("history.bin", Value::protected(vec![1, 2, 3]));
        let listed = document.entry_history(&entry).expect("history should list");
        assert!(!listed.items()[0].restorable());
        assert!(matches!(
            document.restore_entry_history(&entry, 0, listed.document_revision()),
            Err(KdbxError::HistoryRestoreUnsupported)
        ));

        let mut icon_document = KdbxDocument::new("Icon history");
        let root = GroupId::new(icon_document.database.root().id().to_string());
        let icon_entry = icon_document
            .create_entry(
                &root,
                NewEntry {
                    title: "Icon before",
                    username: "",
                    url: "",
                    password: None,
                },
            )
            .expect("icon entry should create");
        let upstream = icon_document
            .find_entry_id(&icon_entry)
            .expect("icon entry id should resolve");
        icon_document
            .database
            .entry_mut(upstream)
            .expect("icon entry should exist")
            .set_icon_custom_new(vec![9, 8, 7]);
        icon_document
            .set_entry_title(&icon_entry, "Icon after")
            .expect("tracked edit should succeed");
        let listed = icon_document
            .entry_history(&icon_entry)
            .expect("icon history should list");
        assert!(!listed.items()[0].restorable());
    }
}
