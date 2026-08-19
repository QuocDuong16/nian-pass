//! Narrow three-way sync adapter over the complete private `keepass` model.
//!
//! This module deliberately keeps secret-bearing values and dependency types
//! inside `kdbx`. Public conflict descriptors identify only an object and a
//! field category/name; they never carry competing values.

use std::{
    collections::{BTreeMap, BTreeSet, HashMap, HashSet},
    ops::Deref,
};

use keepass::{
    Database,
    db::{
        CustomIconId, Entry, EntryId as UpstreamEntryId, Group, GroupId as UpstreamGroupId,
        History, Icon, Meta, Times, Value,
    },
};
use vault_core::{EntryId, GroupId};

use crate::{KdbxDocument, KdbxError};

/// The ambiguity that prevented a complete automatic merge.
#[derive(Clone, Copy, Eq, PartialEq)]
#[non_exhaustive]
pub enum SyncConflictKind {
    /// Both branches changed one value differently.
    FieldEdit,
    /// One branch deleted an object changed by the other branch.
    DeleteVsModify,
    /// Both branches moved one object to different parents.
    MoveVsMove,
    /// A deleted group contains a changed or newly-created descendant.
    GroupDeleteVsDescendantChange,
    /// Both branches independently introduced different objects with one UUID.
    UuidCollision,
    /// The proposed hierarchy would be cyclic or otherwise invalid.
    HierarchyCycle,
    /// Database-level or group-level metadata diverged ambiguously.
    Metadata,
    /// Attachment state could not be combined without loss.
    Binary,
    /// Custom-icon state could not be combined without loss.
    CustomIcon,
    /// Entry history could not be combined without loss.
    History,
    /// Parsed semantics cannot currently be synthesized safely.
    UnsupportedSemantic,
}

/// Dependency-neutral identity of an object involved in a conflict.
#[derive(Clone, Eq, PartialEq)]
#[non_exhaustive]
pub enum SyncConflictObject {
    /// One KDBX entry UUID.
    Entry(EntryId),
    /// One KDBX group UUID.
    Group(GroupId),
    /// Database-wide metadata or represented auxiliary data.
    DatabaseMetadata,
}

/// Non-value classification of a conflicting entry or group property.
#[derive(Clone, Copy, Eq, PartialEq)]
#[non_exhaustive]
pub enum SyncConflictFieldKind {
    /// A standard KeePass entry field.
    Standard,
    /// A non-reserved custom entry field.
    Custom,
    /// A reserved KeePass/KeePassXC entry field.
    Reserved,
    /// Other entry metadata.
    EntryMetadata,
    /// Group metadata.
    GroupMetadata,
    /// Database metadata.
    DatabaseMetadata,
}

/// Optional privacy-sensitive field identity without any competing value.
#[derive(Clone, Eq, PartialEq)]
pub struct SyncConflictField {
    kind: SyncConflictFieldKind,
    name: Option<String>,
}

impl SyncConflictField {
    /// Returns the non-value field category.
    #[must_use]
    pub const fn kind(&self) -> SyncConflictFieldKind {
        self.kind
    }

    /// Explicitly exposes the privacy-sensitive field name, when one exists.
    #[must_use]
    pub fn name(&self) -> Option<&str> {
        self.name.as_deref()
    }
}

/// One structured conflict without secret plaintext.
///
/// Conflict diagnostics are deliberately not formattable automatically:
///
/// ```compile_fail
/// fn render(conflict: &kdbx::SyncConflict) {
///     let _ = format!("{conflict:?}");
/// }
/// ```
#[derive(Clone, Eq, PartialEq)]
pub struct SyncConflict {
    object: SyncConflictObject,
    kind: SyncConflictKind,
    field: Option<SyncConflictField>,
}

impl SyncConflict {
    /// Returns the dependency-neutral object identity.
    #[must_use]
    pub const fn object(&self) -> &SyncConflictObject {
        &self.object
    }

    /// Returns the conflict category.
    #[must_use]
    pub const fn kind(&self) -> SyncConflictKind {
        self.kind
    }

    /// Returns optional field metadata, never a field value.
    #[must_use]
    pub const fn field(&self) -> Option<&SyncConflictField> {
        self.field.as_ref()
    }
}

/// A non-empty collection of conflicts. This type has no automatic diagnostics.
pub struct SyncConflictSet {
    conflicts: Vec<SyncConflict>,
}

impl SyncConflictSet {
    /// Number of detected conflicts.
    #[must_use]
    pub fn len(&self) -> usize {
        self.conflicts.len()
    }

    /// Whether the collection is empty. Produced conflict sets are non-empty.
    #[must_use]
    pub fn is_empty(&self) -> bool {
        self.conflicts.is_empty()
    }

    /// Iterates conflict descriptors without exposing values.
    pub fn iter(&self) -> impl Iterator<Item = &SyncConflict> {
        self.conflicts.iter()
    }
}

/// Complete result of divergent KDBX synthesis inside the sealed adapter.
pub enum KdbxDivergentMergeOutcome {
    /// A complete owned document was synthesized.
    Merged(Box<KdbxDocument>),
    /// Ambiguity was detected and no document was returned.
    Conflicted(SyncConflictSet),
}

#[derive(Clone, Eq, PartialEq)]
struct EntryState {
    entry: Entry,
    parent: UpstreamGroupId,
    previous_parent: Option<UpstreamGroupId>,
    attachments: HashMap<String, Value<Vec<u8>>>,
}

#[derive(Clone, Eq, PartialEq)]
struct GroupState {
    group: Group,
    parent: Option<UpstreamGroupId>,
    previous_parent: Option<UpstreamGroupId>,
    child_groups: Vec<UpstreamGroupId>,
    child_entries: Vec<UpstreamEntryId>,
}

#[derive(Clone, Eq, PartialEq)]
struct IconState {
    name: Option<String>,
    last_modification_time: Option<chrono::NaiveDateTime>,
    data: Vec<u8>,
}

struct MergeBuilder<'a> {
    base: &'a Database,
    local: &'a Database,
    remote: &'a Database,
    candidate: Database,
    conflicts: Vec<SyncConflict>,
}

impl KdbxDocument {
    /// Validates UUID namespace, tombstone, root, and hierarchy invariants for sync.
    #[doc(hidden)]
    pub fn validate_for_sync(&self) -> Result<(), KdbxError> {
        database_valid_for_sync(&self.database)
            .then_some(())
            .ok_or(KdbxError::SyncInvariant)
    }

    /// Synthesizes divergent BASE/LOCAL/REMOTE state without exposing `keepass` types.
    ///
    /// Inputs are immutable and a candidate is returned only when every represented
    /// change was either preserved or proven equivalent.
    #[doc(hidden)]
    pub fn merge_divergent(
        base: &Self,
        local: &Self,
        remote: &Self,
    ) -> Result<KdbxDivergentMergeOutcome, KdbxError> {
        if base.version != local.version
            || base.version != remote.version
            || base.version != (crate::KdbxVersion::Kdbx4 { minor: 1 })
        {
            return Err(KdbxError::SyncInvariant);
        }
        let mut builder = MergeBuilder {
            base: &base.database,
            local: &local.database,
            remote: &remote.database,
            candidate: local.database.clone(),
            conflicts: Vec::new(),
        };
        builder.merge()?;

        if builder.conflicts.is_empty() {
            Ok(KdbxDivergentMergeOutcome::Merged(Box::new(Self {
                version: local.version,
                database: builder.candidate,
                revision: 0,
                revision_permanently_dirty: false,
            })))
        } else {
            Ok(KdbxDivergentMergeOutcome::Conflicted(SyncConflictSet {
                conflicts: builder.conflicts,
            }))
        }
    }
}

