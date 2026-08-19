use std::io::{self, Read, Seek, SeekFrom};

use sha2::{Digest, Sha256};

const HASH_BUFFER_SIZE: usize = 64 * 1024;

/// A strong fingerprint of complete encrypted vault bytes.
///
/// This type deliberately has no `Debug`, `Display`, serialization, or public
/// digest accessor because its stable digest is privacy-sensitive metadata.
#[derive(Clone, Eq, PartialEq)]
pub struct FileFingerprint {
    size: u64,
    sha256: [u8; 32],
}

impl FileFingerprint {
    pub(crate) const fn from_parts(size: u64, sha256: [u8; 32]) -> Self {
        Self { size, sha256 }
    }

    pub(crate) fn from_reader(source: &mut (impl Read + Seek)) -> io::Result<Self> {
        source.seek(SeekFrom::Start(0))?;

        let mut digest = Sha256::new();
        let mut size = 0_u64;
        let mut buffer = [0_u8; HASH_BUFFER_SIZE];
        loop {
            let count = source.read(&mut buffer)?;
            if count == 0 {
                break;
            }
            size = size
                .checked_add(count as u64)
                .ok_or_else(|| io::Error::other("vault size exceeded supported range"))?;
            digest.update(&buffer[..count]);
        }

        Ok(Self {
            size,
            sha256: digest.finalize().into(),
        })
    }
}

#[cfg(test)]
mod tests {
    use std::io::Cursor;

    use super::FileFingerprint;

    #[test]
    fn complete_digest_detects_same_size_changes() {
        let left = FileFingerprint::from_reader(&mut Cursor::new(b"vault-A"))
            .expect("fingerprint should succeed");
        let right = FileFingerprint::from_reader(&mut Cursor::new(b"vault-B"))
            .expect("fingerprint should succeed");

        assert!(left != right);
    }
}
