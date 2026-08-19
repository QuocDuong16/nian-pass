//! KDBX adapter boundary for Nian Pass.
//!
//! Types from `keepass` are intentionally confined to this crate's private
//! implementation. Callers receive only adapter-owned types and `vault_core`
//! domain values.

use std::{
    fmt,
    fs::File,
    io::{Read, Seek, SeekFrom, Write},
    path::Path,
};

use keepass::{
    Database, DatabaseKey,
    config::DatabaseVersion,
    db::{DatabaseOpenError, DatabaseSaveError, MoveGroupError, Times, fields},
};
use thiserror::Error;
use vault_core::{
    CustomFieldSummary, EntryId, EntrySummary, FieldProtection, Group, GroupId, NewEntry,
    SecretString, SummaryText, Vault,
};

const PASSKEY_FIELD_PREFIX: &str = "KPEX_PASSKEY";
const TOTP_FIELD_NAMES: [&str; 7] = [
    fields::OTP,
    "TOTP Seed",
    "TOTP Settings",
    "TimeOtp-Secret-Base32",
    "TimeOtp-Algorithm",
    "TimeOtp-Length",
    "TimeOtp-Period",
];

#[derive(Clone, Copy)]
enum MissingFieldProtection {
    DatabaseTitlePolicy,
    DatabaseUsernamePolicy,
    DatabaseUrlPolicy,
    AlwaysProtected,
}

/// Exact KDBX format version reported by the database header.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum KdbxVersion {
    /// KDBX 3.x with its exact minor version.
    Kdbx3 { minor: u16 },
    /// KDBX 4.x with its exact minor version.
    Kdbx4 { minor: u16 },
}

impl fmt::Display for KdbxVersion {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Kdbx3 { minor } => write!(formatter, "3.{minor}"),
            Self::Kdbx4 { minor } => write!(formatter, "4.{minor}"),
        }
    }
}

/// A projected vault together with its dependency-neutral KDBX version.
pub struct OpenedVault {
    version: KdbxVersion,
    vault: Vault,
}

impl OpenedVault {
    /// Returns the exact KDBX major and minor version from the file header.
    #[must_use]
    pub const fn version(&self) -> KdbxVersion {
        self.version
    }

    /// Borrows the secret-free vault projection.
    #[must_use]
    pub const fn vault(&self) -> &Vault {
        &self.vault
    }

    /// Consumes the open result and returns its vault projection.
    #[must_use]
    pub fn into_vault(self) -> Vault {
        self.vault
    }
}

/// An opened KDBX database that retains the complete representation parsed by
/// `keepass-rs` for narrowly scoped, preservation-oriented edits.
///
/// The underlying dependency type is intentionally private. This document is
/// the serialization source of truth; its [`Vault`] projection must never be
/// used to reconstruct a database. Credentials are supplied separately for
/// each open and save operation and are not retained by the document.
pub struct KdbxDocument {
    version: KdbxVersion,
    database: Database,
    revision: u64,
    revision_permanently_dirty: bool,
}

impl KdbxDocument {
    /// Opens a KDBX document from a file using a master password.
    ///
    /// M2.5 supports password credentials only. The document does not retain the
    /// password, and the credential API is expected to grow to support keyfiles
    /// in a later milestone.
    pub fn open(path: impl AsRef<Path>, master_password: &str) -> Result<Self, KdbxError> {
        let mut file = File::open(path.as_ref()).map_err(KdbxError::Io)?;
        Self::open_reader(&mut file, master_password)
    }

    /// Opens a KDBX document from a seekable reader using a master password.
    pub fn open_reader(
        source: &mut (impl Read + Seek),
        master_password: &str,
    ) -> Result<Self, KdbxError> {
        let (version, database) = parse_database(source, master_password)?;
        Ok(Self {
            version,
            database,
            revision: 0,
            revision_permanently_dirty: false,
        })
    }

    /// Returns the exact KDBX major and minor version read from the source.
    #[must_use]
    pub const fn version(&self) -> KdbxVersion {
        self.version
    }

    /// Returns the process-local monotonic mutation revision.
    ///
    /// The revision starts at zero for every open, advances once for each
    /// successful real mutation, saturates instead of wrapping, and is never
    /// serialized into KDBX output. Use [`Self::has_changes_since`] for the
    /// overflow-aware dirty comparison.
    #[must_use]
    pub const fn revision(&self) -> u64 {
        self.revision
    }

    /// Returns whether this document differs from a previously saved revision.
    ///
    /// Once the numeric counter saturates, the first further real mutation
    /// makes the document permanently dirty for its remaining lifetime. This
    /// avoids a wrapped or saturated counter ever making new edits appear
    /// clean.
    #[must_use]
    pub const fn has_changes_since(&self, saved_revision: u64) -> bool {
        self.revision_permanently_dirty || self.revision != saved_revision
    }

