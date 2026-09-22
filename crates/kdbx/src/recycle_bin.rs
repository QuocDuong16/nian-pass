use keepass::{Database, db::Times};
use vault_core::{EntryId, GroupId};

use crate::{KdbxDocument, KdbxError};

const RECYCLE_BIN_NAME: &str = "Recycle Bin";

impl KdbxDocument {
    /// Returns whether the database permits recycle-bin operations.
    ///
    /// An omitted legacy flag is treated as enabled; an explicit `false` is
    /// respected and never silently overridden.
    #[must_use]
    pub fn recycle_bin_enabled(&self) -> bool {
        self.database.meta.recyclebin_enabled.unwrap_or(true)
    }

    /// Enables or disables recycle-bin operations without deleting database data.
    ///
    /// Disabling is accepted only when the current recycle-bin group has no
    /// direct entries or child groups. The group/UUID are retained so enabling
    /// later preserves the stable KDBX recycle-bin identity. Enabling does not
    /// eagerly create a missing group; the first Trash operation materializes it.
    pub fn set_recycle_bin_enabled(&mut self, enabled: bool) -> Result<(), KdbxError> {
        if self.recycle_bin_enabled() == enabled {
            return Ok(());
        }

        if !enabled && let Some(recycle_id) = recycle_bin_id(&self.database) {
            let recycle = self
                .database
                .group(recycle_id)
                .ok_or(KdbxError::InvalidRecycleBinOperation)?;
            if recycle.entry_ids().next().is_some() || recycle.group_ids().next().is_some() {
                return Err(KdbxError::InvalidRecycleBinOperation);
            }
        }

        let mut candidate = self.database.clone();
        let changed = Times::now();
        candidate.meta.recyclebin_enabled = Some(enabled);
        candidate.meta.recyclebin_changed = Some(changed);
        candidate.meta.settings_changed = Some(changed);
        self.database = candidate;
        self.mark_changed();
        Ok(())
    }

    /// Returns the stable recycle-bin group identifier when metadata points to
    /// a currently present group.
    #[must_use]
    pub fn recycle_bin_group_id(&self) -> Option<GroupId> {
        recycle_bin_id(&self.database).map(|id| GroupId::new(id.to_string()))
    }

    /// Returns whether an entry currently lives anywhere inside the recycle-bin subtree.
    ///
    /// This is intentionally identifier-only metadata so credential-provider
    /// callers can deny recycled records without reading any secret field.
    pub fn entry_is_recycled(&self, id: &EntryId) -> Result<bool, KdbxError> {
        let entry_id = self.find_entry_id(id)?;
        let Some(recycle_id) = recycle_bin_id(&self.database) else {
            return Ok(false);
        };
        let parent_id = self
            .database
            .entry(entry_id)
            .ok_or(KdbxError::EntryNotFound)?
            .parent()
            .id();
        Ok(group_is_in_recycle_bin(
            &self.database,
            parent_id,
            recycle_id,
        ))
    }

    /// Returns whether a group currently lives in the recycle-bin subtree.
    pub fn group_is_recycled(&self, id: &GroupId) -> Result<bool, KdbxError> {
        let group_id = self.find_group_id(id)?;
        let Some(recycle_id) = recycle_bin_id(&self.database) else {
            return Ok(false);
        };
        Ok(group_id == recycle_id || group_is_in_recycle_bin(&self.database, group_id, recycle_id))
    }

    /// Moves one entry into the KDBX recycle bin without creating a tombstone.
    pub fn trash_entry(&mut self, id: &EntryId) -> Result<(), KdbxError> {
        let entry_id = self.find_entry_id(id)?;
        let mut candidate = self.database.clone();
        let recycle_id = ensure_recycle_bin(&mut candidate)?;
        let current_parent = candidate
            .entry(entry_id)
            .ok_or(KdbxError::EntryNotFound)?
            .parent()
            .id();
        if group_is_in_recycle_bin(&candidate, current_parent, recycle_id) {
            return Ok(());
        }

        let mut entry = candidate
            .entry_mut(entry_id)
            .ok_or(KdbxError::EntryNotFound)?;
        entry
            .move_to(recycle_id)
            .map_err(|_| KdbxError::GroupNotFound)?;
        entry.times.location_changed = Some(Times::now());
        self.database = candidate;
        self.mark_changed();
        Ok(())
    }

