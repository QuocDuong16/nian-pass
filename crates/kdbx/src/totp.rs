use std::time::{SystemTime, UNIX_EPOCH};

use keepass::db::{EntryRef, TOTP, fields};
use url::{Url, form_urlencoded};
use vault_core::{EntryId, SecretString};
use zeroize::Zeroizing;

use crate::{KdbxDocument, KdbxError, TOTP_FIELD_NAMES};

const KEEPASS_TOTP_SEED: &str = "TOTP Seed";
const KEEPASS_TOTP_SETTINGS: &str = "TOTP Settings";
const KEEPASS2_TOTP_SECRET_BASE32: &str = "TimeOtp-Secret-Base32";
const KEEPASS2_TOTP_ALGORITHM: &str = "TimeOtp-Algorithm";
const KEEPASS2_TOTP_LENGTH: &str = "TimeOtp-Length";
const KEEPASS2_TOTP_PERIOD: &str = "TimeOtp-Period";

/// One explicitly requested TOTP code plus non-secret timing metadata.
pub struct EntryTotpCode {
    code: SecretString,
    valid_for_seconds: u64,
    period_seconds: u64,
}

impl EntryTotpCode {
    /// Borrows the ephemeral code through the standard secret wrapper.
    #[must_use]
    pub const fn code(&self) -> &SecretString {
        &self.code
    }

    /// Consumes the value and returns the ephemeral code secret.
    #[must_use]
    pub fn into_code(self) -> SecretString {
        self.code
    }

    /// Returns how many whole seconds remain in the current TOTP window.
    #[must_use]
    pub const fn valid_for_seconds(&self) -> u64 {
        self.valid_for_seconds
    }

    /// Returns the configured TOTP period in seconds.
    #[must_use]
    pub const fn period_seconds(&self) -> u64 {
        self.period_seconds
    }
}

impl KdbxDocument {
    /// Generates the current TOTP code for one explicit entry without exposing
    /// the seed or provisioning URI to callers.
    pub fn entry_totp_code(&self, id: &EntryId) -> Result<EntryTotpCode, KdbxError> {
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_err(|_| KdbxError::InvalidTotp)?
            .as_secs();
        self.entry_totp_code_at(id, now)
    }

    /// Replaces one entry's TOTP configuration with a canonical protected
    /// `otp` provisioning URI. Existing recognized legacy TOTP fields are
    /// removed only after the replacement URI has been fully validated.
    pub fn set_entry_totp_uri(
        &mut self,
        id: &EntryId,
        uri: &SecretString,
    ) -> Result<(), KdbxError> {
        validate_totp_uri(uri.expose_secret())?;
        let upstream_id = self.find_entry_id(id)?;
        let current = self
            .database
            .entry(upstream_id)
            .ok_or(KdbxError::EntryNotFound)?;
        let canonical_unchanged = current
            .fields
            .get(fields::OTP)
            .is_some_and(|value| value.get() == uri.expose_secret());
        let has_other_totp_fields = TOTP_FIELD_NAMES
            .iter()
            .filter(|name| **name != fields::OTP)
            .any(|name| current.fields.contains_key(*name));
        if canonical_unchanged && !has_other_totp_fields {
            return Ok(());
        }

        {
            let mut entry = self
                .database
                .entry_mut(upstream_id)
                .ok_or(KdbxError::EntryNotFound)?;
            let mut tracked = entry.track_changes();
            for name in TOTP_FIELD_NAMES {
                tracked.fields.remove(name);
            }
            tracked.set_protected(fields::OTP, uri.expose_secret());
        }
        self.enforce_history_policy_for_entry(upstream_id)?;
        self.mark_changed();
        Ok(())
    }

    /// Removes all recognized TOTP configuration fields from one entry.
    pub fn clear_entry_totp(&mut self, id: &EntryId) -> Result<(), KdbxError> {
        let upstream_id = self.find_entry_id(id)?;
        let current = self
            .database
            .entry(upstream_id)
            .ok_or(KdbxError::EntryNotFound)?;
        if !TOTP_FIELD_NAMES
            .iter()
            .any(|name| current.fields.contains_key(*name))
        {
            return Ok(());
        }

        {
            let mut entry = self
                .database
                .entry_mut(upstream_id)
                .ok_or(KdbxError::EntryNotFound)?;
            let mut tracked = entry.track_changes();
            for name in TOTP_FIELD_NAMES {
                tracked.fields.remove(name);
            }
            tracked.times.last_modification = Some(keepass::db::Times::now());
        }
        self.enforce_history_policy_for_entry(upstream_id)?;
        self.mark_changed();
        Ok(())
    }

