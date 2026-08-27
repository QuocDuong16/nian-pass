#![cfg_attr(not(target_os = "android"), allow(dead_code))]

use crate::dto::{CreatedEntryDto, CreatedGroupDto, VaultSnapshotDto};

use super::{
    MobileError,
    mutations::{
        MobileCreateEntryRequest, MobileCreateGroupRequest, MobileMoveEntryRequest,
        MobileMoveGroupRequest, MobileRenameGroupRequest, MobileSetCustomFieldRequest,
        MobileUpdateEntryRequest,
    },
    state::MobileVaultService,
};

impl MobileVaultService {
    pub(crate) fn update_entry(
        &mut self,
        request: MobileUpdateEntryRequest,
    ) -> Result<VaultSnapshotDto, MobileError> {
        self.session_mut_for_mutation()?.update_entry(request)
    }

    pub(crate) fn create_entry(
        &mut self,
        request: MobileCreateEntryRequest,
    ) -> Result<CreatedEntryDto, MobileError> {
        self.session_mut_for_mutation()?.create_entry(request)
    }

    pub(crate) fn delete_entry(
        &mut self,
        entry_id: String,
    ) -> Result<VaultSnapshotDto, MobileError> {
        self.session_mut_for_mutation()?.delete_entry(entry_id)
    }

    pub(crate) fn move_entry(
        &mut self,
        request: MobileMoveEntryRequest,
    ) -> Result<VaultSnapshotDto, MobileError> {
        self.session_mut_for_mutation()?.move_entry(request)
    }

    pub(crate) fn create_group(
        &mut self,
        request: MobileCreateGroupRequest,
    ) -> Result<CreatedGroupDto, MobileError> {
        self.session_mut_for_mutation()?.create_group(request)
    }

    pub(crate) fn rename_group(
        &mut self,
        request: MobileRenameGroupRequest,
    ) -> Result<VaultSnapshotDto, MobileError> {
        self.session_mut_for_mutation()?.rename_group(request)
    }

    pub(crate) fn move_group(
        &mut self,
        request: MobileMoveGroupRequest,
    ) -> Result<VaultSnapshotDto, MobileError> {
        self.session_mut_for_mutation()?.move_group(request)
    }

    pub(crate) fn delete_group(
        &mut self,
        group_id: String,
    ) -> Result<VaultSnapshotDto, MobileError> {
        self.session_mut_for_mutation()?.delete_group(group_id)
    }

    pub(crate) fn set_custom_field(
        &mut self,
        request: MobileSetCustomFieldRequest,
    ) -> Result<VaultSnapshotDto, MobileError> {
        self.session_mut_for_mutation()?.set_custom_field(request)
    }

    pub(crate) fn delete_custom_field(
        &mut self,
        entry_id: String,
        name: String,
    ) -> Result<VaultSnapshotDto, MobileError> {
        self.session_mut_for_mutation()?
            .delete_custom_field(entry_id, name)
    }
}
