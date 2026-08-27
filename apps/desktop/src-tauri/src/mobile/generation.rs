use std::{
    fs::File,
    io::{Read, Seek, SeekFrom},
    path::Path,
};

use sha2::{Digest, Sha256};

use super::MobileError;

const HASH_BUFFER_SIZE: usize = 64 * 1024;

/// Provider-independent identity of one complete encrypted generation.
/// Deliberately has no Debug, Display, serialization, or public digest access.
#[derive(Clone, Eq, PartialEq)]
pub(super) struct EncryptedGeneration {
    size: u64,
    sha256: [u8; 32],
}

impl EncryptedGeneration {
    pub(super) fn from_path(path: &Path) -> Result<Self, MobileError> {
        let mut source = File::open(path).map_err(|_| MobileError::SaveFailed)?;
        source
            .seek(SeekFrom::Start(0))
            .map_err(|_| MobileError::SaveFailed)?;
        let mut digest = Sha256::new();
        let mut size = 0_u64;
        let mut buffer = [0_u8; HASH_BUFFER_SIZE];
        loop {
            let count = source
                .read(&mut buffer)
                .map_err(|_| MobileError::SaveFailed)?;
            if count == 0 {
                break;
            }
            size = size
                .checked_add(count as u64)
                .ok_or(MobileError::SaveFailed)?;
            digest.update(&buffer[..count]);
        }
        Ok(Self {
            size,
            sha256: digest.finalize().into(),
        })
    }

    pub(super) fn native_identity(&self) -> String {
        use std::fmt::Write as _;
        let mut value = format!("{}:", self.size);
        for byte in self.sha256 {
            let _ = write!(value, "{byte:02x}");
        }
        value
    }
}

/// Opaque token understood only by the Android source adapter.
pub(super) struct MobileSourceHandle(String);

impl MobileSourceHandle {
    pub(super) fn new(value: String) -> Result<Self, MobileError> {
        if value.len() < 32 || value.len() > 128 || !value.is_ascii() {
            return Err(MobileError::Internal);
        }
        Ok(Self(value))
    }

    pub(super) fn as_str(&self) -> &str {
        &self.0
    }
}

pub(super) struct MobileSourceRef {
    pub(super) handle: MobileSourceHandle,
    pub(super) baseline: EncryptedGeneration,
    pub(super) writable: bool,
}
