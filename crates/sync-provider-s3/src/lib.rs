//! AWS S3 and conditionally-compatible object transport.
//!
//! Credentials are supplied explicitly; this crate never constructs the AWS
//! default credential chain, IMDS, ECS, SSO, shared-file, or environment
//! credential providers.

use std::net::IpAddr;

use aws_sdk_s3::{
    Client,
    config::{BehaviorVersion, Credentials, Region, retry::RetryConfig, timeout::TimeoutConfig},
    primitives::ByteStream,
};
use aws_smithy_http_client::{
    Builder as HttpClientBuilder,
    tls::{self, rustls_provider::CryptoMode},
};
use sync_provider_core::{
    CONNECT_TIMEOUT, MAX_REMOTE_CIPHERTEXT_BYTES, ProviderError, READ_TIMEOUT, REQUEST_TIMEOUT,
    RemoteObject, RemoteObjectProvider, RemoteRead, RemoteRevision,
};
use tokio::io::AsyncReadExt as _;
use url::Url;
use vault_core::SecretString;

/// Non-secret S3 target configuration for one exact object.
#[derive(Clone)]
pub struct S3Config {
    endpoint: Option<Url>,
    region: String,
    bucket: String,
    object_key: String,
    path_style: bool,
}

impl S3Config {
    /// Validates one AWS/default or custom S3 target.
    pub fn new(
        endpoint: Option<&str>,
        region: String,
        bucket: String,
        object_key: String,
        path_style: bool,
    ) -> Result<Self, ProviderError> {
        if region.trim().is_empty() || bucket.trim().is_empty() || object_key.is_empty() {
            return Err(ProviderError::InvalidConfiguration);
        }
        let endpoint = endpoint
            .filter(|value| !value.trim().is_empty())
            .map(Url::parse)
            .transpose()
            .map_err(|_| ProviderError::InvalidConfiguration)?;
        if let Some(endpoint) = endpoint.as_ref() {
            validate_endpoint(endpoint)?;
        }
        Ok(Self {
            endpoint,
            region,
            bucket,
            object_key,
            path_style,
        })
    }

    /// Returns the optional non-secret custom endpoint.
    #[must_use]
    pub fn endpoint(&self) -> Option<&Url> {
        self.endpoint.as_ref()
    }

    /// Returns the configured region.
    #[must_use]
    pub fn region(&self) -> &str {
        &self.region
    }

    /// Returns the configured bucket.
    #[must_use]
    pub fn bucket(&self) -> &str {
        &self.bucket
    }

    /// Returns the exact object key.
    #[must_use]
    pub fn object_key(&self) -> &str {
        &self.object_key
    }

    /// Returns whether path-style addressing is required.
    #[must_use]
    pub const fn path_style(&self) -> bool {
        self.path_style
    }
}

/// Explicit request-memory-only AWS credentials.
pub struct S3Credentials {
    access_key_id: String,
    secret_access_key: SecretString,
    session_token: Option<SecretString>,
}

impl S3Credentials {
    /// Creates explicit credentials without consulting any ambient source.
    pub fn new(
        access_key_id: String,
        secret_access_key: SecretString,
        session_token: Option<SecretString>,
    ) -> Result<Self, ProviderError> {
        if access_key_id.trim().is_empty() || secret_access_key.expose_secret().is_empty() {
            return Err(ProviderError::InvalidConfiguration);
        }
        Ok(Self {
            access_key_id,
            secret_access_key,
            session_token,
        })
    }
}

/// Conditional S3 object client. SDK automatic retries are disabled so a PUT
/// is never replayed without an intervening caller-controlled read.
pub struct S3Provider {
    client: Client,
    config: S3Config,
}

