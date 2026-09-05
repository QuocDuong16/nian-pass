use tokio::{
    io::{AsyncReadExt as _, AsyncWriteExt as _},
    net::TcpListener,
    task::JoinHandle,
};
use vault_core::SecretString;

use sync_provider_core::{ProviderError, RemoteObjectProvider, RemoteRead, RemoteRevision};
use sync_provider_gateway::{GatewayConfig, GatewayProvider};

const VAULT_ID: &str = "00112233-4455-4677-8899-aabbccddeeff";
const TOKEN: &str = "synthetic-high-entropy-provider-token-0001";

#[tokio::test(flavor = "current_thread")]
async fn get_missing_present_auth_redirect_and_size_are_mapped() {
    let (base, server) = scripted_server(vec![response(404, &[], b"")]).await;
    assert!(matches!(
        provider(&base).read().await,
        Ok(RemoteRead::Missing)
    ));
    let requests = server.await.expect("server");
    assert!(
        requests[0]
            .to_ascii_lowercase()
            .contains(&format!("authorization: bearer {TOKEN}"))
    );

    let (base, server) =
        scripted_server(vec![response(200, &[("ETag", "\"r1\"")], b"vault")]).await;
    let read = provider(&base).read().await.expect("present");
    let RemoteRead::Present(object) = read else {
        panic!("expected present")
    };
    assert_eq!(object.ciphertext(), b"vault");
    assert_eq!(object.revision().as_provider_token(), "\"r1\"");
    server.await.expect("server");

    let (base, server) =
        scripted_server(vec![response(200, &[("ETag", "W/\"weak\"")], b"vault")]).await;
    assert!(matches!(
        provider(&base).read().await,
        Err(ProviderError::UnsupportedProvider)
    ));
    server.await.expect("server");

    for status in [401, 403] {
        let (base, server) = scripted_server(vec![response(status, &[], b"")]).await;
        assert!(matches!(
            provider(&base).read().await,
            Err(ProviderError::AuthenticationFailed)
        ));
        server.await.expect("server");
    }
    let (base, server) = scripted_server(vec![response(
        302,
        &[("Location", "https://evil.test")],
        b"",
    )])
    .await;
    assert!(matches!(
        provider(&base).read().await,
        Err(ProviderError::UnsafeProvider)
    ));
    server.await.expect("server");
    let oversized = format!(
        "HTTP/1.1 200 OK\r\nETag: \"r1\"\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
        sync_provider_core::MAX_REMOTE_CIPHERTEXT_BYTES + 1
    );
    let (base, server) = scripted_server(vec![oversized.into_bytes()]).await;
    assert!(matches!(
        provider(&base).read().await,
        Err(ProviderError::ObjectTooLarge)
    ));
    server.await.expect("server");
}

#[tokio::test(flavor = "current_thread")]
async fn conditional_headers_and_exact_readback_are_required() {
    let candidate = b"encrypted-kdbx";
    let (base, server) = scripted_server(vec![
        response(201, &[("ETag", "\"ignored\"")], b""),
        response(200, &[("ETag", "\"created\"")], candidate),
    ])
    .await;
    let revision = provider(&base)
        .create_if_absent(candidate)
        .await
        .expect("create");
    assert_eq!(revision.as_provider_token(), "\"created\"");
    let requests = server.await.expect("server");
    assert!(
        requests[0]
            .to_ascii_lowercase()
            .contains("if-none-match: *")
    );
    assert!(
        requests[0]
            .to_ascii_lowercase()
            .contains("content-type: application/octet-stream")
    );
    assert!(requests[1].starts_with(&format!("GET /v1/vaults/{VAULT_ID} ")));

    let (base, server) = scripted_server(vec![
        response(204, &[("ETag", "\"ignored\"")], b""),
        response(200, &[("ETag", "\"next\"")], candidate),
    ])
    .await;
    provider(&base)
        .replace_if_revision(
            &RemoteRevision::new("\"current\"").expect("revision"),
            candidate,
        )
        .await
        .expect("replace");
    assert!(
        server.await.expect("server")[0]
            .to_ascii_lowercase()
            .contains("if-match: \"current\"")
    );

    let (base, server) = scripted_server(vec![
        response(201, &[], b""),
        response(200, &[("ETag", "\"next\"")], b"different"),
    ])
    .await;
    assert!(matches!(
        provider(&base).create_if_absent(candidate).await,
        Err(ProviderError::RemoteChanged)
    ));
    server.await.expect("server");
}

