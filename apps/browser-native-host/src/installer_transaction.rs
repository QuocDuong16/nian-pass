//! Cross-resource transaction policy for Windows Native Messaging registration.

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) enum ManifestState {
    Absent,
    Present(Vec<u8>),
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct RegistrationState {
    pub(crate) key_exists: bool,
    pub(crate) default_value: Option<String>,
}

pub(crate) trait ManifestStore {
    fn capture(&mut self) -> Result<ManifestState, ()>;
    fn replace(&mut self, bytes: &[u8]) -> Result<(), ()>;
    fn remove(&mut self) -> Result<(), ()>;
    fn restore(&mut self, state: &ManifestState) -> Result<(), ()>;
}

pub(crate) trait RegistrationStore {
    fn capture(&mut self) -> Result<RegistrationState, ()>;
    fn set_default(&mut self, value: &str) -> Result<(), ()>;
    fn remove_default(&mut self) -> Result<(), ()>;
    fn restore(&mut self, state: &RegistrationState) -> Result<(), ()>;
}

pub(crate) fn install(
    manifest: &mut impl ManifestStore,
    registration: &mut impl RegistrationStore,
    candidate: &[u8],
    registration_value: &str,
) -> Result<(), String> {
    let old_manifest = manifest
        .capture()
        .map_err(|()| "could not capture existing browser manifest")?;
    let old_registration = registration
        .capture()
        .map_err(|()| "could not capture existing browser registration")?;

    if manifest.replace(candidate).is_err() {
        return if manifest.restore(&old_manifest).is_err() {
            Err(rollback_error())
        } else {
            Err("could not place native host manifest".to_owned())
        };
    }
    if registration.set_default(registration_value).is_err() {
        return match rollback_both(manifest, &old_manifest, registration, &old_registration) {
            Ok(()) => Err("could not write HKCU registration".to_owned()),
            Err(error) => Err(error),
        };
    }
    Ok(())
}

pub(crate) fn uninstall(
    manifest: &mut impl ManifestStore,
    registration: &mut impl RegistrationStore,
) -> Result<(), String> {
    let old_manifest = manifest
        .capture()
        .map_err(|()| "could not capture existing browser manifest")?;
    let old_registration = registration
        .capture()
        .map_err(|()| "could not capture existing browser registration")?;

    if registration.remove_default().is_err() {
        return if registration.restore(&old_registration).is_err() {
            Err(rollback_error())
        } else {
            Err("could not remove HKCU registration".to_owned())
        };
    }
    if manifest.remove().is_err() {
        return match rollback_both(manifest, &old_manifest, registration, &old_registration) {
            Ok(()) => Err("could not remove native host manifest".to_owned()),
            Err(error) => Err(error),
        };
    }
    Ok(())
}

fn rollback_both(
    manifest: &mut impl ManifestStore,
    old_manifest: &ManifestState,
    registration: &mut impl RegistrationStore,
    old_registration: &RegistrationState,
) -> Result<(), String> {
    let registration_result = registration.restore(old_registration);
    let manifest_result = manifest.restore(old_manifest);
    if registration_result.is_err() || manifest_result.is_err() {
        Err(rollback_error())
    } else {
        Ok(())
    }
}

fn rollback_error() -> String {
    "browser integration registration rollback failed".to_owned()
}

#[cfg(test)]
mod tests {
    use std::collections::BTreeMap;

    use super::{
        ManifestState, ManifestStore, RegistrationState, RegistrationStore, install, uninstall,
    };

    #[derive(Default)]
    struct Failures {
        replace_before: bool,
        replace_after: bool,
        remove_before: bool,
        remove_after: bool,
        restore: bool,
    }

    struct FakeManifest {
        state: ManifestState,
        failures: Failures,
    }

    impl FakeManifest {
        fn new(state: ManifestState) -> Self {
            Self {
                state,
                failures: Failures::default(),
            }
        }
    }

    impl ManifestStore for FakeManifest {
        fn capture(&mut self) -> Result<ManifestState, ()> {
            Ok(self.state.clone())
        }

        fn replace(&mut self, bytes: &[u8]) -> Result<(), ()> {
            if self.failures.replace_before {
                return Err(());
            }
            self.state = ManifestState::Present(bytes.to_vec());
            if self.failures.replace_after {
                Err(())
            } else {
                Ok(())
            }
        }

        fn remove(&mut self) -> Result<(), ()> {
            if self.failures.remove_before {
                return Err(());
            }
            self.state = ManifestState::Absent;
            if self.failures.remove_after {
                Err(())
            } else {
                Ok(())
            }
        }

        fn restore(&mut self, state: &ManifestState) -> Result<(), ()> {
            if self.failures.restore {
                return Err(());
            }
            self.state = state.clone();
            Ok(())
        }
    }

    #[derive(Default)]
    struct RegistrationFailures {
        set_after: bool,
        remove_before: bool,
        remove_after: bool,
        restore: bool,
    }

    struct FakeRegistration {
        state: RegistrationState,
        unrelated: BTreeMap<String, String>,
        failures: RegistrationFailures,
        mutation_calls: usize,
    }

    impl FakeRegistration {
        fn new(state: RegistrationState) -> Self {
            Self {
                state,
                unrelated: BTreeMap::new(),
                failures: RegistrationFailures::default(),
                mutation_calls: 0,
            }
        }
    }

    impl RegistrationStore for FakeRegistration {
        fn capture(&mut self) -> Result<RegistrationState, ()> {
            Ok(self.state.clone())
        }

        fn set_default(&mut self, value: &str) -> Result<(), ()> {
            self.mutation_calls += 1;
            self.state.key_exists = true;
            self.state.default_value = Some(value.to_owned());
            if self.failures.set_after {
                Err(())
            } else {
                Ok(())
            }
        }

        fn remove_default(&mut self) -> Result<(), ()> {
            self.mutation_calls += 1;
            if self.failures.remove_before {
                return Err(());
            }
            self.state.default_value = None;
            if self.unrelated.is_empty() {
                self.state.key_exists = false;
            }
            if self.failures.remove_after {
                Err(())
            } else {
                Ok(())
            }
        }

        fn restore(&mut self, state: &RegistrationState) -> Result<(), ()> {
            if self.failures.restore {
                return Err(());
            }
            self.state = state.clone();
            Ok(())
        }
    }

    fn absent_registration() -> RegistrationState {
        RegistrationState {
            key_exists: false,
            default_value: None,
        }
    }

    fn registered(value: &str) -> RegistrationState {
        RegistrationState {
            key_exists: true,
            default_value: Some(value.to_owned()),
        }
    }

    #[test]
    fn fresh_install_commits_manifest_and_registration() {
        let mut manifest = FakeManifest::new(ManifestState::Absent);
        let mut registry = FakeRegistration::new(absent_registration());
        assert!(install(&mut manifest, &mut registry, b"new", "new-path").is_ok());
        assert_eq!(manifest.state, ManifestState::Present(b"new".to_vec()));
        assert_eq!(registry.state, registered("new-path"));
    }

    #[test]
    fn replace_existing_install_commits_exact_new_state() {
        let mut manifest = FakeManifest::new(ManifestState::Present(b"old-exact".to_vec()));
        let mut registry = FakeRegistration::new(registered("old-path"));
        assert!(install(&mut manifest, &mut registry, b"new", "new-path").is_ok());
        assert_eq!(manifest.state, ManifestState::Present(b"new".to_vec()));
        assert_eq!(registry.state, registered("new-path"));
    }

    #[test]
    fn candidate_write_failure_leaves_registry_untouched() {
        let mut manifest = FakeManifest::new(ManifestState::Present(b"old".to_vec()));
        manifest.failures.replace_before = true;
        let mut registry = FakeRegistration::new(registered("old-path"));
        assert!(install(&mut manifest, &mut registry, b"new", "new-path").is_err());
        assert_eq!(manifest.state, ManifestState::Present(b"old".to_vec()));
        assert_eq!(registry.state, registered("old-path"));
        assert_eq!(registry.mutation_calls, 0);
    }

    #[test]
    fn manifest_placement_failure_restores_exact_prior_bytes() {
        let mut manifest = FakeManifest::new(ManifestState::Present(b"old-exact".to_vec()));
        manifest.failures.replace_after = true;
        let mut registry = FakeRegistration::new(registered("old-path"));
        assert!(install(&mut manifest, &mut registry, b"new", "new-path").is_err());
        assert_eq!(
            manifest.state,
            ManifestState::Present(b"old-exact".to_vec())
        );
        assert_eq!(registry.mutation_calls, 0);
    }

    #[test]
    fn registry_write_failure_restores_prior_manifest_and_registry() {
        let mut manifest = FakeManifest::new(ManifestState::Present(b"old-exact".to_vec()));
        let mut registry = FakeRegistration::new(registered("old-path"));
        registry.failures.set_after = true;
        assert!(install(&mut manifest, &mut registry, b"new", "new-path").is_err());
        assert_eq!(
            manifest.state,
            ManifestState::Present(b"old-exact".to_vec())
        );
        assert_eq!(registry.state, registered("old-path"));
    }

    #[test]
    fn registry_write_failure_removes_new_manifest_when_previously_absent() {
        let mut manifest = FakeManifest::new(ManifestState::Absent);
        let mut registry = FakeRegistration::new(absent_registration());
        registry.failures.set_after = true;
        assert!(install(&mut manifest, &mut registry, b"new", "new-path").is_err());
        assert_eq!(manifest.state, ManifestState::Absent);
        assert_eq!(registry.state, absent_registration());
    }

    #[test]
    fn uninstall_success_removes_owned_manifest_and_default_value() {
        let mut manifest = FakeManifest::new(ManifestState::Present(b"old".to_vec()));
        let mut registry = FakeRegistration::new(registered("old-path"));
        assert!(uninstall(&mut manifest, &mut registry).is_ok());
        assert_eq!(manifest.state, ManifestState::Absent);
        assert_eq!(registry.state, absent_registration());
    }

    #[test]
    fn registry_removal_failure_leaves_manifest_and_registry_unchanged() {
        let mut manifest = FakeManifest::new(ManifestState::Present(b"old".to_vec()));
        let mut registry = FakeRegistration::new(registered("old-path"));
        registry.failures.remove_after = true;
        assert!(uninstall(&mut manifest, &mut registry).is_err());
        assert_eq!(manifest.state, ManifestState::Present(b"old".to_vec()));
        assert_eq!(registry.state, registered("old-path"));
    }

    #[test]
    fn manifest_removal_failure_restores_registry_and_exact_manifest() {
        let mut manifest = FakeManifest::new(ManifestState::Present(b"old-exact".to_vec()));
        manifest.failures.remove_after = true;
        let mut registry = FakeRegistration::new(registered("old-path"));
        assert!(uninstall(&mut manifest, &mut registry).is_err());
        assert_eq!(
            manifest.state,
            ManifestState::Present(b"old-exact".to_vec())
        );
        assert_eq!(registry.state, registered("old-path"));
    }

    #[test]
    fn install_converges_from_both_partial_states() {
        for (manifest_state, registry_state) in [
            (
                ManifestState::Present(b"orphan".to_vec()),
                absent_registration(),
            ),
            (ManifestState::Absent, registered("orphan-path")),
        ] {
            let mut manifest = FakeManifest::new(manifest_state);
            let mut registry = FakeRegistration::new(registry_state);
            assert!(install(&mut manifest, &mut registry, b"new", "new-path").is_ok());
            assert_eq!(manifest.state, ManifestState::Present(b"new".to_vec()));
            assert_eq!(registry.state, registered("new-path"));
        }
    }

    #[test]
    fn uninstall_is_idempotent_and_converges_from_partial_states() {
        for (manifest_state, registry_state) in [
            (ManifestState::Absent, absent_registration()),
            (
                ManifestState::Present(b"orphan".to_vec()),
                absent_registration(),
            ),
            (ManifestState::Absent, registered("orphan-path")),
        ] {
            let mut manifest = FakeManifest::new(manifest_state);
            let mut registry = FakeRegistration::new(registry_state);
            assert!(uninstall(&mut manifest, &mut registry).is_ok());
            assert_eq!(manifest.state, ManifestState::Absent);
            assert_eq!(registry.state, absent_registration());
        }
    }

    #[test]
    fn rollback_failure_reports_uncertainty_and_never_success() {
        let mut manifest = FakeManifest::new(ManifestState::Present(b"old".to_vec()));
        manifest.failures.restore = true;
        let mut registry = FakeRegistration::new(registered("old-path"));
        registry.failures.set_after = true;
        let error = install(&mut manifest, &mut registry, b"new", "new-path")
            .expect_err("rollback failure must not report success");
        assert_eq!(error, "browser integration registration rollback failed");
    }

    #[test]
    fn unrelated_registry_values_are_preserved_on_uninstall_and_rollback() {
        let mut manifest = FakeManifest::new(ManifestState::Present(b"old".to_vec()));
        let mut registry = FakeRegistration::new(registered("old-path"));
        registry
            .unrelated
            .insert("unrelated".to_owned(), "keep".to_owned());
        let unrelated = registry.unrelated.clone();
        assert!(uninstall(&mut manifest, &mut registry).is_ok());
        assert_eq!(registry.unrelated, unrelated);
        assert!(registry.state.key_exists);
        assert_eq!(registry.state.default_value, None);
    }

    #[test]
    fn registry_delete_failure_before_mutation_keeps_manifest_unchanged() {
        let mut manifest = FakeManifest::new(ManifestState::Present(b"old".to_vec()));
        let mut registry = FakeRegistration::new(registered("old-path"));
        registry.failures.remove_before = true;
        assert!(uninstall(&mut manifest, &mut registry).is_err());
        assert_eq!(manifest.state, ManifestState::Present(b"old".to_vec()));
        assert_eq!(registry.state, registered("old-path"));
    }

    #[test]
    fn uninstall_rollback_failure_reports_uncertainty() {
        let mut manifest = FakeManifest::new(ManifestState::Present(b"old".to_vec()));
        manifest.failures.remove_after = true;
        let mut registry = FakeRegistration::new(registered("old-path"));
        registry.failures.restore = true;
        let error = uninstall(&mut manifest, &mut registry)
            .expect_err("rollback failure must not report success");
        assert_eq!(error, "browser integration registration rollback failed");
    }

    #[test]
    fn manifest_remove_failure_before_mutation_still_restores_registry() {
        let mut manifest = FakeManifest::new(ManifestState::Present(b"old".to_vec()));
        manifest.failures.remove_before = true;
        let mut registry = FakeRegistration::new(registered("old-path"));
        assert!(uninstall(&mut manifest, &mut registry).is_err());
        assert_eq!(manifest.state, ManifestState::Present(b"old".to_vec()));
        assert_eq!(registry.state, registered("old-path"));
    }
}