fn database_valid_for_sync(database: &Database) -> bool {
    let root = database.root().id();
    if database.root().parent().is_some() {
        return false;
    }

    let mut live = HashSet::new();
    for id in database
        .iter_all_entries()
        .map(|entry| entry.id().uuid())
        .chain(database.iter_all_groups().map(|group| group.id().uuid()))
        .chain(
            database
                .iter_all_custom_icons()
                .map(|icon| icon.id().uuid()),
        )
    {
        if !live.insert(id) || database.deleted_objects.contains_key(&id) {
            return false;
        }
    }

    let mut child_groups = HashSet::new();
    let mut child_entries = HashSet::new();
    for group in database.iter_all_groups() {
        let mut seen = HashSet::new();
        let mut current = Some(group.id());
        while let Some(id) = current {
            if !seen.insert(id) {
                return false;
            }
            let Some(current_group) = database.group(id) else {
                return false;
            };
            current = current_group.parent().map(|parent| parent.id());
        }
        if !seen.contains(&root) {
            return false;
        }
        if matches!(group.icon(), Some(Icon::Custom(id)) if database.custom_icon(*id).is_none()) {
            return false;
        }
        for child_id in group.group_ids() {
            let Some(child) = database.group(child_id) else {
                return false;
            };
            if child.parent().map(|parent| parent.id()) != Some(group.id())
                || !child_groups.insert(child_id)
            {
                return false;
            }
        }
        for entry_id in group.entry_ids() {
            let Some(entry) = database.entry(entry_id) else {
                return false;
            };
            if entry.parent().id() != group.id() || !child_entries.insert(entry_id) {
                return false;
            }
        }
    }
    for entry in database.iter_all_entries() {
        if matches!(entry.icon(), Some(Icon::Custom(id)) if database.custom_icon(*id).is_none()) {
            return false;
        }
        let history_len = entry
            .history
            .as_ref()
            .map_or(0, |history| history.get_entries().len());
        for index in 0..history_len {
            let Some(historical) = entry.historical(index) else {
                return false;
            };
            if matches!(historical.icon(), Some(Icon::Custom(id)) if database.custom_icon(*id).is_none())
            {
                return false;
            }
        }
    }
    child_groups.len() + 1 == database.num_groups() && child_entries.len() == database.num_entries()
}

