//! Platform-neutral credential-provider policy over the canonical Rust KDBX adapter.
//!
//! Native Android and iOS boundaries authenticate the requesting application and
//! translate platform service identifiers. This crate alone matches those targets
//! to the current KDBX document and performs the final stable-entry revalidation.

use kdbx::KdbxDocument;
use url::{Host, Url};
use vault_core::{EntryId, EntrySummary, Group, SecretString, SummaryText};

const ANDROID_APP_FIELD: &str = "AndroidApp";

/// A target already authenticated and normalized by a native platform boundary.
pub enum CredentialTarget {
    /// Android application package name. Signing identity stays native-only.
    AndroidApp(String),
    /// Exact canonical web host used by Android browsers and iOS services.
    WebHost(String),
    /// Exact canonical browser origin (scheme, host, and effective port).
    WebOrigin(String),
}

impl CredentialTarget {
    /// Builds an exact Android application target.
    pub fn android_app(package_name: impl Into<String>) -> Result<Self, ProviderError> {
        let package_name = package_name.into();
        if package_name.is_empty() {
            return Err(ProviderError::InvalidTarget);
        }
        Ok(Self::AndroidApp(package_name))
    }

    /// Builds an exact web target from a domain-only platform identifier.
    pub fn web_domain(domain: &str) -> Result<Self, ProviderError> {
        canonical_domain(domain).map(Self::WebHost)
    }

    /// Builds an exact web target from an iOS URL service identifier.
    pub fn ios_url(url: &str) -> Result<Self, ProviderError> {
        canonical_url_host(url)
            .map(Self::WebHost)
            .ok_or(ProviderError::InvalidTarget)
    }

    /// Builds an exact browser origin. HTTPS is supported everywhere; HTTP is
    /// restricted to loopback development targets.
    pub fn browser_origin(origin: &str) -> Result<Self, ProviderError> {
        canonical_browser_origin(origin, true)
            .map(Self::WebOrigin)
            .ok_or(ProviderError::InvalidTarget)
    }

    /// Returns the non-secret target label used by the host confirmation UI.
    #[must_use]
    pub fn display(&self) -> &str {
        match self {
            Self::AndroidApp(package_name)
            | Self::WebHost(package_name)
            | Self::WebOrigin(package_name) => package_name,
        }
    }
}

/// Secret-free candidate metadata. Protected fields remain protected markers.
pub struct CredentialCandidate {
    entry_id: String,
    title: SummaryText,
    username: SummaryText,
}

impl CredentialCandidate {
    #[must_use]
    pub fn entry_id(&self) -> &str {
        &self.entry_id
    }

    #[must_use]
    pub const fn title(&self) -> &SummaryText {
        &self.title
    }

    #[must_use]
    pub const fn username(&self) -> &SummaryText {
        &self.username
    }
}

/// Password identity metadata suitable for publication to a system identity index.
/// Passwords and protected usernames are never represented by this type.
pub struct PasswordIdentity {
    record_identifier: String,
    service_identifier: String,
    username: String,
}

impl PasswordIdentity {
    #[must_use]
    pub fn record_identifier(&self) -> &str {
        &self.record_identifier
    }

    #[must_use]
    pub fn service_identifier(&self) -> &str {
        &self.service_identifier
    }

    #[must_use]
    pub fn username(&self) -> &str {
        &self.username
    }
}

/// The only secret-bearing result produced by credential-provider policy.
pub struct Credential {
    username: SecretString,
    password: SecretString,
}

impl Credential {
    #[must_use]
    pub const fn username(&self) -> &SecretString {
        &self.username
    }

    #[must_use]
    pub const fn password(&self) -> &SecretString {
        &self.password
    }

    /// Consumes the result so a native boundary can transfer ownership without
    /// creating another long-lived credential cache.
    #[must_use]
    pub fn into_secrets(self) -> (SecretString, SecretString) {
        (self.username, self.password)
    }
}

/// Stable non-secret failures. Adapter diagnostics never cross the provider boundary.
#[derive(Clone, Copy, Eq, PartialEq)]
pub enum ProviderError {
    InvalidTarget,
    CredentialUnavailable,
    Internal,
}

/// Returns secret-free candidates matching the current document exactly.
pub fn candidates(
    document: &KdbxDocument,
    target: &CredentialTarget,
) -> Result<Vec<CredentialCandidate>, ProviderError> {
    let projection = document.projection().map_err(|_| ProviderError::Internal)?;
    let mut entries = Vec::new();
    collect_entries(projection.root(), &mut entries);
    let mut result = Vec::new();
    for entry in entries {
        if entry_matches_target(document, entry.id(), target)? {
            result.push(CredentialCandidate {
                entry_id: entry.id().as_str().to_owned(),
                title: entry.title().clone(),
                username: entry.username().clone(),
            });
        }
    }
    Ok(result)
}

