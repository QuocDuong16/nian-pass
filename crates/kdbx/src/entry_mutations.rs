use keepass::db::{Icon, fields};
use vault_core::{
    EntryExpiry, EntryIconUpdate, EntryId, EntryTotpUpdate, EntryUpdate, MAX_STANDARD_ICON_ID,
    SecretString,
};

use crate::{
    KdbxDocument, KdbxError, MissingFieldProtection, TOTP_FIELD_NAMES, totp::validate_totp_uri,
};

/// Maximum number of tags accepted by one explicit entry-tag mutation.
pub const MAX_ENTRY_TAGS: usize = 64;
/// Maximum UTF-8 byte length accepted for one explicitly edited tag.
pub const MAX_ENTRY_TAG_BYTES: usize = 256;

impl KdbxDocument {
    /// Changes one entry's notes while preserving its protection mode.
    ///
    /// Missing non-empty notes follow the database Notes memory-protection
    /// policy. Missing plus empty is a no-op, matching the other setters.
    pub fn set_entry_notes(&mut self, id: &EntryId, notes: &SecretString) -> Result<(), KdbxError> {
        self.set_standard_field(
            id,
            fields::NOTES,
            notes.expose_secret(),
            MissingFieldProtection::DatabaseNotesPolicy,
        )
    }

    /// Applies one logical multi-field entry edit atomically.
    ///
    /// All lookup and change decisions complete before the tracked edit starts.
    /// A real update appends exactly one prior-state history item and advances
    /// the document revision once, regardless of the number of changed fields.
    pub fn update_entry(&mut self, id: &EntryId, update: EntryUpdate<'_>) -> Result<(), KdbxError> {
        let upstream_id = self.find_entry_id(id)?;
        let current = self
            .database
            .entry(upstream_id)
            .ok_or(KdbxError::EntryNotFound)?;
        if update.is_empty() {
            return Ok(());
        }
        let candidates = [
            (
                fields::TITLE,
                update.title,
                MissingFieldProtection::DatabaseTitlePolicy,
            ),
            (
                fields::USERNAME,
                update.username,
                MissingFieldProtection::DatabaseUsernamePolicy,
            ),
            (
                fields::URL,
                update.url,
                MissingFieldProtection::DatabaseUrlPolicy,
            ),
            (
                fields::PASSWORD,
                update.password.map(SecretString::expose_secret),
                MissingFieldProtection::AlwaysProtected,
            ),
            (
                fields::NOTES,
                update.notes.map(SecretString::expose_secret),
                MissingFieldProtection::DatabaseNotesPolicy,
            ),
        ];
        let changes = candidates
            .into_iter()
            .filter_map(|(field, value, policy)| {
                let value = value?;
                let existing = current.fields.get(field);
                if existing.is_some_and(|current| current.get() == value)
                    || (existing.is_none() && value.is_empty())
                {
                    return None;
                }
                let protected = existing.map_or_else(
                    || self.missing_field_is_protected(policy),
                    keepass::db::Value::is_protected,
                );
                Some((field, value, protected))
            })
            .collect::<Vec<_>>();
        let expiry_change = match update.expiry {
            None => None,
            Some(EntryExpiry::Disabled) => (current.times.expires == Some(true)
                || current.times.expiry.is_some())
            .then_some((EntryExpiry::Disabled, None)),
            Some(EntryExpiry::AtUnixSeconds(seconds)) => {
                let timestamp = chrono::DateTime::from_timestamp(seconds, 0)
                    .map(|value| value.naive_utc())
                    .ok_or(KdbxError::InvalidExpiry)?;
                let unchanged =
                    current.times.expires == Some(true) && current.times.expiry == Some(timestamp);
                (!unchanged).then_some((EntryExpiry::AtUnixSeconds(seconds), Some(timestamp)))
            }
        };
        let icon_change = match update.icon {
            None => None,
            Some(EntryIconUpdate::None) => {
                current.icon().is_some().then_some(EntryIconUpdate::None)
            }
            Some(EntryIconUpdate::BuiltIn(icon_id)) => {
                if icon_id > MAX_STANDARD_ICON_ID {
                    return Err(KdbxError::InvalidIcon);
                }
                (!matches!(current.icon(), Some(Icon::BuiltIn(current_id)) if *current_id == usize::from(icon_id)))
                    .then_some(EntryIconUpdate::BuiltIn(icon_id))
            }
        };
        let totp_change = match update.totp {
            None => None,
            Some(EntryTotpUpdate::Clear) => TOTP_FIELD_NAMES
                .iter()
                .any(|name| current.fields.contains_key(*name))
                .then_some(EntryTotpUpdate::Clear),
            Some(EntryTotpUpdate::Set(uri)) => {
                validate_totp_uri(uri.expose_secret())?;
                let same_uri = current
                    .fields
                    .get(fields::OTP)
                    .is_some_and(|value| value.get() == uri.expose_secret());
                let legacy_present = TOTP_FIELD_NAMES
                    .iter()
                    .filter(|name| **name != fields::OTP)
                    .any(|name| current.fields.contains_key(*name));
                (!same_uri || legacy_present).then_some(EntryTotpUpdate::Set(uri))
            }
        };

        if changes.is_empty()
            && expiry_change.is_none()
            && icon_change.is_none()
            && totp_change.is_none()
        {
            return Ok(());
        }

        {
            let mut entry = self
                .database
                .entry_mut(upstream_id)
                .ok_or(KdbxError::EntryNotFound)?;
            let mut tracked = entry.track_changes();
            for (field, value, protected) in changes {
                if protected {
                    tracked.set_protected(field, value);
                } else {
                    tracked.set_unprotected(field, value);
                }
            }
            if let Some((expiry, timestamp)) = expiry_change {
                match expiry {
                    EntryExpiry::Disabled => {
                        tracked.times.expires = Some(false);
                        tracked.times.expiry = None;
                    }
                    EntryExpiry::AtUnixSeconds(_) => {
                        tracked.times.expires = Some(true);
                        tracked.times.expiry = timestamp;
                    }
                }
                tracked.times.last_modification = Some(keepass::db::Times::now());
            }
            if let Some(icon) = icon_change {
                match icon {
                    EntryIconUpdate::None => tracked.set_icon_none(),
                    EntryIconUpdate::BuiltIn(icon_id) => {
                        tracked.set_icon_builtin(usize::from(icon_id))
                    }
                }
            }
            if let Some(totp) = totp_change {
                for name in TOTP_FIELD_NAMES {
                    tracked.fields.remove(name);
                }
                match totp {
                    EntryTotpUpdate::Clear => {
                        tracked.times.last_modification = Some(keepass::db::Times::now());
                    }
                    EntryTotpUpdate::Set(uri) => {
                        tracked.set_protected(fields::OTP, uri.expose_secret());
                    }
                }
            }
        }
        self.enforce_history_policy_for_entry(upstream_id)?;
        self.mark_changed();
        Ok(())
    }