impl MergeBuilder<'_> {
    fn merge(&mut self) -> Result<(), KdbxError> {
        self.validate_roots();
        self.validate_input_identities();
        self.merge_config_and_metadata();
        self.merge_custom_icons();
        self.merge_groups()?;
        self.merge_entries()?;
        self.merge_tombstones();
        self.validate_final_hierarchy();
        Ok(())
    }

    fn validate_roots(&mut self) {
        let base = self.base.root().id();
        if self.local.root().id() != base || self.remote.root().id() != base {
            self.database_conflict(SyncConflictKind::HierarchyCycle);
        }
    }

    fn validate_input_identities(&mut self) {
        for database in [self.base, self.local, self.remote] {
            let mut live = HashSet::new();
            let mut valid = true;
            for id in database
                .iter_all_entries()
                .map(|entry| entry.id().uuid())
                .chain(database.iter_all_groups().map(|group| group.id().uuid()))
                .chain(
                    database
                        .iter_all_custom_icons()
                        .map(|icon| icon.id().uuid()),
                )
            {
                if !live.insert(id) || database.deleted_objects.contains_key(&id) {
                    valid = false;
                }
            }
            if !valid {
                self.database_conflict(SyncConflictKind::UuidCollision);
            }
        }
    }

    fn merge_config_and_metadata(&mut self) {
        if let Some(config) =
            choose_three_way(&self.base.config, &self.local.config, &self.remote.config)
        {
            self.candidate.config = config;
        } else {
            self.database_conflict(SyncConflictKind::Metadata);
        }

        let mut merged = self.local.meta.clone();
        merge_meta(
            &self.base.meta,
            &self.local.meta,
            &self.remote.meta,
            &mut merged,
            &mut self.conflicts,
        );
        self.candidate.meta = merged;
    }

    fn merge_custom_icons(&mut self) {
        let base = icon_index(self.base);
        let local = icon_index(self.local);
        let remote = icon_index(self.remote);
        let ids = all_keys3(&base, &local, &remote);

        for id in ids {
            match (base.get(&id), local.get(&id), remote.get(&id)) {
                (Some(base_icon), Some(local_icon), Some(remote_icon)) => {
                    match choose_three_way(base_icon, local_icon, remote_icon) {
                        Some(merged) if &merged == local_icon => {}
                        Some(merged) => {
                            if let Some(mut icon) = self.candidate.custom_icon_mut(id) {
                                icon.name = merged.name;
                                icon.last_modification_time = merged.last_modification_time;
                                icon.data = merged.data;
                            } else {
                                self.icon_conflict();
                            }
                        }
                        None => self.icon_conflict(),
                    }
                }
                (Some(base_icon), Some(local_icon), None) => {
                    if remote_deleted(self.remote, id.uuid()) {
                        if local_icon == base_icon {
                            if let Some(icon) = self.candidate.custom_icon_mut(id) {
                                icon.remove();
                            }
                        } else {
                            self.icon_conflict_kind(SyncConflictKind::DeleteVsModify);
                        }
                    } else {
                        self.icon_conflict_kind(SyncConflictKind::UnsupportedSemantic);
                    }
                }
                (Some(base_icon), None, Some(remote_icon)) => {
                    if local_deleted(self.local, id.uuid()) {
                        if remote_icon != base_icon {
                            self.icon_conflict_kind(SyncConflictKind::DeleteVsModify);
                        }
                    } else {
                        self.icon_conflict_kind(SyncConflictKind::UnsupportedSemantic);
                    }
                }
                (Some(_), None, None) => {}
                (None, Some(local_icon), Some(remote_icon))
                    if local_icon == remote_icon
                        && !self.base.deleted_objects.contains_key(&id.uuid()) => {}
                (None, Some(_), Some(_)) => {
                    self.icon_conflict_kind(SyncConflictKind::UuidCollision);
                }
                (None, None, Some(_)) if local_deleted(self.local, id.uuid()) => {
                    self.icon_conflict_kind(SyncConflictKind::UuidCollision);
                }
                (None, None, Some(_)) => {
                    // keepass-rs 0.13.21 does not expose insertion with a chosen
                    // CustomIconId. Refuse instead of regenerating an identity.
                    self.icon_conflict_kind(SyncConflictKind::UnsupportedSemantic);
                }
                (None, Some(_), None) if remote_deleted(self.remote, id.uuid()) => {
                    self.icon_conflict_kind(SyncConflictKind::UuidCollision);
                }
                (None, Some(_), None) | (None, None, None) => {}
            }
        }
    }

    fn merge_groups(&mut self) -> Result<(), KdbxError> {
        let base = group_index(self.base);
        let local = group_index(self.local);
        let remote = group_index(self.remote);
        let ids = all_keys3(&base, &local, &remote);
        let root = self.base.root().id();
        let mut remote_additions = Vec::new();
        let mut remote_deletions = Vec::new();

        for id in &ids {
            if *id == root {
                continue;
            }
            match (base.get(id), local.get(id), remote.get(id)) {
                (Some(base_group), Some(local_group), Some(remote_group)) => {
                    self.merge_existing_group(*id, base_group, local_group, remote_group)?;
                }
                (Some(base_group), Some(local_group), None) => {
                    if !remote_deleted(self.remote, id.uuid()) {
                        self.group_conflict(*id, SyncConflictKind::UnsupportedSemantic);
                    } else if local_group == base_group {
                        remote_deletions.push(*id);
                    } else {
                        self.group_conflict(*id, SyncConflictKind::DeleteVsModify);
                    }
                }
                (Some(base_group), None, Some(remote_group)) => {
                    if !local_deleted(self.local, id.uuid()) {
                        self.group_conflict(*id, SyncConflictKind::UnsupportedSemantic);
                    } else if remote_group != base_group {
                        self.group_conflict(*id, SyncConflictKind::DeleteVsModify);
                    }
                }
                (Some(_), None, None) => {}
                (None, Some(local_group), Some(remote_group)) => {
                    if self.base.deleted_objects.contains_key(&id.uuid())
                        || local_group != remote_group
                    {
                        self.group_conflict(*id, SyncConflictKind::UuidCollision);
                    }
                }
                (None, None, Some(_)) if local_deleted(self.local, id.uuid()) => {
                    self.group_conflict(*id, SyncConflictKind::UuidCollision);
                }
                (None, None, Some(_)) => remote_additions.push(*id),
                (None, Some(_), None) if remote_deleted(self.remote, id.uuid()) => {
                    self.group_conflict(*id, SyncConflictKind::UuidCollision);
                }
                (None, Some(_), None) | (None, None, None) => {}
            }
        }

        remote_additions.sort_by_key(|id| id.uuid());
        let mut pending = remote_additions;
        while !pending.is_empty() {
            let before = pending.len();
            pending.retain(|id| {
                let Some(source) = self.remote.group(*id) else {
                    return false;
                };
                let Some(parent_id) = source.parent().map(|parent| parent.id()) else {
                    self.group_conflict(*id, SyncConflictKind::HierarchyCycle);
                    return false;
                };
                let Some(mut parent) = self.candidate.group_mut(parent_id) else {
                    return true;
                };
                let Ok(mut added) = parent.add_group_with_id(*id) else {
                    self.group_conflict(*id, SyncConflictKind::UuidCollision);
                    return false;
                };
                *added = source.deref().clone();
                false
            });
            if pending.len() == before {
                for id in pending.drain(..) {
                    self.group_conflict(id, SyncConflictKind::GroupDeleteVsDescendantChange);
                }
            }
        }

        // Delete only top-most requested groups; upstream removal is recursive.
        remote_deletions.sort_by_key(|id| id.uuid());
        for id in remote_deletions {
            if let Some(group) = self.candidate.group_mut(id) {
                group.remove();
            }
        }
        Ok(())
    }

    fn merge_existing_group(
        &mut self,
        id: UpstreamGroupId,
        base: &GroupState,
        local: &GroupState,
        remote: &GroupState,
    ) -> Result<(), KdbxError> {
        let merged_parent = match choose_three_way(&base.parent, &local.parent, &remote.parent) {
            Some(parent) => parent,
            None => {
                self.group_conflict(id, SyncConflictKind::MoveVsMove);
                local.parent
            }
        };
        if remote.group != base.group && !group_change_is_representable(self.base, id, remote) {
            self.group_conflict(id, SyncConflictKind::UnsupportedSemantic);
        }
        let merged_previous_parent = choose_three_way(
            &base.previous_parent,
            &local.previous_parent,
            &remote.previous_parent,
        );
        if merged_previous_parent.is_none()
            || (merged_parent == local.parent
                && merged_previous_parent.as_ref() != Some(&local.previous_parent))
        {
            self.group_conflict(id, SyncConflictKind::UnsupportedSemantic);
        }

        let mut merged = local.group.clone();
        let merged_icon = choose_three_way(
            &base.group.icon().cloned(),
            &local.group.icon().cloned(),
            &remote.group.icon().cloned(),
        );
        merge_group_properties(base, local, remote, &mut merged, &mut self.conflicts);
        if let Some(mut target) = self.candidate.group_mut(id) {
            target.name = merged.name;
            target.notes = merged.notes;
            target.tags = merged.tags;
            target.times = merged.times;
            target.custom_data = merged.custom_data;
            target.is_expanded = merged.is_expanded;
            target.default_autotype_sequence = merged.default_autotype_sequence;
            target.enable_autotype = merged.enable_autotype;
            target.enable_searching = merged.enable_searching;
            if let Some(icon) = merged_icon.as_ref() {
                apply_group_icon(&mut target, icon.as_ref(), &mut self.conflicts, id);
            }
        }

        if merged_parent != local.parent {
            let Some(parent) = merged_parent else {
                self.group_conflict(id, SyncConflictKind::HierarchyCycle);
                return Ok(());
            };
            let Some(mut target) = self.candidate.group_mut(id) else {
                return Err(KdbxError::SyncInvariant);
            };
            if target.move_to(parent).is_err() {
                self.group_conflict(id, SyncConflictKind::HierarchyCycle);
            } else {
                target.times.location_changed = remote.group.times.location_changed;
            }
        }
        Ok(())
    }

    fn merge_entries(&mut self) -> Result<(), KdbxError> {
        let base = entry_index(self.base);
        let local = entry_index(self.local);
        let remote = entry_index(self.remote);
        let ids = all_keys3(&base, &local, &remote);

        for id in ids {
            match (base.get(&id), local.get(&id), remote.get(&id)) {
                (Some(base_entry), Some(local_entry), Some(remote_entry)) => {
                    self.merge_existing_entry(id, base_entry, local_entry, remote_entry)?;
                }
                (Some(base_entry), Some(local_entry), None) => {
                    if !remote_deleted(self.remote, id.uuid()) {
                        self.entry_conflict(id, SyncConflictKind::UnsupportedSemantic, None);
                    } else if local_entry == base_entry {
                        if let Some(entry) = self.candidate.entry_mut(id) {
                            entry.remove();
                        }
                    } else {
                        self.entry_conflict(id, SyncConflictKind::DeleteVsModify, None);
                    }
                }
                (Some(base_entry), None, Some(remote_entry)) => {
                    if !local_deleted(self.local, id.uuid()) {
                        self.entry_conflict(id, SyncConflictKind::UnsupportedSemantic, None);
                    } else if remote_entry != base_entry {
                        self.entry_conflict(id, SyncConflictKind::DeleteVsModify, None);
                    }
                }
                (Some(_), None, None) => {}
                (None, Some(local_entry), Some(remote_entry)) => {
                    if self.base.deleted_objects.contains_key(&id.uuid())
                        || local_entry != remote_entry
                    {
                        self.entry_conflict(id, SyncConflictKind::UuidCollision, None);
                    }
                }
                (None, None, Some(_)) if local_deleted(self.local, id.uuid()) => {
                    self.entry_conflict(id, SyncConflictKind::UuidCollision, None);
                }
                (None, None, Some(remote_entry)) => self.add_remote_entry(id, remote_entry),
                (None, Some(_), None) if remote_deleted(self.remote, id.uuid()) => {
                    self.entry_conflict(id, SyncConflictKind::UuidCollision, None);
                }
                (None, Some(_), None) | (None, None, None) => {}
            }
        }
        Ok(())
    }

    fn add_remote_entry(&mut self, id: UpstreamEntryId, source: &EntryState) {
        if !source.attachments.is_empty() || history_has_attachments(self.remote, id) {
            self.entry_conflict(id, SyncConflictKind::Binary, None);
            return;
        }
        if entry_references_unavailable_icon(&self.candidate, &source.entry) {
            self.entry_conflict(id, SyncConflictKind::CustomIcon, None);
            return;
        }
        let Some(mut parent) = self.candidate.group_mut(source.parent) else {
            self.entry_conflict(id, SyncConflictKind::GroupDeleteVsDescendantChange, None);
            return;
        };
        match parent.add_entry_with_id(id) {
            Ok(mut added) => *added = source.entry.clone(),
            Err(_) => self.entry_conflict(id, SyncConflictKind::UuidCollision, None),
        }
    }

    fn merge_existing_entry(
        &mut self,
        id: UpstreamEntryId,
        base: &EntryState,
        local: &EntryState,
        remote: &EntryState,
    ) -> Result<(), KdbxError> {
        let parent = match choose_three_way(&base.parent, &local.parent, &remote.parent) {
            Some(parent) => parent,
            None => {
                self.entry_conflict(id, SyncConflictKind::MoveVsMove, None);
                local.parent
            }
        };
        let merged_previous_parent = choose_three_way(
            &base.previous_parent,
            &local.previous_parent,
            &remote.previous_parent,
        );
        if merged_previous_parent.is_none()
            || (parent == local.parent
                && merged_previous_parent.as_ref() != Some(&local.previous_parent))
        {
            self.entry_conflict(id, SyncConflictKind::UnsupportedSemantic, None);
        }

        let mut merged = local.entry.clone();
        merged.fields = merge_named_map(
            &base.entry.fields,
            &local.entry.fields,
            &remote.entry.fields,
            |name| self.entry_field_conflict(id, name),
        );
        merge_entry_properties(base, local, remote, &mut merged, &mut self.conflicts);
        let attachments = merge_named_map(
            &base.attachments,
            &local.attachments,
            &remote.attachments,
            |_| self.entry_conflict(id, SyncConflictKind::Binary, None),
        );
        merged.history = merge_history(
            base.entry.history.as_ref(),
            local.entry.history.as_ref(),
            remote.entry.history.as_ref(),
            self.remote,
            id,
            &mut self.conflicts,
        );

        let merged_icon = choose_three_way(
            &base.entry.icon().cloned(),
            &local.entry.icon().cloned(),
            &remote.entry.icon().cloned(),
        );
        {
            let mut target = self
                .candidate
                .entry_mut(id)
                .ok_or(KdbxError::SyncInvariant)?;
            *target = merged;
        }

        if let Some(icon) = merged_icon {
            let mut target = self
                .candidate
                .entry_mut(id)
                .ok_or(KdbxError::SyncInvariant)?;
            match icon {
                None => target.set_icon_none(),
                Some(Icon::BuiltIn(icon_id)) => target.set_icon_builtin(icon_id),
                Some(Icon::Custom(custom_id)) => {
                    if target.set_icon_custom(custom_id).is_err() {
                        self.entry_conflict(id, SyncConflictKind::CustomIcon, None);
                    }
                }
            }
        }

        if parent != local.parent {
            let mut target = self
                .candidate
                .entry_mut(id)
                .ok_or(KdbxError::SyncInvariant)?;
            if target.move_to(parent).is_err() {
                self.entry_conflict(id, SyncConflictKind::HierarchyCycle, None);
            } else {
                target.times.location_changed = remote.entry.times.location_changed;
            }
        }

        if attachments != local.attachments {
            let mut target = self
                .candidate
                .entry_mut(id)
                .ok_or(KdbxError::SyncInvariant)?;
            let names = target
                .as_ref()
                .attachments_named()
                .map(|(name, _)| name.to_owned())
                .collect::<Vec<_>>();
            for name in names {
                target.remove_attachment_by_name(&name);
            }
            for (name, value) in attachments {
                target.add_attachment(name, value);
            }
        }
        if parent != base.parent {
            normalize_history_parents(&mut self.candidate, id, &mut self.conflicts)?;
        }
        Ok(())
    }

    fn merge_tombstones(&mut self) {
        let mut all = BTreeSet::new();
        all.extend(self.base.deleted_objects.keys().copied());
        all.extend(self.local.deleted_objects.keys().copied());
        all.extend(self.remote.deleted_objects.keys().copied());
        for id in all {
            let selected = [
                self.base.deleted_objects.get(&id).copied().flatten(),
                self.local.deleted_objects.get(&id).copied().flatten(),
                self.remote.deleted_objects.get(&id).copied().flatten(),
            ]
            .into_iter()
            .flatten()
            .max();
            self.candidate.deleted_objects.insert(id, selected);
        }
    }

    fn validate_final_hierarchy(&mut self) {
        let root = self.candidate.root().id();
        let ids = self
            .candidate
            .iter_all_groups()
            .map(|group| group.id())
            .collect::<Vec<_>>();
        for id in ids {
            let mut seen = HashSet::new();
            let mut current = Some(id);
            while let Some(group_id) = current {
                if !seen.insert(group_id) {
                    self.group_conflict(id, SyncConflictKind::HierarchyCycle);
                    break;
                }
                current = self
                    .candidate
                    .group(group_id)
                    .and_then(|group| group.parent().map(|parent| parent.id()));
            }
            if id == root
                && self
                    .candidate
                    .group(id)
                    .is_some_and(|group| group.parent().is_some())
            {
                self.group_conflict(id, SyncConflictKind::HierarchyCycle);
            }
        }
    }

    fn entry_field_conflict(&mut self, id: UpstreamEntryId, name: &str) {
        let kind = if crate::TOTP_FIELD_NAMES.contains(&name)
            || name.starts_with(crate::PASSKEY_FIELD_PREFIX)
        {
            SyncConflictFieldKind::Reserved
        } else if matches!(
            name,
            keepass::db::fields::TITLE
                | keepass::db::fields::USERNAME
                | keepass::db::fields::PASSWORD
                | keepass::db::fields::URL
                | keepass::db::fields::NOTES
        ) {
            SyncConflictFieldKind::Standard
        } else {
            SyncConflictFieldKind::Custom
        };
        self.entry_conflict(
            id,
            SyncConflictKind::FieldEdit,
            Some(SyncConflictField {
                kind,
                name: Some(name.to_owned()),
            }),
        );
    }

    fn entry_conflict(
        &mut self,
        id: UpstreamEntryId,
        kind: SyncConflictKind,
        field: Option<SyncConflictField>,
    ) {
        self.conflicts.push(SyncConflict {
            object: SyncConflictObject::Entry(EntryId::new(id.to_string())),
            kind,
            field,
        });
    }

    fn group_conflict(&mut self, id: UpstreamGroupId, kind: SyncConflictKind) {
        self.conflicts.push(SyncConflict {
            object: SyncConflictObject::Group(GroupId::new(id.to_string())),
            kind,
            field: None,
        });
    }

    fn icon_conflict(&mut self) {
        self.icon_conflict_kind(SyncConflictKind::CustomIcon);
    }

    fn icon_conflict_kind(&mut self, kind: SyncConflictKind) {
        self.conflicts.push(SyncConflict {
            object: SyncConflictObject::DatabaseMetadata,
            kind,
            field: None,
        });
    }

    fn database_conflict(&mut self, kind: SyncConflictKind) {
        self.conflicts.push(SyncConflict {
            object: SyncConflictObject::DatabaseMetadata,
            kind,
            field: None,
        });
    }
}

