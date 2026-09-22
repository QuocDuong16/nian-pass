use vault_core::{EntryId, SecretBytes};

use crate::{KdbxDocument, KdbxError};

const PNG_SIGNATURE: &[u8; 8] = b"\x89PNG\r\n\x1a\n";
const MAX_CUSTOM_ICON_BYTES: usize = 4 * 1024 * 1024;
const PNG_IHDR_LENGTH: u32 = 13;
const MAX_CUSTOM_ICON_DIMENSION: u32 = 4096;

impl KdbxDocument {
    /// Replaces one entry's icon with a newly created database-owned PNG custom icon.
    ///
    /// The previous entry state is retained in history by the upstream tracked
    /// mutation. Existing custom-icon objects are deliberately not deleted because
    /// historical entry revisions may still reference them.
    pub fn set_entry_custom_icon_png(
        &mut self,
        id: &EntryId,
        bytes: &SecretBytes,
    ) -> Result<(), KdbxError> {
        validate_png_icon(bytes.expose_secret())?;
        let upstream_id = self.find_entry_id(id)?;
        let current = self
            .database
            .entry(upstream_id)
            .ok_or(KdbxError::EntryNotFound)?;
        if current
            .custom_icon()
            .is_some_and(|icon| icon.data.as_slice() == bytes.expose_secret())
        {
            return Ok(());
        }

        {
            let mut entry = self
                .database
                .entry_mut(upstream_id)
                .ok_or(KdbxError::EntryNotFound)?;
            entry
                .track_changes()
                .set_icon_custom_new(bytes.expose_secret().to_vec());
        }
        self.enforce_history_policy_for_entry(upstream_id)?;
        self.mark_changed();
        Ok(())
    }
}

fn validate_png_icon(bytes: &[u8]) -> Result<(), KdbxError> {
    if bytes.len() < 45
        || bytes.len() > MAX_CUSTOM_ICON_BYTES
        || bytes.get(..8) != Some(PNG_SIGNATURE.as_slice())
    {
        return Err(KdbxError::InvalidIcon);
    }

    let mut offset = 8_usize;
    let mut first_chunk = true;
    let mut saw_idat = false;
    while offset.checked_add(12).is_some_and(|end| end <= bytes.len()) {
        let length = u32::from_be_bytes(
            bytes[offset..offset + 4]
                .try_into()
                .map_err(|_| KdbxError::InvalidIcon)?,
        );
        let length = usize::try_from(length).map_err(|_| KdbxError::InvalidIcon)?;
        let chunk_type = bytes
            .get(offset + 4..offset + 8)
            .ok_or(KdbxError::InvalidIcon)?;
        let data_start = offset + 8;
        let data_end = data_start
            .checked_add(length)
            .ok_or(KdbxError::InvalidIcon)?;
        let chunk_end = data_end.checked_add(4).ok_or(KdbxError::InvalidIcon)?;
        if chunk_end > bytes.len() {
            return Err(KdbxError::InvalidIcon);
        }

        if first_chunk {
            if length != PNG_IHDR_LENGTH as usize || chunk_type != b"IHDR" {
                return Err(KdbxError::InvalidIcon);
            }
            let width = u32::from_be_bytes(
                bytes[data_start..data_start + 4]
                    .try_into()
                    .map_err(|_| KdbxError::InvalidIcon)?,
            );
            let height = u32::from_be_bytes(
                bytes[data_start + 4..data_start + 8]
                    .try_into()
                    .map_err(|_| KdbxError::InvalidIcon)?,
            );
            if width == 0
                || height == 0
                || width > MAX_CUSTOM_ICON_DIMENSION
                || height > MAX_CUSTOM_ICON_DIMENSION
            {
                return Err(KdbxError::InvalidIcon);
            }
            first_chunk = false;
        } else if chunk_type == b"IHDR" {
            return Err(KdbxError::InvalidIcon);
        }

        if chunk_type == b"IDAT" {
            saw_idat = true;
        }
        if chunk_type == b"IEND" {
            return if length == 0 && saw_idat && chunk_end == bytes.len() {
                Ok(())
            } else {
                Err(KdbxError::InvalidIcon)
            };
        }
        offset = chunk_end;
    }
    Err(KdbxError::InvalidIcon)
}

