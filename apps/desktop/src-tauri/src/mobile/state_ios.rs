#![cfg_attr(not(target_os = "ios"), allow(dead_code))]

use credential_provider_core::PasswordIdentity;

use super::{
    MobileError,
    state::{MobileOperation, MobileVaultService},
};

impl MobileVaultService {
    pub(crate) fn begin_ios_autofill_operation(&mut self) -> Result<MobileOperation, MobileError> {
        self.begin_reload()
    }

    pub(crate) fn password_identities(&self) -> Result<Vec<PasswordIdentity>, MobileError> {
        self.session
            .as_ref()
            .ok_or(MobileError::Locked)?
            .password_identities()
    }
}

#[cfg(test)]
mod tests {
    use std::{
        fs,
        path::PathBuf,
        sync::atomic::{AtomicU64, Ordering},
    };

    use vault_core::SecretString;

    use super::{MobileError, MobileVaultService};

    static NEXT: AtomicU64 = AtomicU64::new(0);

    fn unlocked_service() -> MobileVaultService {
        let root = std::env::temp_dir().join(format!(
            "nian-pass-ios-state-{}-{}",
            std::process::id(),
            NEXT.fetch_add(1, Ordering::Relaxed)
        ));
        fs::create_dir(&root).expect("test directory");
        let staged = root.join("source.kdbx");
        fs::copy(
            PathBuf::from(env!("CARGO_MANIFEST_DIR"))
                .join("../../../fixtures/kdbx/keepassxc-2.7.12-kdbx41.kdbx"),
            &staged,
        )
        .expect("stage fixture");
        let mut service = MobileVaultService::new();
        let selection = service.begin_selection().expect("begin selection");
        service
            .complete_selection(
                selection.id,
                staged,
                "synthetic.kdbx".to_owned(),
                "0123456789abcdef0123456789abcdef".to_owned(),
                false,
                false,
            )
            .expect("complete selection");
        service
            .unlock(&SecretString::new("demopass".to_owned()))
            .expect("unlock synthetic fixture");
        let _ = fs::remove_dir(root);
        service
    }

    #[test]
    fn ios_identity_projection_requires_unlock_and_operations_serialize() {
        let mut locked = MobileVaultService::new();
        assert!(matches!(
            locked.password_identities(),
            Err(MobileError::Locked)
        ));
        assert!(matches!(
            locked.begin_ios_autofill_operation(),
            Err(MobileError::Locked)
        ));

        let mut service = unlocked_service();
        assert!(service.password_identities().is_ok());
        let operation = service
            .begin_ios_autofill_operation()
            .expect("reserve iOS AutoFill operation");
        assert!(matches!(
            service.begin_ios_autofill_operation(),
            Err(MobileError::Busy)
        ));
        service.finish_operation(operation.id);
        assert!(service.begin_ios_autofill_operation().is_ok());
    }
}