fn entry_index(database: &Database) -> HashMap<UpstreamEntryId, EntryState> {
    database
        .iter_all_entries()
        .map(|entry| {
            let state = EntryState {
                entry: entry.clone(),
                parent: entry.parent().id(),
                previous_parent: entry.previous_parent().map(|group| group.id()),
                attachments: entry
                    .attachments_named()
                    .map(|(name, attachment)| (name.to_owned(), attachment.data.clone()))
                    .collect(),
            };
            (entry.id(), state)
        })
        .collect()
}

fn group_index(database: &Database) -> HashMap<UpstreamGroupId, GroupState> {
    database
        .iter_all_groups()
        .map(|group| {
            let state = GroupState {
                group: group.deref().clone(),
                parent: group.parent().map(|parent| parent.id()),
                previous_parent: group.previous_parent().map(|parent| parent.id()),
                child_groups: group.group_ids().collect(),
                child_entries: group.entry_ids().collect(),
            };
            (group.id(), state)
        })
        .collect()
}

fn group_change_is_representable(
    base_database: &Database,
    id: UpstreamGroupId,
    remote: &GroupState,
) -> bool {
    let mut probe = base_database.clone();
    let root = probe.root().id();

    let current_parent = probe
        .group(id)
        .and_then(|group| group.parent().map(|parent| parent.id()));
    if current_parent != remote.parent {
        let Some(parent) = remote.parent else {
            return false;
        };
        if probe.group(parent).is_none() {
            let mut root_group = probe.root_mut();
            let Ok(mut placeholder) = root_group.add_group_with_id(parent) else {
                return false;
            };
            placeholder.name.clear();
        }
        let Some(mut target) = probe.group_mut(id) else {
            return false;
        };
        if id == root || target.move_to(parent).is_err() {
            return false;
        }
    }

    let Some(target) = probe.group(id) else {
        return false;
    };
    let old_groups = target.group_ids().collect::<Vec<_>>();
    let old_entries = target.entry_ids().collect::<Vec<_>>();
    for child in old_entries {
        if let Some(entry) = probe.entry_mut(child) {
            entry.remove();
        }
    }
    for child in old_groups {
        if let Some(group) = probe.group_mut(child) {
            group.remove();
        }
    }

    for child in &remote.child_groups {
        if probe.group(*child).is_some() {
            let Some(mut child_group) = probe.group_mut(*child) else {
                return false;
            };
            if child_group.move_to(id).is_err() {
                return false;
            }
        } else {
            let Some(mut target) = probe.group_mut(id) else {
                return false;
            };
            if target.add_group_with_id(*child).is_err() {
                return false;
            }
        }
    }
    for entry in &remote.child_entries {
        if probe.entry(*entry).is_some() {
            let Some(mut child_entry) = probe.entry_mut(*entry) else {
                return false;
            };
            if child_entry.move_to(id).is_err() {
                return false;
            }
        } else {
            let Some(mut target) = probe.group_mut(id) else {
                return false;
            };
            if target.add_entry_with_id(*entry).is_err() {
                return false;
            }
        }
    }

    let Some(mut target) = probe.group_mut(id) else {
        return false;
    };
    target.name = remote.group.name.clone();
    target.notes = remote.group.notes.clone();
    target.tags = remote.group.tags.clone();
    target.times = remote.group.times.clone();
    target.custom_data = remote.group.custom_data.clone();
    target.is_expanded = remote.group.is_expanded;
    target.default_autotype_sequence = remote.group.default_autotype_sequence.clone();
    target.enable_autotype = remote.group.enable_autotype;
    target.enable_searching = remote.group.enable_searching;
    match remote.group.icon() {
        None => target.set_icon_none(),
        Some(Icon::BuiltIn(icon)) => target.set_icon_builtin(*icon),
        Some(Icon::Custom(icon)) if target.set_icon_custom(*icon).is_ok() => {}
        Some(Icon::Custom(_)) => return false,
    }

    target.deref() == &remote.group
}

