//! Client transport for one exact Nian Pass Sync Gateway vault object.

use std::net::IpAddr;

use futures_util::StreamExt as _;
use reqwest::{
    Client, StatusCode,
    header::{CONTENT_LENGTH, CONTENT_TYPE, ETAG, IF_MATCH, IF_NONE_MATCH},
    redirect::Policy,
};
use sync_provider_core::{
    CONNECT_TIMEOUT, MAX_REMOTE_CIPHERTEXT_BYTES, ProviderError, READ_TIMEOUT, REQUEST_TIMEOUT,
    RemoteObject, RemoteObjectProvider, RemoteRead, RemoteRevision,
};
use url::Url;
use uuid::{Uuid, Version};
use vault_core::SecretString;

/// Non-secret identity of one object exposed by one gateway deployment.
#[derive(Clone)]
pub struct GatewayConfig {
    base_url: Url,
    vault_id: Uuid,
}

impl GatewayConfig {
    /// Validates and canonicalizes a gateway base URL and UUID-v4 vault ID.
    pub fn new(base_url: &str, vault_id: &str) -> Result<Self, ProviderError> {
        let mut base_url = Url::parse(base_url).map_err(|_| ProviderError::InvalidConfiguration)?;
        validate_remote_url(&base_url)?;
        if !base_url.username().is_empty()
            || base_url.password().is_some()
            || base_url.query().is_some()
            || base_url.fragment().is_some()
            || base_url.cannot_be_a_base()
        {
            return Err(ProviderError::InvalidConfiguration);
        }
        let mut path = base_url.path().trim_end_matches('/').to_owned();
        path.push('/');
        base_url.set_path(&path);
        let vault_id_text = vault_id;
        let vault_id =
            Uuid::parse_str(vault_id_text).map_err(|_| ProviderError::InvalidConfiguration)?;
        if vault_id.get_version() != Some(Version::Random)
            || vault_id_text != vault_id.hyphenated().to_string()
        {
            return Err(ProviderError::InvalidConfiguration);
        }
        Ok(Self { base_url, vault_id })
    }

    /// Returns the canonical non-secret base URL for profile persistence.
    #[must_use]
    pub fn base_url(&self) -> &Url {
        &self.base_url
    }

    /// Returns the canonical UUID-v4 object identifier.
    #[must_use]
    pub fn vault_id(&self) -> Uuid {
        self.vault_id
    }

    fn object_url(&self) -> Result<Url, ProviderError> {
        self.base_url
            .join(&format!("v1/vaults/{}", self.vault_id.hyphenated()))
            .map_err(|_| ProviderError::InvalidConfiguration)
    }
}

/// Request-memory-only gateway client. The bearer token is never serializable.
pub struct GatewayProvider {
    client: Client,
    config: GatewayConfig,
    token: SecretString,
}

impl GatewayProvider {
    /// Builds a verified-TLS client with redirects disabled and bounded operations.
    pub fn new(config: GatewayConfig, token: SecretString) -> Result<Self, ProviderError> {
        let token_len = token.expose_secret().len();
        if token_len == 0 || token_len > 512 {
            return Err(ProviderError::AuthenticationFailed);
        }
        let _ = rustls::crypto::ring::default_provider().install_default();
        let client = Client::builder()
            .redirect(Policy::none())
            .connect_timeout(CONNECT_TIMEOUT)
            .read_timeout(READ_TIMEOUT)
            .timeout(REQUEST_TIMEOUT)
            .referer(false)
            .build()
            .map_err(|_| ProviderError::InvalidConfiguration)?;
        Ok(Self {
            client,
            config,
            token,
        })
    }

    fn authenticated(&self, request: reqwest::RequestBuilder) -> reqwest::RequestBuilder {
        request.bearer_auth(self.token.expose_secret())
    }

    async fn read_success(&self, response: reqwest::Response) -> Result<RemoteRead, ProviderError> {
        let revision = strong_etag(response.headers())?;
        if response
            .headers()
            .get(CONTENT_LENGTH)
            .and_then(|value| value.to_str().ok())
            .and_then(|value| value.parse::<u64>().ok())
            .is_some_and(|size| size > MAX_REMOTE_CIPHERTEXT_BYTES as u64)
        {
            return Err(ProviderError::ObjectTooLarge);
        }
        let mut ciphertext = Vec::new();
        let mut body = response.bytes_stream();
        while let Some(chunk) = body.next().await {
            let chunk = chunk.map_err(|_| ProviderError::Transport)?;
            let next_len = ciphertext
                .len()
                .checked_add(chunk.len())
                .ok_or(ProviderError::ObjectTooLarge)?;
            if next_len > MAX_REMOTE_CIPHERTEXT_BYTES {
                return Err(ProviderError::ObjectTooLarge);
            }
            ciphertext.extend_from_slice(&chunk);
        }
        RemoteObject::new(ciphertext, revision).map(RemoteRead::Present)
    }

