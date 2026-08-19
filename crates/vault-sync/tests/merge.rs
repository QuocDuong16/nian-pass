use std::{
    io::{Cursor, Write},
    path::PathBuf,
    process::{Command, Stdio},
    sync::atomic::{AtomicU64, Ordering},
    time::{SystemTime, UNIX_EPOCH},
};

use kdbx::KdbxDocument;
use vault_core::{EntryId, FieldProtection, GroupId, NewEntry, SecretString};
use vault_sync::{MergeConflictKind, MergeError, MergeOutcome, merge};

const PASSWORD: &str = "demopass";
static TEMP_SEQUENCE: AtomicU64 = AtomicU64::new(0);

struct TestTempDir(PathBuf);

impl TestTempDir {
    fn create() -> Self {
        let sequence = TEMP_SEQUENCE.fetch_add(1, Ordering::Relaxed);
        let timestamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("test clock should follow the Unix epoch")
            .as_nanos();
        let path = std::env::temp_dir().join(format!(
            "nian-pass-sync-{}-{timestamp}-{sequence}",
            std::process::id()
        ));
        std::fs::create_dir(&path).expect("test directory should be created");
        Self(path)
    }

    fn join(&self, name: &str) -> PathBuf {
        self.0.join(name)
    }
}

impl Drop for TestTempDir {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

fn fixture_path() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../fixtures/kdbx/keepassxc-2.7.12-kdbx41.kdbx")
}

fn document() -> KdbxDocument {
    KdbxDocument::open(fixture_path(), PASSWORD).expect("public fixture should open")
}

fn version_fixture(name: &str) -> KdbxDocument {
    KdbxDocument::open(
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../../fixtures/kdbx")
            .join(name),
        PASSWORD,
    )
    .expect("public fixture should open")
}

fn triplet_from_bytes(bytes: &[u8]) -> (KdbxDocument, KdbxDocument, KdbxDocument) {
    let open = || {
        KdbxDocument::open_reader(&mut Cursor::new(bytes), PASSWORD)
            .expect("test generation should reopen")
    };
    (open(), open(), open())
}

fn fixture_triplet() -> (KdbxDocument, KdbxDocument, KdbxDocument) {
    let bytes = std::fs::read(fixture_path()).expect("public fixture should be readable");
    triplet_from_bytes(&bytes)
}

fn bytes(document: &KdbxDocument) -> Vec<u8> {
    let mut bytes = Vec::new();
    document
        .save_to_writer(&mut bytes, PASSWORD)
        .expect("test document should serialize");
    bytes
}

fn first_entry(document: &KdbxDocument) -> EntryId {
    document
        .projection()
        .expect("fixture should project")
        .root()
        .entries()
        .first()
        .expect("fixture should have a root entry")
        .id()
        .clone()
}

fn root_group(document: &KdbxDocument) -> GroupId {
    document
        .projection()
        .expect("fixture should project")
        .root()
        .id()
        .clone()
}

fn first_child_group(document: &KdbxDocument) -> GroupId {
    document
        .projection()
        .expect("fixture should project")
        .root()
        .groups()
        .first()
        .expect("fixture should have a child group")
        .id()
        .clone()
}

fn merged(outcome: MergeOutcome) -> KdbxDocument {
    match outcome {
        MergeOutcome::Merged(document) => document.into_document(),
        _ => panic!("expected an automatically merged document"),
    }
}

fn selected_local(outcome: MergeOutcome, local: KdbxDocument) -> KdbxDocument {
    match outcome {
        MergeOutcome::FastForwardLocal | MergeOutcome::Equivalent => local,
        MergeOutcome::Merged(document) => document.into_document(),
        _ => panic!("expected local-compatible merge result"),
    }
}

fn roundtrip(document: &KdbxDocument) {
    let serialized = bytes(document);
    let reopened = KdbxDocument::open_reader(&mut Cursor::new(serialized), PASSWORD)
        .expect("merged document should reopen");
    document
        .verify_semantic_equivalence(&reopened)
        .expect("merged semantics should roundtrip exactly");
}

#[test]
fn fast_forwards_each_unchanged_side() {
    let (base, local, mut remote) = fixture_triplet();
    let id = first_entry(&remote);
    remote
        .set_entry_title(&id, "remote generation")
        .expect("mutation should succeed");
    assert!(matches!(
        merge(&base, &local, &remote).expect("merge should analyze"),
        MergeOutcome::FastForwardRemote
    ));

    let (base, mut local, remote) = fixture_triplet();
    let id = first_entry(&local);
    local
        .set_entry_title(&id, "local generation")
        .expect("mutation should succeed");
    assert!(matches!(
        merge(&base, &local, &remote).expect("merge should analyze"),
        MergeOutcome::FastForwardLocal
    ));
}

