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
    db::{DatabaseOpenError, DatabaseSaveError, fields},
};
use thiserror::Error;
use vault_core::{Entry, EntryId, Group, GroupId, Vault};

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

    /// Borrows the credential-free vault projection.
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
}

impl KdbxDocument {
    /// Opens a KDBX document from a file using a master password.
    ///
    /// M1 supports password credentials only. The document does not retain the
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
        Ok(Self { version, database })
    }

    /// Returns the exact KDBX major and minor version read from the source.
    #[must_use]
    pub const fn version(&self) -> KdbxVersion {
        self.version
    }

    /// Builds a credential-free presentation projection of the current state.
    ///
    /// This is a one-way view for callers and is not a serialization model.
    pub fn projection(&self) -> Result<Vault, KdbxError> {
        convert_database(&self.database)
    }

    /// Renames an entry by its stable identifier while retaining the complete
    /// parsed database state.
    ///
    /// A real change preserves the title field's existing protection mode, and
    /// `keepass-rs` change tracking records the previous entry in history and
    /// updates its last-modification timestamp. Setting the visible title to
    /// its current value is a no-op. No identifier or title is included in
    /// errors.
    pub fn set_entry_title(&mut self, id: &EntryId, title: &str) -> Result<(), KdbxError> {
        self.ensure_writable_format()?;

        let (upstream_id, title_is_protected, title_is_unchanged) = self
            .database
            .iter_all_entries()
            .find(|entry| entry.id().to_string() == id.as_str())
            .map(|entry| {
                let existing_title = entry.fields.get(fields::TITLE);
                (
                    entry.id(),
                    existing_title.is_some_and(|value| value.is_protected()),
                    entry.get_title().unwrap_or_default() == title,
                )
            })
            .ok_or(KdbxError::EntryNotFound)?;

        if title_is_unchanged {
            return Ok(());
        }

        let mut entry = self
            .database
            .entry_mut(upstream_id)
            .ok_or(KdbxError::EntryNotFound)?;
        let mut tracked = entry.track_changes();
        if title_is_protected {
            tracked.set_protected(fields::TITLE, title);
        } else {
            tracked.set_unprotected(fields::TITLE, title);
        }
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

    fn ensure_writable_format(&self) -> Result<(), KdbxError> {
        if self.version == (KdbxVersion::Kdbx4 { minor: 1 }) {
            Ok(())
        } else {
            Err(KdbxError::UnsupportedWriteFormat)
        }
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

    /// The caller-owned output writer rejected a write operation.
    #[error("could not write the KDBX output")]
    WriteIo(#[source] std::io::Error),

    /// The complete KDBX document could not be serialized.
    #[error("the KDBX database could not be serialized")]
    Serialization,
}

/// Opens a KDBX database with a master password and returns a credential-free
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

fn convert_group(group: keepass::db::GroupRef<'_>) -> Group {
    let groups = group.groups().map(convert_group).collect();
    let entries = group
        .entries()
        .map(|entry| {
            Entry::new(
                EntryId::new(entry.id().to_string()),
                entry.get_title().unwrap_or_default(),
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
        fs,
        io::{Cursor, Write},
        path::{Path, PathBuf},
    };

    use keepass::{Database, DatabaseKey, db::fields};
    use vault_core::{EntryId, Group};

    use super::{KdbxDocument, KdbxError, KdbxVersion, open, open_reader};

    // Synthetic public test credential from the upstream fixture suite.
    const FIXTURE_PASSWORD: &str = "demopass";
    const WRONG_FIXTURE_PASSWORD: &str = "wrong-public-test-password";

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
                    title: entry.title().to_owned(),
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
                .map(vault_core::Entry::title)
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
    }

    #[test]
    fn rejects_writing_unproven_kdbx_versions() {
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
            let save_result = document.save_to_writer(&mut Vec::new(), FIXTURE_PASSWORD);

            assert!(
                matches!(mutation_result, Err(KdbxError::UnsupportedWriteFormat)),
                "unproven format accepted a mutation"
            );
            assert!(
                matches!(save_result, Err(KdbxError::UnsupportedWriteFormat)),
                "unproven write format was not rejected"
            );
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