    async fn conditional_put(
        &self,
        header: reqwest::header::HeaderName,
        value: &str,
        ciphertext: &[u8],
    ) -> Result<RemoteRevision, ProviderError> {
        if ciphertext.len() > MAX_REMOTE_CIPHERTEXT_BYTES {
            return Err(ProviderError::ObjectTooLarge);
        }
        let request = self
            .client
            .put(self.config.object_url()?)
            .header(header, value)
            .header(CONTENT_TYPE, "application/octet-stream")
            .body(ciphertext.to_vec());
        let response = self
            .authenticated(request)
            .send()
            .await
            .map_err(|_| ProviderError::WriteResultUncertain)?;
        match response.status() {
            status if status.is_success() => self.confirm_committed(ciphertext).await,
            StatusCode::PRECONDITION_FAILED | StatusCode::CONFLICT => {
                Err(ProviderError::RemoteChanged)
            }
            StatusCode::UNAUTHORIZED | StatusCode::FORBIDDEN => {
                Err(ProviderError::AuthenticationFailed)
            }
            StatusCode::PAYLOAD_TOO_LARGE => Err(ProviderError::ObjectTooLarge),
            status if status.is_redirection() => Err(ProviderError::UnsafeProvider),
            _ => Err(ProviderError::WriteResultUncertain),
        }
    }

    async fn confirm_committed(
        &self,
        expected_ciphertext: &[u8],
    ) -> Result<RemoteRevision, ProviderError> {
        match self.read().await {
            Ok(RemoteRead::Present(remote)) if remote.ciphertext() == expected_ciphertext => {
                Ok(remote.revision().clone())
            }
            Ok(RemoteRead::Present(_) | RemoteRead::Missing) => Err(ProviderError::RemoteChanged),
            Err(_) => Err(ProviderError::WriteResultUncertain),
        }
    }
}

impl RemoteObjectProvider for GatewayProvider {
    async fn read(&self) -> Result<RemoteRead, ProviderError> {
        let request = self.client.get(self.config.object_url()?);
        let response = self
            .authenticated(request)
            .send()
            .await
            .map_err(|_| ProviderError::Transport)?;
        match response.status() {
            StatusCode::OK => self.read_success(response).await,
            StatusCode::NOT_FOUND => Ok(RemoteRead::Missing),
            StatusCode::UNAUTHORIZED | StatusCode::FORBIDDEN => {
                Err(ProviderError::AuthenticationFailed)
            }
            StatusCode::PAYLOAD_TOO_LARGE => Err(ProviderError::ObjectTooLarge),
            status if status.is_redirection() => Err(ProviderError::UnsafeProvider),
            _ => Err(ProviderError::Transport),
        }
    }

    async fn create_if_absent(&self, ciphertext: &[u8]) -> Result<RemoteRevision, ProviderError> {
        self.conditional_put(IF_NONE_MATCH, "*", ciphertext).await
    }

    async fn replace_if_revision(
        &self,
        expected: &RemoteRevision,
        ciphertext: &[u8],
    ) -> Result<RemoteRevision, ProviderError> {
        self.conditional_put(IF_MATCH, expected.as_provider_token(), ciphertext)
            .await
    }
}

fn strong_etag(headers: &reqwest::header::HeaderMap) -> Result<RemoteRevision, ProviderError> {
    let etag = headers
        .get(ETAG)
        .ok_or(ProviderError::UnsupportedProvider)?
        .to_str()
        .map_err(|_| ProviderError::UnsafeProvider)?
        .trim();
    if etag.starts_with("W/") || etag.len() < 2 || !etag.starts_with('"') || !etag.ends_with('"') {
        return Err(ProviderError::UnsupportedProvider);
    }
    RemoteRevision::new(etag)
}

fn validate_remote_url(url: &Url) -> Result<(), ProviderError> {
    if url.scheme() == "https" {
        return Ok(());
    }
    if url.scheme() != "http" {
        return Err(ProviderError::InvalidConfiguration);
    }
    let host = url.host_str().ok_or(ProviderError::InvalidConfiguration)?;
    let ip_host = host.trim_start_matches('[').trim_end_matches(']');
    if host.eq_ignore_ascii_case("localhost")
        || ip_host
            .parse::<IpAddr>()
            .is_ok_and(|address| address.is_loopback())
    {
        Ok(())
    } else {
        Err(ProviderError::InvalidConfiguration)
    }
}

#[cfg(test)]
mod tests {
    use super::GatewayConfig;

    const VAULT_ID: &str = "00112233-4455-4677-8899-aabbccddeeff";

    #[test]
    fn canonicalizes_safe_urls_and_uuid_v4() {
        let config = GatewayConfig::new("https://GATEWAY.example.test/base", VAULT_ID)
            .expect("valid gateway");
        assert_eq!(
            config.base_url().as_str(),
            "https://gateway.example.test/base/"
        );
        assert_eq!(config.vault_id().to_string(), VAULT_ID);
        assert!(GatewayConfig::new("http://localhost:8080", VAULT_ID).is_ok());
        assert!(GatewayConfig::new("http://127.0.0.1:8080", VAULT_ID).is_ok());
    }

    #[test]
    fn rejects_insecure_remote_and_unsafe_identity_inputs() {
        assert!(GatewayConfig::new("http://example.test", VAULT_ID).is_err());
        assert!(GatewayConfig::new("https://user:pass@example.test", VAULT_ID).is_err());
        assert!(GatewayConfig::new("https://example.test?token=secret", VAULT_ID).is_err());
        assert!(GatewayConfig::new("https://example.test", "../vault").is_err());
        assert!(
            GatewayConfig::new(
                "https://example.test",
                "00112233-4455-3677-8899-aabbccddeeff"
            )
            .is_err()
        );
    }
}
