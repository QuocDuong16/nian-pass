use kdbx::KdbxCredential;
use vault_core::{SecretBytes, SecretString};

/// Per-operation credential for encrypted generations. Never stored in a sync
/// profile, BASE, or journal. Owned components zeroize on drop.
pub struct SyncCredential {
    password: Option<SecretString>,
    keyfile: Option<SecretBytes>,
}

impl SyncCredential {
    #[must_use]
    pub const fn new(password: Option<SecretString>, keyfile: Option<SecretBytes>) -> Self {
        Self { password, keyfile }
    }

    #[must_use]
    pub fn has_component(&self) -> bool {
        self.as_kdbx().has_component()
    }

    #[must_use]
    pub fn as_kdbx(&self) -> KdbxCredential<'_> {
        KdbxCredential::new(
            self.password.as_ref().map(SecretString::expose_secret),
            self.keyfile.as_ref().map(SecretBytes::expose_secret),
        )
    }
}

impl From<SecretString> for SyncCredential {
    fn from(password: SecretString) -> Self {
        Self::new(Some(password), None)
    }
}
