#![cfg_attr(not(target_os = "android"), allow(dead_code))]

use std::{
    fs,
    path::{Path, PathBuf},
};

use vault_core::SecretString;

use crate::dto::{EntryDetailDto, MobileSelectedVaultDto, VaultSnapshotDto};

use super::{
    MobileError,
    generation::MobileSourceHandle,
    session::{MobileVaultSession, PreparedMobileSave},
};

struct PendingMobileSelection {
    staged_path: PathBuf,
    file_name: String,
    handle: MobileSourceHandle,
    writable: bool,
    recovery_required: bool,
}

impl PendingMobileSelection {
    fn cleanup(&self) -> Result<(), MobileError> {
        remove_private_file(&self.staged_path)
    }
}

impl Drop for PendingMobileSelection {
    fn drop(&mut self) {
        let _ = fs::remove_file(&self.staged_path);
    }
}

pub(crate) struct MobileOperation {
    pub(crate) id: u64,
    pub(crate) source_token: String,
}

pub(crate) struct PreviousMobileSource {
    pub(crate) token: String,
    pub(crate) preserve_recovery: bool,
}

pub(crate) struct MobileSelectionOperation {
    pub(crate) id: u64,
    pub(crate) previous: Option<PreviousMobileSource>,
}

/// Android orchestration state. Provider I/O remains outside this synchronous
/// service, while `active_operation` serializes Save, Reload, selection, Lock,
/// and all mutations across native awaits.
pub(crate) struct MobileVaultService {
    pending: Option<PendingMobileSelection>,
    session: Option<MobileVaultSession>,
    active_operation: Option<u64>,
    next_operation: u64,
}

impl MobileVaultService {
    pub(crate) const fn new() -> Self {
        Self {
            pending: None,
            session: None,
            active_operation: None,
            next_operation: 1,
        }
    }

    pub(crate) fn can_select(&self) -> Result<(), MobileError> {
        if self.active_operation.is_some() {
            return Err(MobileError::Busy);
        }
        if self.session.is_some() {
            return Err(MobileError::Conflict);
        }
        Ok(())
    }

    pub(crate) fn begin_selection(&mut self) -> Result<MobileSelectionOperation, MobileError> {
        self.can_select()?;
        let id = self.next_operation;
        self.next_operation = self.next_operation.checked_add(1).unwrap_or(1);
        self.active_operation = Some(id);
        Ok(MobileSelectionOperation {
            id,
            previous: self.pending.as_ref().map(|pending| PreviousMobileSource {
                token: pending.handle.as_str().to_owned(),
                preserve_recovery: pending.recovery_required,
            }),
        })
    }

    pub(crate) fn complete_selection(
        &mut self,
        operation: u64,
        staged_path: PathBuf,
        file_name: String,
        source_token: String,
        writable: bool,
        recovery_required: bool,
    ) -> Result<MobileSelectedVaultDto, MobileError> {
        if self.active_operation != Some(operation) || self.session.is_some() {
            return Err(MobileError::Conflict);
        }
        let candidate = PendingMobileSelection {
            staged_path,
            file_name,
            handle: MobileSourceHandle::new(source_token)?,
            writable,
            recovery_required,
        };
        let dto = MobileSelectedVaultDto {
            file_name: candidate.file_name.clone(),
            writable,
        };
        self.pending.take();
        self.pending = Some(candidate);
        self.active_operation = None;
        Ok(dto)
    }

    pub(crate) fn unlock(
        &mut self,
        credential: &SecretString,
    ) -> Result<VaultSnapshotDto, MobileError> {
        if self.active_operation.is_some() {
            return Err(MobileError::Busy);
        }
        if self.session.is_some() {
            return Err(MobileError::Conflict);
        }
        let pending = self.pending.take().ok_or(MobileError::NoVaultSelected)?;
        if pending.recovery_required {
            self.pending = Some(pending);
            return Err(MobileError::RecoveryRequired);
        }
        let opened = MobileVaultSession::open_candidate(
            &pending.staged_path,
            MobileSourceHandle::new(pending.handle.as_str().to_owned())?,
            pending.writable,
            credential,
        );
        let (session, snapshot) = match opened {
            Ok(value) => value,
            Err(error) => {
                self.pending = Some(pending);
                return Err(error);
            }
        };
        pending.cleanup()?;
        self.session = Some(session);
        Ok(snapshot)
    }

