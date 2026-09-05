use std::{fs, path::PathBuf, sync::Arc};

use nian_pass_sync_gateway::{GatewayState, Storage, TokenVerifier, serve};
use reqwest::{Client, StatusCode, header::ETAG};
use sha2::{Digest, Sha256};
use tokio::{
    io::AsyncWriteExt as _,
    net::{TcpListener, TcpStream},
    sync::oneshot,
    task::JoinHandle,
};
use uuid::Uuid;

const TOKEN: &str = "synthetic-high-entropy-gateway-token-http-tests";

struct TestDirectory(PathBuf);

impl TestDirectory {
    fn new() -> Self {
        let path = std::env::temp_dir().join(format!("nian-pass-gateway-http-{}", Uuid::new_v4()));
        fs::create_dir(&path).expect("test directory");
        Self(path)
    }
}

impl Drop for TestDirectory {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

struct TestServer {
    base_url: String,
    address: std::net::SocketAddr,
    shutdown: oneshot::Sender<()>,
    task: JoinHandle<()>,
}

impl TestServer {
    async fn start(storage: &std::path::Path) -> Self {
        let listener = TcpListener::bind("127.0.0.1:0").await.expect("bind");
        let address = listener.local_addr().expect("address");
        let state = Arc::new(GatewayState::new(
            TokenVerifier::new(TOKEN).expect("token"),
            Storage::open(storage).expect("storage"),
        ));
        let (shutdown, receiver) = oneshot::channel();
        let task = tokio::spawn(async move {
            serve(listener, state, async {
                let _ = receiver.await;
            })
            .await
            .expect("server");
        });
        Self {
            base_url: format!("http://{address}"),
            address,
            shutdown,
            task,
        }
    }

    fn vault_url(&self, id: Uuid) -> String {
        format!("{}/v1/vaults/{}", self.base_url, id.hyphenated())
    }

    async fn stop(self) {
        let _ = self.shutdown.send(());
        self.task.await.expect("server task");
    }
}

fn client() -> Client {
    let _ = rustls::crypto::ring::default_provider().install_default();
    Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .expect("client")
}

fn expected_etag(bytes: &[u8]) -> String {
    let mut output = String::from("\"");
    for byte in Sha256::digest(bytes) {
        use std::fmt::Write as _;
        write!(&mut output, "{byte:02x}").expect("string write");
    }
    output.push('"');
    output
}

#[tokio::test(flavor = "current_thread")]
async fn authentication_health_and_missing_object_are_narrow() {
    let directory = TestDirectory::new();
    let server = TestServer::start(&directory.0).await;
    let client = client();
    let id = Uuid::new_v4();
    let url = server.vault_url(id);

    let missing = client.get(&url).send().await.expect("missing auth");
    assert_eq!(missing.status(), StatusCode::UNAUTHORIZED);
    assert!(!missing.text().await.expect("body").contains(TOKEN));
    let wrong = client
        .get(&url)
        .bearer_auth("wrong-but-still-long-enough-synthetic-token-0000")
        .send()
        .await
        .expect("wrong auth");
    assert_eq!(wrong.status(), StatusCode::UNAUTHORIZED);
    assert!(!wrong.text().await.expect("body").contains(TOKEN));
    let authenticated = client
        .get(&url)
        .bearer_auth(TOKEN)
        .send()
        .await
        .expect("authenticated");
    assert_eq!(authenticated.status(), StatusCode::NOT_FOUND);

    let health = client
        .get(format!("{}/healthz", server.base_url))
        .send()
        .await
        .expect("health");
    assert_eq!(health.status(), StatusCode::OK);
    assert_eq!(health.text().await.expect("health body"), "OK\n");
    server.stop().await;
}

#[tokio::test(flavor = "current_thread")]
async fn conditional_create_and_exact_replace_preserve_bytes_and_etags() {
    let directory = TestDirectory::new();
    let server = TestServer::start(&directory.0).await;
    let client = client();
    let id = Uuid::new_v4();
    let url = server.vault_url(id);
    let first = b"opaque-encrypted-kdbx-generation-one";
    let created = client
        .put(&url)
        .bearer_auth(TOKEN)
        .header("If-None-Match", "*")
        .header("Content-Type", "application/octet-stream")
        .body(first.to_vec())
        .send()
        .await
        .expect("create");
    assert_eq!(created.status(), StatusCode::CREATED);
    assert_eq!(created.headers()[ETAG], expected_etag(first));

    let duplicate = client
        .put(&url)
        .bearer_auth(TOKEN)
        .header("If-None-Match", "*")
        .header("Content-Type", "application/octet-stream")
        .body(b"must-not-overwrite".to_vec())
        .send()
        .await
        .expect("duplicate");
    assert_eq!(duplicate.status(), StatusCode::PRECONDITION_FAILED);

    let read = client
        .get(&url)
        .bearer_auth(TOKEN)
        .send()
        .await
        .expect("read");
    assert_eq!(read.headers()[ETAG], expected_etag(first));
    assert_eq!(read.bytes().await.expect("bytes").as_ref(), first);

    let second = b"opaque-encrypted-kdbx-generation-two";
    let replaced = client
        .put(&url)
        .bearer_auth(TOKEN)
        .header("If-Match", expected_etag(first))
        .header("Content-Type", "application/octet-stream")
        .body(second.to_vec())
        .send()
        .await
        .expect("replace");
    assert_eq!(replaced.status(), StatusCode::NO_CONTENT);
    assert_eq!(replaced.headers()[ETAG], expected_etag(second));
    let stale = client
        .put(&url)
        .bearer_auth(TOKEN)
        .header("If-Match", expected_etag(first))
        .header("Content-Type", "application/octet-stream")
        .body(b"stale".to_vec())
        .send()
        .await
        .expect("stale");
    assert_eq!(stale.status(), StatusCode::PRECONDITION_FAILED);
    server.stop().await;
}

#[tokio::test(flavor = "current_thread")]
async fn blind_writes_bad_ids_traversal_and_oversized_bodies_fail_closed() {
    let directory = TestDirectory::new();
    let server = TestServer::start(&directory.0).await;
    let client = client();
    let id = Uuid::new_v4();
    let url = server.vault_url(id);
    let blind = client
        .put(&url)
        .bearer_auth(TOKEN)
        .header("Content-Type", "application/octet-stream")
        .body(b"blind".to_vec())
        .send()
        .await
        .expect("blind");
    assert_eq!(blind.status(), StatusCode::PRECONDITION_REQUIRED);
    for path in [
        "not-a-uuid",
        "..%2Fsecret",
        "00112233-4455-3677-8899-aabbccddeeff",
    ] {
        let response = client
            .get(format!("{}/v1/vaults/{path}", server.base_url))
            .bearer_auth(TOKEN)
            .send()
            .await
            .expect("invalid path");
        assert_eq!(response.status(), StatusCode::NOT_FOUND);
    }
    let oversized = client
        .put(&url)
        .bearer_auth(TOKEN)
        .header("If-None-Match", "*")
        .header("Content-Type", "application/octet-stream")
        .header(
            "Content-Length",
            (sync_provider_core::MAX_REMOTE_CIPHERTEXT_BYTES + 1).to_string(),
        )
        .body(Vec::new())
        .send()
        .await
        .expect("oversized");
    assert_eq!(oversized.status(), StatusCode::PAYLOAD_TOO_LARGE);
    server.stop().await;
}

#[tokio::test(flavor = "current_thread")]
async fn concurrent_replacements_have_exactly_one_generation_winner() {
    let directory = TestDirectory::new();
    let server = TestServer::start(&directory.0).await;
    let client = client();
    let id = Uuid::new_v4();
    let url = server.vault_url(id);
    let initial = b"initial-generation";
    client
        .put(&url)
        .bearer_auth(TOKEN)
        .header("If-None-Match", "*")
        .header("Content-Type", "application/octet-stream")
        .body(initial.to_vec())
        .send()
        .await
        .expect("create");
    let replace = |body: &'static [u8]| {
        client
            .put(&url)
            .bearer_auth(TOKEN)
            .header("If-Match", expected_etag(initial))
            .header("Content-Type", "application/octet-stream")
            .body(body.to_vec())
            .send()
    };
    let (left, right) = tokio::join!(replace(b"candidate-left"), replace(b"candidate-right"));
    let statuses = [left.expect("left").status(), right.expect("right").status()];
    assert_eq!(
        statuses.iter().filter(|status| status.is_success()).count(),
        1
    );
    assert_eq!(
        statuses
            .iter()
            .filter(|status| **status == StatusCode::PRECONDITION_FAILED)
            .count(),
        1
    );
    let final_read = client
        .get(&url)
        .bearer_auth(TOKEN)
        .send()
        .await
        .expect("read");
    let etag = final_read.headers()[ETAG]
        .to_str()
        .expect("etag")
        .to_owned();
    let bytes = final_read.bytes().await.expect("bytes");
    assert_eq!(etag, expected_etag(&bytes));
    server.stop().await;
}

