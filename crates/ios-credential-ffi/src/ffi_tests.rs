use std::{
    fs::{self, File},
    io::{BufWriter, Write},
    path::{Path, PathBuf},
    slice,
};

use kdbx::KdbxDocument;
use sha2::{Digest, Sha256};
use vault_core::{NewEntry, SecretString};

use super::{
    NpByteBuffer, NpSecretResult, NpStatus, ffi_call, np_ios_close_vault,
    np_ios_copy_candidates_json, np_ios_copy_credential, np_ios_copy_identities_json,
    np_ios_free_buffer, np_ios_free_secret_result, np_ios_open_vault,
};

struct TestMirror {
    root: PathBuf,
    relative: &'static str,
    entry_id: String,
    size: u64,
    sha256: [u8; 32],
}

impl TestMirror {
    fn new() -> Self {
        let mut random = [0_u8; 16];
        getrandom::fill(&mut random).expect("test randomness must be available");
        let root = std::env::temp_dir().join(format!("nian-pass-ios-ffi-{random:02x?}"));
        let relative = "AutoFill/vault.kdbx";
        let path = root.join(relative);
        fs::create_dir_all(path.parent().expect("mirror parent must exist"))
            .expect("test mirror directory must be created");

        let fixture = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../../fixtures/kdbx/keepassxc-2.7.12-kdbx41.kdbx");
        let mut document =
            KdbxDocument::open(fixture, "demopass").expect("synthetic fixture must open");
        let root_group = document
            .projection()
            .expect("synthetic fixture must project")
            .root()
            .id()
            .clone();
        let password = SecretString::new("PUBLIC-IOS-PASSWORD".to_owned());
        let entry_id = document
            .create_entry(
                &root_group,
                NewEntry {
                    title: "Synthetic iOS login",
                    username: "ios-user",
                    url: "https://example.com/login",
                    password: Some(&password),
                },
            )
            .expect("synthetic entry must be created")
            .as_str()
            .to_owned();
        let file = File::create(&path).expect("test mirror must be created");
        let mut writer = BufWriter::new(file);
        document
            .save_to_writer(&mut writer, "demopass")
            .expect("test mirror must serialize");
        writer.flush().expect("test mirror must flush");
        let bytes = fs::read(&path).expect("test mirror must be readable");
        let size = u64::try_from(bytes.len()).expect("test mirror size must fit");
        let sha256 = Sha256::digest(bytes).into();
        Self {
            root,
            relative,
            entry_id,
            size,
            sha256,
        }
    }

    fn open(&self, password: &str, sha256: &[u8]) -> (NpStatus, u64) {
        let root = self.root.to_string_lossy();
        let mut handle = 0;
        // SAFETY: every pointer references a live Rust byte slice and output storage.
        let status = unsafe {
            np_ios_open_vault(
                root.as_bytes().as_ptr(),
                root.len(),
                self.relative.as_ptr(),
                self.relative.len(),
                password.as_ptr(),
                password.len(),
                self.size,
                sha256.as_ptr(),
                sha256.len(),
                &mut handle,
            )
        };
        (status, handle)
    }
}

impl Drop for TestMirror {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.root);
    }
}

unsafe fn copied_bytes(buffer: &NpByteBuffer) -> Vec<u8> {
    // SAFETY: tests borrow a live, not-yet-freed FFI allocation.
    unsafe { slice::from_raw_parts(buffer.data, buffer.len) }.to_vec()
}

