use keepass::db::Times;
use vault_core::{EntryId, GroupId};

use crate::{
    KdbxDocument, KdbxError,
    recycle_bin::{ensure_recycle_bin, group_is_in_recycle_bin, recycle_bin_id},
};

impl KdbxDocument {
    /// Moves multiple entries to one existing group atomically.
    ///
    /// Every identifier and the destination are validated before the retained
    /// document is replaced. A failure leaves the original document untouched,
    /// while a successful batch advances the document revision only once.
    pub fn move_entries(
        &mut self,
        entries: &[EntryId],
        destination: &GroupId,
    ) -> Result<(), KdbxError> {
        if entries.is_empty() {
            return Ok(());
        }
        let destination_id = self.find_group_id(destination)?;
        let entry_ids = entries
            .iter()
            .map(|entry| self.find_entry_id(entry))
            .collect::<Result<Vec<_>, _>>()?;
        let mut candidate = self.database.clone();
        let mut changed = false;

        for entry_id in entry_ids {
            let current_parent = candidate
                .entry(entry_id)
                .ok_or(KdbxError::EntryNotFound)?
                .parent()
                .id();
            if current_parent == destination_id {
                continue;
            }
            let mut entry = candidate
                .entry_mut(entry_id)
                .ok_or(KdbxError::EntryNotFound)?;
            entry
                .move_to(destination_id)
                .map_err(|_| KdbxError::GroupNotFound)?;
            entry.times.location_changed = Some(Times::now());
            changed = true;
        }

        if changed {
            self.database = candidate;
            self.mark_changed();
        }
        Ok(())
    }

    /// Moves multiple entries into the KDBX recycle bin atomically.
    ///
    /// The recycle bin is created lazily on the candidate database. Any invalid
    /// entry or recycle-bin policy failure discards the whole candidate.
    pub fn trash_entries(&mut self, entries: &[EntryId]) -> Result<(), KdbxError> {
        if entries.is_empty() {
            return Ok(());
        }
        let entry_ids = entries
            .iter()
            .map(|entry| self.find_entry_id(entry))
            .collect::<Result<Vec<_>, _>>()?;
        let mut candidate = self.database.clone();
        let recycle_id = ensure_recycle_bin(&mut candidate)?;
        let mut changed = false;

        for entry_id in entry_ids {
            let current_parent = candidate
                .entry(entry_id)
                .ok_or(KdbxError::EntryNotFound)?
                .parent()
                .id();
            if group_is_in_recycle_bin(&candidate, current_parent, recycle_id) {
                continue;
            }
            let mut entry = candidate
                .entry_mut(entry_id)
                .ok_or(KdbxError::EntryNotFound)?;
            entry
                .move_to(recycle_id)
                .map_err(|_| KdbxError::GroupNotFound)?;
            entry.times.location_changed = Some(Times::now());
            changed = true;
        }

        if changed {
            self.database = candidate;
            self.mark_changed();
        }
        Ok(())
    }

    /// Restores multiple entries from the KDBX recycle bin atomically.
    ///
    /// Every entry must currently live inside the recycle-bin subtree. Each
    /// entry returns to its previous parent when that group still exists and is
    /// outside Trash, otherwise it falls back to the vault root. Any invalid
    /// entry rejects the complete batch and a successful batch advances the
    /// document revision exactly once.
    pub fn restore_entries(&mut self, entries: &[EntryId]) -> Result<(), KdbxError> {
        if entries.is_empty() {
            return Ok(());
        }
        let entry_ids = entries
            .iter()
            .map(|entry| self.find_entry_id(entry))
            .collect::<Result<Vec<_>, _>>()?;
        let recycle_id =
            recycle_bin_id(&self.database).ok_or(KdbxError::InvalidRecycleBinOperation)?;
        let root_id = self.database.root().id();
        let destinations = entry_ids
            .iter()
            .map(|entry_id| {
                let entry = self
                    .database
                    .entry(*entry_id)
                    .ok_or(KdbxError::EntryNotFound)?;
                let current_parent = entry.parent().id();
                if !group_is_in_recycle_bin(&self.database, current_parent, recycle_id) {
                    return Err(KdbxError::InvalidRecycleBinOperation);
                }
                let destination = entry
                    .previous_parent()
                    .map(|group| group.id())
                    .filter(|destination| {
                        self.database.group(*destination).is_some()
                            && !group_is_in_recycle_bin(&self.database, *destination, recycle_id)
                    })
                    .unwrap_or(root_id);
                Ok((*entry_id, destination))
            })
            .collect::<Result<Vec<_>, KdbxError>>()?;

        let mut candidate = self.database.clone();
        for (entry_id, destination) in destinations {
            let mut entry = candidate
                .entry_mut(entry_id)
                .ok_or(KdbxError::EntryNotFound)?;
            entry
                .move_to(destination)
                .map_err(|_| KdbxError::GroupNotFound)?;
            entry.times.location_changed = Some(Times::now());
        }
        self.database = candidate;
        self.mark_changed();
        Ok(())
    }