fn icon_index(database: &Database) -> HashMap<CustomIconId, IconState> {
    database
        .iter_all_custom_icons()
        .map(|icon| {
            (
                icon.id(),
                IconState {
                    name: icon.name.clone(),
                    last_modification_time: icon.last_modification_time,
                    data: icon.data.clone(),
                },
            )
        })
        .collect()
}

/// Compares complete represented semantics while ignoring dependency-internal
/// attachment indexes and derived reverse-reference caches. Those values are
/// reconstructed during serialization and are not KDBX semantic identity.
pub(super) fn database_semantically_eq(left: &Database, right: &Database) -> bool {
    if left.config != right.config
        || left.meta != right.meta
        || left.deleted_objects != right.deleted_objects
        || left.root().id() != right.root().id()
        || left.num_groups() != right.num_groups()
        || left.num_entries() != right.num_entries()
    {
        return false;
    }

    for group in left.iter_all_groups() {
        let Some(other) = right.group(group.id()) else {
            return false;
        };
        if group.deref() != other.deref() {
            return false;
        }
    }

    for entry in left.iter_all_entries() {
        let Some(other) = right.entry(entry.id()) else {
            return false;
        };
        if !entry_semantically_eq(entry, other) {
            return false;
        }
    }

    let left_icons = icon_index(left);
    let right_icons = icon_index(right);
    if left_icons != right_icons {
        return false;
    }

    attachment_values(left) == attachment_values(right)
}

fn entry_semantically_eq(
    left: keepass::db::EntryRef<'_>,
    right: keepass::db::EntryRef<'_>,
) -> bool {
    if left.id() != right.id()
        || left.parent().id() != right.parent().id()
        || left.previous_parent().map(|group| group.id())
            != right.previous_parent().map(|group| group.id())
        || left.fields != right.fields
        || left.autotype != right.autotype
        || left.tags != right.tags
        || left.times != right.times
        || left.custom_data != right.custom_data
        || left.icon() != right.icon()
        || left.foreground_color != right.foreground_color
        || left.background_color != right.background_color
        || left.override_url != right.override_url
        || left.quality_check != right.quality_check
        || named_attachments(&left) != named_attachments(&right)
    {
        return false;
    }

    let left_history_len = left
        .history
        .as_ref()
        .map_or(0, |history| history.get_entries().len());
    let right_history_len = right
        .history
        .as_ref()
        .map_or(0, |history| history.get_entries().len());
    left_history_len == right_history_len
        && (0..left_history_len).all(|index| {
            let Some(left_history) = left.historical(index) else {
                return false;
            };
            let Some(right_history) = right.historical(index) else {
                return false;
            };
            history_entry_semantically_eq(left_history, right_history)
        })
}

fn history_entry_semantically_eq(
    left: keepass::db::EntryRef<'_>,
    right: keepass::db::EntryRef<'_>,
) -> bool {
    left.id() == right.id()
        && left.parent().id() == right.parent().id()
        && left.fields == right.fields
        && left.autotype == right.autotype
        && left.tags == right.tags
        && left.times == right.times
        && left.custom_data == right.custom_data
        && left.icon() == right.icon()
        && left.foreground_color == right.foreground_color
        && left.background_color == right.background_color
        && left.override_url == right.override_url
        && left.quality_check == right.quality_check
        && named_attachments(&left) == named_attachments(&right)
}

fn named_attachments(entry: &keepass::db::EntryRef<'_>) -> BTreeMap<String, Value<Vec<u8>>> {
    entry
        .attachments_named()
        .map(|(name, attachment)| (name.to_owned(), attachment.data.clone()))
        .collect()
}

fn attachment_values(database: &Database) -> Vec<Value<Vec<u8>>> {
    let mut values = database
        .iter_all_attachments()
        .map(|attachment| attachment.data.clone())
        .collect::<Vec<_>>();
    values.sort_by(|left, right| {
        left.is_protected()
            .cmp(&right.is_protected())
            .then_with(|| left.get().cmp(right.get()))
    });
    values
}

fn all_keys3<K, V>(base: &HashMap<K, V>, local: &HashMap<K, V>, remote: &HashMap<K, V>) -> Vec<K>
where
    K: Copy + Eq + std::hash::Hash + ToString,
{
    let mut keys = HashSet::new();
    keys.extend(base.keys().copied());
    keys.extend(local.keys().copied());
    keys.extend(remote.keys().copied());
    let mut keys = keys.into_iter().collect::<Vec<_>>();
    keys.sort_by_key(ToString::to_string);
    keys
}

fn choose_three_way<T: Clone + Eq>(base: &T, local: &T, remote: &T) -> Option<T> {
    if local == remote {
        Some(local.clone())
    } else if local == base {
        Some(remote.clone())
    } else if remote == base {
        Some(local.clone())
    } else {
        None
    }
}

fn merge_named_map<V, F>(
    base: &impl MapView<V>,
    local: &impl MapView<V>,
    remote: &impl MapView<V>,
    mut conflict: F,
) -> HashMap<String, V>
where
    V: Clone + Eq,
    F: FnMut(&str),
{
    let mut keys = BTreeSet::new();
    keys.extend(base.keys_owned());
    keys.extend(local.keys_owned());
    keys.extend(remote.keys_owned());
    let mut result = HashMap::new();
    for key in keys {
        let selected = match (
            base.get_value(&key),
            local.get_value(&key),
            remote.get_value(&key),
        ) {
            (_base, local, remote) if local == remote => local.cloned(),
            (base, local, remote) if local == base => remote.cloned(),
            (base, local, remote) if remote == base => local.cloned(),
            (_, local, _) => {
                conflict(&key);
                local.cloned()
            }
        };
        if let Some(value) = selected {
            result.insert(key, value);
        }
    }
    result
}

trait MapView<V> {
    fn keys_owned(&self) -> Vec<String>;
    fn get_value(&self, key: &str) -> Option<&V>;
}

impl<V> MapView<V> for HashMap<String, V> {
    fn keys_owned(&self) -> Vec<String> {
        self.keys().cloned().collect()
    }

    fn get_value(&self, key: &str) -> Option<&V> {
        self.get(key)
    }
}

fn merge_entry_properties(
    base: &EntryState,
    local: &EntryState,
    remote: &EntryState,
    merged: &mut Entry,
    conflicts: &mut Vec<SyncConflict>,
) {
    let id = local.entry.id();
    macro_rules! merge_prop {
        ($field:ident) => {
            if let Some(value) = choose_three_way(
                &base.entry.$field,
                &local.entry.$field,
                &remote.entry.$field,
            ) {
                merged.$field = value;
            } else {
                entry_metadata_conflict(conflicts, id);
            }
        };
    }
    merge_prop!(autotype);
    merge_prop!(tags);
    merge_prop!(custom_data);
    merge_prop!(foreground_color);
    merge_prop!(background_color);
    merge_prop!(override_url);
    merge_prop!(quality_check);

    merge_times(
        &base.entry.times,
        &local.entry.times,
        &remote.entry.times,
        &mut merged.times,
        || entry_metadata_conflict(conflicts, id),
    );

    let base_icon = base.entry.icon().cloned();
    let local_icon = local.entry.icon().cloned();
    let remote_icon = remote.entry.icon().cloned();
    if choose_three_way(&base_icon, &local_icon, &remote_icon).is_none() {
        conflicts.push(SyncConflict {
            object: SyncConflictObject::Entry(EntryId::new(id.to_string())),
            kind: SyncConflictKind::CustomIcon,
            field: None,
        });
    }
}