    /// Replaces one entry's tag list as one tracked mutation.
    ///
    /// Explicit edits are bounded, reject empty/duplicate tags, preserve exact
    /// caller spelling/order, and remain subject to the configured history policy.
    pub fn set_entry_tags(&mut self, id: &EntryId, tags: &[String]) -> Result<(), KdbxError> {
        validate_entry_tags(tags)?;
        let upstream_id = self.find_entry_id(id)?;
        let unchanged = self
            .database
            .entry(upstream_id)
            .ok_or(KdbxError::EntryNotFound)?
            .tags
            == tags;
        if unchanged {
            return Ok(());
        }
        {
            let mut entry = self
                .database
                .entry_mut(upstream_id)
                .ok_or(KdbxError::EntryNotFound)?;
            entry.track_changes().edit(|tracked| {
                tracked.as_mut().tags = tags.to_vec();
                tracked.as_mut().times.last_modification = Some(keepass::db::Times::now());
            });
        }
        self.enforce_history_policy_for_entry(upstream_id)?;
        self.mark_changed();
        Ok(())
    }

    /// Duplicates the current state of one entry inside the KDBX trust boundary.
    ///
    /// The duplicate receives a fresh UUID and fresh creation/access/modification
    /// timestamps. Current fields, protection states, tags, Auto-Type settings,
    /// custom data, display metadata, expiry, icon, and attachments are copied.
    /// Entry history and previous-parent metadata are intentionally not copied.
    pub fn duplicate_entry(&mut self, id: &EntryId) -> Result<EntryId, KdbxError> {
        let source_id = self.find_entry_id(id)?;
        let (
            parent_id,
            fields,
            autotype,
            tags,
            custom_data,
            foreground_color,
            background_color,
            override_url,
            quality_check,
            expiry,
            expires,
            icon,
            attachments,
        ) = {
            let source = self
                .database
                .entry(source_id)
                .ok_or(KdbxError::EntryNotFound)?;
            let attachments = source
                .attachments_named()
                .map(|(name, attachment)| (name.to_owned(), attachment.data.clone()))
                .collect::<Vec<_>>();
            (
                source.parent().id(),
                source.fields.clone(),
                source.autotype.clone(),
                source.tags.clone(),
                source.custom_data.clone(),
                source.foreground_color.clone(),
                source.background_color.clone(),
                source.override_url.clone(),
                source.quality_check,
                source.times.expiry,
                source.times.expires,
                source.icon().cloned(),
                attachments,
            )
        };

        let mut parent = self
            .database
            .group_mut(parent_id)
            .ok_or(KdbxError::GroupNotFound)?;
        let mut duplicate = parent.add_entry();
        let duplicate_id = duplicate.id();
        duplicate.fields = fields;
        duplicate.autotype = autotype;
        duplicate.tags = tags;
        duplicate.custom_data = custom_data;
        duplicate.foreground_color = foreground_color;
        duplicate.background_color = background_color;
        duplicate.override_url = override_url;
        duplicate.quality_check = quality_check;
        duplicate.times.expiry = expiry;
        duplicate.times.expires = expires;
        match icon {
            Some(Icon::BuiltIn(icon_id)) => duplicate.set_icon_builtin(icon_id),
            Some(Icon::Custom(icon_id)) => duplicate
                .set_icon_custom(icon_id)
                .map_err(|_| KdbxError::Conversion("entry custom icon was missing"))?,
            None => {}
        }
        for (name, data) in attachments {
            duplicate.add_attachment(name, data);
        }

        self.mark_changed();
        Ok(EntryId::new(duplicate_id.to_string()))
    }
}