/// Builds the password-only identity projection from visible metadata.
///
/// Protected usernames, malformed URLs, entries without passwords, and entries
/// without a usable web service are deliberately omitted.
pub fn password_identities(
    document: &KdbxDocument,
) -> Result<Vec<PasswordIdentity>, ProviderError> {
    let projection = document.projection().map_err(|_| ProviderError::Internal)?;
    let mut entries = Vec::new();
    collect_entries(projection.root(), &mut entries);
    let mut result = Vec::new();
    for entry in entries {
        if let Some(identity) = password_identity(entry) {
            result.push(identity);
        }
    }
    Ok(result)
}

fn password_identity(entry: &EntrySummary) -> Option<PasswordIdentity> {
    if !entry.has_password() {
        return None;
    }
    let username = entry
        .username()
        .visible()
        .filter(|value| !value.is_empty())?;
    let url = entry.url().visible()?;
    let service_identifier = canonical_url_host(url)?;
    Some(PasswordIdentity {
        record_identifier: entry.id().as_str().to_owned(),
        service_identifier,
        username: username.to_owned(),
    })
}

/// Revalidates stable entry identity and service match before reading secrets.
pub fn credential(
    document: &KdbxDocument,
    entry_id: &str,
    target: &CredentialTarget,
) -> Result<Credential, ProviderError> {
    if entry_id.is_empty() {
        return Err(ProviderError::CredentialUnavailable);
    }
    let id = EntryId::new(entry_id);
    let projection = document
        .projection()
        .map_err(|_| ProviderError::CredentialUnavailable)?;
    if projection.find_entry(&id).is_none() || !entry_matches_target(document, &id, target)? {
        return Err(ProviderError::CredentialUnavailable);
    }
    let username = document
        .entry_username(&id)
        .map_err(|_| ProviderError::CredentialUnavailable)?
        .ok_or(ProviderError::CredentialUnavailable)?;
    let password = document
        .entry_password(&id)
        .map_err(|_| ProviderError::CredentialUnavailable)?
        .ok_or(ProviderError::CredentialUnavailable)?;
    Ok(Credential { username, password })
}

fn entry_matches_target(
    document: &KdbxDocument,
    id: &EntryId,
    target: &CredentialTarget,
) -> Result<bool, ProviderError> {
    match target {
        CredentialTarget::AndroidApp(package_name) => document
            .entry_custom_field(id, ANDROID_APP_FIELD)
            .map_err(|_| ProviderError::Internal)
            .map(|value| value.is_some_and(|value| value.expose_secret() == package_name)),
        CredentialTarget::WebHost(web_host) => document
            .entry_url(id)
            .map_err(|_| ProviderError::Internal)
            .map(|value| {
                value.is_some_and(|value| {
                    canonical_url_host(value.expose_secret()).as_deref() == Some(web_host)
                })
            }),
        CredentialTarget::WebOrigin(web_origin) => document
            .entry_url(id)
            .map_err(|_| ProviderError::Internal)
            .map(|value| {
                value.is_some_and(|value| {
                    canonical_browser_origin(value.expose_secret(), false).as_deref()
                        == Some(web_origin)
                })
            }),
    }
}

fn collect_entries<'a>(group: &'a Group, entries: &mut Vec<&'a EntrySummary>) {
    entries.extend(group.entries());
    for child in group.groups() {
        collect_entries(child, entries);
    }
}

fn canonical_url_host(value: &str) -> Option<String> {
    let parsed = Url::parse(value).ok()?;
    match parsed.host()? {
        Host::Domain(domain) => Some(domain.trim_end_matches('.').to_ascii_lowercase()),
        Host::Ipv4(address) => Some(address.to_string()),
        Host::Ipv6(address) => Some(address.to_string()),
    }
}

fn canonical_domain(value: &str) -> Result<String, ProviderError> {
    if value.is_empty() || value.contains('/') || value.contains('@') || value.contains(':') {
        return Err(ProviderError::InvalidTarget);
    }
    let parsed =
        Url::parse(&format!("https://{value}")).map_err(|_| ProviderError::InvalidTarget)?;
    canonical_url_host(parsed.as_str()).ok_or(ProviderError::InvalidTarget)
}