    fn entry_totp_code_at(&self, id: &EntryId, timestamp: u64) -> Result<EntryTotpCode, KdbxError> {
        let upstream_id = self.find_entry_id(id)?;
        let entry = self
            .database
            .entry(upstream_id)
            .ok_or(KdbxError::EntryNotFound)?;
        let raw = totp_uri_for_entry(entry)?;
        let totp = validate_totp_uri(&raw)?;
        let value = totp.value_at(timestamp);
        Ok(EntryTotpCode {
            code: SecretString::new(value.code),
            valid_for_seconds: value.valid_for.as_secs(),
            period_seconds: value.period.as_secs(),
        })
    }
}

pub(crate) fn validate_totp_uri(raw: &str) -> Result<TOTP, KdbxError> {
    let url = Url::parse(raw).map_err(|_| KdbxError::InvalidTotp)?;
    if url.scheme() != "otpauth" || url.host_str() != Some("totp") {
        return Err(KdbxError::InvalidTotp);
    }
    let totp = raw.parse::<TOTP>().map_err(|_| KdbxError::InvalidTotp)?;
    if totp.period == 0 || !(6..=10).contains(&totp.digits) {
        return Err(KdbxError::InvalidTotp);
    }
    Ok(totp)
}

fn totp_uri_for_entry(entry: EntryRef<'_>) -> Result<Zeroizing<String>, KdbxError> {
    if let Some(raw) = entry.fields.get(fields::OTP) {
        return normalize_otp_field(raw.get());
    }

    if let Some(seed) = entry.fields.get(KEEPASS2_TOTP_SECRET_BASE32) {
        let period = entry
            .fields
            .get(KEEPASS2_TOTP_PERIOD)
            .map(|value| value.get().as_str())
            .unwrap_or("30");
        let digits = entry
            .fields
            .get(KEEPASS2_TOTP_LENGTH)
            .map(|value| value.get().as_str())
            .unwrap_or("6");
        let algorithm = entry
            .fields
            .get(KEEPASS2_TOTP_ALGORITHM)
            .map(|value| normalize_keepass2_algorithm(value.get()))
            .transpose()?
            .unwrap_or("SHA1");
        return build_totp_uri(seed.get(), period, digits, Some(algorithm));
    }

    if let Some(seed) = entry.fields.get(KEEPASS_TOTP_SEED) {
        let settings = entry
            .fields
            .get(KEEPASS_TOTP_SETTINGS)
            .map(|value| value.get().as_str())
            .unwrap_or("30;6");
        let mut parts = settings.split(';');
        let period = parts
            .next()
            .filter(|value| !value.is_empty())
            .unwrap_or("30");
        let digits = parts
            .next()
            .filter(|value| !value.is_empty())
            .unwrap_or("6");
        if digits == "S" {
            return Err(KdbxError::UnsupportedTotpFormat);
        }
        return build_totp_uri(seed.get(), period, digits, None);
    }

    if TOTP_FIELD_NAMES
        .iter()
        .any(|name| entry.fields.contains_key(*name))
    {
        Err(KdbxError::UnsupportedTotpFormat)
    } else {
        Err(KdbxError::TotpNotConfigured)
    }
}

fn normalize_otp_field(raw: &str) -> Result<Zeroizing<String>, KdbxError> {
    if raw.starts_with("otpauth://") {
        return Ok(Zeroizing::new(raw.to_owned()));
    }

    let pairs = form_urlencoded::parse(raw.as_bytes()).collect::<Vec<_>>();
    let secret = pairs
        .iter()
        .find(|(key, _)| key == "key")
        .map(|(_, value)| value.as_ref())
        .ok_or(KdbxError::UnsupportedTotpFormat)?;
    let period = pairs
        .iter()
        .find(|(key, _)| key == "step")
        .map(|(_, value)| value.as_ref())
        .unwrap_or("30");
    let digits = pairs
        .iter()
        .find(|(key, _)| key == "size")
        .map(|(_, value)| value.as_ref())
        .unwrap_or("6");
    build_totp_uri(secret, period, digits, None)
}

fn build_totp_uri(
    secret: &str,
    period: &str,
    digits: &str,
    algorithm: Option<&str>,
) -> Result<Zeroizing<String>, KdbxError> {
    if secret.is_empty() {
        return Err(KdbxError::InvalidTotp);
    }
    let mut url = Url::parse("otpauth://totp/NianPass").map_err(|_| KdbxError::InvalidTotp)?;
    {
        let mut query = url.query_pairs_mut();
        query.append_pair("secret", secret);
        query.append_pair("period", period);
        query.append_pair("digits", digits);
        if let Some(algorithm) = algorithm {
            query.append_pair("algorithm", algorithm);
        }
    }
    let raw = Zeroizing::new(url.to_string());
    validate_totp_uri(&raw)?;
    Ok(raw)
}

fn normalize_keepass2_algorithm(raw: &str) -> Result<&'static str, KdbxError> {
    match raw {
        "HMAC-SHA1" | "SHA1" => Ok("SHA1"),
        "HMAC-SHA256" | "SHA256" => Ok("SHA256"),
        "HMAC-SHA512" | "SHA512" => Ok("SHA512"),
        _ => Err(KdbxError::UnsupportedTotpFormat),
    }
}

