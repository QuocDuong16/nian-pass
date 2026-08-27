use serde_json::{Value, from_str, json, to_value};

use crate::dto::{
    CreatedEntryDto, CreatedGroupDto, CustomFieldSummaryDto, EntryDetailDto, EntrySummaryDto,
    FieldProtectionDto, GroupDto, MobileSelectedVaultDto, SummaryTextDto, VaultSnapshotDto,
};

use super::{MobileError, errors::MobileErrorDto};

#[test]
fn committed_mobile_contract_matches_rust_serialization() {
    let contract: Value = from_str(include_str!("../../../contracts/mobile-contract.json"))
        .expect("mobile contract should be valid JSON");
    let selected = MobileSelectedVaultDto {
        file_name: "example.kdbx".to_owned(),
        writable: true,
    };
    let snapshot = VaultSnapshotDto {
        dirty: false,
        root_group_id: "group-root".to_owned(),
        groups: vec![GroupDto {
            id: "group-root".to_owned(),
            name: "Root".to_owned(),
            child_group_ids: Vec::new(),
            entry_ids: vec!["entry-example".to_owned()],
        }],
        entries: vec![EntrySummaryDto {
            id: "entry-example".to_owned(),
            group_id: "group-root".to_owned(),
            title: SummaryTextDto::Visible {
                value: "Example".to_owned(),
            },
            username: SummaryTextDto::Missing,
            url: SummaryTextDto::Protected,
            password_present: true,
            notes_present: true,
            tags: vec!["synthetic".to_owned()],
        }],
    };
    let detail = EntryDetailDto {
        id: "entry-example".to_owned(),
        title: SummaryTextDto::Visible {
            value: "Example".to_owned(),
        },
        username: SummaryTextDto::Missing,
        url: SummaryTextDto::Protected,
        password_present: true,
        notes_present: true,
        custom_fields: vec![CustomFieldSummaryDto {
            name: "Account type".to_owned(),
            protection: FieldProtectionDto::Unprotected,
        }],
    };
    let dirty_snapshot = VaultSnapshotDto {
        dirty: true,
        ..snapshot.clone()
    };
    let errors = [
        MobileError::PickerFailed,
        MobileError::NoVaultSelected,
        MobileError::UnlockFailed,
        MobileError::UnsupportedVault,
        MobileError::EntryNotFound,
        MobileError::GroupNotFound,
        MobileError::InvalidRequest,
        MobileError::Conflict,
        MobileError::SecretUnavailable,
        MobileError::Locked,
        MobileError::UnsavedChanges,
        MobileError::Busy,
        MobileError::SaveFailed,
        MobileError::SaveAuthenticationFailed,
        MobileError::ExternalChange,
        MobileError::SaveUncertain,
        MobileError::PersistenceUnsupported,
        MobileError::RecoveryRequired,
        MobileError::ReloadFailed,
        MobileError::ReloadAuthenticationFailed,
        MobileError::Internal,
    ]
    .into_iter()
    .map(|error| {
        to_value(MobileErrorDto::from(error)).expect("error should serialize")["code"].clone()
    })
    .collect::<Vec<_>>();

    assert_eq!(
        to_value(selected).expect("selected should serialize"),
        contract["selectedVault"]
    );
    assert_eq!(
        to_value(snapshot).expect("snapshot should serialize"),
        contract["snapshot"]
    );
    assert_eq!(
        to_value(&dirty_snapshot).expect("dirty snapshot should serialize"),
        contract["dirtySnapshot"]
    );
    assert_eq!(
        to_value(CreatedEntryDto {
            created_entry_id: "entry-example".to_owned(),
            snapshot: dirty_snapshot.clone(),
        })
        .expect("created entry should serialize"),
        contract["createdEntry"]
    );
    assert_eq!(
        to_value(CreatedGroupDto {
            created_group_id: "group-root".to_owned(),
            snapshot: dirty_snapshot,
        })
        .expect("created group should serialize"),
        contract["createdGroup"]
    );
    assert_eq!(
        to_value(detail).expect("detail should serialize"),
        contract["entryDetail"]
    );
    assert_eq!(json!(errors), contract["errors"]);
}