fn canonical_browser_origin(value: &str, origin_only: bool) -> Option<String> {
    let parsed = Url::parse(value).ok()?;
    if parsed.cannot_be_a_base()
        || !parsed.username().is_empty()
        || parsed.password().is_some()
        || (origin_only
            && (parsed.path() != "/" || parsed.query().is_some() || parsed.fragment().is_some()))
    {
        return None;
    }
    let scheme = parsed.scheme();
    let host = parsed.host()?;
    if scheme != "https" && !(scheme == "http" && is_loopback_host(&host)) {
        return None;
    }
    let host_text = match host {
        Host::Domain(domain) => domain.trim_end_matches('.').to_ascii_lowercase(),
        Host::Ipv4(address) => address.to_string(),
        Host::Ipv6(address) => format!("[{address}]"),
    };
    let port = parsed.port_or_known_default()?;
    let default_port = if scheme == "https" { 443 } else { 80 };
    if port == default_port {
        Some(format!("{scheme}://{host_text}"))
    } else {
        Some(format!("{scheme}://{host_text}:{port}"))
    }
}

fn is_loopback_host(host: &Host<&str>) -> bool {
    match host {
        Host::Domain(domain) => domain
            .trim_end_matches('.')
            .eq_ignore_ascii_case("localhost"),
        Host::Ipv4(address) => *address == std::net::Ipv4Addr::LOCALHOST,
        Host::Ipv6(address) => address.is_loopback(),
    }
}

#[cfg(test)]
mod tests {
    use super::{
        CredentialTarget, ProviderError, canonical_browser_origin, canonical_url_host,
        password_identity,
    };
    use vault_core::{EntryId, EntrySummary, SummaryText};

    #[test]
    fn exact_web_hosts_never_use_substring_or_parent_matching() {
        let domain = match CredentialTarget::web_domain("EXAMPLE.com.") {
            Ok(value) => value,
            Err(_) => panic!("domain must be accepted"),
        };
        assert_eq!(domain.display(), "example.com");
        let ios_url = match CredentialTarget::ios_url("https://LOGIN.example.com/account") {
            Ok(value) => value,
            Err(_) => panic!("iOS URL must be accepted"),
        };
        assert_eq!(ios_url.display(), "login.example.com");
        assert_ne!(
            canonical_url_host("https://example.com/"),
            canonical_url_host("https://evil-example.com/")
        );
        assert_ne!(
            canonical_url_host("https://example.com/"),
            canonical_url_host("https://login.example.com/")
        );
    }

    #[test]
    fn malformed_platform_targets_fail_closed() {
        assert!(matches!(
            CredentialTarget::android_app(""),
            Err(ProviderError::InvalidTarget)
        ));
        for value in [
            "",
            "user@example.com",
            "example.com/path",
            "example.com:443",
        ] {
            assert!(CredentialTarget::web_domain(value).is_err());
        }
        assert!(CredentialTarget::ios_url("not a URL").is_err());
    }

    #[test]
    fn browser_origin_is_exact_secure_and_normalized() {
        let https = CredentialTarget::browser_origin("https://EXAMPLE.com:443")
            .unwrap_or_else(|_| panic!("HTTPS origin must be accepted"));
        assert_eq!(https.display(), "https://example.com");
        assert_eq!(
            canonical_browser_origin("https://[::1]:8443/login", false).as_deref(),
            Some("https://[::1]:8443")
        );
        assert!(CredentialTarget::browser_origin("http://example.com").is_err());
        assert!(CredentialTarget::browser_origin("http://localhost:8080").is_ok());
        assert!(CredentialTarget::browser_origin("http://127.0.0.1").is_ok());
        assert!(CredentialTarget::browser_origin("http://[::1]").is_ok());
        assert!(CredentialTarget::browser_origin("http://127.0.0.2").is_err());
        for malformed in [
            "https://user@example.com",
            "https://example.com/path",
            "data:text/plain,opaque",
            "not an origin",
        ] {
            assert!(CredentialTarget::browser_origin(malformed).is_err());
        }
    }

    #[test]
    fn identity_projection_omits_protected_or_malformed_metadata() {
        let entry = |username, url| {
            EntrySummary::new(
                EntryId::new("stable-entry"),
                SummaryText::Visible("Synthetic".to_owned()),
                username,
                url,
                Vec::new(),
                true,
                false,
            )
        };
        assert!(
            password_identity(&entry(
                SummaryText::Protected,
                SummaryText::Visible("https://example.com".to_owned())
            ))
            .is_none()
        );
        assert!(
            password_identity(&entry(
                SummaryText::Visible("synthetic-user".to_owned()),
                SummaryText::Protected
            ))
            .is_none()
        );
        assert!(
            password_identity(&entry(
                SummaryText::Visible("synthetic-user".to_owned()),
                SummaryText::Visible("not a URL".to_owned())
            ))
            .is_none()
        );
    }
}
