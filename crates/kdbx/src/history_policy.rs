use keepass::{
    Database,
    db::{EntryId as UpstreamEntryId, History, Times},
};

use crate::{KdbxDocument, KdbxError};

/// Product bound for an explicit per-entry history revision count.
pub const MAX_HISTORY_ITEMS: usize = 10_000;

impl KdbxDocument {
    /// Returns the highest finite history count this build accepts as a new setting.
    #[must_use]
    pub const fn maximum_editable_history_items(&self) -> usize {
        MAX_HISTORY_ITEMS
    }

    pub(crate) fn from_merged_database_with_history_policy(
        version: crate::KdbxVersion,
        database: Database,
    ) -> Self {
        let mut document = Self {
            version,
            database,
            revision: 0,
            revision_permanently_dirty: false,
        };
        document.enforce_history_policy_all();
        document
    }

    /// Returns the finite history-item limit declared by the database.
    ///
    /// Missing and negative legacy values are treated as having no finite item
    /// limit. The independent KDBX HistoryMaxSize field is preserved but is not
    /// interpreted by this API.
    #[must_use]
    pub fn history_max_items(&self) -> Option<usize> {
        finite_history_limit(&self.database)
    }

    /// Updates and immediately enforces the finite history-item count policy.
    ///
    /// Lowering the limit prunes older revisions for every entry in the same
    /// candidate database before it replaces retained state. `None` means that
    /// Nian Pass applies no finite item-count limit; `0` retains no revisions.
    pub fn set_history_max_items(&mut self, max_items: Option<usize>) -> Result<(), KdbxError> {
        if self.history_max_items() == max_items {
            return Ok(());
        }
        if max_items.is_some_and(|value| value > MAX_HISTORY_ITEMS) {
            return Err(KdbxError::InvalidHistoryPolicy);
        }

        let mut candidate = self.database.clone();
        candidate.meta.history_max_items = max_items
            .map(isize::try_from)
            .transpose()
            .map_err(|_| KdbxError::InvalidHistoryPolicy)?;
        candidate.meta.settings_changed = Some(Times::now());
        prune_all_entry_history(&mut candidate, max_items);
        self.database = candidate;
        self.mark_changed();
        Ok(())
    }

    /// Re-applies the database's finite item-count policy after one tracked edit.
    pub(crate) fn enforce_history_policy_for_entry(
        &mut self,
        entry_id: UpstreamEntryId,
    ) -> Result<(), KdbxError> {
        let Some(limit) = self.history_max_items() else {
            return Ok(());
        };
        let mut entry = self
            .database
            .entry_mut(entry_id)
            .ok_or(KdbxError::EntryNotFound)?;
        prune_entry_history(&mut entry, limit);
        Ok(())
    }

    /// Re-applies the merged database's finite item-count policy to every entry.
    pub(crate) fn enforce_history_policy_all(&mut self) {
        let limit = self.history_max_items();
        prune_all_entry_history(&mut self.database, limit);
    }
}

fn finite_history_limit(database: &Database) -> Option<usize> {
    database
        .meta
        .history_max_items
        .and_then(|value| usize::try_from(value).ok())
}

fn prune_all_entry_history(database: &mut Database, limit: Option<usize>) {
    let Some(limit) = limit else {
        return;
    };
    let ids = database
        .iter_all_entries()
        .map(|entry| entry.id())
        .collect::<Vec<_>>();
    for id in ids {
        if let Some(mut entry) = database.entry_mut(id) {
            prune_entry_history(&mut entry, limit);
        }
    }
}

fn prune_entry_history(entry: &mut keepass::db::Entry, limit: usize) {
    let Some(history) = entry.history.as_ref() else {
        return;
    };
    if history.get_entries().len() <= limit {
        return;
    }

    let retained = history
        .get_entries()
        .iter()
        .take(limit)
        .cloned()
        .collect::<Vec<_>>();
    let mut rebuilt = History::default();
    for historical in retained.into_iter().rev() {
        rebuilt.add_entry(historical);
    }
    entry.history = Some(rebuilt);
}