    /// Restores one recycled entry to its previous group when that group is
    /// still outside the recycle bin, otherwise to the vault root.
    pub fn restore_entry(&mut self, id: &EntryId) -> Result<GroupId, KdbxError> {
        let entry_id = self.find_entry_id(id)?;
        let recycle_id =
            recycle_bin_id(&self.database).ok_or(KdbxError::InvalidRecycleBinOperation)?;
        let current_parent = self
            .database
            .entry(entry_id)
            .ok_or(KdbxError::EntryNotFound)?
            .parent()
            .id();
        if !group_is_in_recycle_bin(&self.database, current_parent, recycle_id) {
            return Err(KdbxError::InvalidRecycleBinOperation);
        }

        let root_id = self.database.root().id();
        let previous = self
            .database
            .entry(entry_id)
            .and_then(|entry| entry.previous_parent().map(|group| group.id()))
            .filter(|destination| {
                self.database.group(*destination).is_some()
                    && !group_is_in_recycle_bin(&self.database, *destination, recycle_id)
            })
            .unwrap_or(root_id);

        let mut candidate = self.database.clone();
        let mut entry = candidate
            .entry_mut(entry_id)
            .ok_or(KdbxError::EntryNotFound)?;
        entry
            .move_to(previous)
            .map_err(|_| KdbxError::GroupNotFound)?;
        entry.times.location_changed = Some(Times::now());
        self.database = candidate;
        self.mark_changed();
        Ok(GroupId::new(previous.to_string()))
    }

    /// Permanently removes an entry only when it is already inside the recycle
    /// bin subtree.
    pub fn permanently_delete_recycled_entry(&mut self, id: &EntryId) -> Result<(), KdbxError> {
        let entry_id = self.find_entry_id(id)?;
        let recycle_id =
            recycle_bin_id(&self.database).ok_or(KdbxError::InvalidRecycleBinOperation)?;
        let parent_id = self
            .database
            .entry(entry_id)
            .ok_or(KdbxError::EntryNotFound)?
            .parent()
            .id();
        if !group_is_in_recycle_bin(&self.database, parent_id, recycle_id) {
            return Err(KdbxError::InvalidRecycleBinOperation);
        }
        self.permanently_delete_entry(id)
    }

    /// Moves one non-root group subtree into the KDBX recycle bin.
    pub fn trash_group(&mut self, id: &GroupId) -> Result<(), KdbxError> {
        let group_id = self.find_group_id(id)?;
        if group_id == self.database.root().id() {
            return Err(KdbxError::CannotDeleteRootGroup);
        }
        let mut candidate = self.database.clone();
        let recycle_id = ensure_recycle_bin(&mut candidate)?;
        if group_id == recycle_id || group_is_in_recycle_bin(&candidate, group_id, recycle_id) {
            return Ok(());
        }

        let mut group = candidate
            .group_mut(group_id)
            .ok_or(KdbxError::GroupNotFound)?;
        group
            .move_to(recycle_id)
            .map_err(|_| KdbxError::InvalidGroupMove)?;
        group.times.location_changed = Some(Times::now());
        self.database = candidate;
        self.mark_changed();
        Ok(())
    }

    /// Restores one recycled group subtree to its previous parent when safe,
    /// otherwise to the vault root.
    pub fn restore_group(&mut self, id: &GroupId) -> Result<GroupId, KdbxError> {
        let group_id = self.find_group_id(id)?;
        let recycle_id =
            recycle_bin_id(&self.database).ok_or(KdbxError::InvalidRecycleBinOperation)?;
        if group_id == recycle_id || !group_is_in_recycle_bin(&self.database, group_id, recycle_id)
        {
            return Err(KdbxError::InvalidRecycleBinOperation);
        }

        let root_id = self.database.root().id();
        let previous = self
            .database
            .group(group_id)
            .and_then(|group| group.previous_parent().map(|parent| parent.id()))
            .filter(|destination| {
                !group_is_in_recycle_bin(&self.database, *destination, recycle_id)
            })
            .unwrap_or(root_id);

        let mut candidate = self.database.clone();
        let mut group = candidate
            .group_mut(group_id)
            .ok_or(KdbxError::GroupNotFound)?;
        group
            .move_to(previous)
            .map_err(|_| KdbxError::InvalidGroupMove)?;
        group.times.location_changed = Some(Times::now());
        self.database = candidate;
        self.mark_changed();
        Ok(GroupId::new(previous.to_string()))
    }

    /// Permanently removes a group subtree only when it is inside the recycle
    /// bin. The recycle-bin group itself can never be deleted through this API.
    pub fn permanently_delete_recycled_group(&mut self, id: &GroupId) -> Result<(), KdbxError> {
        let group_id = self.find_group_id(id)?;
        let recycle_id =
            recycle_bin_id(&self.database).ok_or(KdbxError::InvalidRecycleBinOperation)?;
        if group_id == recycle_id || !group_is_in_recycle_bin(&self.database, group_id, recycle_id)
        {
            return Err(KdbxError::InvalidRecycleBinOperation);
        }
        self.permanently_delete_group(id)
    }
}

