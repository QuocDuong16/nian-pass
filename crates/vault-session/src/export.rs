use std::{
    fs,
    io::{BufWriter, Write},
    path::Path,
};

use kdbx::KdbxCredential;

use super::{
    EXPORT_TEMP_PREFIX, ManagedTemp, SessionError, VaultSession, open_document_with_credential,
    platform,
};

impl VaultSession {
    /// Writes a verified encrypted copy of the current in-memory document to a
    /// new destination without retargeting this session or overwriting any file.
    /// Dirty local edits are included intentionally; the canonical source and
    /// saved revision remain unchanged.
    pub fn export_copy_with_credential(
        &self,
        destination: impl AsRef<Path>,
        credential: KdbxCredential<'_>,
    ) -> Result<(), SessionError> {
        let destination = destination.as_ref();
        let parent = destination.parent().ok_or(SessionError::UnsupportedPath)?;
        if destination.exists() {
            return Err(SessionError::ExportTarget(std::io::Error::new(
                std::io::ErrorKind::AlreadyExists,
                "export destination already exists",
            )));
        }

        let mut prepared = ManagedTemp::create(parent, EXPORT_TEMP_PREFIX)?;
        {
            let mut writer = BufWriter::new(prepared.file_mut()?);
            self.document
                .save_to_writer_with_credential(&mut writer, credential)
                .map_err(SessionError::Kdbx)?;
            writer.flush().map_err(SessionError::WriteTemp)?;
        }
        prepared
            .file_mut()?
            .sync_all()
            .map_err(SessionError::SyncTemp)?;
        prepared.close();

        let reopened = open_document_with_credential(prepared.path(), credential)
            .map_err(SessionError::ExportVerificationFailed)?;
        self.document
            .verify_semantic_equivalence(&reopened)
            .map_err(SessionError::ExportVerificationFailed)?;

        fs::hard_link(prepared.path(), destination).map_err(SessionError::ExportTarget)?;
        let published_result = (|| {
            let final_document = open_document_with_credential(destination, credential)
                .map_err(SessionError::ExportVerificationFailed)?;
            self.document
                .verify_semantic_equivalence(&final_document)
                .map_err(SessionError::ExportVerificationFailed)?;
            platform::sync_parent(parent).map_err(SessionError::ExportTarget)
        })();
        if published_result.is_err() {
            let _ = fs::remove_file(destination);
            let _ = platform::sync_parent(parent);
            return published_result;
        }

        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use std::{fs, path::PathBuf};

    use kdbx::{KdbxCredential, KdbxDocument};
    use vault_core::{NewEntry, SecretString};

    use super::VaultSession;

    fn temp_path(name: &str) -> PathBuf {
        std::env::temp_dir().join(format!("nian-pass-export-{}-{name}", std::process::id()))
    }

    #[test]
    fn export_copy_includes_dirty_state_without_retargeting_or_cleaning_session() {
        let source = temp_path("source.kdbx");
        let export = temp_path("copy.kdbx");
        let _ = fs::remove_file(&source);
        let _ = fs::remove_file(&export);
        let credential = SecretString::new("export-fixture".to_owned());
        let mut session = VaultSession::create(&source, "Export", &credential).expect("create");
        let root = session
            .projection()
            .expect("projection")
            .root()
            .id()
            .clone();
        session
            .document_mut()
            .create_entry(
                &root,
                NewEntry {
                    title: "Dirty copy",
                    username: "",
                    url: "",
                    password: None,
                },
            )
            .expect("mutation");
        assert!(session.is_dirty());

        session
            .export_copy_with_credential(
                &export,
                KdbxCredential::password(credential.expose_secret()),
            )
            .expect("export");

        assert_eq!(session.path(), source.as_path());
        assert!(session.is_dirty());
        let copy = KdbxDocument::open(&export, credential.expose_secret()).expect("open export");
        let projection = copy.projection().expect("copy projection");
        assert!(
            projection
                .root()
                .entries()
                .iter()
                .any(|entry| entry.title().visible() == Some("Dirty copy"))
        );
        let _ = fs::remove_file(source);
        let _ = fs::remove_file(export);
    }

    #[test]
    fn export_copy_never_overwrites_existing_destination() {
        let source = temp_path("source-existing.kdbx");
        let export = temp_path("existing.kdbx");
        let _ = fs::remove_file(&source);
        let _ = fs::remove_file(&export);
        let credential = SecretString::new("export-existing".to_owned());
        let session = VaultSession::create(&source, "Export", &credential).expect("create");
        fs::write(&export, b"existing-bytes").expect("existing target");

        let error = session
            .export_copy_with_credential(
                &export,
                KdbxCredential::password(credential.expose_secret()),
            )
            .expect_err("existing target must be refused");
        assert!(matches!(error, crate::SessionError::ExportTarget(_)));
        assert_eq!(fs::read(&export).expect("read existing"), b"existing-bytes");
        let _ = fs::remove_file(source);
        let _ = fs::remove_file(export);
    }
}