fn validate_entry_tags(tags: &[String]) -> Result<(), KdbxError> {
    if tags.len() > MAX_ENTRY_TAGS {
        return Err(KdbxError::InvalidEntryTags);
    }
    for (index, tag) in tags.iter().enumerate() {
        if tag.is_empty()
            || tag.len() > MAX_ENTRY_TAG_BYTES
            || tags[..index].iter().any(|existing| existing == tag)
        {
            return Err(KdbxError::InvalidEntryTags);
        }
    }
    Ok(())
}

#[cfg(test)]
mod tag_tests {
    use vault_core::{EntryId, GroupId, NewEntry};

    use super::{MAX_ENTRY_TAG_BYTES, MAX_ENTRY_TAGS};
    use crate::{KdbxDocument, KdbxError};

    fn entry_fixture() -> (KdbxDocument, EntryId) {
        let mut document = KdbxDocument::new("tag-test");
        let root = GroupId::new(document.database.root().id().to_string());
        let entry = document
            .create_entry(
                &root,
                NewEntry {
                    title: "Tagged",
                    username: "",
                    url: "",
                    password: None,
                },
            )
            .expect("entry");
        (document, entry)
    }

    #[test]
    fn tag_replacement_is_tracked_noop_aware_and_history_bounded() {
        let (mut document, entry) = entry_fixture();
        document
            .set_history_max_items(Some(1))
            .expect("history policy");
        document
            .set_entry_tags(&entry, &["alpha".to_owned(), "beta".to_owned()])
            .expect("tags");
        let revision = document.revision();
        assert_eq!(
            document
                .entry_history(&entry)
                .expect("history")
                .items()
                .len(),
            1
        );
        document
            .set_entry_tags(&entry, &["alpha".to_owned(), "beta".to_owned()])
            .expect("same tags");
        assert_eq!(document.revision(), revision);
        document
            .set_entry_tags(&entry, &["gamma".to_owned()])
            .expect("replacement");
        let summary = document
            .projection()
            .expect("projection")
            .find_entry(&entry)
            .expect("entry")
            .clone();
        assert_eq!(summary.tags(), &["gamma".to_owned()]);
        assert_eq!(
            document
                .entry_history(&entry)
                .expect("history")
                .items()
                .len(),
            1
        );
    }

    #[test]
    fn tag_bounds_reject_without_mutation() {
        let (mut document, entry) = entry_fixture();
        let revision = document.revision();
        for tags in [
            vec![String::new()],
            vec!["duplicate".to_owned(), "duplicate".to_owned()],
            vec!["x".repeat(MAX_ENTRY_TAG_BYTES + 1)],
            vec!["x".to_owned(); MAX_ENTRY_TAGS + 1],
        ] {
            assert!(matches!(
                document.set_entry_tags(&entry, &tags),
                Err(KdbxError::InvalidEntryTags)
            ));
            assert_eq!(document.revision(), revision);
        }
    }
}
