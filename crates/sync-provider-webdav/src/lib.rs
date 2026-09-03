//! WebDAV transport for one exact KDBX resource.

use std::net::IpAddr;

use futures_util::StreamExt as _;
use reqwest::{
    Client, StatusCode,
    header::{CONTENT_LENGTH, ETAG, IF_MATCH, IF_NONE_MATCH},
    redirect::Policy,
};
use sync_provider_core::{
    CONNECT_TIMEOUT, MAX_REMOTE_CIPHERTEXT_BYTES, ProviderError, READ_TIMEOUT, REQUEST_TIMEOUT,
    RemoteObject, RemoteObjectProvider, RemoteRead, RemoteRevision,
};
use url::Url;
use vault_core::SecretString;

/// Non-secret WebDAV profile data for one exact remote resource.
#[derive(Clone)]
pub struct WebDavConfig {
    resource_url: Url,
    username: String,
}

impl WebDavConfig {
    /// Validates an HTTPS resource URL, permitting HTTP only on loopback.
    pub fn new(resource_url: &str, username: String) -> Result<Self, ProviderError> {
        let resource_url =
            Url::parse(resource_url).map_err(|_| ProviderError::InvalidConfiguration)?;
        validate_remote_url(&resource_url)?;
        if !resource_url.username().is_empty() || resource_url.password().is_some() {
            return Err(ProviderError::InvalidConfiguration);
        }
        if resource_url.fragment().is_some() {
            return Err(ProviderError::InvalidConfiguration);
        }
        Ok(Self {
            resource_url,
            username,
        })
    }

    /// Returns the non-secret exact resource URL for profile persistence.
    #[must_use]
    pub fn resource_url(&self) -> &Url {
        &self.resource_url
    }

    /// Returns the non-secret basic-auth username.
    #[must_use]
    pub fn username(&self) -> &str {
        &self.username
    }
}

/// Request-memory-only WebDAV client with redirects disabled.
pub struct WebDavProvider {
    client: Client,
    config: WebDavConfig,
    password: SecretString,
}

