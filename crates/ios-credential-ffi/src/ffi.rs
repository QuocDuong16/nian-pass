//! The sole raw-pointer boundary in Nian Pass.
//!
//! SAFETY invariants are documented at every conversion. No KDBX parsing,
//! credential matching, or other business policy is implemented in this module.

use std::{path::PathBuf, ptr, slice, str};

use credential_provider_core::CredentialTarget;
use zeroize::{Zeroize, Zeroizing};

use crate::session::{self, EncryptedGeneration, SessionError};

const MAX_PATH_BYTES: usize = 16 * 1024;
const MAX_PASSWORD_BYTES: usize = 1024 * 1024;
const MAX_IDENTIFIER_BYTES: usize = 64 * 1024;
const SHA256_BYTES: usize = 32;

#[repr(i32)]
#[derive(Clone, Copy, Eq, PartialEq)]
pub enum NpStatus {
    Ok = 0,
    InvalidRequest = 1,
    AutofillUnavailable = 2,
    UnlockFailed = 3,
    CredentialUnavailable = 4,
    Internal = 255,
}

#[repr(C)]
pub struct NpByteBuffer {
    pub data: *mut u8,
    pub len: usize,
    pub capacity: usize,
}

impl Default for NpByteBuffer {
    fn default() -> Self {
        Self {
            data: ptr::null_mut(),
            len: 0,
            capacity: 0,
        }
    }
}

#[repr(C)]
#[derive(Default)]
pub struct NpSecretResult {
    pub username: NpByteBuffer,
    pub password: NpByteBuffer,
}

#[unsafe(no_mangle)]
/// Opens one verified encrypted App Group mirror and returns an opaque session.
///
/// # Safety
///
/// Every input pointer must reference its stated initialized byte length for the
/// duration of the call. `out_handle` must reference writable `u64` storage.
pub unsafe extern "C" fn np_ios_open_vault(
    app_group_root_ptr: *const u8,
    app_group_root_len: usize,
    mirror_relative_name_ptr: *const u8,
    mirror_relative_name_len: usize,
    password_ptr: *const u8,
    password_len: usize,
    expected_size: u64,
    expected_sha256_ptr: *const u8,
    expected_sha256_len: usize,
    out_handle: *mut u64,
) -> NpStatus {
    ffi_call(|| {
        if out_handle.is_null() {
            return Err(SessionError::InvalidRequest);
        }
        // SAFETY: the non-null out pointer is required to reference writable u64 storage.
        unsafe { out_handle.write(0) };
        // SAFETY: Swift owns each immutable byte range for the duration of this call.
        let root = unsafe { utf8_input(app_group_root_ptr, app_group_root_len, MAX_PATH_BYTES)? };
        // SAFETY: same foreign-buffer contract as above.
        let relative = unsafe {
            utf8_input(
                mirror_relative_name_ptr,
                mirror_relative_name_len,
                MAX_PATH_BYTES,
            )?
        };
        // SAFETY: password bytes remain owned by Swift and are copied immediately.
        let password = unsafe { bytes_input(password_ptr, password_len, MAX_PASSWORD_BYTES)? };
        // SAFETY: the digest range must contain exactly 32 initialized bytes.
        let digest =
            unsafe { bytes_input(expected_sha256_ptr, expected_sha256_len, SHA256_BYTES)? };
        if digest.len() != SHA256_BYTES {
            return Err(SessionError::InvalidRequest);
        }
        let mut sha256 = [0_u8; SHA256_BYTES];
        sha256.copy_from_slice(digest);
        let password = Zeroizing::new(
            String::from_utf8(password.to_vec()).map_err(|_| SessionError::InvalidRequest)?,
        );
        let handle = session::open(
            PathBuf::from(root),
            PathBuf::from(relative),
            password,
            EncryptedGeneration {
                size: expected_size,
                sha256,
            },
        )?;
        // SAFETY: out_handle was validated above and remains exclusively borrowed.
        unsafe { out_handle.write(handle) };
        Ok(())
    })
}