    /// Permanently deletes multiple recycled entries atomically.
    ///
    /// Every entry must already be inside the recycle-bin subtree. Tombstones
    /// are created on a candidate database and the retained document is replaced
    /// only after the full batch succeeds.
    pub fn permanently_delete_recycled_entries(
        &mut self,
        entries: &[EntryId],
    ) -> Result<(), KdbxError> {
        if entries.is_empty() {
            return Ok(());
        }
        let entry_ids = entries
            .iter()
            .map(|entry| self.find_entry_id(entry))
            .collect::<Result<Vec<_>, _>>()?;
        let recycle_id =
            recycle_bin_id(&self.database).ok_or(KdbxError::InvalidRecycleBinOperation)?;
        for entry_id in &entry_ids {
            let parent_id = self
                .database
                .entry(*entry_id)
                .ok_or(KdbxError::EntryNotFound)?
                .parent()
                .id();
            if !group_is_in_recycle_bin(&self.database, parent_id, recycle_id) {
                return Err(KdbxError::InvalidRecycleBinOperation);
            }
        }

        let mut candidate = self.database.clone();
        for entry_id in entry_ids {
            let mut entry = candidate
                .entry_mut(entry_id)
                .ok_or(KdbxError::EntryNotFound)?;
            entry.track_changes().remove();
        }
        self.database = candidate;
        self.mark_changed();
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use vault_core::{EntryId, NewEntry};

    use super::KdbxDocument;

    fn add_entry(document: &mut KdbxDocument, group: &vault_core::GroupId, title: &str) -> EntryId {
        document
            .create_entry(
                group,
                NewEntry {
                    title,
                    username: "",
                    url: "",
                    password: None,
                },
            )
            .expect("entry creation should succeed")
    }

    #[test]
    fn bulk_move_is_atomic_and_advances_revision_once() {
        let mut document = KdbxDocument::new("Bulk test");
        let root = document
            .projection()
            .expect("projection")
            .root()
            .id()
            .clone();
        let destination = document.create_group(&root, "Destination").expect("group");
        let first = add_entry(&mut document, &root, "First");
        let second = add_entry(&mut document, &root, "Second");
        let before = document.revision();

        document
            .move_entries(&[first.clone(), second.clone()], &destination)
            .expect("bulk move should succeed");
        assert_eq!(document.revision(), before + 1);
        let projection = document.projection().expect("projection");
        let destination_group = projection
            .find_group(&destination)
            .expect("destination group should exist");
        assert!(
            destination_group
                .entries()
                .iter()
                .any(|entry| entry.id() == &first),
            "first entry should move to destination"
        );
        assert!(
            destination_group
                .entries()
                .iter()
                .any(|entry| entry.id() == &second),
            "second entry should move to destination"
        );

        let stable = document.revision();
        document
            .move_entries(&[first.clone(), second.clone()], &destination)
            .expect("same destination should no-op");
        assert_eq!(document.revision(), stable);

        let unknown = EntryId::new("00000000-0000-0000-0000-000000000000");
        assert!(
            document
                .move_entries(&[first.clone(), unknown], &root)
                .is_err()
        );
        assert_eq!(document.revision(), stable);
        let projection = document.projection().expect("projection");
        let destination_group = projection
            .find_group(&destination)
            .expect("destination group should remain");
        assert!(
            destination_group
                .entries()
                .iter()
                .any(|entry| entry.id() == &first),
            "failed batch must not move the first entry back"
        );
    }

    #[test]
    fn bulk_trash_is_atomic_and_uses_one_document_revision() {
        let mut document = KdbxDocument::new("Bulk trash");
        let root = document
            .projection()
            .expect("projection")
            .root()
            .id()
            .clone();
        let first = add_entry(&mut document, &root, "First");
        let second = add_entry(&mut document, &root, "Second");
        let before = document.revision();

        document
            .trash_entries(&[first.clone(), second.clone()])
            .expect("bulk trash should succeed");
        assert_eq!(document.revision(), before + 1);
        assert!(document.entry_is_recycled(&first).expect("first state"));
        assert!(document.entry_is_recycled(&second).expect("second state"));

        let stable = document.revision();
        document
            .trash_entries(&[first.clone(), second.clone()])
            .expect("already recycled should no-op");
        assert_eq!(document.revision(), stable);
    }

    #[test]
    fn bulk_restore_is_atomic_and_uses_one_document_revision() {
        let mut document = KdbxDocument::new("Bulk restore");
        let root = document
            .projection()
            .expect("projection")
            .root()
            .id()
            .clone();
        let destination = document.create_group(&root, "Destination").expect("group");
        let first = add_entry(&mut document, &destination, "First");
        let second = add_entry(&mut document, &destination, "Second");
        document
            .trash_entries(&[first.clone(), second.clone()])
            .expect("trash batch");
        let before = document.revision();

        document
            .restore_entries(&[first.clone(), second.clone()])
            .expect("restore batch");
        assert_eq!(document.revision(), before + 1);
        assert!(!document.entry_is_recycled(&first).expect("first state"));
        assert!(!document.entry_is_recycled(&second).expect("second state"));

        document.trash_entry(&first).expect("trash first again");
        let stable = document.revision();
        assert!(
            document
                .restore_entries(&[first.clone(), second.clone()])
                .is_err()
        );
        assert_eq!(document.revision(), stable);
        assert!(document.entry_is_recycled(&first).expect("first retained"));
        assert!(
            !document
                .entry_is_recycled(&second)
                .expect("second retained")
        );
    }

    #[test]
    fn bulk_permanent_delete_requires_trash_and_commits_once() {
        let mut document = KdbxDocument::new("Bulk permanent delete");
        let root = document
            .projection()
            .expect("projection")
            .root()
            .id()
            .clone();
        let first = add_entry(&mut document, &root, "First");
        let second = add_entry(&mut document, &root, "Second");
        let deleted_before = document.database.deleted_objects.len();

        assert!(
            document
                .permanently_delete_recycled_entries(&[first.clone(), second.clone()])
                .is_err()
        );
        assert_eq!(document.database.deleted_objects.len(), deleted_before);

        document
            .trash_entries(&[first.clone(), second.clone()])
            .expect("trash batch");
        let before = document.revision();
        document
            .permanently_delete_recycled_entries(&[first, second])
            .expect("permanent delete batch");
        assert_eq!(document.revision(), before + 1);
        assert_eq!(document.database.deleted_objects.len(), deleted_before + 2);
    }
}