fn merge_group_properties(
    base: &GroupState,
    local: &GroupState,
    remote: &GroupState,
    merged: &mut Group,
    conflicts: &mut Vec<SyncConflict>,
) {
    let id = local.group.id();
    macro_rules! merge_prop {
        ($field:ident) => {
            if let Some(value) = choose_three_way(
                &base.group.$field,
                &local.group.$field,
                &remote.group.$field,
            ) {
                merged.$field = value;
            } else {
                group_metadata_conflict(conflicts, id);
            }
        };
    }
    merge_prop!(name);
    merge_prop!(notes);
    merge_prop!(tags);
    merge_prop!(custom_data);
    merge_prop!(is_expanded);
    merge_prop!(default_autotype_sequence);
    merge_prop!(enable_autotype);
    merge_prop!(enable_searching);
    merge_times(
        &base.group.times,
        &local.group.times,
        &remote.group.times,
        &mut merged.times,
        || group_metadata_conflict(conflicts, id),
    );

    if choose_three_way(
        &base.group.icon().cloned(),
        &local.group.icon().cloned(),
        &remote.group.icon().cloned(),
    )
    .is_none()
    {
        conflicts.push(SyncConflict {
            object: SyncConflictObject::Group(GroupId::new(id.to_string())),
            kind: SyncConflictKind::CustomIcon,
            field: None,
        });
    }

    // Child order is visible KDBX semantics. Local ordering is retained; a
    // remote-only reordering of pre-existing children cannot currently be
    // installed through keepass-rs without accessing private internals.
    if local.child_groups == base.child_groups
        && remote.child_groups != base.child_groups
        && set_eq(&remote.child_groups, &base.child_groups)
    {
        group_metadata_conflict(conflicts, id);
    }
    if local.child_entries == base.child_entries
        && remote.child_entries != base.child_entries
        && set_eq(&remote.child_entries, &base.child_entries)
    {
        group_metadata_conflict(conflicts, id);
    }
}

fn merge_times<F>(base: &Times, local: &Times, remote: &Times, merged: &mut Times, mut conflict: F)
where
    F: FnMut(),
{
    macro_rules! merge_time {
        ($field:ident) => {
            if let Some(value) = choose_three_way(&base.$field, &local.$field, &remote.$field) {
                merged.$field = value;
            } else {
                conflict();
            }
        };
    }
    merge_time!(creation);
    merge_time!(last_access);
    merge_time!(expiry);
    merge_time!(expires);
    merge_time!(usage_count);

    // A synthesized state uses only participating source timestamps. No wall
    // clock or random ordering enters the merge.
    merged.last_modification = local.last_modification.max(remote.last_modification);
    merged.location_changed = local.location_changed.max(remote.location_changed);
}

fn merge_meta(
    base: &Meta,
    local: &Meta,
    remote: &Meta,
    merged: &mut Meta,
    conflicts: &mut Vec<SyncConflict>,
) {
    macro_rules! merge_prop {
        ($field:ident) => {
            if let Some(value) = choose_three_way(&base.$field, &local.$field, &remote.$field) {
                merged.$field = value;
            } else {
                database_metadata_conflict(conflicts);
            }
        };
    }
    merge_prop!(generator);
    merge_prop!(database_name);
    merge_prop!(database_name_changed);
    merge_prop!(database_description);
    merge_prop!(database_description_changed);
    merge_prop!(default_username);
    merge_prop!(default_username_changed);
    merge_prop!(maintenance_history_days);
    merge_prop!(color);
    merge_prop!(master_key_changed);
    merge_prop!(master_key_change_rec);
    merge_prop!(master_key_change_force);
    merge_prop!(memory_protection);
    merge_prop!(recyclebin_enabled);
    merge_prop!(recyclebin_uuid);
    merge_prop!(recyclebin_changed);
    merge_prop!(entry_templates_group);
    merge_prop!(entry_templates_group_changed);
    merge_prop!(last_selected_group);
    merge_prop!(last_top_visible_group);
    merge_prop!(history_max_items);
    merge_prop!(history_max_size);
    merge_prop!(settings_changed);
    merged.custom_data = merge_named_map(
        &base.custom_data,
        &local.custom_data,
        &remote.custom_data,
        |_| database_metadata_conflict(conflicts),
    );
}

fn merge_history(
    base: Option<&History>,
    local: Option<&History>,
    remote: Option<&History>,
    remote_database: &Database,
    id: UpstreamEntryId,
    conflicts: &mut Vec<SyncConflict>,
) -> Option<History> {
    if local == remote {
        return local.cloned();
    }
    if local == base {
        if history_has_attachments(remote_database, id) {
            history_conflict(conflicts, id);
            return local.cloned();
        }
        return remote.cloned();
    }
    if remote == base {
        return local.cloned();
    }

    let mut entries = local.map_or_else(Vec::new, |history| history.get_entries().clone());
    if let Some(remote) = remote {
        for entry in remote.get_entries() {
            if !entries.contains(entry) {
                entries.push(entry.clone());
            }
        }
    }
    let mut history = History::default();
    for entry in entries.into_iter().rev() {
        history.add_entry(entry);
    }
    Some(history)
}

fn apply_group_icon(
    group: &mut keepass::db::GroupMut<'_>,
    icon: Option<&Icon>,
    conflicts: &mut Vec<SyncConflict>,
    id: UpstreamGroupId,
) {
    match icon {
        None => group.set_icon_none(),
        Some(Icon::BuiltIn(icon_id)) => group.set_icon_builtin(*icon_id),
        Some(Icon::Custom(custom_id)) => {
            if group.set_icon_custom(*custom_id).is_err() {
                conflicts.push(SyncConflict {
                    object: SyncConflictObject::Group(GroupId::new(id.to_string())),
                    kind: SyncConflictKind::CustomIcon,
                    field: None,
                });
            }
        }
    }
}

fn history_has_attachments(database: &Database, id: UpstreamEntryId) -> bool {
    let Some(entry) = database.entry(id) else {
        return false;
    };
    let count = entry
        .history
        .as_ref()
        .map_or(0, |history| history.get_entries().len());
    (0..count).any(|index| {
        entry
            .historical(index)
            .is_some_and(|historical| historical.attachments_named().next().is_some())
    })
}

fn entry_references_unavailable_icon(database: &Database, entry: &Entry) -> bool {
    matches!(entry.icon(), Some(Icon::Custom(id)) if database.custom_icon(*id).is_none())
}

fn remote_deleted(database: &Database, id: uuid::Uuid) -> bool {
    database.deleted_objects.contains_key(&id)
}

fn local_deleted(database: &Database, id: uuid::Uuid) -> bool {
    database.deleted_objects.contains_key(&id)
}

fn set_eq<T: Eq + std::hash::Hash>(left: &[T], right: &[T]) -> bool {
    left.iter().collect::<HashSet<_>>() == right.iter().collect::<HashSet<_>>()
}

fn entry_metadata_conflict(conflicts: &mut Vec<SyncConflict>, id: UpstreamEntryId) {
    conflicts.push(SyncConflict {
        object: SyncConflictObject::Entry(EntryId::new(id.to_string())),
        kind: SyncConflictKind::FieldEdit,
        field: Some(SyncConflictField {
            kind: SyncConflictFieldKind::EntryMetadata,
            name: None,
        }),
    });
}

fn group_metadata_conflict(conflicts: &mut Vec<SyncConflict>, id: UpstreamGroupId) {
    conflicts.push(SyncConflict {
        object: SyncConflictObject::Group(GroupId::new(id.to_string())),
        kind: SyncConflictKind::Metadata,
        field: Some(SyncConflictField {
            kind: SyncConflictFieldKind::GroupMetadata,
            name: None,
        }),
    });
}

fn database_metadata_conflict(conflicts: &mut Vec<SyncConflict>) {
    conflicts.push(SyncConflict {
        object: SyncConflictObject::DatabaseMetadata,
        kind: SyncConflictKind::Metadata,
        field: Some(SyncConflictField {
            kind: SyncConflictFieldKind::DatabaseMetadata,
            name: None,
        }),
    });
}

