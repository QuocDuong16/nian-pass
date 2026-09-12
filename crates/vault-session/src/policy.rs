use std::fs;

use kdbx::KdbxVersion;

use super::{VaultSession, platform};

/// Stable reason an unlocked local vault must remain read-only.
#[derive(Clone, Copy, Eq, PartialEq)]
pub enum WriteRestriction {
    /// The KDBX reader can open this version, but the writer cannot safely emit it.
    UnsupportedWriteFormat,
    /// The current platform cannot provide the required safe persistence semantics.
    UnsupportedPersistencePlatform,
    /// The selected source is not writable by the current process policy.
    ReadOnlySource,
}

impl VaultSession {
    /// Returns the exact KDBX version of the unlocked source.
    #[must_use]
    pub const fn version(&self) -> KdbxVersion {
        self.document.version()
    }

    /// Returns why this session cannot be mutated and safely persisted.
    #[must_use]
    pub fn write_restriction(&self) -> Option<WriteRestriction> {
        if self.version() != (KdbxVersion::Kdbx4 { minor: 1 }) {
            return Some(WriteRestriction::UnsupportedWriteFormat);
        }
        if !platform::SAVE_SUPPORTED {
            return Some(WriteRestriction::UnsupportedPersistencePlatform);
        }
        if fs::metadata(&self.path).is_ok_and(|metadata| metadata.permissions().readonly()) {
            return Some(WriteRestriction::ReadOnlySource);
        }
        None
    }
}