#[test]
fn incompatible_or_unwritable_divergent_versions_are_rejected() {
    let base41 = document();
    let local40 = version_fixture("keepassxc-upstream-kdbx40-argon2d-aes.kdbx");
    let remote40 = version_fixture("keepassxc-upstream-kdbx40-argon2d-aes.kdbx");
    assert!(matches!(
        merge(&base41, &local40, &remote40),
        Err(MergeError::VersionMismatch)
    ));

    let base40 = version_fixture("keepassxc-upstream-kdbx40-argon2d-aes.kdbx");
    let base40_bytes = {
        // KDBX 4.0 cannot be written by Nian Pass; open three independent
        // copies directly from the immutable fixture instead.
        std::fs::read(
            PathBuf::from(env!("CARGO_MANIFEST_DIR"))
                .join("../../fixtures/kdbx/keepassxc-upstream-kdbx40-argon2d-aes.kdbx"),
        )
        .expect("fixture should be readable")
    };
    let (_, mut local40, mut remote40) = triplet_from_bytes(&base40_bytes);
    let id = first_entry(&base40);
    local40
        .set_entry_username(&id, "local")
        .expect("in-memory edit should succeed");
    assert!(matches!(
        merge(&base40, &local40, &remote40),
        Ok(MergeOutcome::FastForwardLocal)
    ));
    remote40
        .set_entry_title(&id, "remote")
        .expect("in-memory edit should succeed");
    assert!(matches!(
        merge(&base40, &local40, &remote40),
        Err(MergeError::UnsupportedVersion)
    ));
    // Keep the binding semantically immutable after analysis.
    assert!(!base40.has_changes_since(base40.revision()));
}

#[test]
fn identical_changes_are_equivalent() {
    let (base, mut local, mut remote) = fixture_triplet();
    let id = first_entry(&base);
    local
        .set_entry_title(&id, "same change")
        .expect("local mutation should succeed");
    remote
        .set_entry_title(&id, "same change")
        .expect("remote mutation should succeed");
    assert!(matches!(
        merge(&base, &local, &remote).expect("merge should analyze"),
        MergeOutcome::Equivalent
    ));
}

#[test]
fn independent_fields_merge_and_roundtrip() {
    let (base, mut local, mut remote) = fixture_triplet();
    let id = first_entry(&base);
    local
        .set_entry_username(&id, "local-user")
        .expect("username mutation should succeed");
    let remote_password = SecretString::new("remote-password".to_owned());
    remote
        .set_entry_password(&id, &remote_password)
        .expect("password mutation should succeed");

    let outcome = merge(&base, &local, &remote).expect("merge should analyze");
    let merged = selected_local(outcome, local);
    let projection = merged.projection().expect("merged document should project");
    assert_eq!(
        projection
            .find_entry(&id)
            .expect("entry should remain")
            .username()
            .visible(),
        Some("local-user")
    );
    assert_eq!(
        merged
            .entry_password(&id)
            .expect("password should be readable")
            .expect("password should exist")
            .expose_secret(),
        "remote-password"
    );
    roundtrip(&merged);
}

#[test]
fn divergent_password_edit_is_a_value_free_conflict() {
    let (base, mut local, mut remote) = fixture_triplet();
    let id = first_entry(&base);
    local
        .set_entry_password(&id, &SecretString::new("local-secret".to_owned()))
        .expect("local mutation should succeed");
    remote
        .set_entry_password(&id, &SecretString::new("remote-secret".to_owned()))
        .expect("remote mutation should succeed");

    let MergeOutcome::Conflicted(conflicts) =
        merge(&base, &local, &remote).expect("merge should analyze")
    else {
        panic!("same-field divergence must conflict");
    };
    assert!(conflicts.iter().any(|conflict| {
        conflict.kind() == MergeConflictKind::FieldEdit
            && conflict
                .field()
                .and_then(|field| field.name())
                .is_some_and(|name| name == "Password")
    }));
}