fn history_conflict(conflicts: &mut Vec<SyncConflict>, id: UpstreamEntryId) {
    conflicts.push(SyncConflict {
        object: SyncConflictObject::Entry(EntryId::new(id.to_string())),
        kind: SyncConflictKind::History,
        field: None,
    });
}

fn normalize_history_parents(
    database: &mut Database,
    id: UpstreamEntryId,
    conflicts: &mut Vec<SyncConflict>,
) -> Result<(), KdbxError> {
    let current = database.entry(id).ok_or(KdbxError::SyncInvariant)?;
    let Some(source_history) = current.history.clone() else {
        return Ok(());
    };
    if current.attachments_named().next().is_some() || history_has_attachments(database, id) {
        history_conflict(conflicts, id);
        return Ok(());
    }

    let current_template = current.deref().clone();
    let current_icon = current.icon().cloned();
    let mut normalized = History::default();
    for source in source_history.get_entries().iter().rev() {
        if source.icon().cloned() != current_icon {
            conflicts.push(SyncConflict {
                object: SyncConflictObject::Entry(EntryId::new(id.to_string())),
                kind: SyncConflictKind::CustomIcon,
                field: None,
            });
            return Ok(());
        }
        let mut entry = current_template.clone();
        entry.fields = source.fields.clone();
        entry.autotype = source.autotype.clone();
        entry.tags = source.tags.clone();
        entry.times = source.times.clone();
        entry.custom_data = source.custom_data.clone();
        entry.foreground_color = source.foreground_color.clone();
        entry.background_color = source.background_color.clone();
        entry.override_url = source.override_url.clone();
        entry.quality_check = source.quality_check;
        entry.history = None;
        normalized.add_entry(entry);
    }
    database
        .entry_mut(id)
        .ok_or(KdbxError::SyncInvariant)?
        .history = Some(normalized);
    Ok(())
}

#[cfg(test)]
mod tests {
    use std::{io::Cursor, ops::Deref, path::Path};

    use keepass::db::{EntryId as UpstreamEntryId, Value};
    use uuid::Uuid;
    use vault_core::GroupId;

    use super::KdbxDocument;

    #[test]
    fn merged_move_roundtrips_complete_database_semantics() {
        let path = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../../fixtures/kdbx/keepassxc-2.7.12-kdbx41.kdbx");
        let base = KdbxDocument::open(path, "demopass").expect("fixture");
        let mut bytes = Vec::new();
        base.save_to_writer(&mut bytes, "demopass").expect("save");
        let mut local =
            KdbxDocument::open_reader(&mut Cursor::new(&bytes), "demopass").expect("local");
        let mut remote =
            KdbxDocument::open_reader(&mut Cursor::new(&bytes), "demopass").expect("remote");
        let entry = base.database.root().entries().next().expect("entry").id();
        let group = base.database.root().groups().next().expect("group").id();
        let public_entry = vault_core::EntryId::new(entry.to_string());
        local
            .move_entry(&public_entry, &GroupId::new(group.to_string()))
            .expect("move");
        remote
            .set_entry_title(&public_entry, "remote title")
            .expect("edit");
        let super::KdbxDivergentMergeOutcome::Merged(merged) =
            KdbxDocument::merge_divergent(&base, &local, &remote).expect("merge")
        else {
            panic!("conflict")
        };
        let mut output = Vec::new();
        merged
            .save_to_writer(&mut output, "demopass")
            .expect("save merged");
        let reopened =
            KdbxDocument::open_reader(&mut Cursor::new(output), "demopass").expect("reopen");
        assert!(
            merged.database.config == reopened.database.config,
            "config differs"
        );
        assert!(
            merged.database.meta == reopened.database.meta,
            "meta differs"
        );
        assert!(
            merged.database.deleted_objects == reopened.database.deleted_objects,
            "tombstones differ"
        );
        assert!(
            merged.database.root().deref() == reopened.database.root().deref(),
            "root differs"
        );
        for entry in merged.database.iter_all_entries() {
            let other = reopened.database.entry(entry.id()).expect("entry exists");
            assert!(entry.fields == other.fields, "entry fields differ");
            assert!(entry.autotype == other.autotype, "entry autotype differs");
            assert!(entry.tags == other.tags, "entry tags differ");
            assert!(entry.times == other.times, "entry times differ");
            assert!(
                entry.custom_data == other.custom_data,
                "entry custom data differs"
            );
            assert!(entry.icon() == other.icon(), "entry icon differs");
            assert!(
                entry.foreground_color == other.foreground_color,
                "entry foreground differs"
            );
            assert!(
                entry.background_color == other.background_color,
                "entry background differs"
            );
            assert!(
                entry.override_url == other.override_url,
                "entry override differs"
            );
            assert!(
                entry.quality_check == other.quality_check,
                "entry quality differs"
            );
            assert!(
                entry.parent().id() == other.parent().id(),
                "entry parent differs"
            );
            assert!(
                entry.previous_parent().map(|g| g.id()) == other.previous_parent().map(|g| g.id()),
                "entry previous parent differs"
            );
            assert!(entry.history == other.history, "entry history differs");
            assert!(entry.deref() == other.deref(), "entry differs");
        }
        for group in merged.database.iter_all_groups() {
            let other = reopened.database.group(group.id()).expect("group exists");
            assert!(group.deref() == other.deref(), "group differs");
        }
        assert!(
            merged.database == reopened.database,
            "auxiliary state differs"
        );
    }

    #[test]
    fn same_added_uuid_with_different_semantics_conflicts() {
        let path = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../../fixtures/kdbx/keepassxc-2.7.12-kdbx41.kdbx");
        let base = KdbxDocument::open(&path, "demopass").expect("fixture");
        let mut local = KdbxDocument::open(&path, "demopass").expect("fixture");
        let mut remote = KdbxDocument::open(path, "demopass").expect("fixture");
        let id = UpstreamEntryId::from_uuid(
            Uuid::parse_str("00000000-0000-0000-0000-000000000035").expect("test UUID"),
        );
        local
            .database
            .root_mut()
            .add_entry_with_id(id)
            .expect("unique id")
            .set_unprotected(keepass::db::fields::TITLE, "local");
        remote
            .database
            .root_mut()
            .add_entry_with_id(id)
            .expect("unique id")
            .set_unprotected(keepass::db::fields::TITLE, "remote");

        let super::KdbxDivergentMergeOutcome::Conflicted(conflicts) =
            KdbxDocument::merge_divergent(&base, &local, &remote).expect("analysis")
        else {
            panic!("UUID collision must conflict")
        };
        assert!(
            conflicts
                .iter()
                .any(|conflict| conflict.kind() == super::SyncConflictKind::UuidCollision)
        );
    }

    #[test]
    fn live_object_with_same_uuid_tombstone_is_invalid_input() {
        let path = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../../fixtures/kdbx/keepassxc-2.7.12-kdbx41.kdbx");
        let mut document = KdbxDocument::open(path, "demopass").expect("fixture");
        let id = document
            .database
            .root()
            .entries()
            .next()
            .expect("entry")
            .id();
        document.database.deleted_objects.insert(id.uuid(), None);
        assert!(document.validate_for_sync().is_err());
    }

