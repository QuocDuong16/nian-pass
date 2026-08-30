#![cfg(target_os = "android")]

use super::state::MobileVaultService;

impl MobileVaultService {
    pub(crate) fn security_vault_state(&self) -> &'static str {
        match self.session.as_ref() {
            None => "locked",
            Some(session) if session.is_dirty() => "dirty",
            Some(_) => "clean",
        }
    }

    pub(crate) const fn has_active_operation(&self) -> bool {
        self.active_operation.is_some()
    }
}