#[cfg(test)]
mod tests {
    use vault_core::{EntryId, GroupId, NewEntry, SecretBytes};

    use super::{KdbxDocument, MAX_CUSTOM_ICON_BYTES};
    use crate::KdbxError;

    fn png(width: u32, height: u32, marker: u8) -> SecretBytes {
        let mut bytes = Vec::new();
        bytes.extend_from_slice(b"\x89PNG\r\n\x1a\n");
        bytes.extend_from_slice(&13_u32.to_be_bytes());
        bytes.extend_from_slice(b"IHDR");
        bytes.extend_from_slice(&width.to_be_bytes());
        bytes.extend_from_slice(&height.to_be_bytes());
        bytes.extend_from_slice(&[8, 6, 0, 0, 0]);
        bytes.extend_from_slice(&[0; 4]);
        bytes.extend_from_slice(&1_u32.to_be_bytes());
        bytes.extend_from_slice(b"IDAT");
        bytes.push(marker);
        bytes.extend_from_slice(&[0; 4]);
        bytes.extend_from_slice(&0_u32.to_be_bytes());
        bytes.extend_from_slice(b"IEND");
        bytes.extend_from_slice(&[0; 4]);
        SecretBytes::new(bytes)
    }

    fn document_with_entry() -> (KdbxDocument, EntryId) {
        let mut document = KdbxDocument::new("Custom icon tests");
        let root = GroupId::new(document.database.root().id().to_string());
        let entry = document
            .create_entry(
                &root,
                NewEntry {
                    title: "Entry",
                    username: "",
                    url: "",
                    password: None,
                },
            )
            .expect("entry creation should succeed");
        (document, entry)
    }

    #[test]
    fn custom_icon_upload_tracks_history_and_same_bytes_are_a_noop() {
        let (mut document, entry) = document_with_entry();
        let icon = png(32, 32, 6);
        let before = document.revision();
        document
            .set_entry_custom_icon_png(&entry, &icon)
            .expect("custom icon should apply");
        assert_eq!(document.revision(), before + 1);
        let history_len = document
            .entry_history(&entry)
            .expect("history should list")
            .items()
            .len();

        document
            .set_entry_custom_icon_png(&entry, &icon)
            .expect("same custom icon should be a no-op");
        assert_eq!(document.revision(), before + 1);
        assert_eq!(
            document
                .entry_history(&entry)
                .expect("history should still list")
                .items()
                .len(),
            history_len
        );

        let replacement = png(64, 64, 9);
        document
            .set_entry_custom_icon_png(&entry, &replacement)
            .expect("replacement custom icon should apply");
        assert_eq!(document.revision(), before + 2);
        assert_eq!(document.database.num_custom_icons(), 2);
        let history = document.entry_history(&entry).expect("history should list");
        assert_eq!(history.items().len(), history_len + 1);
        assert!(!history.items()[0].restorable());
    }

    #[test]
    fn malformed_or_unbounded_png_headers_are_rejected_without_mutation() {
        let (mut document, entry) = document_with_entry();
        let before = document.revision();
        for bytes in [
            SecretBytes::new(vec![1, 2, 3]),
            SecretBytes::new(b"\x89PNG\r\n\x1a\n".to_vec()),
            png(0, 32, 6),
            png(4097, 32, 6),
            SecretBytes::new(vec![0; MAX_CUSTOM_ICON_BYTES + 1]),
        ] {
            assert!(matches!(
                document.set_entry_custom_icon_png(&entry, &bytes),
                Err(KdbxError::InvalidIcon)
            ));
            assert_eq!(document.revision(), before);
        }
    }
}