#[unsafe(no_mangle)]
pub extern "C" fn np_ios_close_vault(handle: u64) -> NpStatus {
    ffi_call(|| session::close(handle))
}

#[unsafe(no_mangle)]
/// Copies a secret-free candidate array as strict JSON.
///
/// # Safety
///
/// The service pointer must reference its stated initialized byte length and
/// `out_json` must reference writable `NpByteBuffer` storage.
pub unsafe extern "C" fn np_ios_copy_candidates_json(
    handle: u64,
    service_kind: u32,
    service_ptr: *const u8,
    service_len: usize,
    out_json: *mut NpByteBuffer,
) -> NpStatus {
    ffi_call(|| {
        // SAFETY: output storage is foreign-owned and initialized before any fallible work.
        unsafe { initialize_buffer_output(out_json)? };
        // SAFETY: Swift owns the immutable service bytes for this call.
        let service = unsafe { utf8_input(service_ptr, service_len, MAX_IDENTIFIER_BYTES)? };
        let target = service_target(service_kind, service)?;
        let bytes = session::candidates_json(handle, &target)?;
        // SAFETY: output was checked non-null and is written exactly once.
        unsafe { out_json.write(leak_buffer(bytes)) };
        Ok(())
    })
}

#[unsafe(no_mangle)]
/// Copies the secret-free system identity projection as strict JSON.
///
/// # Safety
///
/// `out_json` must reference writable `NpByteBuffer` storage.
pub unsafe extern "C" fn np_ios_copy_identities_json(
    handle: u64,
    out_json: *mut NpByteBuffer,
) -> NpStatus {
    ffi_call(|| {
        // SAFETY: output storage is foreign-owned and initialized before any fallible work.
        unsafe { initialize_buffer_output(out_json)? };
        let bytes = session::identities_json(handle)?;
        // SAFETY: output was checked non-null and is written exactly once.
        unsafe { out_json.write(leak_buffer(bytes)) };
        Ok(())
    })
}

#[unsafe(no_mangle)]
/// Copies one final, revalidated username/password result.
///
/// # Safety
///
/// Both input pointers must reference their stated initialized byte lengths and
/// `out_secret` must reference writable `NpSecretResult` storage.
pub unsafe extern "C" fn np_ios_copy_credential(
    handle: u64,
    entry_id_ptr: *const u8,
    entry_id_len: usize,
    service_kind: u32,
    service_ptr: *const u8,
    service_len: usize,
    out_secret: *mut NpSecretResult,
) -> NpStatus {
    ffi_call(|| {
        if out_secret.is_null() {
            return Err(SessionError::InvalidRequest);
        }
        // SAFETY: the output pointer references writable result storage.
        unsafe { out_secret.write(NpSecretResult::default()) };
        // SAFETY: Swift owns both immutable identifier ranges for this call.
        let entry_id = unsafe { utf8_input(entry_id_ptr, entry_id_len, MAX_IDENTIFIER_BYTES)? };
        // SAFETY: same foreign-buffer contract as above.
        let service = unsafe { utf8_input(service_ptr, service_len, MAX_IDENTIFIER_BYTES)? };
        let target = service_target(service_kind, service)?;
        let credential = session::credential(handle, entry_id, &target)?;
        let result = NpSecretResult {
            username: leak_buffer(credential.username.to_vec()),
            password: leak_buffer(credential.password.to_vec()),
        };
        // SAFETY: output was validated and has not been aliased by Rust.
        unsafe { out_secret.write(result) };
        Ok(())
    })
}

#[unsafe(no_mangle)]
/// Zeroizes and releases one buffer allocated by this crate.
///
/// # Safety
///
/// `buffer` must be an unchanged, not-yet-freed value returned by this crate.
pub unsafe extern "C" fn np_ios_free_buffer(buffer: NpByteBuffer) -> NpStatus {
    ffi_call(|| {
        // SAFETY: the buffer must be an unchanged value returned by this crate.
        unsafe { reclaim_buffer(buffer)? };
        Ok(())
    })
}

