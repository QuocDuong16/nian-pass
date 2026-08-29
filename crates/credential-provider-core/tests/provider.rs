use std::path::{Path, PathBuf};

use credential_provider_core::{
    CredentialTarget, ProviderError, candidates, credential, password_identities,
};
use kdbx::KdbxDocument;
use vault_core::{FieldProtection, NewEntry, SecretString};

fn fixture_path() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../../fixtures/kdbx/keepassxc-2.7.12-kdbx41.kdbx")
}

fn document() -> KdbxDocument {
    KdbxDocument::open(fixture_path(), "demopass").expect("synthetic fixture must open")
}

fn add_web_entry(document: &mut KdbxDocument) -> vault_core::EntryId {
    let root = document
        .projection()
        .expect("synthetic fixture must project")
        .root()
        .id()
        .clone();
    let password = SecretString::new("PUBLIC-WEB-PASSWORD".to_owned());
    document
        .create_entry(
            &root,
            NewEntry {
                title: "Synthetic web account",
                username: "synthetic-user",
                url: "https://LOGIN.example.com/account",
                password: Some(&password),
            },
        )
        .expect("synthetic entry must be created")
}

#[test]
fn shared_web_matcher_projects_metadata_then_revalidates_final_secret() {
    let mut document = document();
    let entry_id = add_web_entry(&mut document);
    let exact = CredentialTarget::web_domain("login.example.com")
        .unwrap_or_else(|_| panic!("exact target must be valid"));
    let exact_candidates = candidates(&document, &exact)
        .unwrap_or_else(|_| panic!("candidate projection must succeed"));
    let selected = exact_candidates
        .iter()
        .find(|candidate| candidate.entry_id() == entry_id.as_str())
        .unwrap_or_else(|| panic!("created entry must match"));
    assert_eq!(selected.username().visible(), Some("synthetic-user"));

    for target in ["example.com", "evil-example.com"] {
        let target = CredentialTarget::web_domain(target)
            .unwrap_or_else(|_| panic!("test target must be valid"));
        assert!(
            candidates(&document, &target)
                .unwrap_or_else(|_| panic!("candidate projection must succeed"))
                .iter()
                .all(|candidate| candidate.entry_id() != entry_id.as_str())
        );
    }

    let identities = password_identities(&document)
        .unwrap_or_else(|_| panic!("identity projection must succeed"));
    assert!(identities.iter().any(|identity| {
        identity.record_identifier() == entry_id.as_str()
            && identity.service_identifier() == "login.example.com"
            && identity.username() == "synthetic-user"
    }));

    let final_credential = credential(&document, entry_id.as_str(), &exact)
        .unwrap_or_else(|_| panic!("final credential must revalidate"));
    assert_eq!(
        final_credential.username().expose_secret(),
        "synthetic-user"
    );
    assert_eq!(
        final_credential.password().expose_secret(),
        "PUBLIC-WEB-PASSWORD"
    );

    document
        .permanently_delete_entry(&entry_id)
        .expect("synthetic entry must delete");
    assert!(matches!(
        credential(&document, entry_id.as_str(), &exact),
        Err(ProviderError::CredentialUnavailable)
    ));
}

#[test]
fn android_app_matching_reuses_the_same_final_revalidation_core() {
    let mut document = document();
    let entry_id = add_web_entry(&mut document);
    document
        .set_entry_custom_field(
            &entry_id,
            "AndroidApp",
            &SecretString::new("dev.example.login".to_owned()),
            FieldProtection::Protected,
        )
        .expect("synthetic Android association must be set");
    let exact = CredentialTarget::android_app("dev.example.login")
        .unwrap_or_else(|_| panic!("Android target must be valid"));
    assert!(
        candidates(&document, &exact)
            .unwrap_or_else(|_| panic!("Android candidates must succeed"))
            .iter()
            .any(|candidate| candidate.entry_id() == entry_id.as_str())
    );
    let lookalike = CredentialTarget::android_app("dev.example.login.evil")
        .unwrap_or_else(|_| panic!("Android target must be valid"));
    assert!(matches!(
        credential(&document, entry_id.as_str(), &lookalike),
        Err(ProviderError::CredentialUnavailable)
    ));
}
