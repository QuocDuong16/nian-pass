use keepass::db::Times;

use crate::{KdbxDocument, KdbxError};

pub const MAX_DATABASE_NAME_BYTES: usize = 4 * 1024;
pub const MAX_DATABASE_DESCRIPTION_BYTES: usize = 64 * 1024;
pub const MAX_DEFAULT_USERNAME_BYTES: usize = 4 * 1024;

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct DatabaseMetadata {
    name: String,
    description: String,
    default_username: String,
}

impl DatabaseMetadata {
    #[must_use]
    pub fn name(&self) -> &str {
        &self.name
    }

    #[must_use]
    pub fn description(&self) -> &str {
        &self.description
    }

    #[must_use]
    pub fn default_username(&self) -> &str {
        &self.default_username
    }
}

impl KdbxDocument {
    #[must_use]
    pub fn database_metadata(&self) -> DatabaseMetadata {
        DatabaseMetadata {
            name: self.database.meta.database_name.clone().unwrap_or_default(),
            description: self
                .database
                .meta
                .database_description
                .clone()
                .unwrap_or_default(),
            default_username: self
                .database
                .meta
                .default_username
                .clone()
                .unwrap_or_default(),
        }
    }

    pub fn update_database_metadata(
        &mut self,
        name: &str,
        description: &str,
        default_username: &str,
    ) -> Result<DatabaseMetadata, KdbxError> {
        if name.len() > MAX_DATABASE_NAME_BYTES
            || description.len() > MAX_DATABASE_DESCRIPTION_BYTES
            || default_username.len() > MAX_DEFAULT_USERNAME_BYTES
        {
            return Err(KdbxError::InvalidDatabaseMetadata);
        }

        let current = self.database_metadata();
        if current.name == name
            && current.description == description
            && current.default_username == default_username
        {
            return Ok(current);
        }

        let changed = Times::now();
        let mut candidate = self.database.clone();
        if current.name != name {
            candidate.meta.database_name = optional_string(name);
            candidate.meta.database_name_changed = Some(changed);
        }
        if current.description != description {
            candidate.meta.database_description = optional_string(description);
            candidate.meta.database_description_changed = Some(changed);
        }
        if current.default_username != default_username {
            candidate.meta.default_username = optional_string(default_username);
            candidate.meta.default_username_changed = Some(changed);
        }
        candidate.meta.settings_changed = Some(changed);
        self.database = candidate;
        self.mark_changed();
        Ok(self.database_metadata())
    }
}

fn optional_string(value: &str) -> Option<String> {
    (!value.is_empty()).then(|| value.to_owned())
}

#[cfg(test)]
mod tests {
    use std::io::Cursor;

    use super::*;

    #[test]
    fn database_metadata_update_is_atomic_noop_stable_and_roundtrips() {
        let mut document = KdbxDocument::new("Root");
        let initial_revision = document.revision();
        assert_eq!(
            document.database_metadata(),
            DatabaseMetadata {
                name: String::new(),
                description: String::new(),
                default_username: String::new(),
            }
        );
        document
            .update_database_metadata("", "", "")
            .expect("same effective metadata should no-op");
        assert_eq!(document.revision(), initial_revision);

        let updated = document
            .update_database_metadata("Personal", "Primary vault", "alice@example.test")
            .expect("metadata update");
        assert_eq!(updated.name(), "Personal");
        assert_eq!(updated.description(), "Primary vault");
        assert_eq!(updated.default_username(), "alice@example.test");
        assert!(document.database.meta.database_name_changed.is_some());
        assert!(
            document
                .database
                .meta
                .database_description_changed
                .is_some()
        );
        assert!(document.database.meta.default_username_changed.is_some());
        assert!(document.database.meta.settings_changed.is_some());

        let mut bytes = Vec::new();
        document
            .save_to_writer(&mut bytes, "metadata-fixture")
            .expect("serialize metadata");
        let reopened = KdbxDocument::open_reader(&mut Cursor::new(bytes), "metadata-fixture")
            .expect("reopen metadata");
        assert_eq!(reopened.database_metadata(), updated);

        let cleared = document
            .update_database_metadata("", "Primary vault", "")
            .expect("clear selected metadata");
        assert_eq!(cleared.name(), "");
        assert_eq!(cleared.description(), "Primary vault");
        assert_eq!(cleared.default_username(), "");
        assert!(document.database.meta.database_name.is_none());
        assert!(document.database.meta.default_username.is_none());
    }

    #[test]
    fn oversized_database_metadata_never_mutates_document() {
        let mut document = KdbxDocument::new("Root");
        let revision = document.revision();
        let oversized = "x".repeat(MAX_DATABASE_NAME_BYTES + 1);
        assert!(matches!(
            document.update_database_metadata(&oversized, "", ""),
            Err(KdbxError::InvalidDatabaseMetadata)
        ));
        assert_eq!(document.revision(), revision);
        assert_eq!(document.database_metadata().name(), "");
    }
}