    pub(crate) fn snapshot(&self) -> Result<VaultSnapshotDto, MobileError> {
        self.session.as_ref().ok_or(MobileError::Locked)?.snapshot()
    }

    pub(crate) fn entry_detail(&self, entry_id: &str) -> Result<EntryDetailDto, MobileError> {
        self.session
            .as_ref()
            .ok_or(MobileError::Locked)?
            .entry_detail(entry_id)
    }

    pub(crate) fn entry_secret(
        &self,
        entry_id: &str,
        kind: MobileSecretKind,
    ) -> Result<SecretString, MobileError> {
        let session = self.session.as_ref().ok_or(MobileError::Locked)?;
        match kind {
            MobileSecretKind::Title => {
                session.entry_secret(entry_id, |document, id| document.entry_title(id))
            }
            MobileSecretKind::Username => {
                session.entry_secret(entry_id, |document, id| document.entry_username(id))
            }
            MobileSecretKind::Url => {
                session.entry_secret(entry_id, |document, id| document.entry_url(id))
            }
            MobileSecretKind::Notes => {
                session.entry_secret(entry_id, |document, id| document.entry_notes(id))
            }
        }
    }

    pub(crate) fn entry_custom_field(
        &self,
        entry_id: &str,
        name: &str,
    ) -> Result<SecretString, MobileError> {
        self.session
            .as_ref()
            .ok_or(MobileError::Locked)?
            .entry_custom_field(entry_id, name)
    }

    pub(super) fn session_mut_for_mutation(
        &mut self,
    ) -> Result<&mut MobileVaultSession, MobileError> {
        if self.active_operation.is_some() {
            return Err(MobileError::Busy);
        }
        let session = self.session.as_mut().ok_or(MobileError::Locked)?;
        if !session.writable() {
            return Err(MobileError::PersistenceUnsupported);
        }
        Ok(session)
    }

    pub(crate) fn begin_save(&mut self) -> Result<MobileOperation, MobileError> {
        let session = self.session.as_ref().ok_or(MobileError::Locked)?;
        if self.active_operation.is_some() {
            return Err(MobileError::Busy);
        }
        if !session.writable() {
            return Err(MobileError::PersistenceUnsupported);
        }
        if !session.is_dirty() {
            return Err(MobileError::InvalidRequest);
        }
        self.begin_operation()
    }

    pub(crate) fn begin_reload(&mut self) -> Result<MobileOperation, MobileError> {
        if self.session.is_none() {
            return Err(MobileError::Locked);
        }
        if self.active_operation.is_some() {
            return Err(MobileError::Busy);
        }
        self.begin_operation()
    }

    fn begin_operation(&mut self) -> Result<MobileOperation, MobileError> {
        let session = self.session.as_ref().ok_or(MobileError::Locked)?;
        let id = self.next_operation;
        self.next_operation = self.next_operation.checked_add(1).unwrap_or(1);
        self.active_operation = Some(id);
        Ok(MobileOperation {
            id,
            source_token: session.source_handle().as_str().to_owned(),
        })
    }

    fn require_operation(&self, operation: u64) -> Result<&MobileVaultSession, MobileError> {
        if self.active_operation != Some(operation) {
            return Err(MobileError::SaveUncertain);
        }
        self.session.as_ref().ok_or(MobileError::SaveUncertain)
    }

    pub(crate) fn prepare_save(
        &self,
        operation: u64,
        current_path: &Path,
        candidate_path: &Path,
        credential: &SecretString,
    ) -> Result<PreparedMobileSave, MobileError> {
        self.require_operation(operation)?.prepare_save(
            operation,
            current_path,
            candidate_path,
            credential,
        )
    }