impl S3Provider {
    /// Builds a SigV4 client exclusively from explicit target and credentials.
    #[must_use]
    pub fn new(config: S3Config, credentials: S3Credentials) -> Self {
        let credentials = Credentials::new(
            credentials.access_key_id,
            credentials.secret_access_key.expose_secret(),
            credentials
                .session_token
                .as_ref()
                .map(|token| token.expose_secret().to_owned()),
            None,
            "nian-pass-explicit",
        );
        let timeout = TimeoutConfig::builder()
            .connect_timeout(CONNECT_TIMEOUT)
            .read_timeout(READ_TIMEOUT)
            .operation_timeout(REQUEST_TIMEOUT)
            .build();
        let mut builder = aws_sdk_s3::Config::builder()
            .behavior_version(BehaviorVersion::latest())
            .http_client(
                HttpClientBuilder::new()
                    .tls_provider(tls::Provider::Rustls(CryptoMode::Ring))
                    .build_https(),
            )
            .region(Region::new(config.region.clone()))
            .credentials_provider(credentials)
            .timeout_config(timeout)
            .retry_config(RetryConfig::standard().with_max_attempts(1))
            .force_path_style(config.path_style);
        if let Some(endpoint) = config.endpoint.as_ref() {
            builder = builder.endpoint_url(endpoint.as_str());
        }
        Self {
            client: Client::from_conf(builder.build()),
            config,
        }
    }

    async fn read_output(
        &self,
        output: aws_sdk_s3::operation::get_object::GetObjectOutput,
    ) -> Result<RemoteRead, ProviderError> {
        if output
            .content_length()
            .is_some_and(|size| size < 0 || size as u64 > MAX_REMOTE_CIPHERTEXT_BYTES as u64)
        {
            return Err(ProviderError::ObjectTooLarge);
        }
        let revision = output
            .e_tag()
            .ok_or(ProviderError::UnsupportedProvider)
            .and_then(RemoteRevision::new)?;
        let mut reader = output.body.into_async_read();
        let mut ciphertext = Vec::new();
        let mut chunk = [0_u8; 64 * 1024];
        loop {
            let count = reader
                .read(&mut chunk)
                .await
                .map_err(|_| ProviderError::Transport)?;
            if count == 0 {
                break;
            }
            let next_len = ciphertext
                .len()
                .checked_add(count)
                .ok_or(ProviderError::ObjectTooLarge)?;
            if next_len > MAX_REMOTE_CIPHERTEXT_BYTES {
                return Err(ProviderError::ObjectTooLarge);
            }
            ciphertext.extend_from_slice(&chunk[..count]);
        }
        RemoteObject::new(ciphertext, revision).map(RemoteRead::Present)
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

    async fn put(
        &self,
        expected: Option<&RemoteRevision>,
        ciphertext: &[u8],
    ) -> Result<RemoteRevision, ProviderError> {
        if ciphertext.len() > MAX_REMOTE_CIPHERTEXT_BYTES {
            return Err(ProviderError::ObjectTooLarge);
        }
        let request = self
            .client
            .put_object()
            .bucket(&self.config.bucket)
            .key(&self.config.object_key)
            .body(ByteStream::from(ciphertext.to_vec()));
        let request = match expected {
            Some(revision) => request.if_match(revision.as_provider_token()),
            None => request.if_none_match("*"),
        };
        match request.send().await {
            Ok(_) => self.confirm_committed(ciphertext).await,
            Err(error) => match error
                .raw_response()
                .map(|response| response.status().as_u16())
            {
                Some(409 | 412) => Err(ProviderError::RemoteChanged),
                Some(404) if expected.is_some() => Err(ProviderError::RemoteChanged),
                Some(401 | 403) => Err(ProviderError::AuthenticationFailed),
                Some(_) => Err(ProviderError::Transport),
                None => Err(ProviderError::WriteResultUncertain),
            },
        }
    }
}

impl RemoteObjectProvider for S3Provider {
    async fn read(&self) -> Result<RemoteRead, ProviderError> {
        match self
            .client
            .get_object()
            .bucket(&self.config.bucket)
            .key(&self.config.object_key)
            .send()
            .await
        {
            Ok(output) => self.read_output(output).await,
            Err(error) => match error
                .raw_response()
                .map(|response| response.status().as_u16())
            {
                Some(404) => Ok(RemoteRead::Missing),
                Some(401 | 403) => Err(ProviderError::AuthenticationFailed),
                _ => Err(ProviderError::Transport),
            },
        }
    }