impl WebDavProvider {
    /// Builds a Rustls client. Certificate and hostname verification stay enabled.
    pub fn new(config: WebDavConfig, password: SecretString) -> Result<Self, ProviderError> {
        // `reqwest` is built without a bundled provider so the workspace can use
        // Ring consistently across both WebDAV and S3 without pulling AWS-LC.
        // A previously installed provider is safe to retain; reqwest uses that
        // process-wide selection when constructing its verified TLS config.
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
            password,
        })
    }

    fn authenticated(&self, request: reqwest::RequestBuilder) -> reqwest::RequestBuilder {
        request.basic_auth(&self.config.username, Some(self.password.expose_secret()))
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
        condition_name: reqwest::header::HeaderName,
        condition_value: &str,
        ciphertext: &[u8],
    ) -> Result<RemoteRevision, ProviderError> {
        if ciphertext.len() > MAX_REMOTE_CIPHERTEXT_BYTES {
            return Err(ProviderError::ObjectTooLarge);
        }
        let request = self
            .client
            .put(self.config.resource_url.clone())
            .header(condition_name, condition_value)
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
            StatusCode::NOT_FOUND if condition_value != "*" => Err(ProviderError::RemoteChanged),
            StatusCode::UNAUTHORIZED | StatusCode::FORBIDDEN => {
                Err(ProviderError::AuthenticationFailed)
            }
            status if status.is_redirection() => Err(ProviderError::UnsafeProvider),
            _ => Err(ProviderError::Transport),
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

impl RemoteObjectProvider for WebDavProvider {
    async fn read(&self) -> Result<RemoteRead, ProviderError> {
        let request = self.client.get(self.config.resource_url.clone());
        let response = self
            .authenticated(request)
            .send()
            .await
            .map_err(|_| ProviderError::Transport)?;
        match response.status() {
            StatusCode::NOT_FOUND => Ok(RemoteRead::Missing),
            status if status.is_success() => self.read_success(response).await,
            StatusCode::UNAUTHORIZED | StatusCode::FORBIDDEN => {
                Err(ProviderError::AuthenticationFailed)
            }
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
    use tokio::{
        io::{AsyncReadExt as _, AsyncWriteExt as _},
        net::TcpListener,
        task::JoinHandle,
    };
    use vault_core::SecretString;

    use sync_provider_core::{ProviderError, RemoteObjectProvider, RemoteRead, RemoteRevision};

    use super::{WebDavConfig, WebDavProvider};

    #[test]
    fn production_http_and_url_credentials_are_rejected() {
        assert!(WebDavConfig::new("http://example.test/vault.kdbx", "user".to_owned()).is_err());
        assert!(
            WebDavConfig::new("https://user:pass@example.test/vault.kdbx", String::new()).is_err()
        );
        assert!(
            WebDavConfig::new("https://example.test/vault.kdbx#fragment", String::new()).is_err()
        );
    }

    #[test]
    fn loopback_http_and_remote_https_are_accepted() {
        assert!(WebDavConfig::new("http://127.0.0.1:8080/vault.kdbx", "user".to_owned()).is_ok());
        assert!(WebDavConfig::new("http://[::1]:8080/vault.kdbx", "user".to_owned()).is_ok());
        assert!(
            WebDavConfig::new("https://dav.example.test/vault.kdbx", "user".to_owned()).is_ok()
        );
    }

    #[tokio::test(flavor = "current_thread")]
    async fn existing_missing_weak_etag_redirect_and_auth_are_mapped_safely() {
        let (url, server) =
            scripted_server(vec![response(200, &[("ETag", "\"r1\"")], b"vault")]).await;
        assert!(matches!(
            provider(&url).read().await,
            Ok(RemoteRead::Present(_))
        ));
        let requests = server.await.expect("server task");
        assert!(
            requests[0]
                .to_ascii_lowercase()
                .contains("authorization: basic ")
        );

        let (url, server) = scripted_server(vec![response(404, &[], b"")]).await;
        assert!(matches!(
            provider(&url).read().await,
            Ok(RemoteRead::Missing)
        ));
        server.await.expect("server task");

        let (url, server) =
            scripted_server(vec![response(200, &[("ETag", "W/\"r1\"")], b"vault")]).await;
        assert!(matches!(
            provider(&url).read().await,
            Err(ProviderError::UnsupportedProvider)
        ));
        server.await.expect("server task");

        let (url, server) = scripted_server(vec![response(
            302,
            &[("Location", "https://evil.example/vault.kdbx")],
            b"",
        )])
        .await;
        assert!(matches!(
            provider(&url).read().await,
            Err(ProviderError::UnsafeProvider)
        ));
        assert_eq!(server.await.expect("server task").len(), 1);

        let (url, server) = scripted_server(vec![response(401, &[], b"")]).await;
        assert!(matches!(
            provider(&url).read().await,
            Err(ProviderError::AuthenticationFailed)
        ));
        server.await.expect("server task");
    }

    #[tokio::test(flavor = "current_thread")]
    async fn conditional_create_and_replace_use_exact_headers_and_read_back() {
        let candidate = b"encrypted-kdbx";
        let (url, server) = scripted_server(vec![
            response(201, &[("ETag", "\"ignored\"")], b""),
            response(200, &[("ETag", "\"r2\"")], candidate),
        ])
        .await;
        let committed = provider(&url)
            .create_if_absent(candidate)
            .await
            .expect("conditional create should succeed");
        assert_eq!(committed.as_provider_token(), "\"r2\"");
        let requests = server.await.expect("server task");
        assert!(
            requests[0]
                .to_ascii_lowercase()
                .contains("if-none-match: *")
        );
        assert!(requests[1].starts_with("GET "));

        let (url, server) = scripted_server(vec![
            response(204, &[], b""),
            response(200, &[("ETag", "\"r3\"")], candidate),
        ])
        .await;
        provider(&url)
            .replace_if_revision(&RemoteRevision::new("\"r2\"").expect("revision"), candidate)
            .await
            .expect("conditional replace should succeed");
        let requests = server.await.expect("server task");
        assert!(
            requests[0]
                .to_ascii_lowercase()
                .contains("if-match: \"r2\"")
        );
    }

    #[tokio::test(flavor = "current_thread")]
    async fn preconditions_and_oversized_bodies_fail_closed() {
        for status in [409, 412] {
            let (url, server) = scripted_server(vec![response(status, &[], b"")]).await;
            assert!(matches!(
                provider(&url).create_if_absent(b"candidate").await,
                Err(ProviderError::RemoteChanged)
            ));
            server.await.expect("server task");
        }
        let oversized = format!(
            "HTTP/1.1 200 OK\r\nETag: \"r1\"\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
            sync_provider_core::MAX_REMOTE_CIPHERTEXT_BYTES + 1
        );
        let (url, server) = scripted_server(vec![oversized.into_bytes()]).await;
        assert!(matches!(
            provider(&url).read().await,
            Err(ProviderError::ObjectTooLarge)
        ));
        server.await.expect("server task");
    }

    fn provider(url: &str) -> WebDavProvider {
        WebDavProvider::new(
            WebDavConfig::new(url, "synthetic-user".to_owned()).expect("loopback URL"),
            SecretString::new("SECRET_WEBDAV_PASSWORD".to_owned()),
        )
        .expect("provider should build")
    }

    async fn scripted_server(responses: Vec<Vec<u8>>) -> (String, JoinHandle<Vec<String>>) {
        let listener = TcpListener::bind("127.0.0.1:0")
            .await
            .expect("loopback bind");
        let address = listener.local_addr().expect("local address");
        let task = tokio::spawn(async move {
            let mut requests = Vec::new();
            for response in responses {
                let (mut stream, _) = listener.accept().await.expect("request connection");
                let mut request = Vec::new();
                let mut buffer = [0_u8; 4096];
                let header_end = loop {
                    let count = stream.read(&mut buffer).await.expect("request read");
                    if count == 0 {
                        panic!("request ended before headers");
                    }
                    request.extend_from_slice(&buffer[..count]);
                    if let Some(index) = request.windows(4).position(|part| part == b"\r\n\r\n") {
                        break index + 4;
                    }
                };
                let headers = String::from_utf8_lossy(&request[..header_end]);
                let content_length = headers
                    .lines()
                    .find_map(|line| {
                        line.strip_prefix("content-length: ")
                            .or_else(|| line.strip_prefix("Content-Length: "))
                    })
                    .and_then(|value| value.parse::<usize>().ok())
                    .unwrap_or(0);
                while request.len() < header_end + content_length {
                    let count = stream.read(&mut buffer).await.expect("body read");
                    if count == 0 {
                        break;
                    }
                    request.extend_from_slice(&buffer[..count]);
                }
                requests.push(String::from_utf8_lossy(&request).into_owned());
                stream.write_all(&response).await.expect("response write");
                stream.shutdown().await.expect("response shutdown");
            }
            requests
        });
        (format!("http://{address}/vault.kdbx"), task)
    }

    fn response(status: u16, headers: &[(&str, &str)], body: &[u8]) -> Vec<u8> {
        let reason = match status {
            200 => "OK",
            201 => "Created",
            204 => "No Content",
            302 => "Found",
            401 => "Unauthorized",
            404 => "Not Found",
            409 => "Conflict",
            412 => "Precondition Failed",
            _ => "Response",
        };
        let mut response = format!("HTTP/1.1 {status} {reason}\r\n");
        for (name, value) in headers {
            response.push_str(name);
            response.push_str(": ");
            response.push_str(value);
            response.push_str("\r\n");
        }
        response.push_str(&format!(
            "Content-Length: {}\r\nConnection: close\r\n\r\n",
            body.len()
        ));
        let mut bytes = response.into_bytes();
        bytes.extend_from_slice(body);
        bytes
    }
}