#[tokio::test(flavor = "current_thread")]
async fn interrupted_upload_preserves_previous_object_and_restart_preserves_storage() {
    let directory = TestDirectory::new();
    let server = TestServer::start(&directory.0).await;
    let client = client();
    let id = Uuid::new_v4();
    let url = server.vault_url(id);
    let original = b"complete-original";
    client
        .put(&url)
        .bearer_auth(TOKEN)
        .header("If-None-Match", "*")
        .header("Content-Type", "application/octet-stream")
        .body(original.to_vec())
        .send()
        .await
        .expect("create");
    let mut stream = TcpStream::connect(server.address)
        .await
        .expect("raw connection");
    let request = format!(
        "PUT /v1/vaults/{} HTTP/1.1\r\nHost: {}\r\nAuthorization: Bearer {}\r\nIf-Match: {}\r\nContent-Type: application/octet-stream\r\nContent-Length: 100\r\nConnection: close\r\n\r\npartial",
        id.hyphenated(),
        server.address,
        TOKEN,
        expected_etag(original)
    );
    stream
        .write_all(request.as_bytes())
        .await
        .expect("partial request");
    let _ = server.shutdown.send(());
    stream.shutdown().await.expect("disconnect");
    server.task.await.expect("graceful server task");
    let restarted = TestServer::start(&directory.0).await;
    let read = client
        .get(restarted.vault_url(id))
        .bearer_auth(TOKEN)
        .send()
        .await
        .expect("read");
    assert_eq!(read.bytes().await.expect("bytes").as_ref(), original);
    let temporary_entries = fs::read_dir(directory.0.join(".tmp"))
        .expect("temporary directory")
        .count();
    assert_eq!(temporary_entries, 0);
    let read = client
        .get(restarted.vault_url(id))
        .bearer_auth(TOKEN)
        .send()
        .await
        .expect("restart read");
    assert_eq!(read.bytes().await.expect("bytes").as_ref(), original);
    restarted.stop().await;
}