    pub(crate) fn mark_verified_saved(
        &mut self,
        prepared: &PreparedMobileSave,
        read_back_path: &Path,
        credential: &SecretString,
    ) -> Result<VaultSnapshotDto, MobileError> {
        if self.active_operation != Some(prepared.operation) {
            return Err(MobileError::SaveUncertain);
        }
        self.session
            .as_mut()
            .ok_or(MobileError::SaveUncertain)?
            .mark_verified_saved(prepared, read_back_path, credential)
    }

    pub(crate) fn reload_candidate(
        &mut self,
        operation: u64,
        staged_path: &Path,
        credential: &SecretString,
    ) -> Result<VaultSnapshotDto, MobileError> {
        if self.active_operation != Some(operation) {
            return Err(MobileError::ReloadFailed);
        }
        self.session
            .as_mut()
            .ok_or(MobileError::ReloadFailed)?
            .reload_candidate(staged_path, credential)
    }

    pub(crate) fn finish_operation(&mut self, operation: u64) {
        if self.active_operation == Some(operation) {
            self.active_operation = None;
        }
    }

    pub(crate) fn lock(&mut self) -> Result<String, MobileError> {
        if self.active_operation.is_some() {
            return Err(MobileError::Busy);
        }
        if self.session.as_ref().ok_or(MobileError::Locked)?.is_dirty() {
            return Err(MobileError::UnsavedChanges);
        }
        self.drop_session()
    }

    pub(crate) fn discard_and_lock(&mut self) -> Result<String, MobileError> {
        if self.active_operation.is_some() {
            return Err(MobileError::Busy);
        }
        self.drop_session()
    }

    fn drop_session(&mut self) -> Result<String, MobileError> {
        let session = self.session.take().ok_or(MobileError::Locked)?;
        let handle = session.source_handle().as_str().to_owned();
        drop(session);
        Ok(handle)
    }
}

#[derive(Clone, Copy)]
pub(crate) enum MobileSecretKind {
    Title,
    Username,
    Url,
    Notes,
}

impl Default for MobileVaultService {
    fn default() -> Self {
        Self::new()
    }
}

fn remove_private_file(path: &Path) -> Result<(), MobileError> {
    match fs::remove_file(path) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(_) => Err(MobileError::Internal),
    }
}

#[cfg(test)]
mod tests {
    use super::{MobileError, MobileVaultService};
    use crate::mobile::{
        mutations::{
            MobileCreateEntryRequest, MobileCreateGroupRequest, MobileMoveEntryRequest,
            MobileMoveGroupRequest, MobileRenameGroupRequest, MobileSetCustomFieldRequest,
            MobileUpdateEntryRequest,
        },
        state::MobileSecretKind,
    };
    use serde::de::DeserializeOwned;
    use serde_json::{Value, json};
    use std::{
        fs,
        path::{Path, PathBuf},
        sync::atomic::{AtomicU64, Ordering},
    };
    use vault_core::SecretString;

    static NEXT: AtomicU64 = AtomicU64::new(0);
    fn fixture() -> (PathBuf, PathBuf) {
        let root = std::env::temp_dir().join(format!(
            "nian-pass-mobile-state-{}-{}",
            std::process::id(),
            NEXT.fetch_add(1, Ordering::Relaxed)
        ));
        fs::create_dir(&root).expect("test dir");
        let staged = root.join("staged.kdbx");
        fs::copy(
            Path::new(env!("CARGO_MANIFEST_DIR"))
                .join("../../../fixtures/kdbx/keepassxc-2.7.12-kdbx41.kdbx"),
            &staged,
        )
        .expect("stage");
        (root, staged)
    }
    fn selected(service: &mut MobileVaultService, path: PathBuf, writable: bool) {
        let operation = service.begin_selection().expect("begin selection");
        service
            .complete_selection(
                operation.id,
                path,
                "vault.kdbx".to_owned(),
                "0123456789abcdef0123456789abcdef".to_owned(),
                writable,
                false,
            )
            .expect("select");
    }

