//! Audited C ABI for the native iOS Credential Provider Extension.
//!
//! Business logic and KDBX matching live in `credential-provider-core`. Raw
//! pointer conversion and foreign allocation ownership are isolated in `ffi`.

mod ffi;
mod session;

pub use ffi::{
    NpByteBuffer, NpSecretResult, NpStatus, np_ios_close_vault, np_ios_copy_candidates_json,
    np_ios_copy_credential, np_ios_copy_identities_json, np_ios_free_buffer,
    np_ios_free_secret_result, np_ios_open_vault,
};