#[cfg(test)]
mod tests {
    use keepass::db::fields;
    use vault_core::{EntryId, NewEntry, SecretString};

    use super::*;

    fn document_with_entry() -> (KdbxDocument, EntryId) {
        let mut document = KdbxDocument::new("TOTP tests");
        let root = document
            .projection()
            .expect("new database should project")
            .root()
            .id()
            .clone();
        let entry = document
            .create_entry(
                &root,
                NewEntry {
                    title: "TOTP entry",
                    username: "",
                    url: "",
                    password: None,
                },
            )
            .expect("entry should be created");
        (document, entry)
    }

    #[test]
    fn canonical_totp_set_generate_noop_clear_tracks_secret_free_presence() {
        let (mut document, entry) = document_with_entry();
        let revision = document.revision();
        let uri = SecretString::new(
            "otpauth://totp/Test?secret=JBSWY3DPEHPK3PXP&period=30&digits=6".to_owned(),
        );

        document
            .set_entry_totp_uri(&entry, &uri)
            .expect("valid TOTP should be accepted");
        assert_eq!(document.revision(), revision + 1);
        let projected = document.projection().expect("projection should succeed");
        assert!(
            projected
                .find_entry(&entry)
                .is_some_and(|item| item.has_totp())
        );
        let code = document
            .entry_totp_code_at(&entry, 1234)
            .expect("TOTP should generate");
        assert_eq!(code.code().expose_secret(), "806863");
        assert_eq!(code.valid_for_seconds(), 26);
        assert_eq!(code.period_seconds(), 30);

        document
            .set_entry_totp_uri(&entry, &uri)
            .expect("same TOTP should be a no-op");
        assert_eq!(document.revision(), revision + 1);

        document
            .clear_entry_totp(&entry)
            .expect("TOTP should clear");
        assert_eq!(document.revision(), revision + 2);
        assert!(
            document
                .projection()
                .expect("projection should succeed")
                .find_entry(&entry)
                .is_some_and(|item| !item.has_totp())
        );
        assert!(matches!(
            document.entry_totp_code_at(&entry, 1234),
            Err(KdbxError::TotpNotConfigured)
        ));
    }

    #[test]
    fn legacy_keepass_and_query_string_totp_formats_generate_without_rewriting() {
        let (mut document, entry) = document_with_entry();
        let upstream = document
            .find_entry_id(&entry)
            .expect("entry id should resolve");
        {
            let mut value = document
                .database
                .entry_mut(upstream)
                .expect("entry should exist");
            value.set_protected("TOTP Seed", "JBSWY3DPEHPK3PXP");
            value.set_unprotected("TOTP Settings", "30;6");
        }
        assert_eq!(
            document
                .entry_totp_code_at(&entry, 1234)
                .expect("KeePass legacy TOTP should generate")
                .code()
                .expose_secret(),
            "806863"
        );

        {
            let mut value = document
                .database
                .entry_mut(upstream)
                .expect("entry should exist");
            value.fields.remove("TOTP Seed");
            value.fields.remove("TOTP Settings");
            value.set_protected(fields::OTP, "key=JBSWY3DPEHPK3PXP&step=30&size=6");
        }
        assert_eq!(
            document
                .entry_totp_code_at(&entry, 1234)
                .expect("KeeOtp query TOTP should generate")
                .code()
                .expose_secret(),
            "806863"
        );

        {
            let mut value = document
                .database
                .entry_mut(upstream)
                .expect("entry should exist");
            value.fields.remove(fields::OTP);
            value.set_protected("TimeOtp-Secret-Base32", "JBSWY3DPEHPK3PXP");
            value.set_unprotected("TimeOtp-Algorithm", "HMAC-SHA1");
            value.set_unprotected("TimeOtp-Length", "6");
            value.set_unprotected("TimeOtp-Period", "30");
        }
        assert_eq!(
            document
                .entry_totp_code_at(&entry, 1234)
                .expect("KeePass2 TOTP should generate")
                .code()
                .expose_secret(),
            "806863"
        );
    }

    #[test]
    fn invalid_or_unsupported_totp_never_mutates_existing_entry() {
        let (mut document, entry) = document_with_entry();
        let revision = document.revision();
        let invalid =
            SecretString::new("otpauth://hotp/Test?secret=JBSWY3DPEHPK3PXP&digits=6".to_owned());
        assert!(matches!(
            document.set_entry_totp_uri(&entry, &invalid),
            Err(KdbxError::InvalidTotp)
        ));
        assert_eq!(document.revision(), revision);

        let upstream = document
            .find_entry_id(&entry)
            .expect("entry id should resolve");
        document
            .database
            .entry_mut(upstream)
            .expect("entry should exist")
            .set_protected("TimeOtp-Secret-Hex", "31323334");
        assert!(matches!(
            document.entry_totp_code_at(&entry, 1234),
            Err(KdbxError::UnsupportedTotpFormat)
        ));
    }
}