#[test]
fn deletion_of_an_unchanged_entry_is_preserved() {
    let (base, mut local, remote) = fixture_triplet();
    let id = first_entry(&base);
    local
        .permanently_delete_entry(&id)
        .expect("deletion should succeed");
    let outcome = merge(&base, &local, &remote).expect("merge should analyze");
    let merged = selected_local(outcome, local);
    assert!(
        merged
            .projection()
            .expect("merged document should project")
            .find_entry(&id)
            .is_none()
    );
    roundtrip(&merged);
}

#[test]
fn delete_vs_modify_conflicts() {
    let (base, mut local, mut remote) = fixture_triplet();
    let id = first_entry(&base);
    local
        .permanently_delete_entry(&id)
        .expect("deletion should succeed");
    remote
        .set_entry_title(&id, "modified remotely")
        .expect("mutation should succeed");
    let MergeOutcome::Conflicted(conflicts) =
        merge(&base, &local, &remote).expect("merge should analyze")
    else {
        panic!("delete versus modify must conflict");
    };
    assert!(
        conflicts
            .iter()
            .any(|conflict| conflict.kind() == MergeConflictKind::DeleteVsModify)
    );
}

#[test]
fn concurrent_delete_merges_once() {
    let (base, mut local, mut remote) = fixture_triplet();
    let id = first_entry(&base);
    local
        .permanently_delete_entry(&id)
        .expect("local deletion should succeed");
    remote
        .permanently_delete_entry(&id)
        .expect("remote deletion should succeed");
    let outcome = merge(&base, &local, &remote).expect("merge should analyze");
    let merged = selected_local(outcome, local);
    assert!(
        merged
            .projection()
            .expect("merged document should project")
            .find_entry(&id)
            .is_none()
    );
    roundtrip(&merged);
}

#[test]
fn move_and_field_edit_merge_independently() {
    let (base, mut local, mut remote) = fixture_triplet();
    let id = first_entry(&base);
    let destination = first_child_group(&base);
    local
        .move_entry(&id, &destination)
        .expect("move should succeed");
    remote
        .set_entry_title(&id, "remote title")
        .expect("field change should succeed");
    let merged = merged(merge(&base, &local, &remote).expect("merge should analyze"));
    let projection = merged.projection().expect("merged document should project");
    let destination_group = projection
        .find_group(&destination)
        .expect("destination should remain");
    assert!(
        destination_group
            .entries()
            .iter()
            .any(|entry| { entry.id() == &id && entry.title().visible() == Some("remote title") })
    );
    roundtrip(&merged);
}

#[test]
fn move_vs_move_conflicts() {
    let mut prepared = document();
    let root = root_group(&prepared);
    let second = prepared
        .create_group(&root, "second destination")
        .expect("group creation should succeed");
    let prepared = bytes(&prepared);
    let (base, mut local, mut remote) = triplet_from_bytes(&prepared);
    let id = first_entry(&base);
    let first = first_child_group(&base);
    local.move_entry(&id, &first).expect("move should succeed");
    remote
        .move_entry(&id, &second)
        .expect("move should succeed");
    let MergeOutcome::Conflicted(conflicts) =
        merge(&base, &local, &remote).expect("merge should analyze")
    else {
        panic!("divergent moves must conflict");
    };
    assert!(
        conflicts
            .iter()
            .any(|conflict| conflict.kind() == MergeConflictKind::MoveVsMove)
    );
}

