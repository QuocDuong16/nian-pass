use std::io::Cursor;

use keepass::DatabaseKey;

use crate::KdbxError;

/// Borrowed KDBX credential components. Password and keyfile are deliberately
/// kept outside the parsed document and may be combined without copying either
/// secret into an adapter-owned long-lived allocation.
#[derive(Clone, Copy)]
pub struct KdbxCredential<'a> {
    password: Option<&'a str>,
    keyfile: Option<&'a [u8]>,
}

impl<'a> KdbxCredential<'a> {
    #[must_use]
    pub const fn new(password: Option<&'a str>, keyfile: Option<&'a [u8]>) -> Self {
        Self { password, keyfile }
    }

    #[must_use]
    pub const fn password(password: &'a str) -> Self {
        Self::new(Some(password), None)
    }

    #[must_use]
    pub const fn has_component(self) -> bool {
        self.password.is_some() || self.keyfile.is_some()
    }
}

pub(crate) fn database_key(credential: KdbxCredential<'_>) -> Result<DatabaseKey, KdbxError> {
    if !credential.has_component() {
        return Err(KdbxError::InvalidCredentials);
    }

    let mut key = DatabaseKey::new();
    if let Some(password) = credential.password {
        key = key.with_password(password);
    }
    if let Some(keyfile) = credential.keyfile {
        key = key
            .with_keyfile(&mut Cursor::new(keyfile))
            .map_err(KdbxError::Io)?;
    }
    Ok(key)
}