#[tokio::test(flavor = "current_thread")]
async fn precondition_auth_and_uncertain_writes_fail_closed_without_retry() {
    for status in [412, 409] {
        let (base, server) = scripted_server(vec![response(status, &[], b"")]).await;
        assert!(matches!(
            provider(&base).create_if_absent(b"candidate").await,
            Err(ProviderError::RemoteChanged)
        ));
        assert_eq!(server.await.expect("server").len(), 1);
    }
    let (base, server) = scripted_server(vec![response(401, &[], b"")]).await;
    assert!(matches!(
        provider(&base).create_if_absent(b"candidate").await,
        Err(ProviderError::AuthenticationFailed)
    ));
    server.await.expect("server");
    let (base, server) = scripted_server(vec![response(500, &[], b"")]).await;
    assert!(matches!(
        provider(&base).create_if_absent(b"candidate").await,
        Err(ProviderError::WriteResultUncertain)
    ));
    server.await.expect("server");
    let (base, server) = scripted_server(vec![]).await;
    assert!(matches!(
        provider(&base).create_if_absent(b"candidate").await,
        Err(ProviderError::WriteResultUncertain)
    ));
    assert_eq!(server.await.expect("server").len(), 1);

    let oversized = vec![0_u8; sync_provider_core::MAX_REMOTE_CIPHERTEXT_BYTES + 1];
    assert!(matches!(
        provider("http://127.0.0.1:9/")
            .create_if_absent(&oversized)
            .await,
        Err(ProviderError::ObjectTooLarge)
    ));
}

#[test]
fn https_is_required_away_from_loopback_and_token_format_is_exact() {
    assert!(GatewayConfig::new("http://example.test", VAULT_ID).is_err());
    assert!(GatewayConfig::new("https://example.test", VAULT_ID).is_ok());
    let config = GatewayConfig::new("http://127.0.0.1:8080", VAULT_ID).expect("config");
    for invalid in [
        String::new(),
        "x".repeat(31),
        "x".repeat(513),
        format!("{}\n", "x".repeat(32)),
        format!("{}\t", "x".repeat(32)),
        format!("{} ", "x".repeat(32)),
    ] {
        assert!(
            GatewayProvider::new(config.clone(), SecretString::new(invalid)).is_err(),
            "invalid token class must fail before network I/O"
        );
    }
    for valid in ["x".repeat(32), TOKEN.to_owned(), "x".repeat(512)] {
        assert!(GatewayProvider::new(config.clone(), SecretString::new(valid)).is_ok());
    }
}

fn provider(base: &str) -> GatewayProvider {
    GatewayProvider::new(
        GatewayConfig::new(base, VAULT_ID).expect("loopback config"),
        SecretString::new(TOKEN.to_owned()),
    )
    .expect("provider")
}

async fn scripted_server(responses: Vec<Vec<u8>>) -> (String, JoinHandle<Vec<String>>) {
    let listener = TcpListener::bind("127.0.0.1:0").await.expect("bind");
    let address = listener.local_addr().expect("address");
    let task = tokio::spawn(async move {
        let mut requests = Vec::new();
        let count = responses.len().max(1);
        for index in 0..count {
            let (mut stream, _) = listener.accept().await.expect("accept");
            let mut request = Vec::new();
            let mut buffer = [0_u8; 4096];
            let header_end = loop {
                let read = stream.read(&mut buffer).await.expect("read");
                if read == 0 {
                    break request.len();
                }
                request.extend_from_slice(&buffer[..read]);
                if let Some(offset) = request.windows(4).position(|part| part == b"\r\n\r\n") {
                    break offset + 4;
                }
            };
            let headers = String::from_utf8_lossy(&request[..header_end]).into_owned();
            let length = headers
                .lines()
                .find_map(|line| {
                    line.to_ascii_lowercase()
                        .strip_prefix("content-length: ")
                        .and_then(|value| value.parse::<usize>().ok())
                })
                .unwrap_or(0);
            while request.len() < header_end + length {
                let read = stream.read(&mut buffer).await.expect("body");
                if read == 0 {
                    break;
                }
                request.extend_from_slice(&buffer[..read]);
            }
            requests.push(String::from_utf8_lossy(&request).into_owned());
            if let Some(response) = responses.get(index) {
                stream.write_all(response).await.expect("response");
            }
        }
        requests
    });
    (format!("http://{address}/"), task)
}

fn response(status: u16, headers: &[(&str, &str)], body: &[u8]) -> Vec<u8> {
    let reason = match status {
        200 => "OK",
        201 => "Created",
        204 => "No Content",
        302 => "Found",
        401 => "Unauthorized",
        403 => "Forbidden",
        404 => "Not Found",
        409 => "Conflict",
        412 => "Precondition Failed",
        _ => "Error",
    };
    let mut response = format!(
        "HTTP/1.1 {status} {reason}\r\nContent-Length: {}\r\nConnection: close\r\n",
        body.len()
    )
    .into_bytes();
    for (name, value) in headers {
        response.extend_from_slice(format!("{name}: {value}\r\n").as_bytes());
    }
    response.extend_from_slice(b"\r\n");
    response.extend_from_slice(body);
    response
}