#[test]
fn independent_custom_fields_merge_and_protection_conflicts() {
    let (base, mut local, mut remote) = fixture_triplet();
    let id = first_entry(&base);
    local
        .set_entry_custom_field(
            &id,
            "LocalField",
            &SecretString::new("local-value".to_owned()),
            FieldProtection::Protected,
        )
        .expect("local custom field should succeed");
    remote
        .set_entry_custom_field(
            &id,
            "RemoteField",
            &SecretString::new("remote-value".to_owned()),
            FieldProtection::Unprotected,
        )
        .expect("remote custom field should succeed");
    let merged = merged(merge(&base, &local, &remote).expect("merge should analyze"));
    assert_eq!(
        merged
            .entry_custom_field(&id, "LocalField")
            .expect("field should read")
            .expect("field should exist")
            .expose_secret(),
        "local-value"
    );
    assert_eq!(
        merged
            .entry_custom_field(&id, "RemoteField")
            .expect("field should read")
            .expect("field should exist")
            .expose_secret(),
        "remote-value"
    );
    roundtrip(&merged);

    let (base, mut local, mut remote) = fixture_triplet();
    let id = first_entry(&base);
    local
        .set_entry_custom_field(
            &id,
            "ProtectionField",
            &SecretString::new("same".to_owned()),
            FieldProtection::Protected,
        )
        .expect("local field should succeed");
    remote
        .set_entry_custom_field(
            &id,
            "ProtectionField",
            &SecretString::new("same".to_owned()),
            FieldProtection::Unprotected,
        )
        .expect("remote field should succeed");
    assert!(matches!(
        merge(&base, &local, &remote).expect("merge should analyze"),
        MergeOutcome::Conflicted(_)
    ));

    let (base, mut local, mut remote) = fixture_triplet();
    let id = first_entry(&base);
    local
        .set_entry_custom_field(
            &id,
            "DivergentField",
            &SecretString::new("local".to_owned()),
            FieldProtection::Protected,
        )
        .expect("local field should succeed");
    remote
        .set_entry_custom_field(
            &id,
            "DivergentField",
            &SecretString::new("remote".to_owned()),
            FieldProtection::Protected,
        )
        .expect("remote field should succeed");
    assert!(matches!(
        merge(&base, &local, &remote).expect("merge should analyze"),
        MergeOutcome::Conflicted(_)
    ));
}

#[test]
fn concurrent_independent_entry_creation_preserves_both() {
    let (base, mut local, mut remote) = fixture_triplet();
    let root = root_group(&base);
    let local_id = local
        .create_entry(
            &root,
            NewEntry {
                title: "local addition",
                username: "",
                url: "",
                password: None,
            },
        )
        .expect("local entry should be created");
    let remote_id = remote
        .create_entry(
            &root,
            NewEntry {
                title: "remote addition",
                username: "",
                url: "",
                password: None,
            },
        )
        .expect("remote entry should be created");
    let merged = merged(merge(&base, &local, &remote).expect("merge should analyze"));
    let projection = merged.projection().expect("merged document should project");
    assert!(projection.find_entry(&local_id).is_some());
    assert!(projection.find_entry(&remote_id).is_some());
    roundtrip(&merged);
}

#[test]
fn group_rename_and_child_edit_merge() {
    let mut prepared = document();
    let group = first_child_group(&prepared);
    prepared
        .create_entry(
            &group,
            NewEntry {
                title: "child",
                username: "",
                url: "",
                password: None,
            },
        )
        .expect("child entry should be created");
    let prepared = bytes(&prepared);
    let (base, mut local, mut remote) = triplet_from_bytes(&prepared);
    let group = first_child_group(&base);
    let child_entry = base
        .projection()
        .expect("fixture should project")
        .find_group(&group)
        .expect("group should exist")
        .entries()
        .first()
        .expect("child group should contain an entry")
        .id()
        .clone();
    local
        .rename_group(&group, "renamed locally")
        .expect("rename should succeed");
    remote
        .set_entry_title(&child_entry, "edited remotely")
        .expect("entry edit should succeed");
    let merged = merged(merge(&base, &local, &remote).expect("merge should analyze"));
    let projection = merged.projection().expect("merged document should project");
    let group = projection.find_group(&group).expect("group should remain");
    assert_eq!(group.name(), "renamed locally");
    assert_eq!(
        group
            .entries()
            .first()
            .expect("child should remain")
            .title()
            .visible(),
        Some("edited remotely")
    );
    roundtrip(&merged);
}

#[test]
fn group_move_and_independent_rename_merge() {
    let mut prepared = document();
    let root = root_group(&prepared);
    let first = prepared
        .create_group(&root, "old name")
        .expect("group should be created");
    let second = prepared
        .create_group(&root, "destination")
        .expect("group should be created");
    let prepared = bytes(&prepared);
    let (base, mut local, mut remote) = triplet_from_bytes(&prepared);
    local
        .move_group(&first, &second)
        .expect("group move should succeed");
    remote
        .rename_group(&first, "new name")
        .expect("group rename should succeed");
    let merged = merged(merge(&base, &local, &remote).expect("merge should analyze"));
    let projection = merged.projection().expect("merged document should project");
    let destination = projection
        .find_group(&second)
        .expect("destination should remain");
    let moved = destination
        .groups()
        .iter()
        .find(|group| group.id() == &first)
        .expect("moved group should be under destination");
    assert_eq!(moved.name(), "new name");
    roundtrip(&merged);
}