    async fn create_if_absent(&self, ciphertext: &[u8]) -> Result<RemoteRevision, ProviderError> {
        self.put(None, ciphertext).await
    }

    async fn replace_if_revision(
        &self,
        expected: &RemoteRevision,
        ciphertext: &[u8],
    ) -> Result<RemoteRevision, ProviderError> {
        self.put(Some(expected), ciphertext).await
    }
}

fn validate_endpoint(endpoint: &Url) -> Result<(), ProviderError> {
    if !endpoint.username().is_empty()
        || endpoint.password().is_some()
        || endpoint.query().is_some()
        || endpoint.fragment().is_some()
    {
        return Err(ProviderError::InvalidConfiguration);
    }
    if endpoint.scheme() == "https" {
        return Ok(());
    }
    if endpoint.scheme() != "http" {
        return Err(ProviderError::InvalidConfiguration);
    }
    let host = endpoint
        .host_str()
        .ok_or(ProviderError::InvalidConfiguration)?;
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

    use super::{S3Config, S3Credentials, S3Provider};

    #[test]
    fn custom_endpoints_fail_closed_on_plaintext_remote_http() {
        assert!(
            S3Config::new(
                Some("http://s3.example.test"),
                "us-east-1".to_owned(),
                "bucket".to_owned(),
                "vault.kdbx".to_owned(),
                true,
            )
            .is_err()
        );
        assert!(
            S3Config::new(
                Some("http://127.0.0.1:9000"),
                "us-east-1".to_owned(),
                "bucket".to_owned(),
                "vault.kdbx".to_owned(),
                true,
            )
            .is_ok()
        );
    }

    #[test]
    fn empty_object_coordinates_are_rejected() {
        assert!(
            S3Config::new(
                None,
                String::new(),
                "bucket".to_owned(),
                "key".to_owned(),
                false
            )
            .is_err()
        );
        assert!(
            S3Config::new(
                None,
                "region".to_owned(),
                "bucket".to_owned(),
                String::new(),
                false
            )
            .is_err()
        );
    }

    #[tokio::test(flavor = "current_thread")]
    async fn get_maps_existing_missing_auth_and_oversize() {
        let (endpoint, server) = scripted_server(vec![response(
            200,
            &[("ETag", "\"opaque-r1\"")],
            b"encrypted",
        )])
        .await;
        assert!(matches!(
            provider(&endpoint).read().await,
            Ok(RemoteRead::Present(_))
        ));
        let requests = server.await.expect("server task");
        assert!(requests[0].starts_with("GET /bucket/vault.kdbx"));
        assert!(
            requests[0]
                .to_ascii_lowercase()
                .contains("authorization: aws4-hmac-sha256")
        );

        let (endpoint, server) = scripted_server(vec![response(404, &[], b"")]).await;
        assert!(matches!(
            provider(&endpoint).read().await,
            Ok(RemoteRead::Missing)
        ));
        server.await.expect("server task");

        let (endpoint, server) = scripted_server(vec![response(403, &[], b"")]).await;
        assert!(matches!(
            provider(&endpoint).read().await,
            Err(ProviderError::AuthenticationFailed)
        ));
        server.await.expect("server task");

        let oversized = format!(
            "HTTP/1.1 200 OK\r\nETag: \"r1\"\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
            sync_provider_core::MAX_REMOTE_CIPHERTEXT_BYTES + 1
        );
        let (endpoint, server) = scripted_server(vec![oversized.into_bytes()]).await;
        assert!(matches!(
            provider(&endpoint).read().await,
            Err(ProviderError::ObjectTooLarge)
        ));
        server.await.expect("server task");
    }

    #[tokio::test(flavor = "current_thread")]
    async fn conditional_writes_emit_cas_headers_and_map_concurrency() {
        let candidate = b"encrypted-kdbx";
        let (endpoint, server) = scripted_server(vec![
            response(200, &[("ETag", "\"put-r1\"")], b""),
            response(200, &[("ETag", "\"read-r2\"")], candidate),
        ])
        .await;
        let revision = provider(&endpoint)
            .create_if_absent(candidate)
            .await
            .expect("create should succeed");
        assert_eq!(revision.as_provider_token(), "\"read-r2\"");
        let requests = server.await.expect("server task");
        assert!(
            requests[0]
                .to_ascii_lowercase()
                .contains("if-none-match: *")
        );

        let (endpoint, server) = scripted_server(vec![
            response(200, &[("ETag", "\"put-r2\"")], b""),
            response(200, &[("ETag", "\"read-r3\"")], candidate),
        ])
        .await;
        provider(&endpoint)
            .replace_if_revision(
                &RemoteRevision::new("\"read-r2\"").expect("revision"),
                candidate,
            )
            .await
            .expect("replace should succeed");
        let requests = server.await.expect("server task");
        assert!(
            requests[0]
                .to_ascii_lowercase()
                .contains("if-match: \"read-r2\"")
        );

        for status in [404, 409, 412] {
            let (endpoint, server) = scripted_server(vec![response(status, &[], b"")]).await;
            assert!(matches!(
                provider(&endpoint)
                    .replace_if_revision(
                        &RemoteRevision::new("\"stale\"").expect("revision"),
                        candidate,
                    )
                    .await,
                Err(ProviderError::RemoteChanged)
            ));
            server.await.expect("server task");
        }
    }

    #[tokio::test(flavor = "current_thread")]
    async fn successful_put_requires_an_exact_and_available_readback() {
        let candidate = b"encrypted-kdbx";
        let (endpoint, server) = scripted_server(vec![
            response(200, &[("ETag", "\"put-r1\"")], b""),
            response(200, &[("ETag", "\"read-r2\"")], b"different-ciphertext"),
        ])
        .await;
        assert!(matches!(
            provider(&endpoint).create_if_absent(candidate).await,
            Err(ProviderError::RemoteChanged)
        ));
        server.await.expect("server task");

        let (endpoint, server) =
            scripted_server(vec![response(200, &[("ETag", "\"put-r1\"")], b"")]).await;
        assert!(matches!(
            provider(&endpoint).create_if_absent(candidate).await,
            Err(ProviderError::WriteResultUncertain)
        ));
        server.await.expect("server task");
    }

    fn provider(endpoint: &str) -> S3Provider {
        let config = S3Config::new(
            Some(endpoint),
            "us-east-1".to_owned(),
            "bucket".to_owned(),
            "vault.kdbx".to_owned(),
            true,
        )
        .expect("loopback config");
        let credentials = S3Credentials::new(
            "SYNTHETIC_ACCESS_KEY".to_owned(),
            SecretString::new("SECRET_S3_ACCESS_SECRET".to_owned()),
            Some(SecretString::new("SYNTHETIC_SESSION_TOKEN".to_owned())),
        )
        .expect("synthetic credentials");
        S3Provider::new(config, credentials)
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
                        line.to_ascii_lowercase()
                            .strip_prefix("content-length: ")
                            .and_then(|value| value.parse::<usize>().ok())
                    })
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
        (format!("http://{address}"), task)
    }

    fn response(status: u16, headers: &[(&str, &str)], body: &[u8]) -> Vec<u8> {
        let reason = match status {
            200 => "OK",
            403 => "Forbidden",
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
