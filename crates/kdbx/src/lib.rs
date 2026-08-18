//! KDBX adapter boundary for Nian Pass.
//!
//! Types from `keepass` are intentionally confined to this crate's private
//! implementation. Callers receive only `vault_core` domain values.

use std::{
    fmt,
    fs::File,
    io::{Read, Seek, SeekFrom},
    path::Path,
};

use keepass::{Database, DatabaseKey, config::DatabaseVersion, db::DatabaseOpenError};
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

/// Errors returned while opening and projecting a KDBX database.
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
}

/// Opens a KDBX database with a master password and returns a credential-free
/// domain projection containing privacy-sensitive vault metadata.
///
/// The password is never logged or included in an error. The caller retains
/// ownership of the password buffer and is responsible for clearing it.
pub fn open(path: impl AsRef<Path>, master_password: &str) -> Result<OpenedVault, KdbxError> {
    let mut file = File::open(path.as_ref()).map_err(KdbxError::Io)?;
    open_reader(&mut file, master_password)
}

fn open_reader(
    source: &mut (impl Read + Seek),
    master_password: &str,
) -> Result<OpenedVault, KdbxError> {
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

    let vault = convert_database(&database)?;
    Ok(OpenedVault {
        version: kdbx_version,
        vault,
    })
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
        io::Cursor,
        path::{Path, PathBuf},
    };

    use super::{KdbxError, KdbxVersion, open, open_reader};

    // Synthetic public test credential from the upstream fixture suite.
    const FIXTURE_PASSWORD: &str = "demopass";
    const WRONG_FIXTURE_PASSWORD: &str = "wrong-public-test-password";

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
}
