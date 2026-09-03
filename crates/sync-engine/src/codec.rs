use std::io::Cursor;

use kdbx::{KdbxDocument, KdbxError};
use vault_core::SecretString;

use crate::SyncError;

pub(crate) fn open_document(
    bytes: &[u8],
    password: &SecretString,
) -> Result<KdbxDocument, SyncError> {
    KdbxDocument::open_reader(&mut Cursor::new(bytes), password.expose_secret()).map_err(|error| {
        if matches!(error, KdbxError::InvalidCredentials) {
            SyncError::VaultAuthenticationFailed
        } else {
            SyncError::InvalidVault
        }
    })
}

pub(crate) fn serialize_verified(
    document: &KdbxDocument,
    password: &SecretString,
) -> Result<Vec<u8>, SyncError> {
    let mut bytes = Vec::new();
    document
        .save_to_writer(&mut bytes, password.expose_secret())
        .map_err(|_| SyncError::InvalidVault)?;
    let reopened = open_document(&bytes, password)?;
    document
        .verify_semantic_equivalence(&reopened)
        .map_err(|_| SyncError::InvalidVault)?;
    Ok(bytes)
}

#[cfg(test)]
mod tests {
    use std::{fs, path::Path};

    use vault_core::SecretString;

    use super::open_document;
    use crate::SyncError;

    fn fixture() -> Vec<u8> {
        fs::read(
            Path::new(env!("CARGO_MANIFEST_DIR"))
                .join("../../fixtures/kdbx/keepassxc-2.7.12-kdbx41.kdbx"),
        )
        .expect("fixture")
    }

    #[test]
    fn open_maps_authentication_and_malformed_ciphertext_separately() {
        assert!(matches!(
            open_document(&fixture(), &SecretString::new("wrong-password".to_owned())),
            Err(SyncError::VaultAuthenticationFailed)
        ));
        assert!(matches!(
            open_document(
                b"not a kdbx vault",
                &SecretString::new("irrelevant".to_owned())
            ),
            Err(SyncError::InvalidVault)
        ));
    }
}