#[test]
fn group_delete_vs_descendant_edit_conflicts() {
    let mut prepared = document();
    let group = first_child_group(&prepared);
    prepared
        .create_entry(
            &group,
            NewEntry {
                title: "child",
                username: "",
                url: "",
                password: None,
            },
        )
        .expect("child entry should be created");
    let prepared = bytes(&prepared);
    let (base, mut local, mut remote) = triplet_from_bytes(&prepared);
    let group = first_child_group(&base);
    let child = base
        .projection()
        .expect("fixture should project")
        .find_group(&group)
        .expect("group should exist")
        .entries()
        .first()
        .expect("group should contain an entry")
        .id()
        .clone();
    local
        .permanently_delete_group(&group)
        .expect("group deletion should succeed");
    remote
        .set_entry_title(&child, "remote descendant edit")
        .expect("descendant edit should succeed");
    assert!(matches!(
        merge(&base, &local, &remote).expect("merge should analyze"),
        MergeOutcome::Conflicted(_)
    ));
}

#[test]
fn group_delete_vs_new_descendant_conflicts() {
    let (base, mut local, mut remote) = fixture_triplet();
    let group = first_child_group(&base);
    local
        .permanently_delete_group(&group)
        .expect("group deletion should succeed");
    remote
        .create_entry(
            &group,
            NewEntry {
                title: "new remote child",
                username: "",
                url: "",
                password: None,
            },
        )
        .expect("remote child should be created");
    let MergeOutcome::Conflicted(conflicts) =
        merge(&base, &local, &remote).expect("merge should analyze")
    else {
        panic!("deleted group versus new child must conflict");
    };
    assert!(conflicts.iter().any(|conflict| {
        matches!(
            conflict.kind(),
            MergeConflictKind::DeleteVsModify | MergeConflictKind::GroupDeleteVsDescendantChange
        )
    }));
}

#[test]
fn concurrent_group_moves_that_form_a_cycle_conflict() {
    let mut prepared = document();
    let root = root_group(&prepared);
    let first = prepared
        .create_group(&root, "first")
        .expect("group should be created");
    let second = prepared
        .create_group(&root, "second")
        .expect("group should be created");
    let prepared = bytes(&prepared);
    let (base, mut local, mut remote) = triplet_from_bytes(&prepared);
    local
        .move_group(&first, &second)
        .expect("local move should be valid alone");
    remote
        .move_group(&second, &first)
        .expect("remote move should be valid alone");
    let MergeOutcome::Conflicted(conflicts) =
        merge(&base, &local, &remote).expect("merge should analyze")
    else {
        panic!("combined cycle must conflict");
    };
    assert!(conflicts.iter().any(|conflict| {
        matches!(
            conflict.kind(),
            MergeConflictKind::HierarchyCycle | MergeConflictKind::MoveVsMove
        )
    }));
}

#[test]
#[ignore = "requires a released keepassxc-cli; run scripts/test-keepassxc-compat.sh"]
fn external_keepassxc_opens_merged_output() {
    if Command::new("keepassxc-cli")
        .arg("--version")
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .is_err()
    {
        if std::env::var_os("NIAN_PASS_REQUIRE_KEEPASSXC").is_some() {
            panic!("keepassxc-cli is required but was not found");
        }
        return;
    }

    let (base, mut local, mut remote) = fixture_triplet();
    let id = first_entry(&base);
    local
        .set_entry_username(&id, "merged-local-user")
        .expect("local edit should succeed");
    remote
        .set_entry_title(&id, "Merged remote title")
        .expect("remote edit should succeed");
    let merged = merged(merge(&base, &local, &remote).expect("merge should analyze"));
    let temp = TestTempDir::create();
    let output = temp.join("merged-output.kdbx");
    let mut output_file = std::fs::File::create(&output).expect("test output should be created");
    merged
        .save_to_writer(&mut output_file, PASSWORD)
        .expect("merged output should serialize");
    output_file
        .sync_all()
        .expect("test output should be flushed");
    drop(output_file);

    let mut child = Command::new("keepassxc-cli")
        .arg("db-info")
        .arg("-q")
        .arg(&output)
        .stdin(Stdio::piped())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .expect("KeePassXC should start");
    child
        .stdin
        .as_mut()
        .expect("stdin should be piped")
        .write_all(format!("{PASSWORD}\n").as_bytes())
        .expect("synthetic fixture password should be written through stdin");
    assert!(
        child.wait().expect("KeePassXC should finish").success(),
        "KeePassXC should open the merged output"
    );
}
