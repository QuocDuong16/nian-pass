use kdbx::KdbxCredential;
use vault_core::{SecretBytes, SecretString};

/// Rust-owned unlock/save authority for the active desktop session.
///
/// Neither component is serializable or exposed through desktop DTOs. The
/// keyfile is retained as zeroizing bytes rather than a path so Save does not
/// depend on the selected keyfile remaining present or unchanged on disk.
pub(crate) struct DesktopVaultCredential {
    password: Option<SecretString>,
    keyfile: Option<SecretBytes>,
}

impl DesktopVaultCredential {
    pub(crate) fn new(password: Option<SecretString>, keyfile: Option<SecretBytes>) -> Self {
        Self { password, keyfile }
    }

    pub(crate) fn password(password: SecretString) -> Self {
        Self::new(Some(password), None)
    }

    pub(crate) fn as_kdbx(&self) -> KdbxCredential<'_> {
        KdbxCredential::new(
            self.password.as_ref().map(SecretString::expose_secret),
            self.keyfile.as_ref().map(SecretBytes::expose_secret),
        )
    }

    pub(crate) fn password_component(&self) -> Option<&SecretString> {
        self.password.as_ref()
    }

    pub(crate) fn keyfile(&self) -> Option<&SecretBytes> {
        self.keyfile.as_ref()
    }

    pub(crate) fn has_keyfile(&self) -> bool {
        self.keyfile.is_some()
    }

    pub(crate) fn into_components(self) -> (Option<SecretString>, Option<SecretBytes>) {
        (self.password, self.keyfile)
    }
}