    fn request<T: DeserializeOwned>(value: Value) -> T {
        serde_json::from_value(value).expect("request")
    }

    #[test]
    fn dirty_lock_refuses_and_explicit_discard_drops_session() {
        let (root, path) = fixture();
        let mut service = MobileVaultService::new();
        selected(&mut service, path, true);
        let snapshot = service
            .unlock(&SecretString::new("demopass".to_owned()))
            .expect("unlock");
        let entry = snapshot.entries.first().expect("entry").id.clone();
        service
            .update_entry(crate::mobile::mutations::MobileUpdateEntryRequest {
                entry_id: entry,
                title: Some("dirty".to_owned()),
                username: None,
                url: None,
                password: None,
                notes: None,
            })
            .expect("mutate");
        assert!(matches!(service.lock(), Err(MobileError::UnsavedChanges)));
        assert!(service.snapshot().expect("retained").dirty);
        assert!(service.discard_and_lock().is_ok());
        assert!(matches!(service.snapshot(), Err(MobileError::Locked)));
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn active_save_serializes_mutation_reload_and_lock_without_sleeps() {
        let (root, path) = fixture();
        let mut service = MobileVaultService::new();
        selected(&mut service, path, true);
        let snapshot = service
            .unlock(&SecretString::new("demopass".to_owned()))
            .expect("unlock");
        let entry = snapshot.entries.first().expect("entry").id.clone();
        service
            .update_entry(crate::mobile::mutations::MobileUpdateEntryRequest {
                entry_id: entry.clone(),
                title: Some("dirty".to_owned()),
                username: None,
                url: None,
                password: None,
                notes: None,
            })
            .expect("mutate");
        let operation = service.begin_save().expect("begin");
        assert!(matches!(
            service.update_entry(crate::mobile::mutations::MobileUpdateEntryRequest {
                entry_id: entry,
                title: Some("later".to_owned()),
                username: None,
                url: None,
                password: None,
                notes: None
            }),
            Err(MobileError::Busy)
        ));
        assert!(matches!(service.begin_reload(), Err(MobileError::Busy)));
        assert!(matches!(service.lock(), Err(MobileError::Busy)));
        service.finish_operation(operation.id);
        assert!(matches!(service.lock(), Err(MobileError::UnsavedChanges)));
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn mobile_service_exercises_reviewed_crud_and_narrow_secret_loads() {
        let (root, path) = fixture();
        let mut service = MobileVaultService::new();
        selected(&mut service, path, true);
        let initial = service
            .unlock(&SecretString::new("demopass".to_owned()))
            .expect("unlock");
        let root_group = initial.root_group_id.clone();
        let existing_entry = initial.entries.first().expect("entry").id.clone();
        assert!(service.entry_detail(&existing_entry).is_ok());

        service
            .update_entry(request::<MobileUpdateEntryRequest>(json!({
                "entryId": existing_entry,
                "title": "Mobile title",
                "username": "mobile-user",
                "url": "m5.2://entry",
                "password": "M5.2-PASSWORD",
                "notes": "M5.2-NOTES"
            })))
            .expect("atomic entry update");
        for kind in [
            MobileSecretKind::Title,
            MobileSecretKind::Username,
            MobileSecretKind::Url,
            MobileSecretKind::Notes,
        ] {
            assert!(service.entry_secret(&existing_entry, kind).is_ok());
        }

        let first_group = service
            .create_group(request::<MobileCreateGroupRequest>(json!({
                "parentGroupId": root_group,
                "name": "Mobile first"
            })))
            .expect("first group");
        assert!(first_group.snapshot.dirty);
        let second_group = service
            .create_group(request::<MobileCreateGroupRequest>(json!({
                "parentGroupId": root_group,
                "name": "Mobile second"
            })))
            .expect("second group");
        service
            .rename_group(request::<MobileRenameGroupRequest>(json!({
                "groupId": first_group.created_group_id,
                "name": "Mobile renamed"
            })))
            .expect("rename group");
        service
            .move_group(request::<MobileMoveGroupRequest>(json!({
                "groupId": first_group.created_group_id,
                "destinationGroupId": second_group.created_group_id
            })))
            .expect("move group");

        let created = service
            .create_entry(request::<MobileCreateEntryRequest>(json!({
                "groupId": first_group.created_group_id,
                "title": "Created",
                "username": "created-user",
                "url": "m5.2://created",
                "password": "CREATED-PASSWORD",
                "notes": "CREATED-NOTES"
            })))
            .expect("create entry");
        assert!(
            created
                .snapshot
                .entries
                .iter()
                .any(|entry| entry.id == created.created_entry_id)
        );
        service
            .move_entry(request::<MobileMoveEntryRequest>(json!({
                "entryId": created.created_entry_id,
                "destinationGroupId": second_group.created_group_id
            })))
            .expect("move entry");
        service
            .set_custom_field(request::<MobileSetCustomFieldRequest>(json!({
                "entryId": created.created_entry_id,
                "name": "Mobile custom",
                "value": "CUSTOM-SECRET",
                "protection": "protected"
            })))
            .expect("create custom field");
        service
            .set_custom_field(request::<MobileSetCustomFieldRequest>(json!({
                "entryId": created.created_entry_id,
                "name": "Mobile custom",
                "value": "UPDATED-CUSTOM-SECRET",
                "protection": "unprotected"
            })))
            .expect("update custom field while core preserves protection");
        let detail = service
            .entry_detail(&created.created_entry_id)
            .expect("detail");
        assert!(detail.custom_fields.iter().any(|field| {
            field.name == "Mobile custom"
                && matches!(field.protection, crate::dto::FieldProtectionDto::Protected)
        }));
        assert_eq!(
            service
                .entry_custom_field(&created.created_entry_id, "Mobile custom")
                .expect("custom value")
                .expose_secret(),
            "UPDATED-CUSTOM-SECRET"
        );
        service
            .delete_custom_field(created.created_entry_id.clone(), "Mobile custom".to_owned())
            .expect("delete custom field");
        service
            .delete_entry(created.created_entry_id)
            .expect("delete entry");
        service
            .delete_group(first_group.created_group_id)
            .expect("delete first group");
        service
            .delete_group(second_group.created_group_id)
            .expect("delete second group");
        assert!(service.snapshot().expect("snapshot").dirty);
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn selection_recovery_read_only_and_clean_lock_fail_closed() {
        let (root, first) = fixture();
        let second = root.join("replacement.kdbx");
        fs::copy(&first, &second).expect("second selection");
        let mut service = MobileVaultService::new();
        selected(&mut service, first, true);
        let operation = service.begin_selection().expect("begin replacement");
        assert_eq!(
            operation
                .previous
                .as_ref()
                .map(|value| value.token.as_str()),
            Some("0123456789abcdef0123456789abcdef")
        );
        assert!(
            !operation
                .previous
                .as_ref()
                .expect("previous")
                .preserve_recovery
        );
        service
            .complete_selection(
                operation.id,
                second,
                "replacement.kdbx".to_owned(),
                "fedcba9876543210fedcba9876543210".to_owned(),
                false,
                false,
            )
            .expect("replace pending selection");
        let snapshot = service
            .unlock(&SecretString::new("demopass".to_owned()))
            .expect("read-only unlock");
        let entry = snapshot.entries.first().expect("entry").id.clone();
        assert!(matches!(
            service.update_entry(request::<MobileUpdateEntryRequest>(json!({
                "entryId": entry,
                "title": "must not mutate"
            }))),
            Err(MobileError::PersistenceUnsupported)
        ));
        assert!(matches!(
            service.begin_save(),
            Err(MobileError::PersistenceUnsupported)
        ));
        assert!(matches!(service.can_select(), Err(MobileError::Conflict)));
        assert!(service.lock().is_ok());
        assert!(matches!(service.lock(), Err(MobileError::Locked)));

        let (recovery_root, recovery_path) = fixture();
        let mut recovery = MobileVaultService::new();
        let operation = recovery
            .begin_selection()
            .expect("begin recovery selection");
        recovery
            .complete_selection(
                operation.id,
                recovery_path,
                "vault.kdbx".to_owned(),
                "00112233445566778899aabbccddeeff".to_owned(),
                true,
                true,
            )
            .expect("select recovery source");
        assert!(matches!(
            recovery.unlock(&SecretString::new("demopass".to_owned())),
            Err(MobileError::RecoveryRequired)
        ));
        let _ = fs::remove_dir_all(root);
        drop(recovery);
        let _ = fs::remove_dir_all(recovery_root);
    }

    #[test]
    fn operation_tokens_cover_verified_save_reload_and_stale_completion() {
        let (root, staged) = fixture();
        let provider = root.join("provider.kdbx");
        fs::copy(&staged, &provider).expect("provider generation");
        let credential = SecretString::new("demopass".to_owned());
        let mut service = MobileVaultService::default();
        selected(&mut service, staged, true);
        let snapshot = service.unlock(&credential).expect("unlock");
        assert!(matches!(
            service.unlock(&credential),
            Err(MobileError::Conflict)
        ));
        let entry = snapshot.entries.first().expect("entry").id.clone();
        service
            .update_entry(request::<MobileUpdateEntryRequest>(json!({
                "entryId": entry,
                "title": "transaction revision"
            })))
            .expect("dirty mutation");

        let operation = service.begin_save().expect("begin save");
        assert!(matches!(service.begin_save(), Err(MobileError::Busy)));
        assert!(matches!(service.can_select(), Err(MobileError::Busy)));
        let candidate = root.join("candidate.kdbx");
        assert!(matches!(
            service.prepare_save(operation.id + 1, &provider, &candidate, &credential),
            Err(MobileError::SaveUncertain)
        ));
        let prepared = service
            .prepare_save(operation.id, &provider, &candidate, &credential)
            .expect("prepare");
        fs::copy(&candidate, &provider).expect("verified provider commit");
        assert!(
            !service
                .mark_verified_saved(&prepared, &provider, &credential)
                .expect("mark saved")
                .dirty
        );
        service.finish_operation(operation.id);
        assert!(matches!(
            service.mark_verified_saved(&prepared, &provider, &credential),
            Err(MobileError::SaveUncertain)
        ));
        assert!(matches!(
            service.begin_save(),
            Err(MobileError::InvalidRequest)
        ));

        let reload = service.begin_reload().expect("begin reload");
        let reload_stage = root.join("reload.kdbx");
        fs::copy(&provider, &reload_stage).expect("reload staging");
        assert!(
            !service
                .reload_candidate(reload.id, &reload_stage, &credential)
                .expect("reload")
                .dirty
        );
        service.finish_operation(reload.id);
        service.finish_operation(reload.id);
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn unlock_failures_retain_selection_and_locked_reload_is_rejected() {
        let (root, path) = fixture();
        let mut service = MobileVaultService::new();
        assert!(matches!(
            service.unlock(&SecretString::new("demopass".to_owned())),
            Err(MobileError::NoVaultSelected)
        ));
        assert!(matches!(service.begin_reload(), Err(MobileError::Locked)));
        selected(&mut service, path, true);
        assert!(matches!(
            service.unlock(&SecretString::new("wrong".to_owned())),
            Err(MobileError::UnlockFailed)
        ));
        assert!(
            service
                .unlock(&SecretString::new("demopass".to_owned()))
                .is_ok()
        );
        let operation = service.begin_reload().expect("active operation");
        assert!(matches!(
            service.unlock(&SecretString::new("demopass".to_owned())),
            Err(MobileError::Busy)
        ));
        assert!(matches!(service.begin_reload(), Err(MobileError::Busy)));
        service.finish_operation(operation.id);
        let _ = fs::remove_dir_all(root);
    }
}
