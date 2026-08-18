//! KDBX adapter boundary for Nian Pass.
//!
//! Types from `keepass` are intentionally confined to this crate's private
//! implementation. Callers receive only `vault_core` domain values.

use std::{
    fs::File,
    io::{Seek, SeekFrom},
    path::Path,
};

use keepass::{Database, DatabaseKey, config::DatabaseVersion, db::DatabaseOpenError};
use thiserror::Error;
use vault_core::{Entry, EntryId, Group, GroupId, Vault};

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

/// Opens a KDBX database with a master password and returns a non-sensitive
/// domain projection.
///
/// The password is never logged or included in an error. The caller retains
/// ownership of the password buffer and is responsible for clearing it.
pub fn open(path: impl AsRef<Path>, master_password: &str) -> Result<Vault, KdbxError> {
    let mut file = File::open(path.as_ref()).map_err(KdbxError::Io)?;
    let version = Database::get_version(&mut file).map_err(map_open_error)?;
    if !matches!(version, DatabaseVersion::KDB3(_) | DatabaseVersion::KDB4(_)) {
        return Err(KdbxError::UnsupportedFormat);
    }
    file.seek(SeekFrom::Start(0)).map_err(KdbxError::Io)?;

    let key = DatabaseKey::new().with_password(master_password);
    let database = Database::open(&mut file, key).map_err(map_open_error)?;

    convert_database(&database)
}

fn map_open_error(error: DatabaseOpenError) -> KdbxError {
    match error {
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
    use std::path::{Path, PathBuf};

    use super::{KdbxError, open};

    const FIXTURE_PASSWORD: &str = "demopass";

    fn fixture_path() -> PathBuf {
        Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../../fixtures/kdbx/keepassxc-2.7.12-kdbx41.kdbx")
    }

    #[test]
    fn opens_keepassxc_fixture_with_correct_password() {
        let vault = open(fixture_path(), FIXTURE_PASSWORD).expect("fixture should open");

        assert_eq!(vault.group_count(), 2);
        assert_eq!(vault.entry_count(), 2);
    }

    #[test]
    fn rejects_wrong_password_cleanly() {
        let result = open(fixture_path(), "wrong-test-password");

        assert!(matches!(result, Err(KdbxError::InvalidCredentials)));
    }

    #[test]
    fn rejects_invalid_file_cleanly() {
        let result = open(
            Path::new(env!("CARGO_MANIFEST_DIR")).join("Cargo.toml"),
            FIXTURE_PASSWORD,
        );

        assert!(matches!(result, Err(KdbxError::InvalidKdbx)));
    }

    #[test]
    fn converts_group_and_entry_presentation_data() {
        let vault = open(fixture_path(), FIXTURE_PASSWORD).expect("fixture should open");
        let root = vault.root();
        let titles: Vec<_> = root
            .entries()
            .iter()
            .map(vault_core::Entry::title)
            .collect();

        assert_eq!(root.name(), "Root");
        assert_eq!(titles, ["tagged-entry-41", "ayyyyo"]);
        assert_eq!(root.groups().len(), 1);
        assert_eq!(root.groups()[0].name(), "DumbDangler");
        assert!(!root.id().as_str().is_empty());
        assert!(
            root.entries()
                .iter()
                .all(|entry| !entry.id().as_str().is_empty())
        );
    }
}