#[cfg(test)]
mod tests {
    use vault_core::{
        EntryId, EntryUpdate, FieldProtection, GroupId, NewEntry, SecretBytes, SecretString,
    };

    use super::{KdbxDocument, MAX_HISTORY_ITEMS};
    use crate::KdbxError;

    fn document_with_entry() -> (KdbxDocument, EntryId) {
        let mut document = KdbxDocument::new("History policy");
        let root = GroupId::new(document.database.root().id().to_string());
        let entry = document
            .create_entry(
                &root,
                NewEntry {
                    title: "zero",
                    username: "",
                    url: "",
                    password: None,
                },
            )
            .expect("entry");
        (document, entry)
    }

    #[test]
    fn history_item_limit_prunes_existing_revisions_newest_first_and_roundtrips() {
        let (mut document, entry) = document_with_entry();
        for title in ["one", "two", "three", "four"] {
            document
                .update_entry(
                    &entry,
                    EntryUpdate {
                        title: Some(title),
                        username: None,
                        url: None,
                        password: None,
                        notes: None,
                        expiry: None,
                        totp: None,
                        icon: None,
                    },
                )
                .expect("edit");
        }
        assert_eq!(
            document
                .entry_history(&entry)
                .expect("history")
                .items()
                .len(),
            4
        );

        document.set_history_max_items(Some(2)).expect("limit");
        let listed = document.entry_history(&entry).expect("limited history");
        assert_eq!(listed.items().len(), 2);

        let mut saved = Vec::new();
        document
            .save_to_writer(&mut saved, "fixture")
            .expect("save");
        let reopened =
            KdbxDocument::open_reader(&mut std::io::Cursor::new(saved), "fixture").expect("reopen");
        assert_eq!(reopened.history_max_items(), Some(2));
        assert_eq!(
            reopened
                .entry_history(&entry)
                .expect("reopened history")
                .items()
                .len(),
            2
        );
    }

    #[test]
    fn configured_limit_is_enforced_after_future_standard_custom_and_attachment_mutations() {
        let (mut document, entry) = document_with_entry();
        document.set_history_max_items(Some(1)).expect("limit");

        for title in ["one", "two", "three"] {
            document
                .update_entry(
                    &entry,
                    EntryUpdate {
                        title: Some(title),
                        username: None,
                        url: None,
                        password: None,
                        notes: None,
                        expiry: None,
                        totp: None,
                        icon: None,
                    },
                )
                .expect("edit");
            assert_eq!(
                document
                    .entry_history(&entry)
                    .expect("history")
                    .items()
                    .len(),
                1
            );
        }

        document
            .set_entry_custom_field(
                &entry,
                "policy-marker",
                &SecretString::new("marker".to_owned()),
                FieldProtection::Protected,
            )
            .expect("custom field");
        assert_eq!(
            document
                .entry_history(&entry)
                .expect("history")
                .items()
                .len(),
            1
        );

        document
            .add_entry_attachment(&entry, "policy.bin", &SecretBytes::new(vec![1, 2, 3]))
            .expect("attachment");
        assert_eq!(
            document
                .entry_history(&entry)
                .expect("history")
                .items()
                .len(),
            1
        );
    }

    #[test]
    fn zero_disables_history_retention_and_invalid_limit_never_mutates() {
        let (mut document, entry) = document_with_entry();
        document
            .update_entry(
                &entry,
                EntryUpdate {
                    title: Some("one"),
                    username: None,
                    url: None,
                    password: None,
                    notes: None,
                    expiry: None,
                    totp: None,
                    icon: None,
                },
            )
            .expect("edit");
        document
            .set_history_max_items(Some(0))
            .expect("disable history");
        assert!(
            document
                .entry_history(&entry)
                .expect("history")
                .items()
                .is_empty()
        );
        let revision = document.revision();
        assert!(matches!(
            document.set_history_max_items(Some(MAX_HISTORY_ITEMS + 1)),
            Err(KdbxError::InvalidHistoryPolicy)
        ));
        assert_eq!(document.revision(), revision);
    }
}
