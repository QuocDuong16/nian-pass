use vault_core::SecretString;

use super::{AppState, DesktopError};
use crate::clipboard::ClipboardCopy;

impl AppState {
    /// Copies a freshly generated ASCII password/passphrase using the same
    /// ownership-aware clipboard lease as entry secrets. No vault mutation.
    pub fn copy_generated_password(
        &self,
        password: SecretString,
    ) -> Result<ClipboardCopy, DesktopError> {
        self.copy_secret_with(|service| {
            // A generated password cannot be copied through this vault-scoped
            // command after Lock. Validate even if IPC bypasses the UI.
            service.snapshot()?;
            let value = password.expose_secret();
            if value.is_empty()
                || value.len() > 256
                || !value.bytes().all(|byte| (b' '..=b'~').contains(&byte))
            {
                return Err(DesktopError::InvalidRequest);
            }
            Ok(password)
        })
    }
}
