use keepass::{Database, config::DatabaseVersion};

use super::{KdbxDocument, KdbxVersion};

impl KdbxDocument {
    /// Creates a new empty KDBX document using the pinned writer's current
    /// supported KDBX4 configuration. The returned document has a named root
    /// group and no entries.
    #[must_use]
    pub fn new(vault_name: &str) -> Self {
        let mut database = Database::new();
        database.root_mut().name = vault_name.to_owned();
        let version = match &database.config.version {
            DatabaseVersion::KDB4(minor) => KdbxVersion::Kdbx4 { minor: *minor },
            DatabaseVersion::KDB3(minor) => KdbxVersion::Kdbx3 { minor: *minor },
            _ => KdbxVersion::Kdbx4 { minor: 1 },
        };
        Self {
            version,
            database,
            revision: 0,
            revision_permanently_dirty: false,
        }
    }
}