    /// Builds a secret-free presentation projection of the current state.
    ///
    /// This is a one-way view for callers and is not a serialization model.
    pub fn projection(&self) -> Result<Vault, KdbxError> {
        convert_database(&self.database)
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

    /// Renames an entry by its stable identifier while retaining the complete
    /// parsed database state.
    ///
    /// A real change preserves the title field's existing protection mode. A
    /// missing non-empty Title follows the database's Title memory-protection
    /// policy, falling back to unprotected when metadata is absent.
    /// `keepass-rs` change tracking records the previous entry in history and
    /// updates its last-modification timestamp. Setting the current value is a
    /// no-op. No identifier or title is included in errors.
    pub fn set_entry_title(&mut self, id: &EntryId, title: &str) -> Result<(), KdbxError> {
        self.set_standard_field(
            id,
            fields::TITLE,
            title,
            MissingFieldProtection::DatabaseTitlePolicy,
        )
    }

    /// Changes one entry username while preserving its existing protection mode.
    ///
    /// A missing non-empty username follows the database's UserName
    /// memory-protection policy, falling back to unprotected when metadata is
    /// absent. Setting the current value, or setting a missing username to
    /// empty, is a complete no-op.
    pub fn set_entry_username(&mut self, id: &EntryId, username: &str) -> Result<(), KdbxError> {
        self.set_standard_field(
            id,
            fields::USERNAME,
            username,
            MissingFieldProtection::DatabaseUsernamePolicy,
        )
    }

    /// Changes one entry URL without parsing or normalizing it.
    ///
    /// Existing protection mode is preserved. A missing non-empty URL follows
    /// the database's URL memory-protection policy, falling back to unprotected
    /// when metadata is absent; missing plus empty is a no-op.
    pub fn set_entry_url(&mut self, id: &EntryId, url: &str) -> Result<(), KdbxError> {
        self.set_standard_field(
            id,
            fields::URL,
            url,
            MissingFieldProtection::DatabaseUrlPolicy,
        )
    }

    /// Changes one entry password while preserving its existing protection mode.
    ///
    /// A newly created Password field is always protected. A missing password
    /// set to an empty secret remains absent. Plaintext is exposed only for the
    /// duration needed to copy it into the retained KDBX representation.
    pub fn set_entry_password(
        &mut self,
        id: &EntryId,
        password: &SecretString,
    ) -> Result<(), KdbxError> {
        self.set_standard_field(
            id,
            fields::PASSWORD,
            password.expose_secret(),
            MissingFieldProtection::AlwaysProtected,
        )
    }

    /// Creates an entry in the requested group and returns its generated stable
    /// identifier.
    ///
    /// The upstream constructor generates a UUID v4, initializes all entry
    /// timestamps, and creates empty history. Empty title, username, and URL
    /// inputs remain absent. An explicitly supplied password remains present
    /// even when empty and is always protected. Other non-empty standard fields
    /// follow the database memory-protection policy.
    pub fn create_entry(
        &mut self,
        group: &GroupId,
        input: NewEntry<'_>,
    ) -> Result<EntryId, KdbxError> {
        let group_id = self.find_group_id(group)?;
        let protect_title =
            self.missing_field_is_protected(MissingFieldProtection::DatabaseTitlePolicy);
        let protect_username =
            self.missing_field_is_protected(MissingFieldProtection::DatabaseUsernamePolicy);
        let protect_url =
            self.missing_field_is_protected(MissingFieldProtection::DatabaseUrlPolicy);

        let mut parent = self
            .database
            .group_mut(group_id)
            .ok_or(KdbxError::GroupNotFound)?;
        let mut entry = parent.add_entry();
        let entry_id = entry.id();

        set_new_field(&mut entry, fields::TITLE, input.title, protect_title);
        set_new_field(
            &mut entry,
            fields::USERNAME,
            input.username,
            protect_username,
        );
        set_new_field(&mut entry, fields::URL, input.url, protect_url);
        if let Some(password) = input.password {
            entry.set_protected(fields::PASSWORD, password.expose_secret());
        }

        self.mark_changed();
        Ok(EntryId::new(entry_id.to_string()))
    }

    /// Permanently removes an entry from the KDBX tree and creates its deleted-
    /// object tombstone.
    ///
    /// This is deliberately not a product-level recycle-bin operation. The
    /// entry UUID is recorded with an upstream-generated deletion timestamp so
    /// a future sync layer can distinguish deletion from absence.
    pub fn permanently_delete_entry(&mut self, id: &EntryId) -> Result<(), KdbxError> {
        let upstream_id = self.find_entry_id(id)?;
        let mut entry = self
            .database
            .entry_mut(upstream_id)
            .ok_or(KdbxError::EntryNotFound)?;
        entry.track_changes().remove();
        self.mark_changed();
        Ok(())
    }

    /// Moves an entry by stable identifier without creating field history.
    ///
    /// A real move preserves the entry UUID and fields, records the previous
    /// parent through the upstream model, and updates only `LocationChanged` on
    /// the entry. Moving to the current parent is a complete no-op.
    pub fn move_entry(&mut self, entry: &EntryId, destination: &GroupId) -> Result<(), KdbxError> {
        let entry_id = self.find_entry_id(entry)?;
        let destination_id = self.find_group_id(destination)?;
        let current_parent = self
            .database
            .entry(entry_id)
            .ok_or(KdbxError::EntryNotFound)?
            .parent()
            .id();
        if current_parent == destination_id {
            return Ok(());
        }

        let mut candidate = self.database.clone();
        let mut entry = candidate
            .entry_mut(entry_id)
            .ok_or(KdbxError::EntryNotFound)?;
        entry
            .move_to(destination_id)
            .map_err(|_| KdbxError::GroupNotFound)?;
        entry.times.location_changed = Some(Times::now());
        self.database = candidate;
        self.mark_changed();
        Ok(())
    }

    /// Creates an empty group beneath the requested parent.
    ///
    /// The upstream constructor generates a UUID v4 and initializes the
    /// KeePass group defaults and timestamps. Empty group names are accepted.
    pub fn create_group(&mut self, parent: &GroupId, name: &str) -> Result<GroupId, KdbxError> {
        let parent_id = self.find_group_id(parent)?;
        let created_id = {
            let mut parent = self
                .database
                .group_mut(parent_id)
                .ok_or(KdbxError::GroupNotFound)?;
            let mut group = parent.add_group();
            group.name = name.to_owned();
            GroupId::new(group.id().to_string())
        };
        self.mark_changed();
        Ok(created_id)
    }

    /// Renames a group by stable identifier.
    ///
    /// Setting the existing name is a complete no-op. A real rename updates the
    /// group's last-modification timestamp without inventing entry history.
    pub fn rename_group(&mut self, id: &GroupId, name: &str) -> Result<(), KdbxError> {
        let group_id = self.find_group_id(id)?;
        let current_name = self
            .database
            .group(group_id)
            .ok_or(KdbxError::GroupNotFound)?
            .name
            .clone();
        if current_name == name {
            return Ok(());
        }

        let mut group = self
            .database
            .group_mut(group_id)
            .ok_or(KdbxError::GroupNotFound)?;
        group.track_changes().edit(|tracked| {
            tracked.name = name.to_owned();
        });
        self.mark_changed();
        Ok(())
    }

    /// Moves a non-root group beneath another group by stable identifier.
    ///
    /// Root moves, self moves, and descendant cycles return
    /// [`KdbxError::InvalidGroupMove`]. Moving to the current parent is a
    /// complete no-op.
    pub fn move_group(
        &mut self,
        group: &GroupId,
        destination_parent: &GroupId,
    ) -> Result<(), KdbxError> {
        let group_id = self.find_group_id(group)?;
        let destination_id = self.find_group_id(destination_parent)?;
        let current_parent = self
            .database
            .group(group_id)
            .ok_or(KdbxError::GroupNotFound)?
            .parent()
            .map(|parent| parent.id());
        let Some(current_parent) = current_parent else {
            return Err(KdbxError::InvalidGroupMove);
        };
        if current_parent == destination_id {
            return Ok(());
        }

        let mut candidate = self.database.clone();
        let mut group = candidate
            .group_mut(group_id)
            .ok_or(KdbxError::GroupNotFound)?;
        group
            .track_changes()
            .move_to(destination_id)
            .map_err(map_group_move_error)?;
        self.database = candidate;
        self.mark_changed();
        Ok(())
    }

    /// Permanently removes a non-root group and its complete subtree.
    ///
    /// Every removed group and entry receives a deleted-object tombstone, which
    /// matches KeePassXC 2.7.12 permanent-deletion tests. This method also
    /// clears internal custom-icon back-references and metadata UUID pointers
    /// before invoking the tracked upstream recursive remover. It deliberately
    /// does not implement the product-level recycle-bin workflow.
    pub fn permanently_delete_group(&mut self, id: &GroupId) -> Result<(), KdbxError> {
        let group_id = self.find_group_id(id)?;
        if group_id == self.database.root().id() {
            return Err(KdbxError::CannotDeleteRootGroup);
        }

        let subtree = self.group_subtree_ids(group_id)?;
        let mut candidate = self.database.clone();
        for descendant in &subtree {
            candidate
                .group_mut(*descendant)
                .ok_or(KdbxError::GroupNotFound)?
                .set_icon_none();
        }
        clear_deleted_group_metadata_references(&mut candidate, &subtree);

        let mut group = candidate
            .group_mut(group_id)
            .ok_or(KdbxError::GroupNotFound)?;
        group
            .track_changes()
            .remove()
            .map_err(|_| KdbxError::CannotDeleteRootGroup)?;
        self.database = candidate;
        self.mark_changed();
        Ok(())
    }

    /// Lists privacy-sensitive custom-field names and protection states without
    /// copying any field value.
    ///
    /// Ordering is unspecified. Standard fields, TOTP storage attributes, and
    /// KeePassXC passkey attributes are excluded.
    pub fn custom_fields(&self, id: &EntryId) -> Result<Vec<CustomFieldSummary>, KdbxError> {
        let upstream_id = self.find_entry_id(id)?;
        let entry = self
            .database
            .entry(upstream_id)
            .ok_or(KdbxError::EntryNotFound)?;

        Ok(entry
            .fields
            .iter()
            .filter(|(name, _)| !is_reserved_field(name))
            .map(|(name, value)| {
                let protection = if value.is_protected() {
                    FieldProtection::Protected
                } else {
                    FieldProtection::Unprotected
                };
                CustomFieldSummary::new(name.clone(), protection)
            })
            .collect())
    }

    /// Fetches one custom field value explicitly as a secret-bearing value.
    ///
    /// A missing field returns `Ok(None)`, distinct from an explicitly empty
    /// field. Reserved standard, TOTP, and passkey names cannot bypass their
    /// dedicated APIs through this generic path.
    pub fn entry_custom_field(
        &self,
        entry: &EntryId,
        name: &str,
    ) -> Result<Option<SecretString>, KdbxError> {
        reject_reserved_field(name)?;
        self.entry_secret(entry, name)
    }

    /// Creates or updates one custom field through tracked entry mutation.
    ///
    /// Existing fields preserve their current protection state; the protection
    /// argument applies only when the field is missing. Same-value updates are
    /// complete no-ops.
    pub fn set_entry_custom_field(
        &mut self,
        entry: &EntryId,
        name: &str,
        value: &SecretString,
        new_field_protection: FieldProtection,
    ) -> Result<(), KdbxError> {
        reject_reserved_field(name)?;

        let upstream_id = self.find_entry_id(entry)?;
        let (same_value, existing_protection) = {
            let current_entry = self
                .database
                .entry(upstream_id)
                .ok_or(KdbxError::EntryNotFound)?;
            let existing = current_entry.fields.get(name);
            let protection = existing.map(|existing| {
                if existing.is_protected() {
                    FieldProtection::Protected
                } else {
                    FieldProtection::Unprotected
                }
            });
            (
                existing.is_some_and(|existing| existing.get() == value.expose_secret()),
                protection,
            )
        };
        if same_value {
            return Ok(());
        }

        let protection = existing_protection.unwrap_or(new_field_protection);
        {
            let mut entry = self
                .database
                .entry_mut(upstream_id)
                .ok_or(KdbxError::EntryNotFound)?;
            let mut tracked = entry.track_changes();
            match protection {
                FieldProtection::Protected => tracked.set_protected(name, value.expose_secret()),
                FieldProtection::Unprotected => {
                    tracked.set_unprotected(name, value.expose_secret());
                }
            }
        }
        self.mark_changed();
        Ok(())
    }

    /// Deletes one custom field through tracked entry mutation.
    ///
    /// Missing fields are complete no-ops. Reserved names are rejected and an
    /// unknown entry remains distinct from a missing field.
    pub fn delete_entry_custom_field(
        &mut self,
        entry: &EntryId,
        name: &str,
    ) -> Result<(), KdbxError> {
        reject_reserved_field(name)?;

        let upstream_id = self.find_entry_id(entry)?;
        let exists = self
            .database
            .entry(upstream_id)
            .ok_or(KdbxError::EntryNotFound)?
            .fields
            .contains_key(name);
        if !exists {
            return Ok(());
        }

        let mut entry = self
            .database
            .entry_mut(upstream_id)
            .ok_or(KdbxError::EntryNotFound)?;
        entry.track_changes().edit(|tracked| {
            tracked.as_mut().fields.remove(name);
        });
        self.mark_changed();
        Ok(())
    }

    /// Serializes this document to a caller-owned writer using a master
    /// password.
    ///
    /// Only KDBX 4.1 is enabled because that is the exact write format supported
    /// by the pinned `keepass-rs` writer. This API does not open, truncate, or
    /// replace a filesystem path and does not verify the resulting bytes.
    pub fn save_to_writer(
        &self,
        destination: &mut impl Write,
        master_password: &str,
    ) -> Result<(), KdbxError> {
        self.ensure_writable_format()?;

        let key = DatabaseKey::new().with_password(master_password);
        self.database.save(destination, key).map_err(map_save_error)
    }

    /// Verifies exact parsed KDBX semantic equivalence without exposing the
    /// underlying `keepass-rs` database representation.
    ///
    /// Ciphertext is deliberately not compared because fresh salts, seeds,
    /// nonces, and authentication data are expected after serialization.
    pub fn verify_semantic_equivalence(&self, other: &Self) -> Result<(), KdbxError> {
        if self.version == other.version && self.database == other.database {
            Ok(())
        } else {
            Err(KdbxError::VerificationFailed)
        }
    }

    fn ensure_writable_format(&self) -> Result<(), KdbxError> {
        if self.version == (KdbxVersion::Kdbx4 { minor: 1 }) {
            Ok(())
        } else {
            Err(KdbxError::UnsupportedWriteFormat)
        }
    }

    fn entry_secret(&self, id: &EntryId, field: &str) -> Result<Option<SecretString>, KdbxError> {
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

    fn set_standard_field(
        &mut self,
        id: &EntryId,
        field: &str,
        new_value: &str,
        missing_protection: MissingFieldProtection,
    ) -> Result<(), KdbxError> {
        let upstream_id = self.find_entry_id(id)?;
        let missing_protected = self.missing_field_is_protected(missing_protection);
        let current_entry = self
            .database
            .entry(upstream_id)
            .ok_or(KdbxError::EntryNotFound)?;
        let existing = current_entry.fields.get(field);

        if existing.is_some_and(|value| value.get() == new_value)
            || (existing.is_none() && new_value.is_empty())
        {
            return Ok(());
        }

        let protect = existing.map_or(missing_protected, keepass::db::Value::is_protected);
        {
            let mut entry = self
                .database
                .entry_mut(upstream_id)
                .ok_or(KdbxError::EntryNotFound)?;
            let mut tracked = entry.track_changes();
            if protect {
                tracked.set_protected(field, new_value);
            } else {
                tracked.set_unprotected(field, new_value);
            }
        }

        self.mark_changed();
        Ok(())
    }

    fn mark_changed(&mut self) {
        if self.revision == u64::MAX {
            self.revision_permanently_dirty = true;
        } else {
            self.revision += 1;
        }
    }

    fn missing_field_is_protected(&self, policy: MissingFieldProtection) -> bool {
        let memory_protection = self.database.meta.memory_protection.as_ref();

        match policy {
            MissingFieldProtection::DatabaseTitlePolicy => {
                memory_protection.is_some_and(|policy| policy.protect_title)
            }
            MissingFieldProtection::DatabaseUsernamePolicy => {
                memory_protection.is_some_and(|policy| policy.protect_username)
            }
            MissingFieldProtection::DatabaseUrlPolicy => {
                memory_protection.is_some_and(|policy| policy.protect_url)
            }
            MissingFieldProtection::AlwaysProtected => true,
        }
    }

    fn find_entry_id(&self, id: &EntryId) -> Result<keepass::db::EntryId, KdbxError> {
        self.database
            .iter_all_entries()
            .find(|entry| entry.id().to_string() == id.as_str())
            .map(|entry| entry.id())
            .ok_or(KdbxError::EntryNotFound)
    }

    fn find_group_id(&self, id: &GroupId) -> Result<keepass::db::GroupId, KdbxError> {
        self.database
            .iter_all_groups()
            .find(|group| group.id().to_string() == id.as_str())
            .map(|group| group.id())
            .ok_or(KdbxError::GroupNotFound)
    }

    fn group_subtree_ids(
        &self,
        root: keepass::db::GroupId,
    ) -> Result<Vec<keepass::db::GroupId>, KdbxError> {
        let mut pending = vec![root];
        let mut result = Vec::new();

        while let Some(group_id) = pending.pop() {
            let group = self
                .database
                .group(group_id)
                .ok_or(KdbxError::GroupNotFound)?;
            pending.extend(group.group_ids());
            result.push(group_id);
        }

        Ok(result)
    }
}

fn set_new_field(
    entry: &mut keepass::db::EntryMut<'_>,
    name: &str,
    value: &str,
    protected_by_policy: bool,
) {
    if value.is_empty() {
        return;
    }

    if protected_by_policy {
        entry.set_protected(name, value);
    } else {
        entry.set_unprotected(name, value);
    }
}

fn map_group_move_error(error: MoveGroupError) -> KdbxError {
    match error {
        MoveGroupError::NotFound(_) => KdbxError::GroupNotFound,
        MoveGroupError::CannotMoveRoot | MoveGroupError::WouldCreateCycle => {
            KdbxError::InvalidGroupMove
        }
        _ => KdbxError::InvalidGroupMove,
    }
}

fn clear_deleted_group_metadata_references(
    database: &mut Database,
    deleted_groups: &[keepass::db::GroupId],
) {
    let contains = |uuid| deleted_groups.iter().any(|group| group.uuid() == uuid);
    let meta = &mut database.meta;

    if meta.recyclebin_uuid.is_some_and(contains) {
        meta.recyclebin_uuid = None;
    }
    if meta.entry_templates_group.is_some_and(contains) {
        meta.entry_templates_group = None;
    }
    if meta.last_selected_group.is_some_and(contains) {
        meta.last_selected_group = None;
    }
    if meta.last_top_visible_group.is_some_and(contains) {
        meta.last_top_visible_group = None;
    }
}

fn is_reserved_field(name: &str) -> bool {
    fields::KNOWN_FIELDS.contains(&name)
        || TOTP_FIELD_NAMES.contains(&name)
        || name.starts_with(PASSKEY_FIELD_PREFIX)
}

fn reject_reserved_field(name: &str) -> Result<(), KdbxError> {
    if is_reserved_field(name) {
        Err(KdbxError::ReservedField)
    } else {
        Ok(())
    }
}

/// Errors returned while opening, projecting, mutating, or serializing KDBX.
#[derive(Debug, Error)]
#[non_exhaustive]
pub enum KdbxError {
    /// The database file could not be read.
    #[error("could not read the database file")]
    Io(#[source] std::io::Error),

    /// The input is truncated, malformed, or not a KDBX database.
    #[error("the file is not a valid KDBX database")]
    InvalidKdbx,

    /// The supplied database credentials were rejected.
    #[error("the master password is incorrect")]
    InvalidCredentials,

    /// The database uses a format or feature unsupported by this adapter.
    #[error("the KDBX format or feature is not supported")]
    UnsupportedFormat,

    /// A valid parsed database could not be represented by the domain model.
    #[error("the KDBX database could not be converted into the vault model: {0}")]
    Conversion(&'static str),

    /// Writing this exact KDBX version is not supported safely.
    #[error("writing this KDBX format is not supported")]
    UnsupportedWriteFormat,

    /// No entry matched the supplied stable identifier.
    #[error("entry was not found")]
    EntryNotFound,

    /// No group matched the supplied stable identifier.
    #[error("group was not found")]
    GroupNotFound,

    /// The root group cannot be permanently deleted.
    #[error("the root group cannot be permanently deleted")]
    CannotDeleteRootGroup,

    /// A group move targeted the root, itself, or one of its descendants.
    #[error("the group move is invalid")]
    InvalidGroupMove,

    /// A generic custom-field API targeted a reserved field name.
    #[error("the field name is reserved")]
    ReservedField,

    /// The caller-owned output writer rejected a write operation.
    #[error("could not write the KDBX output")]
    WriteIo(#[source] std::io::Error),

    /// The complete KDBX document could not be serialized.
    #[error("the KDBX database could not be serialized")]
    Serialization,

    /// Parsed KDBX state differs after a preservation-sensitive round trip.
    #[error("serialized vault did not preserve database semantics")]
    VerificationFailed,
}

/// Opens a KDBX database with a master password and returns a secret-free
/// domain projection containing privacy-sensitive vault metadata.
///
/// The password is never logged or included in an error. The caller retains
/// ownership of the password buffer and is responsible for clearing it.
pub fn open(path: impl AsRef<Path>, master_password: &str) -> Result<OpenedVault, KdbxError> {
    let document = KdbxDocument::open(path, master_password)?;
    let version = document.version();
    let vault = document.projection()?;
    Ok(OpenedVault { version, vault })
}

#[cfg(test)]
fn open_reader(
    source: &mut (impl Read + Seek),
    master_password: &str,
) -> Result<OpenedVault, KdbxError> {
    let document = KdbxDocument::open_reader(source, master_password)?;
    let version = document.version();
    let vault = document.projection()?;
    Ok(OpenedVault { version, vault })
}

fn parse_database(
    source: &mut (impl Read + Seek),
    master_password: &str,
) -> Result<(KdbxVersion, Database), KdbxError> {
    let version = Database::get_version(source).map_err(map_open_error)?;
    let kdbx_version = match &version {
        DatabaseVersion::KDB3(minor) => KdbxVersion::Kdbx3 { minor: *minor },
        DatabaseVersion::KDB4(minor) => KdbxVersion::Kdbx4 { minor: *minor },
        _ => return Err(KdbxError::UnsupportedFormat),
    };
    source.seek(SeekFrom::Start(0)).map_err(KdbxError::Io)?;

    let key = DatabaseKey::new().with_password(master_password);
    let database =
        Database::open(source, key).map_err(|error| map_database_open_error(&version, error))?;

    Ok((kdbx_version, database))
}

fn map_save_error(error: DatabaseSaveError) -> KdbxError {
    match error {
        DatabaseSaveError::Io(error) => KdbxError::WriteIo(error),
        DatabaseSaveError::UnsupportedVersion => KdbxError::UnsupportedWriteFormat,
        _ => KdbxError::Serialization,
    }
}

fn map_database_open_error(version: &DatabaseVersion, error: DatabaseOpenError) -> KdbxError {
    match (version, error) {
        // KDBX 3 has no authenticated header and keepass-rs reports a wrong
        // password as invalid cipher padding instead of IncorrectKey.
        (DatabaseVersion::KDB3(_), DatabaseOpenError::Cryptography(_)) => {
            KdbxError::InvalidCredentials
        }
        (_, error) => map_open_error(error),
    }
}

fn map_open_error(error: DatabaseOpenError) -> KdbxError {
    match error {
        DatabaseOpenError::Io(error) if error.kind() == std::io::ErrorKind::UnexpectedEof => {
            KdbxError::InvalidKdbx
        }
        DatabaseOpenError::Io(error) => KdbxError::Io(error),
        DatabaseOpenError::Key(_) => KdbxError::InvalidCredentials,
        DatabaseOpenError::UnsupportedVersion => KdbxError::UnsupportedFormat,
        DatabaseOpenError::UnexpectedEof
        | DatabaseOpenError::VersionParse(_)
        | DatabaseOpenError::Format(_) => KdbxError::InvalidKdbx,
        DatabaseOpenError::Cryptography(_) => KdbxError::InvalidKdbx,
        _ => KdbxError::UnsupportedFormat,
    }
}

fn convert_database(database: &Database) -> Result<Vault, KdbxError> {
    let root = database.root();
    Ok(Vault::new(convert_group(root)))
}

fn project_summary_text(value: Option<&keepass::db::Value<String>>) -> SummaryText {
    match value {
        None => SummaryText::Missing,
        Some(value) if value.is_protected() => SummaryText::Protected,
        Some(value) => SummaryText::Visible(value.get().to_owned()),
    }
}

fn convert_group(group: keepass::db::GroupRef<'_>) -> Group {
    let groups = group.groups().map(convert_group).collect();
    let entries = group
        .entries()
        .map(|entry| {
            EntrySummary::new(
                EntryId::new(entry.id().to_string()),
                project_summary_text(entry.fields.get(fields::TITLE)),
                project_summary_text(entry.fields.get(fields::USERNAME)),
                project_summary_text(entry.fields.get(fields::URL)),
                entry.tags.clone(),
                entry.fields.contains_key(fields::PASSWORD),
                entry.fields.contains_key(fields::NOTES),
            )
        })
        .collect();

    Group::new(
        GroupId::new(group.id().to_string()),
        group.name.clone(),
        groups,
        entries,
    )
}

#[cfg(test)]
mod tests {
    use std::{
        ffi::OsString,
        fs,
        io::{Cursor, Write},
        path::{Path, PathBuf},
        process::{Command, Output, Stdio},
        time::{SystemTime, UNIX_EPOCH},
    };

    use keepass::{
        Database, DatabaseKey,
        db::{MemoryProtection, Times, Value, fields},
    };
    use vault_core::{
        EntryId, FieldProtection, Group, GroupId, NewEntry, SecretString, SummaryText,
    };

    use super::{KdbxDocument, KdbxError, KdbxVersion, open, open_reader};

    // Synthetic public test credential from the upstream fixture suite.
    const FIXTURE_PASSWORD: &str = "demopass";
    const WRONG_FIXTURE_PASSWORD: &str = "wrong-public-test-password";
    const EXTERNAL_FIXTURE: &str = "keepassxc-2.7.12-kdbx41.kdbx";
    const NIAN_PASS_EXTERNAL_TITLE: &str = "Nian Pass — Tiếng Việt 日本語 👩‍💻 e\u{301}";
    const NIAN_PASS_CREATED_TITLE: &str = "Nian Pass created lifecycle entry";
    const KEEPASSXC_ENTRY_TITLE: &str = "ayyyyo";
    const KEEPASSXC_EXTERNAL_TITLE: &str = "KeePassXC resaved title";
    const TEST_SECRET_BEFORE: &str = "public-test-password-before";
    const TEST_SECRET_AFTER: &str = "public-test-password-after";
    const TEST_CUSTOM_PROTECTED: &str = "public-test-custom-protected";
    const TEST_CUSTOM_UNPROTECTED: &str = "public-test-custom-unprotected";

    struct SemanticSnapshot {
        version: KdbxVersion,
        group_count: usize,
        entry_count: usize,
        groups: Vec<GroupSnapshot>,
    }

    struct GroupSnapshot {
        id: String,
        name: String,
        entries: Vec<EntrySnapshot>,
    }

    struct EntrySnapshot {
        id: String,
        title: String,
    }

    impl SemanticSnapshot {
        fn capture(document: &KdbxDocument) -> Self {
            let vault = document
                .projection()
                .expect("trusted fixture should project");
            let mut groups = Vec::new();
            capture_group(vault.root(), &mut groups);

            Self {
                version: document.version(),
                group_count: vault.group_count(),
                entry_count: vault.entry_count(),
                groups,
            }
        }

        fn assert_preserved_except_title(
            &self,
            after: &Self,
            changed_id: &EntryId,
            expected_title: &str,
        ) {
            assert!(self.version == after.version, "KDBX version changed");
            assert_eq!(self.group_count, after.group_count, "group count changed");
            assert_eq!(self.entry_count, after.entry_count, "entry count changed");
            assert_eq!(
                self.groups.len(),
                after.groups.len(),
                "group traversal changed"
            );

            for (before_group, after_group) in self.groups.iter().zip(&after.groups) {
                assert!(
                    before_group.id == after_group.id,
                    "group identifier changed"
                );
                assert!(before_group.name == after_group.name, "group name changed");
                assert_eq!(
                    before_group.entries.len(),
                    after_group.entries.len(),
                    "group entry membership changed"
                );

                for (before_entry, after_entry) in
                    before_group.entries.iter().zip(&after_group.entries)
                {
                    assert!(
                        before_entry.id == after_entry.id,
                        "entry identifier changed"
                    );
                    if before_entry.id == changed_id.as_str() {
                        assert!(
                            after_entry.title == expected_title,
                            "requested entry title was not persisted"
                        );
                    } else {
                        assert!(
                            before_entry.title == after_entry.title,
                            "an unrelated entry title changed"
                        );
                    }
                }
            }
        }
    }

    fn capture_group(group: &Group, destination: &mut Vec<GroupSnapshot>) {
        destination.push(GroupSnapshot {
            id: group.id().as_str().to_owned(),
            name: group.name().to_owned(),
            entries: group
                .entries()
                .iter()
                .map(|entry| EntrySnapshot {
                    id: entry.id().as_str().to_owned(),
                    title: entry
                        .title()
                        .visible()
                        .expect("snapshot fixture title should be visible")
                        .to_owned(),
                })
                .collect(),
        });

        for child in group.groups() {
            capture_group(child, destination);
        }
    }

    struct AlwaysFailWriter;

    impl Write for AlwaysFailWriter {
        fn write(&mut self, _buffer: &[u8]) -> std::io::Result<usize> {
            Err(std::io::Error::other("intentional test writer failure"))
        }

        fn flush(&mut self) -> std::io::Result<()> {
            Ok(())
        }
    }

    struct TestTempDir {
        path: PathBuf,
    }

    impl TestTempDir {
        fn create() -> Self {
            let nonce = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .expect("system clock should be after the Unix epoch")
                .as_nanos();

            for attempt in 0..100_u8 {
                let path = std::env::temp_dir().join(format!(
                    "nian-pass-keepassxc-{}-{nonce}-{attempt}",
                    std::process::id()
                ));
                match fs::create_dir(&path) {
                    Ok(()) => return Self { path },
                    Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {}
                    Err(error) => {
                        panic!("could not create isolated compatibility directory: {error}")
                    }
                }
            }

            panic!("could not allocate a unique compatibility directory");
        }

        fn join(&self, file: &str) -> PathBuf {
            self.path.join(file)
        }
    }

    impl Drop for TestTempDir {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.path);
        }
    }

    struct Fixture {
        file: &'static str,
        password: &'static str,
        expected_version: KdbxVersion,
        expected_root_name: &'static str,
        expected_groups: usize,
        expected_entries: usize,
    }

    const FIXTURES: &[Fixture] = &[
        Fixture {
            file: "keepass-upstream-kdbx31-aeskdf-aes.kdbx",
            password: FIXTURE_PASSWORD,
            expected_version: KdbxVersion::Kdbx3 { minor: 1 },
            expected_root_name: "sample",
            expected_groups: 5,
            expected_entries: 6,
        },
        Fixture {
            file: "keepassxc-upstream-kdbx40-argon2d-aes.kdbx",
            password: FIXTURE_PASSWORD,
            expected_version: KdbxVersion::Kdbx4 { minor: 0 },
            expected_root_name: "Root",
            expected_groups: 1,
            expected_entries: 2,
        },
        Fixture {
            file: "keepassxc-upstream-kdbx40-argon2id-chacha20.kdbx",
            password: FIXTURE_PASSWORD,
            expected_version: KdbxVersion::Kdbx4 { minor: 0 },
            expected_root_name: "Root",
            expected_groups: 1,
            expected_entries: 1,
        },
        Fixture {
            file: "keepassxc-2.7.12-kdbx41.kdbx",
            password: FIXTURE_PASSWORD,
            expected_version: KdbxVersion::Kdbx4 { minor: 1 },
            expected_root_name: "Root",
            expected_groups: 2,
            expected_entries: 2,
        },
    ];

    fn fixture_path(file: &str) -> PathBuf {
        Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../../fixtures/kdbx")
            .join(file)
    }

    fn kdbx41_document() -> KdbxDocument {
        KdbxDocument::open(
            fixture_path("keepassxc-2.7.12-kdbx41.kdbx"),
            FIXTURE_PASSWORD,
        )
        .expect("trusted KDBX 4.1 fixture should open")
    }

    fn first_entry_ids(document: &KdbxDocument) -> (EntryId, keepass::db::EntryId) {
        let projected_id = document
            .projection()
            .expect("trusted fixture should project")
            .root()
            .entries()
            .first()
            .expect("fixture should have a root entry")
            .id()
            .clone();
        let upstream_id = document
            .database
            .iter_all_entries()
            .find(|entry| entry.id().to_string() == projected_id.as_str())
            .map(|entry| entry.id())
            .expect("projected entry should exist in the complete database");

        (projected_id, upstream_id)
    }

    fn root_group_ids(document: &KdbxDocument) -> (GroupId, keepass::db::GroupId) {
        let upstream_id = document.database.root().id();
        (GroupId::new(upstream_id.to_string()), upstream_id)
    }

    fn first_child_group_ids(document: &KdbxDocument) -> (GroupId, keepass::db::GroupId) {
        let root = document.database.root();
        let child = root
            .groups()
            .next()
            .expect("fixture root should have a child group");
        (GroupId::new(child.id().to_string()), child.id())
    }

    fn unknown_entry_id() -> EntryId {
        EntryId::new("00000000-0000-0000-0000-000000000000")
    }

    fn unknown_group_id() -> GroupId {
        GroupId::new("00000000-0000-0000-0000-000000000000")
    }

    fn reopen(document: &KdbxDocument) -> KdbxDocument {
        let mut saved = Vec::new();
        document
            .save_to_writer(&mut saved, FIXTURE_PASSWORD)
            .expect("mutated document should serialize");
        KdbxDocument::open_reader(&mut Cursor::new(saved), FIXTURE_PASSWORD)
            .expect("mutated document should reopen")
    }

    fn history_len(entry: &keepass::db::Entry) -> usize {
        entry
            .history
            .as_ref()
            .map_or(0, |history| history.get_entries().len())
    }

    fn assert_metadata_mutation_matrix(
        field: &str,
        before: &str,
        after: &str,
        setter: fn(&mut KdbxDocument, &EntryId, &str) -> Result<(), KdbxError>,
    ) {
        let mut unprotected = kdbx41_document();
        let (projected_id, upstream_id) = first_entry_ids(&unprotected);
        unprotected
            .database
            .entry_mut(upstream_id)
            .expect("target entry should exist")
            .set_unprotected(field, before);
        let original = unprotected
            .database
            .entry(upstream_id)
            .expect("prepared entry should exist");
        let original_history_len = history_len(&original);
        let original_last_modification = original.times.last_modification;

        setter(&mut unprotected, &projected_id, after)
            .expect("unprotected metadata edit should succeed");
        let edited = unprotected
            .database
            .entry(upstream_id)
            .expect("edited entry should exist");
        let edited_value = edited
            .fields
            .get(field)
            .expect("edited field should remain present");
        assert!(edited_value.get() == after, "metadata edit did not apply");
        assert!(
            !edited_value.is_protected(),
            "unprotected metadata unexpectedly became protected"
        );
        assert_eq!(
            history_len(&edited),
            original_history_len + 1,
            "metadata edit did not append exactly one history item"
        );
        let historical_value = edited
            .history
            .as_ref()
            .and_then(|history| history.get_entries().first())
            .and_then(|entry| entry.fields.get(field))
            .expect("metadata history should retain the previous field");
        assert!(
            historical_value.get() == before && !historical_value.is_protected(),
            "metadata history did not preserve the prior value and protection"
        );
        assert!(
            edited.times.last_modification != original_last_modification,
            "metadata edit did not update LastModificationTime"
        );

        let expected_database = unprotected.database.clone();
        let mut saved = Vec::new();
        unprotected
            .save_to_writer(&mut saved, FIXTURE_PASSWORD)
            .expect("metadata edit should serialize");
        let reopened = KdbxDocument::open_reader(&mut Cursor::new(saved), FIXTURE_PASSWORD)
            .expect("metadata edit should reopen");
        assert!(
            reopened.database == expected_database,
            "metadata round-trip changed parsed database semantics"
        );

        let mut protected = kdbx41_document();
        let (projected_id, upstream_id) = first_entry_ids(&protected);
        protected
            .database
            .entry_mut(upstream_id)
            .expect("target entry should exist")
            .set_protected(field, before);
        let original = protected
            .database
            .entry(upstream_id)
            .expect("prepared entry should exist");
        let original_history_len = history_len(&original);
        let original_last_modification = original.times.last_modification;

        setter(&mut protected, &projected_id, after)
            .expect("protected metadata edit should succeed");
        let edited = protected
            .database
            .entry(upstream_id)
            .expect("edited entry should exist");
        let edited_value = edited
            .fields
            .get(field)
            .expect("edited field should remain present");
        assert!(
            edited_value.get() == after,
            "protected metadata edit failed"
        );
        assert!(
            edited_value.is_protected(),
            "protected metadata lost its protection"
        );
        assert_eq!(
            history_len(&edited),
            original_history_len + 1,
            "protected metadata edit did not append history"
        );
        let historical_value = edited
            .history
            .as_ref()
            .and_then(|history| history.get_entries().first())
            .and_then(|entry| entry.fields.get(field))
            .expect("protected metadata history should retain the prior field");
        assert!(
            historical_value.get() == before && historical_value.is_protected(),
            "protected metadata history lost prior semantics"
        );
        assert!(
            edited.times.last_modification != original_last_modification,
            "protected metadata edit did not update LastModificationTime"
        );

        let mut same = kdbx41_document();
        let (projected_id, upstream_id) = first_entry_ids(&same);
        same.database
            .entry_mut(upstream_id)
            .expect("target entry should exist")
            .set_protected(field, before);
        let before_database = same.database.clone();
        setter(&mut same, &projected_id, before).expect("same-value edit should succeed");
        assert!(
            same.database == before_database,
            "same-value metadata edit changed the database"
        );

        let mut missing = kdbx41_document();
        let (projected_id, upstream_id) = first_entry_ids(&missing);
        missing
            .database
            .entry_mut(upstream_id)
            .expect("target entry should exist")
            .fields
            .remove(field);
        let original = missing
            .database
            .entry(upstream_id)
            .expect("prepared entry should exist");
        let original_history_len = history_len(&original);
        let original_last_modification = original.times.last_modification;
        setter(&mut missing, &projected_id, after)
            .expect("missing metadata field should be created");
        let edited = missing
            .database
            .entry(upstream_id)
            .expect("edited entry should exist");
        let edited_value = edited
            .fields
            .get(field)
            .expect("missing metadata field was not created");
        assert!(
            edited_value.get() == after && !edited_value.is_protected(),
            "new metadata field did not use the unprotected default"
        );
        assert_eq!(
            history_len(&edited),
            original_history_len + 1,
            "new metadata field did not append history"
        );
        assert!(
            edited
                .history
                .as_ref()
                .and_then(|history| history.get_entries().first())
                .is_some_and(|entry| !entry.fields.contains_key(field)),
            "metadata history did not preserve field absence"
        );
        assert!(
            edited.times.last_modification != original_last_modification,
            "new metadata field did not update LastModificationTime"
        );

        let mut missing_empty = kdbx41_document();
        let (projected_id, upstream_id) = first_entry_ids(&missing_empty);
        missing_empty
            .database
            .entry_mut(upstream_id)
            .expect("target entry should exist")
            .fields
            .remove(field);
        let before_database = missing_empty.database.clone();
        setter(&mut missing_empty, &projected_id, "")
            .expect("missing-to-empty metadata edit should succeed");
        assert!(
            missing_empty.database == before_database,
            "missing-to-empty metadata edit changed the database"
        );
    }

    fn assert_missing_metadata_uses_database_policy(
        field: &str,
        value: &str,
        setter: fn(&mut KdbxDocument, &EntryId, &str) -> Result<(), KdbxError>,
        configure: fn(&mut MemoryProtection, bool),
        verify_roundtrip: bool,
    ) {
        let mut protected = kdbx41_document();
        let mut policy = MemoryProtection::default();
        configure(&mut policy, true);
        protected.database.meta.memory_protection = Some(policy);
        let (projected_id, upstream_id) = first_entry_ids(&protected);
        protected
            .database
            .entry_mut(upstream_id)
            .expect("target entry should exist")
            .fields
            .remove(field);
        let original = protected
            .database
            .entry(upstream_id)
            .expect("prepared entry should exist");
        let original_history_len = history_len(&original);
        let original_last_modification = original.times.last_modification;

        setter(&mut protected, &projected_id, value)
            .expect("policy-driven field creation should succeed");
        let edited = protected
            .database
            .entry(upstream_id)
            .expect("edited entry should exist");
        let created = edited
            .fields
            .get(field)
            .expect("policy-driven field was not created");
        assert!(created.is_protected());
        assert!(created.get() == value, "created metadata value changed");
        assert_eq!(
            history_len(&edited),
            original_history_len + 1,
            "policy-driven creation did not append history"
        );
        assert!(
            edited
                .history
                .as_ref()
                .and_then(|history| history.get_entries().first())
                .is_some_and(|entry| !entry.fields.contains_key(field)),
            "policy-driven history did not preserve field absence"
        );
        assert!(
            edited.times.last_modification != original_last_modification,
            "policy-driven creation did not update LastModificationTime"
        );

        if verify_roundtrip {
            let mut saved = Vec::new();
            protected
                .save_to_writer(&mut saved, FIXTURE_PASSWORD)
                .expect("policy-driven edit should serialize");
            let reopened = KdbxDocument::open_reader(&mut Cursor::new(saved), FIXTURE_PASSWORD)
                .expect("policy-driven edit should reopen");
            assert!(
                reopened.database.entry(upstream_id).is_some_and(|entry| {
                    entry
                        .fields
                        .get(field)
                        .is_some_and(keepass::db::Value::is_protected)
                }),
                "reopened policy-driven field lost protection"
            );
        }

        let mut missing_empty = kdbx41_document();
        let mut policy = MemoryProtection::default();
        configure(&mut policy, true);
        missing_empty.database.meta.memory_protection = Some(policy);
        let (projected_id, upstream_id) = first_entry_ids(&missing_empty);
        missing_empty
            .database
            .entry_mut(upstream_id)
            .expect("target entry should exist")
            .fields
            .remove(field);
        let before_database = missing_empty.database.clone();
        setter(&mut missing_empty, &projected_id, "")
            .expect("policy-driven missing-to-empty edit should succeed");
        assert!(
            missing_empty.database == before_database,
            "policy-driven missing-to-empty edit changed the database"
        );

        let mut unprotected = kdbx41_document();
        let mut policy = MemoryProtection::default();
        configure(&mut policy, false);
        unprotected.database.meta.memory_protection = Some(policy);
        let (projected_id, upstream_id) = first_entry_ids(&unprotected);
        unprotected
            .database
            .entry_mut(upstream_id)
            .expect("target entry should exist")
            .fields
            .remove(field);
        setter(&mut unprotected, &projected_id, value)
            .expect("unprotected policy-driven field creation should succeed");
        assert!(
            unprotected
                .database
                .entry(upstream_id)
                .is_some_and(|entry| {
                    entry
                        .fields
                        .get(field)
                        .is_some_and(|value| !value.is_protected())
                }),
            "false database policy unexpectedly protected a new field"
        );

        let mut existing = kdbx41_document();
        let mut policy = MemoryProtection::default();
        configure(&mut policy, true);
        existing.database.meta.memory_protection = Some(policy);
        let (projected_id, upstream_id) = first_entry_ids(&existing);
        existing
            .database
            .entry_mut(upstream_id)
            .expect("target entry should exist")
            .set_unprotected(field, "public-existing-metadata");
        setter(&mut existing, &projected_id, value).expect("existing metadata edit should succeed");
        assert!(
            existing.database.entry(upstream_id).is_some_and(|entry| {
                entry
                    .fields
                    .get(field)
                    .is_some_and(|value| !value.is_protected())
            }),
            "database policy overrode an existing field's protection"
        );
    }

    fn assert_missing_metadata_without_policy_is_unprotected(
        field: &str,
        value: &str,
        setter: fn(&mut KdbxDocument, &EntryId, &str) -> Result<(), KdbxError>,
    ) {
        let mut document = kdbx41_document();
        document.database.meta.memory_protection = None;
        let (projected_id, upstream_id) = first_entry_ids(&document);
        document
            .database
            .entry_mut(upstream_id)
            .expect("target entry should exist")
            .fields
            .remove(field);

        setter(&mut document, &projected_id, value)
            .expect("missing metadata creation without policy should succeed");
        assert!(
            document.database.entry(upstream_id).is_some_and(|entry| {
                entry
                    .fields
                    .get(field)
                    .is_some_and(|value| !value.is_protected())
            }),
            "absent database policy did not use the unprotected fallback"
        );
    }

    fn keepassxc_version() -> Option<String> {
        match keepassxc_command().arg("--version").output() {
            Ok(output) if output.status.success() => {
                let version = String::from_utf8(output.stdout)
                    .expect("KeePassXC version output should be UTF-8");
                Some(version.trim().to_owned())
            }
            Ok(output) => panic!(
                "KeePassXC version detection failed with status {}",
                output.status
            ),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => None,
            Err(error) => panic!("KeePassXC version detection failed: {error}"),
        }
    }

    fn keepassxc_command() -> Command {
        let mut command = Command::new("keepassxc-cli");
        command.env("LANG", "C.UTF-8").env("LC_ALL", "C.UTF-8");
        command
    }

    fn run_keepassxc(stage: &str, arguments: Vec<OsString>) -> Output {
        let mut child = keepassxc_command()
            .args(arguments)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .unwrap_or_else(|error| {
                panic!("{stage}: could not start KeePassXC for {EXTERNAL_FIXTURE}: {error}")
            });

        let mut password_input = child
            .stdin
            .take()
            .expect("KeePassXC password input should be piped");
        password_input
            .write_all(FIXTURE_PASSWORD.as_bytes())
            .and_then(|()| password_input.write_all(b"\n"))
            .unwrap_or_else(|error| {
                panic!("{stage}: could not provide synthetic fixture credentials: {error}")
            });
        drop(password_input);

        let output = child
            .wait_with_output()
            .unwrap_or_else(|error| panic!("{stage}: could not wait for KeePassXC: {error}"));
        assert!(
            output.status.success(),
            "{stage}: KeePassXC command failed for {EXTERNAL_FIXTURE} with status {}",
            output.status
        );
        output
    }

    fn assert_keepassxc_title_edit(before: &keepass::db::Entry, after: &keepass::db::Entry) {
        let before_title = before
            .fields
            .get(fields::TITLE)
            .expect("external edit target should have a title");
        let after_title = after
            .fields
            .get(fields::TITLE)
            .expect("externally edited entry should retain a title field");
        assert!(
            after_title.as_str() == KEEPASSXC_EXTERNAL_TITLE,
            "KeePassXC title mutation did not persist"
        );
        assert!(
            before_title.is_protected() == after_title.is_protected(),
            "KeePassXC title mutation changed the title protection mode"
        );
        assert_eq!(
            before.fields.len(),
            after.fields.len(),
            "KeePassXC title mutation changed the field count"
        );
        for (key, value) in &before.fields {
            if key != fields::TITLE {
                assert!(
                    after.fields.get(key) == Some(value),
                    "KeePassXC title mutation changed an unrelated field"
                );
            }
        }

        assert!(
            before.times.creation == after.times.creation,
            "KeePassXC title mutation changed CreationTime"
        );
        assert!(
            before.times.last_access != after.times.last_access,
            "KeePassXC edit should update LastAccessTime"
        );
        assert!(
            before.times.expiry == after.times.expiry,
            "KeePassXC title mutation changed ExpiryTime"
        );
        assert!(
            before.times.location_changed == after.times.location_changed,
            "KeePassXC title mutation changed LocationChanged"
        );
        assert!(
            before.times.expires == after.times.expires,
            "KeePassXC title mutation changed Expires"
        );
        assert!(
            before.times.usage_count == after.times.usage_count,
            "KeePassXC title mutation changed UsageCount"
        );
        assert!(
            before.times.last_modification != after.times.last_modification,
            "KeePassXC title mutation did not update LastModificationTime"
        );

        let before_history = before
            .history
            .as_ref()
            .map_or(&[][..], |history| history.get_entries().as_slice());
        let after_history = after
            .history
            .as_ref()
            .map_or(&[][..], |history| history.get_entries().as_slice());
        let (latest_history, older_history) = after_history
            .split_first()
            .expect("KeePassXC title mutation should create a history item");
        let mut expected_history = before.clone();
        expected_history.history = None;
        assert!(
            latest_history == &expected_history,
            "KeePassXC history did not preserve the pre-edit entry state"
        );
        assert!(
            older_history == before_history,
            "KeePassXC title mutation changed existing history"
        );

        let mut expected_entry = before.clone();
        expected_entry.set(fields::TITLE, after_title.clone());
        expected_entry.times.last_modification = after.times.last_modification;
        expected_entry.times.last_access = after.times.last_access;
        expected_entry.history = after.history.clone();
        assert!(
            &expected_entry == after,
            "KeePassXC title mutation changed unrelated entry semantics"
        );
    }

    fn assert_database_preserved_after_keepassxc_edit(
        before: &Database,
        after: &Database,
        edited_id: keepass::db::EntryId,
    ) {
        assert!(
            before.config == after.config,
            "database configuration changed"
        );
        let mut expected_meta = before.meta.clone();
        let keepassxc_last_modified = after
            .meta
            .custom_data
            .get("_LAST_MODIFIED")
            .expect("KeePassXC resave should record _LAST_MODIFIED")
            .clone();
        assert!(
            expected_meta.custom_data.get("_LAST_MODIFIED") != Some(&keepassxc_last_modified),
            "KeePassXC resave should update _LAST_MODIFIED"
        );
        expected_meta
            .custom_data
            .insert("_LAST_MODIFIED".to_owned(), keepassxc_last_modified);
        if let Some(random_slug) = after.meta.custom_data.get("KPXC_RANDOM_SLUG") {
            expected_meta
                .custom_data
                .insert("KPXC_RANDOM_SLUG".to_owned(), random_slug.clone());
        } else {
            expected_meta.custom_data.remove("KPXC_RANDOM_SLUG");
        }
        if expected_meta != after.meta {
            let mut changed_fields = Vec::new();
            macro_rules! record_changed {
                ($field:ident) => {
                    if expected_meta.$field != after.meta.$field {
                        changed_fields.push(stringify!($field));
                    }
                };
            }
            record_changed!(generator);
            record_changed!(database_name);
            record_changed!(database_name_changed);
            record_changed!(database_description);
            record_changed!(database_description_changed);
            record_changed!(default_username);
            record_changed!(default_username_changed);
            record_changed!(maintenance_history_days);
            record_changed!(color);
            record_changed!(master_key_changed);
            record_changed!(master_key_change_rec);
            record_changed!(master_key_change_force);
            record_changed!(memory_protection);
            record_changed!(recyclebin_enabled);
            record_changed!(recyclebin_uuid);
            record_changed!(recyclebin_changed);
            record_changed!(entry_templates_group);
            record_changed!(entry_templates_group_changed);
            record_changed!(last_selected_group);
            record_changed!(last_top_visible_group);
            record_changed!(history_max_items);
            record_changed!(history_max_size);
            record_changed!(settings_changed);
            record_changed!(custom_data);
            let mut changed_custom_data = expected_meta
                .custom_data
                .keys()
                .chain(after.meta.custom_data.keys())
                .filter(|key| {
                    expected_meta.custom_data.get(*key) != after.meta.custom_data.get(*key)
                })
                .map(String::as_str)
                .collect::<Vec<_>>();
            changed_custom_data.sort_unstable();
            changed_custom_data.dedup();
            panic!(
                "KeePassXC resave changed metadata beyond allowed internal keys: {}; custom-data keys: {}",
                changed_fields.join(", "),
                changed_custom_data.join(", ")
            );
        }
        assert!(
            before.deleted_objects == after.deleted_objects,
            "deleted-object records changed"
        );
        assert_eq!(
            before.num_groups(),
            after.num_groups(),
            "group count changed"
        );
        assert_eq!(
            before.num_entries(),
            after.num_entries(),
            "entry count changed"
        );
        assert_eq!(
            before.num_attachments(),
            after.num_attachments(),
            "attachment count changed"
        );
        assert_eq!(
            before.num_custom_icons(),
            after.num_custom_icons(),
            "custom-icon count changed"
        );

        for group in before.iter_all_groups() {
            let after_group = after
                .group(group.id())
                .expect("KeePassXC output should retain every group UUID");
            assert!(
                *group == *after_group,
                "KeePassXC title mutation changed group semantics"
            );
        }
        for attachment in before.iter_all_attachments() {
            let after_attachment = after
                .attachment(attachment.id())
                .expect("KeePassXC output should retain every attachment ID");
            assert!(
                *attachment == *after_attachment,
                "KeePassXC title mutation changed attachment semantics"
            );
        }
        for icon in before.iter_all_custom_icons() {
            let after_icon = after
                .custom_icon(icon.id())
                .expect("KeePassXC output should retain every custom-icon UUID");
            assert!(
                *icon == *after_icon,
                "KeePassXC title mutation changed custom-icon semantics"
            );
        }
        for entry in before.iter_all_entries() {
            let after_entry = after
                .entry(entry.id())
                .expect("KeePassXC output should retain every entry UUID");
            if entry.id() == edited_id {
                assert_keepassxc_title_edit(&entry, &after_entry);
            } else {
                assert!(
                    *entry == *after_entry,
                    "KeePassXC title mutation changed an unrelated entry"
                );
            }
        }
    }

    #[test]
    fn opens_trusted_compatibility_fixtures() {
        for fixture in FIXTURES {
            let opened = open(fixture_path(fixture.file), fixture.password)
                .unwrap_or_else(|error| panic!("{} should open: {error}", fixture.file));
            let vault = opened.vault();

            assert_eq!(
                opened.version(),
                fixture.expected_version,
                "unexpected KDBX version in {}",
                fixture.file
            );
            assert_eq!(
                vault.root().name(),
                fixture.expected_root_name,
                "unexpected root group in {}",
                fixture.file
            );
            assert_eq!(
                vault.group_count(),
                fixture.expected_groups,
                "unexpected group count in {}",
                fixture.file
            );
            assert_eq!(
                vault.entry_count(),
                fixture.expected_entries,
                "unexpected entry count in {}",
                fixture.file
            );
        }
    }

    #[test]
    #[ignore = "requires a released keepassxc-cli; run scripts/test-keepassxc-compat.sh"]
    fn external_keepassxc_roundtrip_preserves_semantics() {
        let Some(version) = keepassxc_version() else {
            if std::env::var_os("NIAN_PASS_REQUIRE_KEEPASSXC").is_some() {
                panic!("keepassxc-cli is required but was not found");
            }
            eprintln!("SKIP: keepassxc-cli not found");
            return;
        };
        assert!(!version.is_empty(), "KeePassXC version should not be empty");
        eprintln!("External KeePassXC binary: {version}");

        let source_path = fixture_path(EXTERNAL_FIXTURE);
        let source_bytes = fs::read(&source_path).expect("trusted fixture should be readable");
        let temp = TestTempDir::create();
        let fixture_copy = temp.join("external-source-copy.kdbx");
        let created_output = temp.join("nian-pass-created-entry.kdbx");
        let nian_output = temp.join("nian-pass-output.kdbx");
        let keepassxc_output = temp.join("keepassxc-output.kdbx");
        fs::copy(&source_path, &fixture_copy).expect("fixture should copy into the temp directory");

        let mut creation_document = KdbxDocument::open(&fixture_copy, FIXTURE_PASSWORD)
            .expect("trusted KDBX 4.1 fixture should open for creation");
        let (creation_root_id, _) = root_group_ids(&creation_document);
        let created_entry_id = creation_document
            .create_entry(
                &creation_root_id,
                NewEntry {
                    title: NIAN_PASS_CREATED_TITLE,
                    username: "created-user",
                    url: "https://created.example.test",
                    password: None,
                },
            )
            .expect("Nian Pass entry creation should succeed");
        assert!(
            creation_document.find_entry_id(&created_entry_id).is_ok(),
            "created entry UUID was not retained"
        );
        let expected_creation_database = creation_document.database.clone();
        let mut creation_output_file =
            fs::File::create(&created_output).expect("test-only creation output should be created");
        creation_document
            .save_to_writer(&mut creation_output_file, FIXTURE_PASSWORD)
            .expect("created entry should serialize");
        drop(creation_output_file);
        let creation_reopened = KdbxDocument::open(&created_output, FIXTURE_PASSWORD)
            .expect("created-entry output should reopen");
        assert!(
            creation_reopened.database == expected_creation_database,
            "created-entry output changed before external validation"
        );
        let creation_info = run_keepassxc(
            "KeePassXC opening Nian Pass created-entry output",
            vec![
                OsString::from("db-info"),
                OsString::from("-q"),
                created_output.as_os_str().to_owned(),
            ],
        );
        let creation_info = String::from_utf8(creation_info.stdout)
            .expect("KeePassXC created-entry db-info output should be UTF-8");
        assert!(
            creation_info.contains("Number of entries: 3"),
            "KeePassXC did not count the Nian Pass-created entry"
        );
        let creation_listing = run_keepassxc(
            "KeePassXC listing Nian Pass created-entry output",
            vec![
                OsString::from("ls"),
                OsString::from("-q"),
                OsString::from("-R"),
                OsString::from("-f"),
                created_output.as_os_str().to_owned(),
            ],
        );
        let creation_listing = String::from_utf8(creation_listing.stdout)
            .expect("KeePassXC created-entry listing should be UTF-8");
        assert!(
            creation_listing
                .lines()
                .any(|line| line == NIAN_PASS_CREATED_TITLE),
            "KeePassXC did not list the entry created by Nian Pass"
        );

        let mut document = KdbxDocument::open(&fixture_copy, FIXTURE_PASSWORD)
            .expect("trusted KDBX 4.1 fixture should open");
        assert!(
            document.version() == (KdbxVersion::Kdbx4 { minor: 1 }),
            "external fixture should be exact KDBX 4.1"
        );
        let nian_target = document
            .database
            .iter_all_entries()
            .find(|entry| entry.get_title() == Some("tagged-entry-41"))
            .expect("fixture should contain the tagged Nian Pass edit target");
        assert_eq!(
            nian_target.tags.len(),
            3,
            "fixture should retain its externally created tag set"
        );
        assert!(
            nian_target
                .fields
                .get(fields::PASSWORD)
                .is_some_and(|value| value.is_protected()),
            "fixture password should be protected"
        );
        let original_history_len = nian_target
            .history
            .as_ref()
            .map_or(0, |history| history.get_entries().len());
        let nian_target_id = nian_target.id();
        let projected_id = EntryId::new(nian_target_id.to_string());

        document
            .set_entry_title(&projected_id, NIAN_PASS_EXTERNAL_TITLE)
            .expect("Nian Pass title mutation should succeed");
        let mutated_entry = document
            .database
            .entry(nian_target_id)
            .expect("Nian Pass mutation should retain the target UUID");
        assert_eq!(
            mutated_entry
                .history
                .as_ref()
                .map_or(0, |history| history.get_entries().len()),
            original_history_len + 1,
            "Nian Pass mutation should add exactly one history item"
        );
        assert_eq!(
            mutated_entry.tags.len(),
            3,
            "Nian Pass mutation changed the external tag set"
        );
        assert!(
            mutated_entry
                .fields
                .get(fields::PASSWORD)
                .is_some_and(|value| value.is_protected()),
            "Nian Pass mutation changed password protection"
        );

        let expected_nian_database = document.database.clone();
        let mut output_file = fs::File::create(&nian_output)
            .expect("test-only Nian Pass output should be created in the temp directory");
        document
            .save_to_writer(&mut output_file, FIXTURE_PASSWORD)
            .expect("Nian Pass should serialize the external fixture");
        drop(output_file);

        let nian_reopened = KdbxDocument::open(&nian_output, FIXTURE_PASSWORD)
            .expect("Nian Pass output should reopen before external validation");
        assert!(
            nian_reopened.version() == document.version(),
            "Nian Pass output changed the exact KDBX version"
        );
        assert!(
            nian_reopened.database == expected_nian_database,
            "Nian Pass output changed parsed semantics before external validation"
        );

        let info = run_keepassxc(
            "KeePassXC opening Nian Pass output",
            vec![
                OsString::from("db-info"),
                OsString::from("-q"),
                nian_output.as_os_str().to_owned(),
            ],
        );
        let info =
            String::from_utf8(info.stdout).expect("KeePassXC db-info output should be UTF-8");
        assert!(
            info.contains("Cipher: AES 256-bit")
                && info.contains("KDF: AES")
                && info.contains("Number of entries: 2"),
            "KeePassXC db-info did not report the expected public fixture metadata"
        );

        let listing = run_keepassxc(
            "KeePassXC listing Nian Pass output",
            vec![
                OsString::from("ls"),
                OsString::from("-q"),
                OsString::from("-R"),
                OsString::from("-f"),
                nian_output.as_os_str().to_owned(),
            ],
        );
        let listing = String::from_utf8(listing.stdout).expect("KeePassXC listing should be UTF-8");
        assert!(
            listing.lines().any(|line| line == NIAN_PASS_EXTERNAL_TITLE),
            "KeePassXC did not read the Unicode title written by Nian Pass"
        );

        let keepassxc_target_id = nian_reopened
            .database
            .iter_all_entries()
            .find(|entry| entry.get_title() == Some(KEEPASSXC_ENTRY_TITLE))
            .map(|entry| entry.id())
            .expect("fixture should contain the KeePassXC edit target");
        fs::copy(&nian_output, &keepassxc_output)
            .expect("Nian Pass output should copy before KeePassXC mutation");
        run_keepassxc(
            "KeePassXC mutation and resave",
            vec![
                OsString::from("edit"),
                OsString::from("-q"),
                OsString::from("--title"),
                OsString::from(KEEPASSXC_EXTERNAL_TITLE),
                keepassxc_output.as_os_str().to_owned(),
                OsString::from(KEEPASSXC_ENTRY_TITLE),
            ],
        );

        let keepassxc_reopened = KdbxDocument::open(&keepassxc_output, FIXTURE_PASSWORD)
            .expect("Nian Pass should reopen the KeePassXC-resaved output");
        assert!(
            keepassxc_reopened.version() == nian_reopened.version(),
            "KeePassXC resave changed the exact KDBX version"
        );
        assert_database_preserved_after_keepassxc_edit(
            &nian_reopened.database,
            &keepassxc_reopened.database,
            keepassxc_target_id,
        );
        let final_nian_entry = keepassxc_reopened
            .database
            .entry(nian_target_id)
            .expect("KeePassXC resave should retain the Nian Pass target UUID");
        assert!(
            final_nian_entry.get_title() == Some(NIAN_PASS_EXTERNAL_TITLE),
            "KeePassXC resave changed the Nian Pass Unicode title"
        );
        assert_eq!(
            final_nian_entry.tags.len(),
            3,
            "KeePassXC resave changed the external tag set"
        );
        assert!(
            final_nian_entry
                .fields
                .get(fields::PASSWORD)
                .is_some_and(|value| value.is_protected()),
            "KeePassXC resave changed protected-password semantics"
        );
        assert!(
            fs::read(&source_path).expect("source fixture should remain readable") == source_bytes,
            "external compatibility test modified its source fixture"
        );
    }

    #[test]
    fn rejects_wrong_password_for_every_compatible_format() {
        for fixture in FIXTURES {
            let result = open(fixture_path(fixture.file), WRONG_FIXTURE_PASSWORD);

            match result {
                Err(KdbxError::InvalidCredentials) => {}
                Err(error) => panic!(
                    "wrong password returned the wrong error for {}: {error:?}",
                    fixture.file
                ),
                Ok(_) => panic!("wrong password opened {}", fixture.file),
            }
        }
    }

    #[test]
    fn rejects_invalid_files_cleanly() {
        let toml_result = open(
            Path::new(env!("CARGO_MANIFEST_DIR")).join("Cargo.toml"),
            FIXTURE_PASSWORD,
        );
        assert!(matches!(toml_result, Err(KdbxError::InvalidKdbx)));

        for input in [
            &b"plain text"[..],
            &b"[package]\nname = \"not-kdbx\""[..],
            &b"\x03\xd9\xa2"[..],
        ] {
            let result = open_reader(&mut Cursor::new(input), FIXTURE_PASSWORD);
            assert!(matches!(result, Err(KdbxError::InvalidKdbx)));
        }
    }

    #[test]
    fn rejects_truncated_fixtures_without_exposing_credentials() {
        for fixture in FIXTURES {
            let bytes = fs::read(fixture_path(fixture.file)).expect("fixture should be readable");
            let lengths = [0, 1, 11, 12, bytes.len() / 2, bytes.len() - 1];

            for length in lengths {
                let result = open_reader(&mut Cursor::new(&bytes[..length]), fixture.password);
                let error = match result {
                    Ok(_) => panic!(
                        "truncated fixture {} unexpectedly opened at {length} bytes",
                        fixture.file
                    ),
                    Err(error) => error,
                };

                assert!(!error.to_string().contains(fixture.password));
            }
        }
    }

    #[test]
    fn maps_corrupted_authenticated_payloads_to_invalid_kdbx() {
        for fixture in &FIXTURES[1..] {
            let mut bytes =
                fs::read(fixture_path(fixture.file)).expect("fixture should be readable");
            let mutation_index = bytes.len() / 2;
            bytes[mutation_index] ^= 0x01;

            let result = open_reader(&mut Cursor::new(bytes), fixture.password);
            assert!(
                matches!(result, Err(KdbxError::InvalidKdbx)),
                "authenticated corruption should be invalid KDBX for {}",
                fixture.file
            );
        }
    }

    #[test]
    fn distinguishes_unsupported_legacy_format_from_invalid_version() {
        let legacy_kdb_header = [
            0x03, 0xd9, 0xa2, 0x9a, 0x65, 0xfb, 0x4b, 0xb5, 0x00, 0x00, 0x01, 0x00,
        ];
        let unsupported = open_reader(&mut Cursor::new(legacy_kdb_header), FIXTURE_PASSWORD);
        assert!(matches!(unsupported, Err(KdbxError::UnsupportedFormat)));

        let invalid_future_version = [
            0x03, 0xd9, 0xa2, 0x9a, 0x67, 0xfb, 0x4b, 0xb5, 0x00, 0x00, 0x05, 0x00,
        ];
        let invalid = open_reader(&mut Cursor::new(invalid_future_version), FIXTURE_PASSWORD);
        assert!(matches!(invalid, Err(KdbxError::InvalidKdbx)));
    }

    #[test]
    fn converts_nested_and_empty_groups() {
        let opened = open(
            fixture_path("keepass-upstream-kdbx31-aeskdf-aes.kdbx"),
            FIXTURE_PASSWORD,
        )
        .expect("KDBX 3.1 fixture should open");
        let vault = opened.vault();

        let general = vault
            .root()
            .groups()
            .iter()
            .find(|group| group.name() == "General")
            .expect("General group should exist");
        assert!(
            general
                .groups()
                .iter()
                .any(|group| group.name() == "Subgroup")
        );

        let recycle_bin = vault
            .root()
            .groups()
            .iter()
            .find(|group| group.name() == "Recycle Bin")
            .expect("Recycle Bin group should exist");
        assert!(recycle_bin.groups().is_empty());
        assert!(recycle_bin.entries().is_empty());
    }

    #[test]
    fn projects_known_entry_titles_including_empty_titles() {
        let cases: &[(&str, &[&str])] = &[
            (
                "keepass-upstream-kdbx31-aeskdf-aes.kdbx",
                &["Sample Entry", ""],
            ),
            ("keepassxc-upstream-kdbx40-argon2d-aes.kdbx", &["Test", ""]),
            (
                "keepassxc-upstream-kdbx40-argon2id-chacha20.kdbx",
                &["test"],
            ),
            (
                "keepassxc-2.7.12-kdbx41.kdbx",
                &["tagged-entry-41", "ayyyyo"],
            ),
        ];

        for (file, expected_titles) in cases {
            let opened = open(fixture_path(file), FIXTURE_PASSWORD)
                .unwrap_or_else(|error| panic!("{file} should open: {error}"));
            let vault = opened.vault();
            let titles: Vec<_> = vault
                .root()
                .entries()
                .iter()
                .map(|entry| {
                    entry
                        .title()
                        .visible()
                        .expect("known fixture title should be visible")
                })
                .collect();

            assert_eq!(titles, *expected_titles, "unexpected titles in {file}");
            assert!(!vault.root().id().as_str().is_empty());
            assert!(
                vault
                    .root()
                    .entries()
                    .iter()
                    .all(|entry| !entry.id().as_str().is_empty())
            );
        }
    }

    #[test]
    fn entry_summaries_preserve_metadata_presence_without_secret_plaintext() {
        const TEST_TITLE: &str = "public-visible-title";
        const TEST_NOTES: &str = "public-test-notes";

        let mut document = kdbx41_document();
        let (projected_id, upstream_id) = first_entry_ids(&document);
        {
            let mut entry = document
                .database
                .entry_mut(upstream_id)
                .expect("target entry should exist");
            entry.set_unprotected(fields::TITLE, TEST_TITLE);
            entry.fields.remove(fields::USERNAME);
            entry.set_unprotected(fields::URL, "");
            entry.set_protected(fields::NOTES, TEST_NOTES);
        }

        let vault = document
            .projection()
            .expect("prepared document should project");
        let summary = vault
            .root()
            .entries()
            .iter()
            .find(|entry| entry.id() == &projected_id)
            .expect("prepared entry should be present in the projection");

        assert!(summary.title().visible() == Some(TEST_TITLE));
        assert!(!summary.title().is_missing());
        assert!(!summary.title().is_protected());
        assert!(summary.username().is_missing());
        assert!(summary.username().visible().is_none());
        assert!(!summary.username().is_protected());
        assert!(!summary.url().is_missing());
        assert!(!summary.url().is_protected());
        assert!(summary.url().visible() == Some(""));
        assert!(
            summary.has_password(),
            "password presence was not projected"
        );
        assert!(summary.has_notes(), "notes presence was not projected");
        assert_eq!(summary.tags().len(), 3, "fixture tags were not projected");
    }

    #[test]
    fn protected_standard_metadata_projects_without_plaintext() {
        const TEST_TITLE: &str = "public-protected-title";
        const TEST_USERNAME: &str = "public-protected-username";
        const TEST_URL: &str = "https://protected.example.test";

        let mut document = kdbx41_document();
        let (projected_id, upstream_id) = first_entry_ids(&document);
        {
            let mut entry = document
                .database
                .entry_mut(upstream_id)
                .expect("target entry should exist");
            entry.set_protected(fields::TITLE, TEST_TITLE);
            entry.set_protected(fields::USERNAME, TEST_USERNAME);
            entry.set_protected(fields::URL, TEST_URL);
        }

        let vault = document
            .projection()
            .expect("prepared document should project");
        let summary = vault
            .root()
            .entries()
            .iter()
            .find(|entry| entry.id() == &projected_id)
            .expect("prepared entry should be present in the projection");

        for projected in [summary.title(), summary.username(), summary.url()] {
            assert!(projected.is_protected());
            assert!(projected.visible().is_none());
            assert!(!projected.is_missing());
        }
        assert!(matches!(summary.title(), SummaryText::Protected));
        assert!(matches!(summary.username(), SummaryText::Protected));
        assert!(matches!(summary.url(), SummaryText::Protected));
    }

    #[test]
    fn reads_one_password_explicitly_and_preserves_missing_and_empty() {
        let mut document = kdbx41_document();
        let (projected_id, upstream_id) = first_entry_ids(&document);
        let raw_entry = document
            .database
            .entry(upstream_id)
            .expect("fixture target should exist");
        let expected = raw_entry
            .fields
            .get(fields::PASSWORD)
            .expect("fixture target should have a password")
            .get();
        let secret = document
            .entry_password(&projected_id)
            .expect("password lookup should succeed")
            .expect("fixture password should exist");
        assert!(
            secret.expose_secret() == expected,
            "synthetic fixture password was not returned"
        );
        drop(secret);

        document
            .database
            .entry_mut(upstream_id)
            .expect("target entry should exist")
            .fields
            .remove(fields::PASSWORD);
        assert!(
            document
                .entry_password(&projected_id)
                .expect("missing password lookup should succeed")
                .is_none(),
            "missing password did not remain absent"
        );

        document
            .database
            .entry_mut(upstream_id)
            .expect("target entry should exist")
            .set_protected(fields::PASSWORD, "");
        let empty = document
            .entry_password(&projected_id)
            .expect("empty password lookup should succeed")
            .expect("explicit empty password should remain present");
        assert!(
            empty.expose_secret().is_empty(),
            "explicit empty password changed value"
        );

        assert!(matches!(
            document.entry_password(&EntryId::new("00000000-0000-0000-0000-000000000000")),
            Err(KdbxError::EntryNotFound)
        ));
    }

    #[test]
    fn reads_notes_explicitly_and_preserves_missing_and_empty() {
        const TEST_NOTES: &str = "public-test-notes";

        let mut document = kdbx41_document();
        let (projected_id, upstream_id) = first_entry_ids(&document);
        document
            .database
            .entry_mut(upstream_id)
            .expect("target entry should exist")
            .set_protected(fields::NOTES, TEST_NOTES);

        let notes = document
            .entry_notes(&projected_id)
            .expect("notes lookup should succeed")
            .expect("prepared notes should exist");
        assert!(
            notes.expose_secret() == TEST_NOTES,
            "synthetic notes were not returned"
        );
        drop(notes);

        document
            .database
            .entry_mut(upstream_id)
            .expect("target entry should exist")
            .fields
            .remove(fields::NOTES);
        assert!(
            document
                .entry_notes(&projected_id)
                .expect("missing notes lookup should succeed")
                .is_none(),
            "missing notes did not remain absent"
        );

        document
            .database
            .entry_mut(upstream_id)
            .expect("target entry should exist")
            .set_protected(fields::NOTES, "");
        let empty = document
            .entry_notes(&projected_id)
            .expect("empty notes lookup should succeed")
            .expect("explicit empty notes should remain present");
        assert!(
            empty.expose_secret().is_empty(),
            "explicit empty notes changed value"
        );
    }

    #[test]
    fn entry_creation_uses_upstream_identity_defaults_and_fresh_projection() {
        let path = fixture_path(EXTERNAL_FIXTURE);
        let source_bytes = fs::read(&path).expect("fixture should be readable");
        let mut document = kdbx41_document();
        let old_projection = document.projection().expect("fixture should project");
        let (root_id, upstream_root_id) = root_group_ids(&document);
        let original_entries = document.database.num_entries();
        let original_groups = document.database.num_groups();
        let policy = MemoryProtection {
            protect_title: true,
            protect_username: false,
            protect_password: false,
            protect_url: true,
            protect_notes: false,
        };
        document.database.meta.memory_protection = Some(policy);
        let password = SecretString::new("public-created-password".to_owned());
        let empty_password = SecretString::new(String::new());

        let created = document
            .create_entry(
                &root_id,
                NewEntry {
                    title: "Created entry",
                    username: "",
                    url: "https://created.example.test/đường-dẫn",
                    password: Some(&password),
                },
            )
            .expect("entry creation should succeed");
        let second = document
            .create_entry(
                &root_id,
                NewEntry {
                    title: "",
                    username: "",
                    url: "",
                    password: None,
                },
            )
            .expect("minimal entry creation should succeed");
        let third = document
            .create_entry(
                &root_id,
                NewEntry {
                    title: "",
                    username: "",
                    url: "",
                    password: Some(&empty_password),
                },
            )
            .expect("explicit empty password creation should succeed");

        assert!(
            created != second && second != third && created != third,
            "generated entry UUIDs collided"
        );
        assert!(!created.as_str().is_empty(), "created UUID was empty");
        assert_eq!(document.database.num_entries(), original_entries + 3);
        assert_eq!(document.database.num_groups(), original_groups);
        assert!(
            old_projection.find_entry(&created).is_none(),
            "old projection changed after document mutation"
        );
        assert!(
            document
                .projection()
                .expect("mutated document should project")
                .find_entry(&created)
                .is_some(),
            "fresh projection omitted created entry"
        );

        let upstream_created = document
            .find_entry_id(&created)
            .expect("created entry should be discoverable by UUID");
        let entry = document
            .database
            .entry(upstream_created)
            .expect("created entry should exist");
        assert!(entry.parent().id() == upstream_root_id);
        assert!(entry.autotype.is_none());
        assert!(entry.tags.is_empty());
        assert!(entry.custom_data.is_empty());
        assert!(entry.icon().is_none());
        assert!(entry.foreground_color.is_none());
        assert!(entry.background_color.is_none());
        assert!(entry.override_url.is_none());
        assert!(entry.quality_check);
        assert!(entry.attachments().next().is_none());
        assert!(entry.previous_parent().is_none());
        assert!(
            entry
                .fields
                .get(fields::TITLE)
                .is_some_and(|value| value.get() == "Created entry" && value.is_protected()),
            "created title did not follow database protection policy"
        );
        assert!(
            !entry.fields.contains_key(fields::USERNAME),
            "empty username should remain absent"
        );
        assert!(
            entry
                .fields
                .get(fields::URL)
                .is_some_and(|value| value.is_protected()),
            "created URL did not follow database protection policy"
        );
        assert!(
            entry
                .fields
                .get(fields::PASSWORD)
                .is_some_and(|value| value.is_protected()),
            "created password was not protected"
        );
        assert_eq!(history_len(&entry), 0, "creation invented entry history");
        assert!(entry.times.creation.is_some());
        assert!(entry.times.last_modification.is_some());
        assert!(entry.times.last_access.is_some());
        assert!(entry.times.location_changed.is_some());

        let upstream_second = document
            .find_entry_id(&second)
            .expect("second entry should be discoverable by UUID");
        assert!(
            document
                .database
                .entry(upstream_second)
                .is_some_and(|entry| entry.fields.is_empty()),
            "empty optional creation fields were materialized"
        );
        let upstream_third = document
            .find_entry_id(&third)
            .expect("third entry should be discoverable by UUID");
        let third_entry = document
            .database
            .entry(upstream_third)
            .expect("third entry should exist");
        assert_eq!(third_entry.fields.len(), 1);
        assert!(
            third_entry
                .fields
                .get(fields::PASSWORD)
                .is_some_and(|value| value.get().is_empty() && value.is_protected()),
            "explicit empty password was not preserved as protected"
        );

        let expected_database = document.database.clone();
        let reopened = reopen(&document);
        assert!(
            reopened.database == expected_database,
            "entry creation round-trip changed parsed database semantics"
        );
        assert!(
            fs::read(path).expect("source fixture should remain readable") == source_bytes,
            "entry creation test modified its source fixture"
        );
    }

    #[test]
    fn entry_move_preserves_identity_fields_history_and_roundtrips() {
        let mut document = kdbx41_document();
        let old_projection = document.projection().expect("fixture should project");
        let (entry_id, upstream_entry_id) = first_entry_ids(&document);
        let (destination_id, upstream_destination_id) = first_child_group_ids(&document);
        let source_id = document
            .database
            .entry(upstream_entry_id)
            .expect("entry should exist")
            .parent()
            .id();
        document
            .database
            .entry_mut(upstream_entry_id)
            .expect("entry should exist")
            .times
            .location_changed = Some(Times::epoch());
        let before = document
            .database
            .entry(upstream_entry_id)
            .expect("entry should exist");
        let fields_before = before.fields.clone();
        let history_before = before.history.clone();
        let last_modification_before = before.times.last_modification;

        document
            .move_entry(&entry_id, &destination_id)
            .expect("entry move should succeed");
        let moved = document
            .database
            .entry(upstream_entry_id)
            .expect("moved entry should exist");
        assert!(moved.id() == upstream_entry_id);
        assert!(moved.parent().id() == upstream_destination_id);
        assert!(
            moved
                .previous_parent()
                .is_some_and(|group| group.id() == source_id)
        );
        assert!(
            moved.fields == fields_before,
            "entry move changed field data"
        );
        assert!(
            moved.history == history_before,
            "entry move changed history"
        );
        assert!(moved.times.last_modification == last_modification_before);
        assert!(moved.times.location_changed != Some(Times::epoch()));
        assert!(
            !document
                .database
                .group(source_id)
                .expect("source group should exist")
                .entry_ids()
                .any(|id| id == upstream_entry_id)
        );
        assert_eq!(
            document
                .database
                .group(upstream_destination_id)
                .expect("destination should exist")
                .entry_ids()
                .filter(|id| *id == upstream_entry_id)
                .count(),
            1
        );
        let fresh_projection = document
            .projection()
            .expect("moved document should project");
        assert!(
            old_projection
                .root()
                .entries()
                .iter()
                .any(|entry| entry.id() == &entry_id),
            "old projection changed after entry move"
        );
        assert!(
            !fresh_projection
                .root()
                .entries()
                .iter()
                .any(|entry| entry.id() == &entry_id),
            "fresh projection retained moved entry in source"
        );
        assert!(
            fresh_projection
                .find_group(&destination_id)
                .is_some_and(|group| group.entries().iter().any(|entry| entry.id() == &entry_id)),
            "fresh projection omitted moved entry from destination"
        );

        let before_same_group = document.database.clone();
        document
            .move_entry(&entry_id, &destination_id)
            .expect("same-group move should succeed");
        assert!(
            document.database == before_same_group,
            "same-group entry move changed the database"
        );

        let expected_database = document.database.clone();
        let reopened = reopen(&document);
        assert!(
            reopened.database == expected_database,
            "entry move round-trip changed parsed semantics"
        );
    }

    #[test]
    fn entry_move_validation_and_unknown_delete_leave_database_unchanged() {
        let mut document = kdbx41_document();
        let (entry_id, _) = first_entry_ids(&document);
        let before = document.database.clone();

        assert!(matches!(
            document.move_entry(&unknown_entry_id(), &unknown_group_id()),
            Err(KdbxError::EntryNotFound)
        ));
        assert!(document.database == before);
        assert!(matches!(
            document.move_entry(&entry_id, &unknown_group_id()),
            Err(KdbxError::GroupNotFound)
        ));
        assert!(document.database == before);
        assert!(matches!(
            document.create_entry(
                &unknown_group_id(),
                NewEntry {
                    title: "unused",
                    username: "",
                    url: "",
                    password: None,
                }
            ),
            Err(KdbxError::GroupNotFound)
        ));
        assert!(document.database == before);
        assert!(matches!(
            document.permanently_delete_entry(&unknown_entry_id()),
            Err(KdbxError::EntryNotFound)
        ));
        assert!(document.database == before);
    }

    #[test]
    fn permanent_entry_delete_creates_and_roundtrips_tombstone() {
        let mut document = kdbx41_document();
        let old_projection = document.projection().expect("fixture should project");
        let (entry_id, upstream_entry_id) = first_entry_ids(&document);
        let original_count = document.database.num_entries();
        let original_deleted = document.database.deleted_objects.len();

        document
            .permanently_delete_entry(&entry_id)
            .expect("permanent entry deletion should succeed");

        assert_eq!(document.database.num_entries(), original_count - 1);
        assert!(document.database.entry(upstream_entry_id).is_none());
        assert_eq!(
            document.database.deleted_objects.len(),
            original_deleted + 1
        );
        assert!(old_projection.find_entry(&entry_id).is_some());
        assert!(
            document
                .projection()
                .expect("deleted document should project")
                .find_entry(&entry_id)
                .is_none(),
            "fresh projection retained permanently deleted entry"
        );
        assert!(
            document
                .database
                .deleted_objects
                .get(&upstream_entry_id.uuid())
                .is_some_and(|timestamp| timestamp.is_some()),
            "entry tombstone did not contain a deletion timestamp"
        );

        let expected_database = document.database.clone();
        let reopened = reopen(&document);
        assert!(reopened.database.entry(upstream_entry_id).is_none());
        assert!(
            reopened
                .database
                .deleted_objects
                .get(&upstream_entry_id.uuid())
                .is_some_and(|timestamp| timestamp.is_some())
        );
        assert!(
            reopened.database == expected_database,
            "entry deletion round-trip changed parsed semantics"
        );
    }

    #[test]
    fn group_create_rename_and_move_preserve_defaults_and_validate_cycles() {
        let mut document = kdbx41_document();
        let (root_id, upstream_root_id) = root_group_ids(&document);
        let group_a = document
            .create_group(&root_id, "Group A")
            .expect("group creation should succeed");
        let group_b = document
            .create_group(&root_id, "")
            .expect("empty group name should be accepted");
        let group_c = document
            .create_group(&group_a, "Group C")
            .expect("nested group creation should succeed");
        assert!(group_a != group_b && group_b != group_c && group_a != group_c);
        let upstream_a = document
            .find_group_id(&group_a)
            .expect("group A should exist");
        let upstream_b = document
            .find_group_id(&group_b)
            .expect("group B should exist");
        let upstream_c = document
            .find_group_id(&group_c)
            .expect("group C should exist");
        let created_b = document
            .database
            .group(upstream_b)
            .expect("group B should exist");
        assert!(created_b.name.is_empty());
        assert!(
            created_b
                .parent()
                .is_some_and(|parent| parent.id() == upstream_root_id)
        );
        assert!(created_b.previous_parent().is_none());
        assert!(created_b.notes.is_none());
        assert!(created_b.tags.is_empty());
        assert!(created_b.icon().is_none());
        assert!(created_b.custom_data.is_empty());
        assert!(created_b.is_expanded);
        assert!(created_b.default_autotype_sequence.is_none());
        assert!(created_b.enable_autotype.is_none());
        assert!(created_b.enable_searching.is_none());
        assert!(created_b.group_ids().next().is_none());
        assert!(created_b.entry_ids().next().is_none());
        assert!(created_b.times.creation.is_some());
        assert!(created_b.times.last_modification.is_some());
        assert!(created_b.times.last_access.is_some());
        assert!(created_b.times.location_changed.is_some());

        let before_same_name = document.database.clone();
        document
            .rename_group(&group_a, "Group A")
            .expect("same-name rename should succeed");
        assert!(document.database == before_same_name);
        document
            .database
            .group_mut(upstream_a)
            .expect("group A should exist")
            .times
            .last_modification = Some(Times::epoch());
        document
            .rename_group(&group_a, "Renamed A")
            .expect("real group rename should succeed");
        let renamed = document
            .database
            .group(upstream_a)
            .expect("renamed group should exist");
        assert!(renamed.name == "Renamed A");
        assert!(renamed.times.last_modification != Some(Times::epoch()));
        document
            .rename_group(&root_id, "Renamed Root")
            .expect("root rename should be supported");
        assert!(
            document
                .database
                .group(upstream_root_id)
                .is_some_and(|root| root.name == "Renamed Root")
        );

        for result in [
            document.move_group(&root_id, &group_a),
            document.move_group(&group_a, &group_a),
            document.move_group(&group_a, &group_c),
        ] {
            assert!(matches!(result, Err(KdbxError::InvalidGroupMove)));
        }
        let before_unknown = document.database.clone();
        assert!(matches!(
            document.create_group(&unknown_group_id(), "unused"),
            Err(KdbxError::GroupNotFound)
        ));
        assert!(document.database == before_unknown);
        assert!(matches!(
            document.rename_group(&unknown_group_id(), "unused"),
            Err(KdbxError::GroupNotFound)
        ));
        assert!(document.database == before_unknown);
        assert!(matches!(
            document.move_group(&unknown_group_id(), &group_b),
            Err(KdbxError::GroupNotFound)
        ));
        assert!(document.database == before_unknown);
        assert!(matches!(
            document.move_group(&group_c, &unknown_group_id()),
            Err(KdbxError::GroupNotFound)
        ));
        assert!(document.database == before_unknown);

        document
            .database
            .group_mut(upstream_c)
            .expect("group C should exist")
            .times
            .location_changed = Some(Times::epoch());
        document
            .move_group(&group_c, &group_b)
            .expect("valid group move should succeed");
        let moved = document
            .database
            .group(upstream_c)
            .expect("moved group should exist");
        assert!(moved.id() == upstream_c);
        assert!(
            moved
                .parent()
                .is_some_and(|parent| parent.id() == upstream_b)
        );
        assert!(
            moved
                .previous_parent()
                .is_some_and(|parent| parent.id() == upstream_a)
        );
        assert!(moved.times.location_changed != Some(Times::epoch()));
        assert!(
            document
                .database
                .group(upstream_root_id)
                .expect("root should exist")
                .group_ids()
                .any(|id| id == upstream_b)
        );

        let before_same_parent = document.database.clone();
        document
            .move_group(&group_c, &group_b)
            .expect("same-parent group move should succeed");
        assert!(document.database == before_same_parent);

        let expected_database = document.database.clone();
        let reopened = reopen(&document);
        assert!(
            reopened.database == expected_database,
            "group create/rename/move round-trip changed parsed semantics"
        );
    }

    #[test]
    fn invalid_group_moves_and_root_delete_are_complete_no_ops() {
        let mut document = kdbx41_document();
        let (root_id, _) = root_group_ids(&document);
        let child = document
            .create_group(&root_id, "Cycle parent")
            .expect("group should be created");
        let descendant = document
            .create_group(&child, "Cycle descendant")
            .expect("descendant should be created");

        for operation in [
            (root_id.clone(), child.clone()),
            (child.clone(), child.clone()),
            (child.clone(), descendant),
        ] {
            let before = document.database.clone();
            assert!(matches!(
                document.move_group(&operation.0, &operation.1),
                Err(KdbxError::InvalidGroupMove)
            ));
            assert!(
                document.database == before,
                "invalid group move changed the database"
            );
        }

        let before = document.database.clone();
        assert!(matches!(
            document.permanently_delete_group(&root_id),
            Err(KdbxError::CannotDeleteRootGroup)
        ));
        assert!(document.database == before);
    }

    #[test]
    fn permanent_group_delete_tombstones_complete_subtree_and_roundtrips() {
        let mut document = kdbx41_document();
        let (root_id, _) = root_group_ids(&document);
        let parent = document
            .create_group(&root_id, "Delete parent")
            .expect("parent should be created");
        let child = document
            .create_group(&parent, "Delete child")
            .expect("child should be created");
        let parent_entry = document
            .create_entry(
                &parent,
                NewEntry {
                    title: "Parent entry",
                    username: "",
                    url: "",
                    password: None,
                },
            )
            .expect("parent entry should be created");
        let child_entry = document
            .create_entry(
                &child,
                NewEntry {
                    title: "Child entry",
                    username: "",
                    url: "",
                    password: None,
                },
            )
            .expect("child entry should be created");
        let upstream_parent = document
            .find_group_id(&parent)
            .expect("parent should exist");
        let upstream_child = document.find_group_id(&child).expect("child should exist");
        let upstream_parent_entry = document
            .find_entry_id(&parent_entry)
            .expect("parent entry should exist");
        let upstream_child_entry = document
            .find_entry_id(&child_entry)
            .expect("child entry should exist");
        {
            let mut raw_parent = document
                .database
                .group_mut(upstream_parent)
                .expect("parent should exist");
            let _custom_icon = raw_parent.set_icon_custom_new(vec![1, 2, 3, 4]);
        }
        {
            let mut raw_child_entry = document
                .database
                .entry_mut(upstream_child_entry)
                .expect("child entry should exist");
            raw_child_entry.add_attachment(
                "synthetic-attachment.txt",
                Value::protected(b"public-test-attachment".to_vec()),
            );
            let _custom_icon = raw_child_entry.set_icon_custom_new(vec![5, 6, 7, 8]);
        }
        document.database.meta.last_selected_group = Some(upstream_parent.uuid());
        document.database.meta.last_top_visible_group = Some(upstream_child.uuid());
        document.database.meta.recyclebin_uuid = Some(upstream_parent.uuid());
        document.database.meta.entry_templates_group = Some(upstream_child.uuid());
        let original_deleted = document.database.deleted_objects.len();
        let original_groups = document.database.num_groups();
        let original_entries = document.database.num_entries();
        let original_attachments = document.database.num_attachments();

        document
            .permanently_delete_group(&parent)
            .expect("recursive permanent deletion should succeed");

        assert_eq!(document.database.num_groups(), original_groups - 2);
        assert_eq!(document.database.num_entries(), original_entries - 2);
        assert_eq!(
            document.database.num_attachments(),
            original_attachments - 1
        );
        assert_eq!(
            document.database.deleted_objects.len(),
            original_deleted + 4
        );
        for uuid in [
            upstream_parent.uuid(),
            upstream_child.uuid(),
            upstream_parent_entry.uuid(),
            upstream_child_entry.uuid(),
        ] {
            assert!(
                document
                    .database
                    .deleted_objects
                    .get(&uuid)
                    .is_some_and(|timestamp| timestamp.is_some()),
                "recursive deletion omitted a tombstone or timestamp"
            );
        }
        assert!(document.database.meta.last_selected_group.is_none());
        assert!(document.database.meta.last_top_visible_group.is_none());
        assert!(document.database.meta.recyclebin_uuid.is_none());
        assert!(document.database.meta.entry_templates_group.is_none());
        assert!(document.database.group(upstream_parent).is_none());
        assert!(document.database.group(upstream_child).is_none());
        assert!(document.database.entry(upstream_parent_entry).is_none());
        assert!(document.database.entry(upstream_child_entry).is_none());

        let expected_database = document.database.clone();
        let reopened = reopen(&document);
        assert!(
            reopened.database == expected_database,
            "recursive group deletion round-trip changed parsed semantics"
        );

        let before_unknown = document.database.clone();
        assert!(matches!(
            document.permanently_delete_group(&unknown_group_id()),
            Err(KdbxError::GroupNotFound)
        ));
        assert!(document.database == before_unknown);
    }

    #[test]
    fn custom_field_metadata_and_explicit_reads_exclude_reserved_values() {
        let mut document = kdbx41_document();
        let (entry_id, upstream_entry_id) = first_entry_ids(&document);
        {
            let mut entry = document
                .database
                .entry_mut(upstream_entry_id)
                .expect("entry should exist");
            entry.set_protected("Protected custom", TEST_CUSTOM_PROTECTED);
            entry.set_unprotected("Unprotected custom", TEST_CUSTOM_UNPROTECTED);
            entry.set_protected("Empty custom", "");
            entry.set_protected(fields::OTP, "public-test-totp-seed");
            entry.set_protected("KPEX_PASSKEY_PRIVATE_KEY_PEM", "public-test-passkey");
        }

        let summaries = document
            .custom_fields(&entry_id)
            .expect("custom metadata lookup should succeed");
        assert_eq!(summaries.len(), 3);
        assert!(summaries.iter().any(|summary| {
            summary.name() == "Protected custom"
                && summary.protection() == FieldProtection::Protected
        }));
        assert!(summaries.iter().any(|summary| {
            summary.name() == "Unprotected custom"
                && summary.protection() == FieldProtection::Unprotected
        }));
        assert!(summaries.iter().all(|summary| {
            summary.name() != fields::TITLE
                && summary.name() != fields::OTP
                && !summary.name().starts_with("KPEX_PASSKEY")
        }));

        let protected = document
            .entry_custom_field(&entry_id, "Protected custom")
            .expect("protected custom read should succeed")
            .expect("protected custom field should exist");
        assert!(
            protected.expose_secret() == TEST_CUSTOM_PROTECTED,
            "protected synthetic custom value changed"
        );
        let unprotected = document
            .entry_custom_field(&entry_id, "Unprotected custom")
            .expect("unprotected custom read should succeed")
            .expect("unprotected custom field should exist");
        assert!(
            unprotected.expose_secret() == TEST_CUSTOM_UNPROTECTED,
            "unprotected synthetic custom value changed"
        );
        let empty = document
            .entry_custom_field(&entry_id, "Empty custom")
            .expect("empty custom read should succeed")
            .expect("empty custom field should remain present");
        assert!(empty.expose_secret().is_empty());
        assert!(
            document
                .entry_custom_field(&entry_id, "Missing custom")
                .expect("missing custom read should succeed")
                .is_none()
        );
        assert!(matches!(
            document.custom_fields(&unknown_entry_id()),
            Err(KdbxError::EntryNotFound)
        ));
        assert!(matches!(
            document.entry_custom_field(&unknown_entry_id(), "Unknown custom"),
            Err(KdbxError::EntryNotFound)
        ));
    }

    #[test]
    fn custom_field_mutations_preserve_protection_history_noops_and_roundtrip() {
        let mut document = kdbx41_document();
        let (entry_id, upstream_entry_id) = first_entry_ids(&document);
        let protected_before = SecretString::new(TEST_CUSTOM_PROTECTED.to_owned());
        let unprotected_before = SecretString::new(TEST_CUSTOM_UNPROTECTED.to_owned());
        let empty = SecretString::new(String::new());

        document
            .set_entry_custom_field(
                &entry_id,
                "Protected custom",
                &protected_before,
                FieldProtection::Protected,
            )
            .expect("protected custom field creation should succeed");
        let after_protected_create = document
            .database
            .entry(upstream_entry_id)
            .expect("entry should exist");
        assert!(
            after_protected_create
                .history
                .as_ref()
                .and_then(|history| history.get_entries().first())
                .is_some_and(|historical| !historical.fields.contains_key("Protected custom")),
            "custom-field creation history did not preserve prior absence"
        );
        document
            .set_entry_custom_field(
                &entry_id,
                "Unprotected custom",
                &unprotected_before,
                FieldProtection::Unprotected,
            )
            .expect("unprotected custom field creation should succeed");
        document
            .set_entry_custom_field(&entry_id, "", &empty, FieldProtection::Protected)
            .expect("empty custom field name and value should be preserved");
        let created = document
            .database
            .entry(upstream_entry_id)
            .expect("entry should exist");
        assert!(
            created
                .fields
                .get("Protected custom")
                .is_some_and(|value| value.is_protected())
        );
        assert!(
            created
                .fields
                .get("Unprotected custom")
                .is_some_and(|value| !value.is_protected())
        );
        assert!(created.fields.contains_key(""));

        document
            .database
            .entry_mut(upstream_entry_id)
            .expect("entry should exist")
            .times
            .last_modification = Some(Times::epoch());

        let protected_after = SecretString::new("public-test-custom-protected-after".to_owned());
        let prepared = document
            .database
            .entry(upstream_entry_id)
            .expect("entry should exist");
        let history_before = history_len(&prepared);
        let modification_before = prepared.times.last_modification;
        document
            .set_entry_custom_field(
                &entry_id,
                "Protected custom",
                &protected_after,
                FieldProtection::Unprotected,
            )
            .expect("protected custom update should succeed");
        let updated = document
            .database
            .entry(upstream_entry_id)
            .expect("entry should exist");
        assert_eq!(history_len(&updated), history_before + 1);
        assert!(updated.times.last_modification != modification_before);
        assert!(
            updated
                .fields
                .get("Protected custom")
                .is_some_and(|value| value.is_protected()),
            "existing protected custom field lost protection"
        );
        assert!(
            updated
                .history
                .as_ref()
                .and_then(|history| history.get_entries().first())
                .and_then(|historical| historical.fields.get("Protected custom"))
                .is_some_and(|value| {
                    value.is_protected() && value.get() == TEST_CUSTOM_PROTECTED
                }),
            "custom history lost the prior protected state"
        );

        let unprotected_after =
            SecretString::new("public-test-custom-unprotected-after".to_owned());
        document
            .set_entry_custom_field(
                &entry_id,
                "Unprotected custom",
                &unprotected_after,
                FieldProtection::Protected,
            )
            .expect("unprotected custom update should succeed");
        let updated_unprotected = document
            .database
            .entry(upstream_entry_id)
            .expect("entry should exist");
        assert!(
            updated_unprotected
                .fields
                .get("Unprotected custom")
                .is_some_and(|value| !value.is_protected()),
            "existing unprotected custom field changed protection"
        );
        assert!(
            updated_unprotected
                .history
                .as_ref()
                .and_then(|history| history.get_entries().first())
                .and_then(|historical| historical.fields.get("Unprotected custom"))
                .is_some_and(|value| {
                    !value.is_protected() && value.get() == TEST_CUSTOM_UNPROTECTED
                }),
            "custom history lost the prior unprotected state"
        );

        let before_same = document.database.clone();
        document
            .set_entry_custom_field(
                &entry_id,
                "Protected custom",
                &protected_after,
                FieldProtection::Unprotected,
            )
            .expect("same-value custom update should succeed");
        assert!(document.database == before_same);

        let delete_history_before = history_len(
            &document
                .database
                .entry(upstream_entry_id)
                .expect("entry should exist"),
        );
        document
            .delete_entry_custom_field(&entry_id, "Protected custom")
            .expect("custom field deletion should succeed");
        let deleted = document
            .database
            .entry(upstream_entry_id)
            .expect("entry should exist");
        assert!(!deleted.fields.contains_key("Protected custom"));
        assert_eq!(history_len(&deleted), delete_history_before + 1);
        assert!(
            deleted
                .history
                .as_ref()
                .and_then(|history| history.get_entries().first())
                .and_then(|historical| historical.fields.get("Protected custom"))
                .is_some_and(|value| value.is_protected()),
            "custom deletion history lost the previous protected field"
        );

        let before_missing_delete = document.database.clone();
        document
            .delete_entry_custom_field(&entry_id, "Missing custom")
            .expect("missing custom deletion should succeed");
        assert!(document.database == before_missing_delete);

        let survives = SecretString::new("public-test-protected-roundtrip".to_owned());
        document
            .set_entry_custom_field(
                &entry_id,
                "Protected survives",
                &survives,
                FieldProtection::Protected,
            )
            .expect("round-trip custom field should be created");
        let expected_database = document.database.clone();
        let reopened = reopen(&document);
        let reopened_secret = reopened
            .entry_custom_field(&entry_id, "Protected survives")
            .expect("reopened custom read should succeed")
            .expect("reopened protected custom field should exist");
        assert!(
            reopened_secret.expose_secret() == "public-test-protected-roundtrip",
            "reopened protected custom field changed"
        );
        assert!(
            reopened.database == expected_database,
            "custom mutation round-trip changed parsed semantics"
        );
    }

    #[test]
    fn reserved_custom_field_names_and_unknown_entries_are_rejected_without_mutation() {
        let mut document = kdbx41_document();
        let (entry_id, _) = first_entry_ids(&document);
        let value = SecretString::new("public-test-reserved-value".to_owned());

        for reserved in [
            fields::TITLE,
            fields::USERNAME,
            fields::PASSWORD,
            fields::URL,
            fields::NOTES,
            fields::OTP,
            "TOTP Seed",
            "TimeOtp-Secret-Base32",
            "KPEX_PASSKEY_PRIVATE_KEY_PEM",
        ] {
            let before = document.database.clone();
            assert!(matches!(
                document.entry_custom_field(&entry_id, reserved),
                Err(KdbxError::ReservedField)
            ));
            assert!(matches!(
                document.set_entry_custom_field(
                    &entry_id,
                    reserved,
                    &value,
                    FieldProtection::Protected
                ),
                Err(KdbxError::ReservedField)
            ));
            assert!(matches!(
                document.delete_entry_custom_field(&entry_id, reserved),
                Err(KdbxError::ReservedField)
            ));
            assert!(document.database == before);
        }

        let before = document.database.clone();
        assert!(matches!(
            document.set_entry_custom_field(
                &unknown_entry_id(),
                "Unknown custom",
                &value,
                FieldProtection::Protected
            ),
            Err(KdbxError::EntryNotFound)
        ));
        assert!(matches!(
            document.delete_entry_custom_field(&unknown_entry_id(), "Unknown custom"),
            Err(KdbxError::EntryNotFound)
        ));
        assert!(document.database == before);
    }

    #[test]
    fn kdbx41_title_edit_self_roundtrip_preserves_parsed_semantics() {
        const FILE: &str = "keepassxc-2.7.12-kdbx41.kdbx";
        const NEW_TITLE: &str = "nian-pass-self-roundtrip-title";

        let path = fixture_path(FILE);
        let original_bytes = fs::read(&path).expect("fixture should be readable");
        let mut document = KdbxDocument::open_reader(
            &mut Cursor::new(original_bytes.as_slice()),
            FIXTURE_PASSWORD,
        )
        .expect("trusted KDBX 4.1 fixture should open as a document");
        let before = SemanticSnapshot::capture(&document);
        let target_id = document
            .projection()
            .expect("trusted fixture should project")
            .root()
            .entries()
            .first()
            .expect("fixture should have a root entry")
            .id()
            .clone();

        let upstream_id = document
            .database
            .iter_all_entries()
            .find(|entry| entry.id().to_string() == target_id.as_str())
            .map(|entry| entry.id())
            .expect("projected entry should exist in the complete database");
        let original_entry = document
            .database
            .entry(upstream_id)
            .expect("target entry should exist");
        let original_title = original_entry
            .get_title()
            .expect("target entry should have a title")
            .to_owned();
        let original_history_len = original_entry
            .history
            .as_ref()
            .map_or(0, |history| history.get_entries().len());
        let original_last_modification = original_entry.times.last_modification;

        document
            .set_entry_title(&target_id, NEW_TITLE)
            .expect("title edit should succeed");

        let edited_entry = document
            .database
            .entry(upstream_id)
            .expect("edited entry should still exist");
        assert!(
            edited_entry.get_title() == Some(NEW_TITLE),
            "in-memory title edit did not apply"
        );
        assert_eq!(
            edited_entry
                .history
                .as_ref()
                .map_or(0, |history| history.get_entries().len()),
            original_history_len + 1,
            "tracked edit did not append exactly one history item"
        );
        let latest_history = edited_entry
            .history
            .as_ref()
            .and_then(|history| history.get_entries().first())
            .expect("tracked edit should retain the prior entry state");
        assert!(
            latest_history.get_title() == Some(original_title.as_str()),
            "history did not retain the prior title"
        );
        assert!(
            edited_entry.times.last_modification != original_last_modification,
            "tracked edit did not update LastModificationTime"
        );

        let expected_database = document.database.clone();
        let mut saved = Vec::new();
        document
            .save_to_writer(&mut saved, FIXTURE_PASSWORD)
            .expect("KDBX 4.1 document should serialize");

        let reopened = KdbxDocument::open_reader(&mut Cursor::new(&saved), FIXTURE_PASSWORD)
            .expect("serialized document should reopen");
        let after = SemanticSnapshot::capture(&reopened);

        before.assert_preserved_except_title(&after, &target_id, NEW_TITLE);
        assert!(
            reopened.database == expected_database,
            "serialized output changed the complete parsed database representation"
        );
        assert!(
            document.database.config.kdf_config == reopened.database.config.kdf_config,
            "KDF configuration changed"
        );
        assert!(
            document.database.config.outer_cipher_config
                == reopened.database.config.outer_cipher_config,
            "outer cipher changed"
        );
        assert!(
            document.database.config.compression_config
                == reopened.database.config.compression_config,
            "compression configuration changed"
        );
        assert!(
            document.database.config.inner_cipher_config
                == reopened.database.config.inner_cipher_config,
            "inner cipher changed"
        );
        assert!(
            matches!(
                KdbxDocument::open_reader(&mut Cursor::new(&saved), WRONG_FIXTURE_PASSWORD),
                Err(KdbxError::InvalidCredentials)
            ),
            "wrong credentials unexpectedly reopened serialized output"
        );
        assert!(
            fs::read(path).expect("fixture should remain readable") == original_bytes,
            "round-trip test modified its source fixture"
        );
    }

    #[test]
    fn protected_title_remains_protected_after_edit_and_roundtrip() {
        const TITLE_BEFORE: &str = "public-protected-title-before";
        const TITLE_AFTER: &str = "public-protected-title-after";

        let mut document = KdbxDocument::open(
            fixture_path("keepassxc-2.7.12-kdbx41.kdbx"),
            FIXTURE_PASSWORD,
        )
        .expect("trusted fixture should open");
        let target_id = document
            .projection()
            .expect("trusted fixture should project")
            .root()
            .entries()
            .first()
            .expect("fixture should have a root entry")
            .id()
            .clone();
        let upstream_id = document
            .database
            .iter_all_entries()
            .find(|entry| entry.id().to_string() == target_id.as_str())
            .map(|entry| entry.id())
            .expect("projected entry should exist in the complete database");

        document
            .database
            .entry_mut(upstream_id)
            .expect("target entry should exist")
            .set_protected(fields::TITLE, TITLE_BEFORE);

        let prepared_entry = document
            .database
            .entry(upstream_id)
            .expect("target entry should exist");
        assert!(
            prepared_entry.get_title() == Some(TITLE_BEFORE),
            "protected test title was not prepared"
        );
        assert!(
            prepared_entry
                .fields
                .get(fields::TITLE)
                .is_some_and(|value| value.is_protected()),
            "prepared title should be protected"
        );
        let original_history_len = prepared_entry
            .history
            .as_ref()
            .map_or(0, |history| history.get_entries().len());
        let original_last_modification = prepared_entry.times.last_modification;

        document
            .set_entry_title(&target_id, TITLE_AFTER)
            .expect("protected title edit should succeed");

        let edited_entry = document
            .database
            .entry(upstream_id)
            .expect("edited entry should still exist");
        assert!(
            edited_entry.get_title() == Some(TITLE_AFTER),
            "protected title edit did not apply"
        );
        assert!(
            edited_entry
                .fields
                .get(fields::TITLE)
                .is_some_and(|value| value.is_protected()),
            "edited title lost its protected state"
        );
        assert_eq!(
            edited_entry
                .history
                .as_ref()
                .map_or(0, |history| history.get_entries().len()),
            original_history_len + 1,
            "protected title edit did not append exactly one history item"
        );
        let latest_history = edited_entry
            .history
            .as_ref()
            .and_then(|history| history.get_entries().first())
            .expect("protected title edit should retain the prior state");
        assert!(
            latest_history.get_title() == Some(TITLE_BEFORE),
            "history did not retain the prior protected title"
        );
        assert!(
            latest_history
                .fields
                .get(fields::TITLE)
                .is_some_and(|value| value.is_protected()),
            "historical title lost its protected state"
        );
        assert!(
            edited_entry.times.last_modification != original_last_modification,
            "protected title edit did not update LastModificationTime"
        );

        let expected_database = document.database.clone();
        let mut saved = Vec::new();
        document
            .save_to_writer(&mut saved, FIXTURE_PASSWORD)
            .expect("KDBX 4.1 document should serialize");
        let reopened = KdbxDocument::open_reader(&mut Cursor::new(saved), FIXTURE_PASSWORD)
            .expect("serialized document should reopen");
        let reopened_entry = reopened
            .database
            .entry(upstream_id)
            .expect("reopened entry should exist");

        assert!(
            reopened_entry.get_title() == Some(TITLE_AFTER),
            "reopened title did not retain its edited value"
        );
        assert!(
            reopened_entry
                .fields
                .get(fields::TITLE)
                .is_some_and(|value| value.is_protected()),
            "reopened title lost its protected state"
        );
        assert!(
            reopened_entry
                .history
                .as_ref()
                .and_then(|history| history.get_entries().first())
                .and_then(|historical| historical.fields.get(fields::TITLE))
                .is_some_and(|value| value.is_protected()),
            "reopened historical title lost its protected state"
        );
        assert!(
            reopened.database == expected_database,
            "protected-title round-trip changed the parsed database representation"
        );
    }

    #[test]
    fn unprotected_title_remains_unprotected_after_edit() {
        const TITLE_AFTER: &str = "public-unprotected-title-after";

        let mut document = KdbxDocument::open(
            fixture_path("keepassxc-2.7.12-kdbx41.kdbx"),
            FIXTURE_PASSWORD,
        )
        .expect("trusted fixture should open");
        let target_id = document
            .projection()
            .expect("trusted fixture should project")
            .root()
            .entries()
            .first()
            .expect("fixture should have a root entry")
            .id()
            .clone();
        let upstream_id = document
            .database
            .iter_all_entries()
            .find(|entry| entry.id().to_string() == target_id.as_str())
            .map(|entry| entry.id())
            .expect("projected entry should exist in the complete database");
        let original_entry = document
            .database
            .entry(upstream_id)
            .expect("target entry should exist");
        assert!(
            original_entry
                .fields
                .get(fields::TITLE)
                .is_some_and(|value| !value.is_protected()),
            "fixture title should be unprotected"
        );
        let original_history_len = original_entry
            .history
            .as_ref()
            .map_or(0, |history| history.get_entries().len());
        let original_last_modification = original_entry.times.last_modification;

        document
            .set_entry_title(&target_id, TITLE_AFTER)
            .expect("unprotected title edit should succeed");

        let edited_entry = document
            .database
            .entry(upstream_id)
            .expect("edited entry should still exist");
        assert!(
            edited_entry.get_title() == Some(TITLE_AFTER),
            "unprotected title edit did not apply"
        );
        assert!(
            edited_entry
                .fields
                .get(fields::TITLE)
                .is_some_and(|value| !value.is_protected()),
            "edited title unexpectedly became protected"
        );
        assert_eq!(
            edited_entry
                .history
                .as_ref()
                .map_or(0, |history| history.get_entries().len()),
            original_history_len + 1,
            "unprotected title edit did not append exactly one history item"
        );
        assert!(
            edited_entry.times.last_modification != original_last_modification,
            "unprotected title edit did not update LastModificationTime"
        );
    }

    #[test]
    fn same_title_is_a_complete_no_op() {
        let mut document = KdbxDocument::open(
            fixture_path("keepassxc-2.7.12-kdbx41.kdbx"),
            FIXTURE_PASSWORD,
        )
        .expect("trusted fixture should open");
        let target_id = document
            .projection()
            .expect("trusted fixture should project")
            .root()
            .entries()
            .first()
            .expect("fixture should have a root entry")
            .id()
            .clone();
        let upstream_id = document
            .database
            .iter_all_entries()
            .find(|entry| entry.id().to_string() == target_id.as_str())
            .map(|entry| entry.id())
            .expect("projected entry should exist in the complete database");
        let original_entry = document
            .database
            .entry(upstream_id)
            .expect("target entry should exist");
        let existing_title = original_entry
            .get_title()
            .expect("target entry should have a title")
            .to_owned();
        let original_history_len = original_entry
            .history
            .as_ref()
            .map_or(0, |history| history.get_entries().len());
        let original_last_modification = original_entry.times.last_modification;
        let before_database = document.database.clone();

        document
            .set_entry_title(&target_id, &existing_title)
            .expect("same-value title update should succeed");

        let unchanged_entry = document
            .database
            .entry(upstream_id)
            .expect("target entry should still exist");
        assert_eq!(
            unchanged_entry
                .history
                .as_ref()
                .map_or(0, |history| history.get_entries().len()),
            original_history_len,
            "same-value title update changed history"
        );
        assert!(
            unchanged_entry.times.last_modification == original_last_modification,
            "same-value title update changed LastModificationTime"
        );
        assert!(
            document.database == before_database,
            "same-value title update changed the database"
        );
    }

    #[test]
    fn missing_title_set_to_empty_is_a_complete_no_op() {
        let mut document = KdbxDocument::open(
            fixture_path("keepassxc-2.7.12-kdbx41.kdbx"),
            FIXTURE_PASSWORD,
        )
        .expect("trusted fixture should open");
        let target_id = document
            .projection()
            .expect("trusted fixture should project")
            .root()
            .entries()
            .first()
            .expect("fixture should have a root entry")
            .id()
            .clone();
        let upstream_id = document
            .database
            .iter_all_entries()
            .find(|entry| entry.id().to_string() == target_id.as_str())
            .map(|entry| entry.id())
            .expect("projected entry should exist in the complete database");
        document
            .database
            .entry_mut(upstream_id)
            .expect("target entry should exist")
            .fields
            .remove(fields::TITLE);
        assert!(
            !document
                .database
                .entry(upstream_id)
                .expect("target entry should exist")
                .fields
                .contains_key(fields::TITLE),
            "title field should be absent for the test"
        );
        let before_database = document.database.clone();

        document
            .set_entry_title(&target_id, "")
            .expect("missing-to-empty title update should succeed");

        assert!(
            document.database == before_database,
            "missing-to-empty title update changed the database"
        );
    }

    #[test]
    fn username_mutation_preserves_protection_history_and_absence_semantics() {
        assert_metadata_mutation_matrix(
            fields::USERNAME,
            "public-test-username-before",
            "public-test-username-after",
            KdbxDocument::set_entry_username,
        );
    }

    #[test]
    fn title_mutation_uses_the_common_protection_and_missing_field_policy() {
        assert_metadata_mutation_matrix(
            fields::TITLE,
            "public-test-title-before",
            "public-test-title-after",
            KdbxDocument::set_entry_title,
        );
    }

    #[test]
    fn url_mutation_preserves_protection_history_unicode_and_absence_semantics() {
        assert_metadata_mutation_matrix(
            fields::URL,
            "https://example.test/before",
            "https://example.test/đường-dẫn?q=日本語",
            KdbxDocument::set_entry_url,
        );
    }

    #[test]
    fn missing_title_uses_database_memory_protection_policy() {
        assert_missing_metadata_uses_database_policy(
            fields::TITLE,
            "public-policy-title",
            KdbxDocument::set_entry_title,
            |policy, protected| policy.protect_title = protected,
            false,
        );
    }

    #[test]
    fn missing_username_uses_database_memory_protection_policy_and_roundtrips() {
        assert_missing_metadata_uses_database_policy(
            fields::USERNAME,
            "public-policy-username",
            KdbxDocument::set_entry_username,
            |policy, protected| policy.protect_username = protected,
            true,
        );
    }

    #[test]
    fn missing_url_uses_database_memory_protection_policy() {
        assert_missing_metadata_uses_database_policy(
            fields::URL,
            "https://policy.example.test",
            KdbxDocument::set_entry_url,
            |policy, protected| policy.protect_url = protected,
            false,
        );
    }

    #[test]
    fn absent_memory_protection_uses_standard_metadata_fallbacks() {
        assert_missing_metadata_without_policy_is_unprotected(
            fields::TITLE,
            "public-fallback-title",
            KdbxDocument::set_entry_title,
        );
        assert_missing_metadata_without_policy_is_unprotected(
            fields::USERNAME,
            "public-fallback-username",
            KdbxDocument::set_entry_username,
        );
        assert_missing_metadata_without_policy_is_unprotected(
            fields::URL,
            "https://fallback.example.test",
            KdbxDocument::set_entry_url,
        );
    }

    #[test]
    fn password_mutation_preserves_protected_state_history_and_roundtrip() {
        let mut document = kdbx41_document();
        let (projected_id, upstream_id) = first_entry_ids(&document);
        document
            .database
            .entry_mut(upstream_id)
            .expect("target entry should exist")
            .set_protected(fields::PASSWORD, TEST_SECRET_BEFORE);
        let original = document
            .database
            .entry(upstream_id)
            .expect("prepared entry should exist");
        let original_history_len = history_len(&original);
        let original_last_modification = original.times.last_modification;
        let replacement = SecretString::new(TEST_SECRET_AFTER.to_owned());

        document
            .set_entry_password(&projected_id, &replacement)
            .expect("protected password edit should succeed");
        let edited = document
            .database
            .entry(upstream_id)
            .expect("edited entry should exist");
        let edited_password = edited
            .fields
            .get(fields::PASSWORD)
            .expect("edited password should remain present");
        assert!(
            edited_password.get() == TEST_SECRET_AFTER,
            "synthetic password edit did not apply"
        );
        assert!(
            edited_password.is_protected(),
            "protected password lost its protection"
        );
        assert_eq!(
            history_len(&edited),
            original_history_len + 1,
            "password edit did not append exactly one history item"
        );
        let historical_password = edited
            .history
            .as_ref()
            .and_then(|history| history.get_entries().first())
            .and_then(|entry| entry.fields.get(fields::PASSWORD))
            .expect("password history should retain the prior value");
        assert!(
            historical_password.get() == TEST_SECRET_BEFORE,
            "password history did not preserve the expected synthetic value"
        );
        assert!(
            historical_password.is_protected(),
            "password history lost the prior protection mode"
        );
        assert!(
            edited.times.last_modification != original_last_modification,
            "password edit did not update LastModificationTime"
        );

        let expected_database = document.database.clone();
        let mut saved = Vec::new();
        document
            .save_to_writer(&mut saved, FIXTURE_PASSWORD)
            .expect("password edit should serialize");
        let reopened = KdbxDocument::open_reader(&mut Cursor::new(saved), FIXTURE_PASSWORD)
            .expect("password edit should reopen");
        let reopened_password = reopened
            .entry_password(&projected_id)
            .expect("reopened password lookup should succeed")
            .expect("reopened password should exist");
        assert!(
            reopened_password.expose_secret() == TEST_SECRET_AFTER,
            "reopened synthetic password changed"
        );
        assert!(
            reopened.database.entry(upstream_id).is_some_and(|entry| {
                entry
                    .fields
                    .get(fields::PASSWORD)
                    .is_some_and(keepass::db::Value::is_protected)
            }),
            "reopened password lost protection"
        );
        assert!(
            reopened.database == expected_database,
            "password round-trip changed parsed database semantics"
        );
    }

    #[test]
    fn password_mutation_preserves_unprotected_state() {
        let mut document = kdbx41_document();
        let (projected_id, upstream_id) = first_entry_ids(&document);
        document
            .database
            .entry_mut(upstream_id)
            .expect("target entry should exist")
            .set_unprotected(fields::PASSWORD, TEST_SECRET_BEFORE);
        let original = document
            .database
            .entry(upstream_id)
            .expect("prepared entry should exist");
        let original_history_len = history_len(&original);
        let original_last_modification = original.times.last_modification;
        let replacement = SecretString::new(TEST_SECRET_AFTER.to_owned());

        document
            .set_entry_password(&projected_id, &replacement)
            .expect("unprotected password edit should succeed");
        let edited = document
            .database
            .entry(upstream_id)
            .expect("edited entry should exist");
        let edited_password = edited
            .fields
            .get(fields::PASSWORD)
            .expect("edited password should remain present");
        assert!(
            edited_password.get() == TEST_SECRET_AFTER,
            "synthetic password edit did not apply"
        );
        assert!(
            !edited_password.is_protected(),
            "unprotected password unexpectedly became protected"
        );
        assert_eq!(
            history_len(&edited),
            original_history_len + 1,
            "unprotected password edit did not append history"
        );
        let historical_password = edited
            .history
            .as_ref()
            .and_then(|history| history.get_entries().first())
            .and_then(|entry| entry.fields.get(fields::PASSWORD))
            .expect("password history should retain the prior value");
        assert!(
            historical_password.get() == TEST_SECRET_BEFORE && !historical_password.is_protected(),
            "password history did not preserve unprotected prior semantics"
        );
        assert!(
            edited.times.last_modification != original_last_modification,
            "password edit did not update LastModificationTime"
        );
    }

    #[test]
    fn missing_password_defaults_to_protected_and_empty_is_a_no_op() {
        let mut document = kdbx41_document();
        let mut policy = document
            .database
            .meta
            .memory_protection
            .clone()
            .unwrap_or_default();
        policy.protect_password = false;
        document.database.meta.memory_protection = Some(policy);
        let (projected_id, upstream_id) = first_entry_ids(&document);
        document
            .database
            .entry_mut(upstream_id)
            .expect("target entry should exist")
            .fields
            .remove(fields::PASSWORD);
        let original = document
            .database
            .entry(upstream_id)
            .expect("prepared entry should exist");
        let original_history_len = history_len(&original);
        let original_last_modification = original.times.last_modification;
        let replacement = SecretString::new(TEST_SECRET_AFTER.to_owned());

        document
            .set_entry_password(&projected_id, &replacement)
            .expect("missing password should be created");
        let edited = document
            .database
            .entry(upstream_id)
            .expect("edited entry should exist");
        let password = edited
            .fields
            .get(fields::PASSWORD)
            .expect("new password should exist");
        assert!(
            password.get() == TEST_SECRET_AFTER,
            "new synthetic password changed value"
        );
        assert!(password.is_protected(), "new password was not protected");
        assert_eq!(
            history_len(&edited),
            original_history_len + 1,
            "new password did not append history"
        );
        assert!(
            edited
                .history
                .as_ref()
                .and_then(|history| history.get_entries().first())
                .is_some_and(|entry| !entry.fields.contains_key(fields::PASSWORD)),
            "password history did not preserve field absence"
        );
        assert!(
            edited.times.last_modification != original_last_modification,
            "new password did not update LastModificationTime"
        );

        let mut missing_empty = kdbx41_document();
        let (projected_id, upstream_id) = first_entry_ids(&missing_empty);
        missing_empty
            .database
            .entry_mut(upstream_id)
            .expect("target entry should exist")
            .fields
            .remove(fields::PASSWORD);
        let before_database = missing_empty.database.clone();
        let empty = SecretString::new(String::new());
        missing_empty
            .set_entry_password(&projected_id, &empty)
            .expect("missing-to-empty password edit should succeed");
        assert!(
            missing_empty.database == before_database,
            "missing-to-empty password edit changed the database"
        );
    }

    #[test]
    fn same_password_is_a_complete_no_op() {
        let mut document = kdbx41_document();
        let (projected_id, upstream_id) = first_entry_ids(&document);
        document
            .database
            .entry_mut(upstream_id)
            .expect("target entry should exist")
            .set_protected(fields::PASSWORD, TEST_SECRET_BEFORE);
        let before_database = document.database.clone();
        let same = SecretString::new(TEST_SECRET_BEFORE.to_owned());

        document
            .set_entry_password(&projected_id, &same)
            .expect("same-password edit should succeed");
        assert!(
            document.database == before_database,
            "same-password edit changed the database"
        );
    }

    #[test]
    fn rejects_unknown_entry_identifier() {
        let mut document = KdbxDocument::open(
            fixture_path("keepassxc-2.7.12-kdbx41.kdbx"),
            FIXTURE_PASSWORD,
        )
        .expect("trusted fixture should open");

        let result = document.set_entry_title(
            &EntryId::new("00000000-0000-0000-0000-000000000000"),
            "unused test title",
        );

        assert!(matches!(result, Err(KdbxError::EntryNotFound)));

        let unknown = EntryId::new("00000000-0000-0000-0000-000000000000");
        assert!(matches!(
            document.set_entry_username(&unknown, "unused test username"),
            Err(KdbxError::EntryNotFound)
        ));
        assert!(matches!(
            document.set_entry_url(&unknown, "https://unused.example.test"),
            Err(KdbxError::EntryNotFound)
        ));
        let password = SecretString::new("unused-public-test-password".to_owned());
        assert!(matches!(
            document.set_entry_password(&unknown, &password),
            Err(KdbxError::EntryNotFound)
        ));
        assert!(matches!(
            document.entry_notes(&unknown),
            Err(KdbxError::EntryNotFound)
        ));
    }

    #[test]
    fn permits_dirty_in_memory_edits_but_rejects_writing_unproven_kdbx_versions() {
        for file in [
            "keepass-upstream-kdbx31-aeskdf-aes.kdbx",
            "keepassxc-upstream-kdbx40-argon2d-aes.kdbx",
            "keepassxc-upstream-kdbx40-argon2id-chacha20.kdbx",
        ] {
            let mut document = KdbxDocument::open(fixture_path(file), FIXTURE_PASSWORD)
                .expect("trusted read fixture should open");
            let target_id = document
                .projection()
                .expect("trusted fixture should project")
                .root()
                .entries()
                .first()
                .expect("fixture should have a root entry")
                .id()
                .clone();
            let mutation_result = document.set_entry_title(&target_id, "unpersisted test title");
            let username_result =
                document.set_entry_username(&target_id, "unpersisted test username");
            let url_result = document.set_entry_url(&target_id, "https://unpersisted.example.test");
            let password = SecretString::new("unpersisted-public-test-password".to_owned());
            let password_result = document.set_entry_password(&target_id, &password);
            let save_result = document.save_to_writer(&mut Vec::new(), FIXTURE_PASSWORD);

            assert!(mutation_result.is_ok(), "in-memory title edit failed");
            assert!(username_result.is_ok(), "in-memory username edit failed");
            assert!(url_result.is_ok(), "in-memory URL edit failed");
            assert!(password_result.is_ok(), "in-memory password edit failed");
            assert_eq!(document.revision(), 4);
            assert!(
                matches!(save_result, Err(KdbxError::UnsupportedWriteFormat)),
                "unproven write format was not rejected"
            );
        }
    }

    #[test]
    fn structural_edits_can_be_dirty_while_unproven_write_remains_rejected() {
        let mut document = KdbxDocument::open(
            fixture_path("keepassxc-upstream-kdbx40-argon2d-aes.kdbx"),
            FIXTURE_PASSWORD,
        )
        .expect("trusted KDBX 4.0 fixture should open");
        let (entry_id, _) = first_entry_ids(&document);
        let (root_id, _) = root_group_ids(&document);
        let secret = SecretString::new("unpersisted-public-test-value".to_owned());

        document
            .create_entry(
                &root_id,
                NewEntry {
                    title: "unpersisted",
                    username: "",
                    url: "",
                    password: None,
                },
            )
            .expect("in-memory entry creation should succeed");
        document
            .create_group(&root_id, "unpersisted")
            .expect("in-memory group creation should succeed");
        document
            .set_entry_custom_field(
                &entry_id,
                "unpersisted",
                &secret,
                FieldProtection::Protected,
            )
            .expect("in-memory custom-field edit should succeed");

        assert_eq!(document.revision(), 3);
        assert!(matches!(
            document.save_to_writer(&mut Vec::new(), FIXTURE_PASSWORD),
            Err(KdbxError::UnsupportedWriteFormat)
        ));
    }

    #[test]
    fn mutation_revision_counts_one_logical_change_and_ignores_noops_and_failures() {
        let mut document = kdbx41_document();
        assert_eq!(document.revision(), 0);
        let (entry_id, _) = first_entry_ids(&document);
        let (root_id, _) = root_group_ids(&document);
        let (child_id, _) = first_child_group_ids(&document);

        document
            .set_entry_title(&entry_id, "revision title")
            .expect("real title change should succeed");
        assert_eq!(document.revision(), 1);
        document
            .set_entry_title(&entry_id, "revision title")
            .expect("same title should be a no-op");
        assert_eq!(document.revision(), 1);

        let secret = SecretString::new("revision custom value".to_owned());
        document
            .set_entry_custom_field(
                &entry_id,
                "revision-field",
                &secret,
                FieldProtection::Protected,
            )
            .expect("custom field creation should succeed");
        assert_eq!(document.revision(), 2);
        document
            .set_entry_custom_field(
                &entry_id,
                "revision-field",
                &secret,
                FieldProtection::Unprotected,
            )
            .expect("same custom value should be a no-op");
        assert_eq!(document.revision(), 2);
        document
            .delete_entry_custom_field(&entry_id, "revision-field")
            .expect("existing custom field deletion should succeed");
        assert_eq!(document.revision(), 3);
        document
            .delete_entry_custom_field(&entry_id, "revision-field")
            .expect("missing custom field deletion should be a no-op");
        assert_eq!(document.revision(), 3);

        let created_entry = document
            .create_entry(
                &root_id,
                NewEntry {
                    title: "revision entry",
                    username: "",
                    url: "",
                    password: None,
                },
            )
            .expect("entry creation should succeed");
        assert_eq!(document.revision(), 4);
        document
            .set_entry_username(&created_entry, "")
            .expect("missing username plus empty should be a no-op");
        assert_eq!(document.revision(), 4);
        document
            .move_entry(&created_entry, &root_id)
            .expect("same-parent entry move should be a no-op");
        assert_eq!(document.revision(), 4);
        document
            .move_entry(&created_entry, &child_id)
            .expect("real entry move should succeed");
        assert_eq!(document.revision(), 5);
        document
            .permanently_delete_entry(&created_entry)
            .expect("entry deletion should succeed");
        assert_eq!(document.revision(), 6);

        let created_group = document
            .create_group(&root_id, "revision group")
            .expect("group creation should succeed");
        assert_eq!(document.revision(), 7);
        document
            .rename_group(&created_group, "revision group renamed")
            .expect("real group rename should succeed");
        assert_eq!(document.revision(), 8);
        document
            .rename_group(&created_group, "revision group renamed")
            .expect("same-name group rename should be a no-op");
        assert_eq!(document.revision(), 8);
        document
            .move_group(&created_group, &root_id)
            .expect("same-parent group move should be a no-op");
        assert_eq!(document.revision(), 8);
        document
            .move_group(&created_group, &child_id)
            .expect("real group move should succeed");
        assert_eq!(document.revision(), 9);
        document
            .permanently_delete_group(&created_group)
            .expect("recursive group deletion should succeed");
        assert_eq!(document.revision(), 10);

        assert!(matches!(
            document.set_entry_title(&unknown_entry_id(), "unused"),
            Err(KdbxError::EntryNotFound)
        ));
        assert_eq!(document.revision(), 10);
        let reserved = SecretString::new("unused".to_owned());
        assert!(matches!(
            document.set_entry_custom_field(
                &entry_id,
                fields::TITLE,
                &reserved,
                FieldProtection::Protected,
            ),
            Err(KdbxError::ReservedField)
        ));
        assert_eq!(document.revision(), 10);
        assert!(matches!(
            document.move_group(&root_id, &child_id),
            Err(KdbxError::InvalidGroupMove)
        ));
        assert_eq!(document.revision(), 10);

        document.revision = u64::MAX;
        document.revision_permanently_dirty = false;
        assert!(!document.has_changes_since(u64::MAX));
        document
            .set_entry_title(&entry_id, "revision title after saturation")
            .expect("mutation at saturated revision should succeed");
        assert_eq!(document.revision(), u64::MAX);
        assert!(document.has_changes_since(u64::MAX));
    }

    #[test]
    fn structural_error_messages_do_not_disclose_identifiers_or_field_names() {
        for (error, expected) in [
            (KdbxError::GroupNotFound, "group was not found"),
            (
                KdbxError::CannotDeleteRootGroup,
                "the root group cannot be permanently deleted",
            ),
            (KdbxError::InvalidGroupMove, "the group move is invalid"),
            (KdbxError::ReservedField, "the field name is reserved"),
        ] {
            assert!(error.to_string() == expected);
        }
    }

    #[test]
    fn writer_io_failure_returns_write_io() {
        let document = KdbxDocument::open(
            fixture_path("keepassxc-2.7.12-kdbx41.kdbx"),
            FIXTURE_PASSWORD,
        )
        .expect("trusted fixture should open");

        let result = document.save_to_writer(&mut AlwaysFailWriter, FIXTURE_PASSWORD);

        let error = result.expect_err("failing writer should reject serialized output");
        assert!(matches!(&error, KdbxError::WriteIo(_)));
        assert_eq!(error.to_string(), "could not write the KDBX output");
    }

    #[test]
    fn kdbx41_output_uses_upstream_keepassxc_regression_encodings() {
        let document = KdbxDocument::open(
            fixture_path("keepassxc-2.7.12-kdbx41.kdbx"),
            FIXTURE_PASSWORD,
        )
        .expect("trusted fixture should open");
        let mut saved = Vec::new();
        document
            .save_to_writer(&mut saved, FIXTURE_PASSWORD)
            .expect("KDBX 4.1 document should serialize");

        let xml = Database::get_xml(
            &mut Cursor::new(saved),
            DatabaseKey::new().with_password(FIXTURE_PASSWORD),
        )
        .expect("serialized XML should decrypt");
        let xml = String::from_utf8(xml).expect("KDBX XML should be UTF-8");

        assert!(
            xml.contains("<EnableSearching>null</EnableSearching>"),
            "EnableSearching did not use the KeePassXC-compatible null encoding"
        );
        assert!(
            xml.contains("<EnableAutoType>null</EnableAutoType>"),
            "EnableAutoType did not use the KeePassXC-compatible null encoding"
        );
        assert!(
            xml.contains("<DataTransferObfuscation>0</DataTransferObfuscation>"),
            "DataTransferObfuscation did not use an integer encoding"
        );
        assert!(
            !xml.contains("<DataTransferObfuscation>False</DataTransferObfuscation>")
                && !xml.contains("<DataTransferObfuscation>True</DataTransferObfuscation>"),
            "DataTransferObfuscation used a KeePassXC-incompatible boolean encoding"
        );
    }
}