    #[test]
    fn remote_attachment_addition_survives_unrelated_local_edit() {
        let path = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../../fixtures/kdbx/keepassxc-2.7.12-kdbx41.kdbx");
        let base = KdbxDocument::open(&path, "demopass").expect("fixture");
        let mut local = KdbxDocument::open(&path, "demopass").expect("fixture");
        let mut remote = KdbxDocument::open(path, "demopass").expect("fixture");
        let id = base.database.root().entries().next().expect("entry").id();
        let public_id = vault_core::EntryId::new(id.to_string());
        local
            .set_entry_title(&public_id, "local title")
            .expect("edit");
        remote
            .database
            .entry_mut(id)
            .expect("entry")
            .add_attachment("synthetic.bin", Value::protected(vec![1, 3, 3, 7]));

        let super::KdbxDivergentMergeOutcome::Merged(merged) =
            KdbxDocument::merge_divergent(&base, &local, &remote).expect("analysis")
        else {
            panic!("independent attachment should merge")
        };
        let merged_entry = merged.database.entry(id).expect("entry");
        let attachment = merged_entry
            .attachment_by_name("synthetic.bin")
            .expect("attachment should remain");
        assert!(attachment.data == Value::protected(vec![1, 3, 3, 7]));

        let mut output = Vec::new();
        merged
            .save_to_writer(&mut output, "demopass")
            .expect("save");
        let reopened =
            KdbxDocument::open_reader(&mut Cursor::new(output), "demopass").expect("reopen");
        let reopened_entry = reopened.database.entry(id).expect("reopened entry");
        let reopened_attachment = reopened_entry
            .attachment_by_name("synthetic.bin")
            .expect("reopened attachment");
        assert!(
            attachment.data.is_protected() == reopened_attachment.data.is_protected(),
            "attachment protection differs"
        );
        assert!(
            attachment.data.get() == reopened_attachment.data.get(),
            "attachment bytes differ"
        );
        assert!(
            super::entry_semantically_eq(merged_entry, reopened_entry),
            "entry semantic comparison differs"
        );
        assert!(
            merged.database.config == reopened.database.config,
            "config differs"
        );
        assert!(
            merged.database.meta == reopened.database.meta,
            "meta differs"
        );
        assert!(
            merged.database.deleted_objects == reopened.database.deleted_objects,
            "tombstones differ"
        );
        for candidate_entry in merged.database.iter_all_entries() {
            let other = reopened
                .database
                .entry(candidate_entry.id())
                .expect("entry exists");
            assert!(
                super::entry_semantically_eq(candidate_entry, other),
                "another entry differs"
            );
        }
        for candidate_group in merged.database.iter_all_groups() {
            let other = reopened
                .database
                .group(candidate_group.id())
                .expect("group exists");
            assert!(candidate_group.deref() == other.deref(), "group differs");
        }
        assert!(
            super::icon_index(&merged.database) == super::icon_index(&reopened.database),
            "icons differ"
        );
        assert!(
            super::attachment_values(&merged.database)
                == super::attachment_values(&reopened.database),
            "attachment collection differs"
        );
        merged
            .verify_semantic_equivalence(&reopened)
            .expect("attachment merge should roundtrip");
    }

    #[test]
    fn existing_custom_icon_survives_independent_field_merge() {
        let path = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../../fixtures/kdbx/keepassxc-2.7.12-kdbx41.kdbx");
        let mut prepared = KdbxDocument::open(path, "demopass").expect("fixture");
        let id = prepared
            .database
            .root()
            .entries()
            .next()
            .expect("entry")
            .id();
        prepared
            .database
            .entry_mut(id)
            .expect("entry")
            .set_icon_custom_new(vec![8, 6, 7, 5, 3, 0, 9]);
        let mut input = Vec::new();
        prepared
            .save_to_writer(&mut input, "demopass")
            .expect("save");
        let base = KdbxDocument::open_reader(&mut Cursor::new(&input), "demopass").expect("base");
        let mut local =
            KdbxDocument::open_reader(&mut Cursor::new(&input), "demopass").expect("local");
        let mut remote =
            KdbxDocument::open_reader(&mut Cursor::new(&input), "demopass").expect("remote");
        let public_id = vault_core::EntryId::new(id.to_string());
        local.set_entry_title(&public_id, "local").expect("edit");
        remote
            .set_entry_username(&public_id, "remote")
            .expect("edit");

        let super::KdbxDivergentMergeOutcome::Merged(merged) =
            KdbxDocument::merge_divergent(&base, &local, &remote).expect("analysis")
        else {
            panic!("independent fields should merge")
        };
        assert!(
            merged
                .database
                .entry(id)
                .expect("entry")
                .custom_icon()
                .is_some()
        );
        let mut output = Vec::new();
        merged
            .save_to_writer(&mut output, "demopass")
            .expect("save");
        let reopened =
            KdbxDocument::open_reader(&mut Cursor::new(output), "demopass").expect("reopen");
        merged
            .verify_semantic_equivalence(&reopened)
            .expect("custom icon should roundtrip");
    }

    #[test]
    fn remote_only_new_custom_icon_fails_closed() {
        let path = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../../fixtures/kdbx/keepassxc-2.7.12-kdbx41.kdbx");
        let base = KdbxDocument::open(&path, "demopass").expect("fixture");
        let mut local = KdbxDocument::open(&path, "demopass").expect("fixture");
        let mut remote = KdbxDocument::open(path, "demopass").expect("fixture");
        let id = base.database.root().entries().next().expect("entry").id();
        let public_id = vault_core::EntryId::new(id.to_string());
        local.set_entry_title(&public_id, "local").expect("edit");
        remote
            .database
            .entry_mut(id)
            .expect("entry")
            .set_icon_custom_new(vec![4, 2]);

        let super::KdbxDivergentMergeOutcome::Conflicted(conflicts) =
            KdbxDocument::merge_divergent(&base, &local, &remote).expect("analysis")
        else {
            panic!("unrepresentable icon identity must conflict")
        };
        assert!(conflicts.iter().any(|conflict| {
            matches!(
                conflict.kind(),
                super::SyncConflictKind::CustomIcon | super::SyncConflictKind::UnsupportedSemantic
            )
        }));
    }

    #[test]
    fn same_custom_icon_uuid_with_divergent_bytes_conflicts() {
        let path = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../../fixtures/kdbx/keepassxc-2.7.12-kdbx41.kdbx");
        let mut prepared = KdbxDocument::open(path, "demopass").expect("fixture");
        let entry_id = prepared
            .database
            .root()
            .entries()
            .next()
            .expect("entry")
            .id();
        let icon_id = prepared
            .database
            .entry_mut(entry_id)
            .expect("entry")
            .set_icon_custom_new(vec![1, 2, 3])
            .id();
        let mut input = Vec::new();
        prepared
            .save_to_writer(&mut input, "demopass")
            .expect("save");
        let base = KdbxDocument::open_reader(&mut Cursor::new(&input), "demopass").expect("base");
        let mut local =
            KdbxDocument::open_reader(&mut Cursor::new(&input), "demopass").expect("local");
        let mut remote =
            KdbxDocument::open_reader(&mut Cursor::new(input), "demopass").expect("remote");
        local.database.custom_icon_mut(icon_id).expect("icon").data = vec![4, 5, 6];
        remote.database.custom_icon_mut(icon_id).expect("icon").data = vec![7, 8, 9];

        let super::KdbxDivergentMergeOutcome::Conflicted(conflicts) =
            KdbxDocument::merge_divergent(&base, &local, &remote).expect("analysis")
        else {
            panic!("divergent icon bytes must conflict")
        };
        assert!(
            conflicts
                .iter()
                .any(|conflict| conflict.kind() == super::SyncConflictKind::CustomIcon)
        );
    }

    #[test]
    fn synthesized_deletion_keeps_tombstone_after_roundtrip() {
        let path = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../../fixtures/kdbx/keepassxc-2.7.12-kdbx41.kdbx");
        let base = KdbxDocument::open(&path, "demopass").expect("fixture");
        let mut local = KdbxDocument::open(&path, "demopass").expect("fixture");
        let mut remote = KdbxDocument::open(path, "demopass").expect("fixture");
        let ids = base
            .database
            .iter_all_entries()
            .map(|entry| entry.id())
            .collect::<Vec<_>>();
        let deleted = ids[0];
        let modified = ids[1];
        local
            .permanently_delete_entry(&vault_core::EntryId::new(deleted.to_string()))
            .expect("delete");
        remote
            .set_entry_title(
                &vault_core::EntryId::new(modified.to_string()),
                "remote independent edit",
            )
            .expect("edit");

        let super::KdbxDivergentMergeOutcome::Merged(merged) =
            KdbxDocument::merge_divergent(&base, &local, &remote).expect("analysis")
        else {
            panic!("independent deletion should merge")
        };
        assert!(
            merged
                .database
                .deleted_objects
                .contains_key(&deleted.uuid())
        );
        let mut output = Vec::new();
        merged
            .save_to_writer(&mut output, "demopass")
            .expect("save");
        let reopened =
            KdbxDocument::open_reader(&mut Cursor::new(output), "demopass").expect("reopen");
        assert!(
            reopened
                .database
                .deleted_objects
                .contains_key(&deleted.uuid())
        );
        merged
            .verify_semantic_equivalence(&reopened)
            .expect("tombstone should roundtrip");
    }
}