pub(crate) fn ensure_recycle_bin(
    database: &mut Database,
) -> Result<keepass::db::GroupId, KdbxError> {
    if database.meta.recyclebin_enabled == Some(false) {
        return Err(KdbxError::RecycleBinDisabled);
    }
    if let Some(id) = recycle_bin_id(database) {
        return Ok(id);
    }

    let id = {
        let mut root = database.root_mut();
        let mut recycle = root.add_group();
        recycle.name = RECYCLE_BIN_NAME.to_owned();
        recycle.id()
    };
    let uuid = id.uuid();
    database.meta.recyclebin_enabled = Some(true);
    database.meta.recyclebin_uuid = Some(uuid);
    database.meta.recyclebin_changed = Some(Times::now());
    Ok(id)
}

pub(crate) fn recycle_bin_id(database: &Database) -> Option<keepass::db::GroupId> {
    let uuid = database.meta.recyclebin_uuid?;
    let id = keepass::db::GroupId::from_uuid(uuid);
    database.group(id).map(|_| id)
}

pub(crate) fn group_is_in_recycle_bin(
    database: &Database,
    group_id: keepass::db::GroupId,
    recycle_id: keepass::db::GroupId,
) -> bool {
    let mut current = Some(group_id);
    while let Some(id) = current {
        if id == recycle_id {
            return true;
        }
        current = database
            .group(id)
            .and_then(|group| group.parent().map(|parent| parent.id()));
    }
    false
}
#[cfg(test)]
mod tests {
    use std::io::Cursor;

    use vault_core::{NewEntry, SecretString};

    use super::*;

    fn add_entry(document: &mut KdbxDocument, title: &str) -> EntryId {
        let root = GroupId::new(document.database.root().id().to_string());
        let password = SecretString::new("fixture".to_owned());
        document
            .create_entry(
                &root,
                NewEntry {
                    title,
                    username: "",
                    url: "",
                    password: Some(&password),
                },
            )
            .expect("entry")
    }

    #[test]
    fn recycle_bin_setting_is_noop_stable_and_lazy_when_reenabled() {
        let mut document = KdbxDocument::new("settings");
        let initial_revision = document.revision();
        document
            .set_recycle_bin_enabled(true)
            .expect("effective true should no-op");
        assert_eq!(document.revision(), initial_revision);
        assert!(document.recycle_bin_enabled());
        assert!(document.recycle_bin_group_id().is_none());

        document
            .set_recycle_bin_enabled(false)
            .expect("empty recycle bin can disable");
        let disabled_revision = document.revision();
        assert!(!document.recycle_bin_enabled());
        assert!(document.recycle_bin_group_id().is_none());

        let entry = add_entry(&mut document, "active");
        assert!(matches!(
            document.trash_entry(&entry),
            Err(KdbxError::RecycleBinDisabled)
        ));
        assert_eq!(document.revision(), disabled_revision + 1);

        document.set_recycle_bin_enabled(true).expect("reenable");
        assert!(document.recycle_bin_enabled());
        assert!(document.recycle_bin_group_id().is_none());
        document.trash_entry(&entry).expect("trash after reenable");
        assert!(document.recycle_bin_group_id().is_some());
    }

    #[test]
    fn disabling_nonempty_recycle_bin_fails_without_mutating_policy() {
        let mut document = KdbxDocument::new("settings");
        let entry = add_entry(&mut document, "recycled");
        document.trash_entry(&entry).expect("trash");
        let revision = document.revision();

        assert!(matches!(
            document.set_recycle_bin_enabled(false),
            Err(KdbxError::InvalidRecycleBinOperation)
        ));
        assert_eq!(document.revision(), revision);
        assert!(document.recycle_bin_enabled());

        document
            .permanently_delete_recycled_entry(&entry)
            .expect("empty trash");
        document
            .set_recycle_bin_enabled(false)
            .expect("empty recycle bin can disable");
        assert!(!document.recycle_bin_enabled());
        assert!(document.recycle_bin_group_id().is_some());
    }

    #[test]
    fn recycle_bin_policy_roundtrips_through_kdbx_serialization() {
        let mut document = KdbxDocument::new("settings");
        document
            .set_recycle_bin_enabled(false)
            .expect("disable recycle bin");
        let mut saved = Vec::new();
        document
            .save_to_writer(&mut saved, "fixture")
            .expect("serialize recycle-bin policy");

        let reopened = KdbxDocument::open_reader(&mut Cursor::new(saved), "fixture")
            .expect("reopen recycle-bin policy");
        assert!(!reopened.recycle_bin_enabled());
        assert!(reopened.recycle_bin_group_id().is_none());
    }
}