#[unsafe(no_mangle)]
/// Zeroizes and releases a final credential allocated by this crate.
///
/// # Safety
///
/// `result` must be an unchanged, not-yet-freed value returned by this crate.
pub unsafe extern "C" fn np_ios_free_secret_result(result: NpSecretResult) -> NpStatus {
    ffi_call(|| {
        // SAFETY: both buffers must be unchanged values returned in one result.
        unsafe { reclaim_buffer(result.username)? };
        // SAFETY: same allocation ownership contract as above.
        unsafe { reclaim_buffer(result.password)? };
        Ok(())
    })
}

fn ffi_call(call: impl FnOnce() -> Result<(), SessionError>) -> NpStatus {
    match std::panic::catch_unwind(std::panic::AssertUnwindSafe(call)) {
        Ok(Ok(())) => NpStatus::Ok,
        Ok(Err(error)) => map_error(error),
        Err(_) => NpStatus::Internal,
    }
}

fn map_error(error: SessionError) -> NpStatus {
    match error {
        SessionError::InvalidRequest => NpStatus::InvalidRequest,
        SessionError::AutofillUnavailable => NpStatus::AutofillUnavailable,
        SessionError::UnlockFailed => NpStatus::UnlockFailed,
        SessionError::CredentialUnavailable => NpStatus::CredentialUnavailable,
        SessionError::Internal => NpStatus::Internal,
    }
}

fn service_target(kind: u32, value: &str) -> Result<CredentialTarget, SessionError> {
    match kind {
        1 => CredentialTarget::web_domain(value),
        2 => CredentialTarget::ios_url(value),
        _ => return Err(SessionError::InvalidRequest),
    }
    .map_err(|_| SessionError::InvalidRequest)
}

fn leak_buffer(mut bytes: Vec<u8>) -> NpByteBuffer {
    let result = NpByteBuffer {
        data: bytes.as_mut_ptr(),
        len: bytes.len(),
        capacity: bytes.capacity(),
    };
    std::mem::forget(bytes);
    result
}

unsafe fn initialize_buffer_output(output: *mut NpByteBuffer) -> Result<(), SessionError> {
    if output.is_null() {
        return Err(SessionError::InvalidRequest);
    }
    // SAFETY: caller promises output references writable NpByteBuffer storage.
    unsafe { output.write(NpByteBuffer::default()) };
    Ok(())
}

unsafe fn bytes_input<'a>(
    data: *const u8,
    len: usize,
    maximum: usize,
) -> Result<&'a [u8], SessionError> {
    if len > maximum || (data.is_null() && len != 0) {
        return Err(SessionError::InvalidRequest);
    }
    if len == 0 {
        return Ok(&[]);
    }
    // SAFETY: caller promises `data..data+len` is initialized and readable for this call.
    Ok(unsafe { slice::from_raw_parts(data, len) })
}

unsafe fn utf8_input<'a>(
    data: *const u8,
    len: usize,
    maximum: usize,
) -> Result<&'a str, SessionError> {
    // SAFETY: inherits the foreign byte-range contract from this function.
    let bytes = unsafe { bytes_input(data, len, maximum)? };
    str::from_utf8(bytes).map_err(|_| SessionError::InvalidRequest)
}

unsafe fn reclaim_buffer(buffer: NpByteBuffer) -> Result<(), SessionError> {
    if buffer.data.is_null() {
        return if buffer.len == 0 && buffer.capacity == 0 {
            Ok(())
        } else {
            Err(SessionError::InvalidRequest)
        };
    }
    if buffer.len > buffer.capacity {
        return Err(SessionError::InvalidRequest);
    }
    // SAFETY: caller returns the exact pointer, length, and capacity allocated by leak_buffer once.
    let mut bytes = unsafe { Vec::from_raw_parts(buffer.data, buffer.len, buffer.capacity) };
    bytes.zeroize();
    Ok(())
}

#[cfg(test)]
#[path = "ffi_tests.rs"]
mod tests;