#[test]
fn open_candidates_credential_close_and_replay_are_fail_closed() {
    let mirror = TestMirror::new();
    let (status, handle) = mirror.open("demopass", &mirror.sha256);
    assert!(matches!(status, NpStatus::Ok));
    assert_ne!(handle, 0);

    let service = "example.com";
    let mut candidates = NpByteBuffer::default();
    // SAFETY: input and output buffers remain live for the call.
    let status = unsafe {
        np_ios_copy_candidates_json(handle, 1, service.as_ptr(), service.len(), &mut candidates)
    };
    assert!(matches!(status, NpStatus::Ok));
    // SAFETY: candidates has not been freed and came from this crate.
    let payload: serde_json::Value = serde_json::from_slice(&unsafe { copied_bytes(&candidates) })
        .expect("candidate JSON must be valid");
    assert!(
        payload
            .as_array()
            .is_some_and(|items| items.iter().any(|item| {
                item.get("entryId").and_then(serde_json::Value::as_str)
                    == Some(mirror.entry_id.as_str())
                    && item.get("password").is_none()
            }))
    );
    // SAFETY: candidates is returned unchanged exactly once.
    assert!(matches!(
        unsafe { np_ios_free_buffer(candidates) },
        NpStatus::Ok
    ));

    let mut identities = NpByteBuffer::default();
    // SAFETY: output storage remains live for the call.
    assert!(matches!(
        unsafe { np_ios_copy_identities_json(handle, &mut identities) },
        NpStatus::Ok
    ));
    // SAFETY: identities has not been freed and came from this crate.
    let identity_payload = unsafe { copied_bytes(&identities) };
    assert!(
        !identity_payload
            .windows(19)
            .any(|window| window == b"PUBLIC-IOS-PASSWORD")
    );
    // SAFETY: identities is returned unchanged exactly once.
    assert!(matches!(
        unsafe { np_ios_free_buffer(identities) },
        NpStatus::Ok
    ));

    let mut credential = NpSecretResult::default();
    // SAFETY: all foreign buffers are valid for the duration of the call.
    assert!(matches!(
        unsafe {
            np_ios_copy_credential(
                handle,
                mirror.entry_id.as_ptr(),
                mirror.entry_id.len(),
                2,
                b"https://example.com/login".as_ptr(),
                b"https://example.com/login".len(),
                &mut credential,
            )
        },
        NpStatus::Ok
    ));
    // SAFETY: both buffers are live allocations returned by this crate.
    assert_eq!(unsafe { copied_bytes(&credential.username) }, b"ios-user");
    // SAFETY: same allocation contract as above.
    assert_eq!(
        unsafe { copied_bytes(&credential.password) },
        b"PUBLIC-IOS-PASSWORD"
    );
    // SAFETY: credential is returned unchanged exactly once.
    assert!(matches!(
        unsafe { np_ios_free_secret_result(credential) },
        NpStatus::Ok
    ));

    assert!(matches!(np_ios_close_vault(handle), NpStatus::Ok));
    assert!(matches!(
        np_ios_close_vault(handle),
        NpStatus::CredentialUnavailable
    ));
    let mut replay = NpByteBuffer::default();
    // SAFETY: buffers are valid; the stale handle is rejected before allocation.
    assert!(matches!(
        unsafe {
            np_ios_copy_candidates_json(handle, 1, service.as_ptr(), service.len(), &mut replay)
        },
        NpStatus::CredentialUnavailable
    ));
    assert!(replay.data.is_null());
}

#[test]
fn wrong_password_and_generation_mismatch_never_create_a_session() {
    let mirror = TestMirror::new();
    let (status, handle) = mirror.open("wrong", &mirror.sha256);
    assert!(matches!(status, NpStatus::UnlockFailed));
    assert_eq!(handle, 0);

    let mut wrong_generation = mirror.sha256;
    wrong_generation[0] ^= 0xff;
    let (status, handle) = mirror.open("demopass", &wrong_generation);
    assert!(matches!(status, NpStatus::AutofillUnavailable));
    assert_eq!(handle, 0);
}

#[test]
fn malformed_boundaries_and_panics_map_to_stable_status() {
    assert!(matches!(np_ios_close_vault(0), NpStatus::InvalidRequest));
    let malformed = NpByteBuffer {
        data: std::ptr::null_mut(),
        len: 1,
        capacity: 1,
    };
    // SAFETY: this null buffer is rejected before allocation reconstruction.
    assert!(matches!(
        unsafe { np_ios_free_buffer(malformed) },
        NpStatus::InvalidRequest
    ));
    assert!(matches!(
        ffi_call(|| panic!("synthetic contained panic")),
        NpStatus::Internal
    ));
}
