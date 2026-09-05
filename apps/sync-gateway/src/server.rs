use std::{convert::Infallible, future::Future, io, sync::Arc};

use bytes::Bytes;
use http_body_util::{BodyExt as _, Full, Limited};
use hyper::{
    Method, Request, Response, StatusCode,
    body::Incoming,
    header::{
        CACHE_CONTROL, CONTENT_LENGTH, CONTENT_TYPE, ETAG, HeaderValue, IF_MATCH, IF_NONE_MATCH,
    },
    server::conn::http1,
    service::service_fn,
};
use hyper_util::rt::TokioIo;
use sync_provider_core::{MAX_REMOTE_CIPHERTEXT_BYTES, READ_TIMEOUT, REQUEST_TIMEOUT};
use tokio::{
    net::TcpListener,
    sync::Semaphore,
    task::JoinSet,
    time::{self, Duration},
};
use uuid::{Uuid, Version};

use crate::{
    auth::TokenVerifier,
    storage::{Storage, StorageError},
};

const MAX_REQUEST_TARGET_BYTES: usize = 256;
const MAX_CONNECTIONS: usize = 64;
const MAX_CONCURRENT_WRITES: usize = 4;

pub struct GatewayState {
    token: TokenVerifier,
    storage: Arc<Storage>,
    writes: Arc<Semaphore>,
}

impl GatewayState {
    #[must_use]
    pub fn new(token: TokenVerifier, storage: Storage) -> Self {
        Self {
            token,
            storage: Arc::new(storage),
            writes: Arc::new(Semaphore::new(MAX_CONCURRENT_WRITES)),
        }
    }
}

pub async fn serve<F>(
    listener: TcpListener,
    state: Arc<GatewayState>,
    shutdown: F,
) -> io::Result<()>
where
    F: Future<Output = ()>,
{
    tokio::pin!(shutdown);
    let connections = Arc::new(Semaphore::new(MAX_CONNECTIONS));
    let mut tasks = JoinSet::new();
    loop {
        tokio::select! {
            biased;
            () = &mut shutdown => break,
            accepted = listener.accept() => {
                let (stream, _) = accepted?;
                let Ok(permit) = connections.clone().try_acquire_owned() else {
                    drop(stream);
                    continue;
                };
                let state = state.clone();
                tasks.spawn(async move {
                    let _permit = permit;
                    let service = service_fn(move |request| handle(request, state.clone()));
                    let mut builder = http1::Builder::new();
                    builder.keep_alive(false).max_buf_size(32 * 1024);
                    let _ = time::timeout(
                        REQUEST_TIMEOUT + Duration::from_secs(5),
                        builder.serve_connection(TokioIo::new(stream), service),
                    ).await;
                });
            }
        }
    }
    let _ = time::timeout(REQUEST_TIMEOUT, async {
        while tasks.join_next().await.is_some() {}
    })
    .await;
    Ok(())
}

async fn handle(
    request: Request<Incoming>,
    state: Arc<GatewayState>,
) -> Result<Response<Full<Bytes>>, Infallible> {
    let response = route(request, &state).await;
    Ok(response)
}

async fn route(request: Request<Incoming>, state: &GatewayState) -> Response<Full<Bytes>> {
    if request.uri().path() == "/healthz" && request.uri().query().is_none() {
        return if request.method() == Method::GET {
            fixed(StatusCode::OK, "OK\n")
        } else {
            fixed(StatusCode::METHOD_NOT_ALLOWED, "Method Not Allowed\n")
        };
    }
    if request.uri().to_string().len() > MAX_REQUEST_TARGET_BYTES
        || !state.token.authenticates(request.headers())
    {
        return fixed(StatusCode::UNAUTHORIZED, "Unauthorized\n");
    }
    let Some(vault_id) = vault_id(request.uri().path(), request.uri().query()) else {
        return fixed(StatusCode::NOT_FOUND, "Not Found\n");
    };
    match *request.method() {
        Method::GET => read(vault_id, state).await,
        Method::PUT => write(vault_id, request, state).await,
        _ => fixed(StatusCode::METHOD_NOT_ALLOWED, "Method Not Allowed\n"),
    }
}

async fn read(vault_id: Uuid, state: &GatewayState) -> Response<Full<Bytes>> {
    match state.storage.read(vault_id).await {
        Ok(Some(object)) => object_response(object.bytes, &object.revision),
        Ok(None) => fixed(StatusCode::NOT_FOUND, "Not Found\n"),
        Err(StorageError::TooLarge) => fixed(StatusCode::PAYLOAD_TOO_LARGE, "Payload Too Large\n"),
        Err(_) => fixed(StatusCode::INTERNAL_SERVER_ERROR, "Internal Server Error\n"),
    }
}

async fn write(
    vault_id: Uuid,
    request: Request<Incoming>,
    state: &GatewayState,
) -> Response<Full<Bytes>> {
    if request
        .headers()
        .get(CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        != Some("application/octet-stream")
    {
        return fixed(
            StatusCode::UNSUPPORTED_MEDIA_TYPE,
            "Unsupported Media Type\n",
        );
    }
    if request
        .headers()
        .get(CONTENT_LENGTH)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.parse::<u64>().ok())
        .is_some_and(|size| size > MAX_REMOTE_CIPHERTEXT_BYTES as u64)
    {
        return fixed(StatusCode::PAYLOAD_TOO_LARGE, "Payload Too Large\n");
    }
    let condition = match condition(request.headers()) {
        Ok(condition) => condition,
        Err(status) => return fixed(status, status_text(status)),
    };
    let Ok(_permit) = state.writes.clone().try_acquire_owned() else {
        return fixed(StatusCode::SERVICE_UNAVAILABLE, "Service Unavailable\n");
    };
    let body = Limited::new(request.into_body(), MAX_REMOTE_CIPHERTEXT_BYTES);
    let bytes = match time::timeout(READ_TIMEOUT, body.collect()).await {
        Ok(Ok(collected)) => collected.to_bytes().to_vec(),
        Ok(Err(_)) => return fixed(StatusCode::PAYLOAD_TOO_LARGE, "Payload Too Large\n"),
        Err(_) => return fixed(StatusCode::REQUEST_TIMEOUT, "Request Timeout\n"),
    };
    let is_create = matches!(condition, WriteCondition::Create);
    let result = match condition {
        WriteCondition::Create => state.storage.create(vault_id, bytes).await,
        WriteCondition::Replace(expected) => state.storage.replace(vault_id, expected, bytes).await,
    };
    match result {
        Ok(revision) => empty_with_etag(
            if is_create {
                StatusCode::CREATED
            } else {
                StatusCode::NO_CONTENT
            },
            &revision,
        ),
        Err(StorageError::PreconditionFailed) => {
            fixed(StatusCode::PRECONDITION_FAILED, "Precondition Failed\n")
        }
        Err(StorageError::TooLarge) => fixed(StatusCode::PAYLOAD_TOO_LARGE, "Payload Too Large\n"),
        Err(_) => fixed(StatusCode::INTERNAL_SERVER_ERROR, "Internal Server Error\n"),
    }
}

enum WriteCondition {
    Create,
    Replace(String),
}

fn condition(headers: &hyper::HeaderMap) -> Result<WriteCondition, StatusCode> {
    let create = single_header(headers, IF_NONE_MATCH)?;
    let replace = single_header(headers, IF_MATCH)?;
    match (create, replace) {
        (Some("*"), None) => Ok(WriteCondition::Create),
        (None, Some(value)) if valid_strong_etag(value) => {
            Ok(WriteCondition::Replace(value.to_owned()))
        }
        (None, None) => Err(StatusCode::PRECONDITION_REQUIRED),
        _ => Err(StatusCode::BAD_REQUEST),
    }
}

fn single_header(
    headers: &hyper::HeaderMap,
    name: hyper::header::HeaderName,
) -> Result<Option<&str>, StatusCode> {
    let mut values = headers.get_all(name).iter();
    let Some(value) = values.next() else {
        return Ok(None);
    };
    if values.next().is_some() {
        return Err(StatusCode::BAD_REQUEST);
    }
    value
        .to_str()
        .map(Some)
        .map_err(|_| StatusCode::BAD_REQUEST)
}

fn valid_strong_etag(value: &str) -> bool {
    value.len() == 66
        && value.starts_with('"')
        && value.ends_with('"')
        && value[1..65]
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
}

fn vault_id(path: &str, query: Option<&str>) -> Option<Uuid> {
    if query.is_some() {
        return None;
    }
    let value = path.strip_prefix("/v1/vaults/")?;
    if value.contains('/') {
        return None;
    }
    let id = Uuid::parse_str(value).ok()?;
    (id.get_version() == Some(Version::Random) && value == id.hyphenated().to_string())
        .then_some(id)
}

fn object_response(bytes: Vec<u8>, revision: &str) -> Response<Full<Bytes>> {
    let mut response = Response::new(Full::new(Bytes::from(bytes)));
    *response.status_mut() = StatusCode::OK;
    response.headers_mut().insert(
        CONTENT_TYPE,
        HeaderValue::from_static("application/octet-stream"),
    );
    response
        .headers_mut()
        .insert(CACHE_CONTROL, HeaderValue::from_static("no-store"));
    if let Ok(value) = HeaderValue::from_str(revision) {
        response.headers_mut().insert(ETAG, value);
        response
    } else {
        fixed(StatusCode::INTERNAL_SERVER_ERROR, "Internal Server Error\n")
    }
}

fn empty_with_etag(status: StatusCode, revision: &str) -> Response<Full<Bytes>> {
    let mut response = fixed(status, "");
    if let Ok(value) = HeaderValue::from_str(revision) {
        response.headers_mut().insert(ETAG, value);
        response
    } else {
        fixed(StatusCode::INTERNAL_SERVER_ERROR, "Internal Server Error\n")
    }
}

fn fixed(status: StatusCode, body: &'static str) -> Response<Full<Bytes>> {
    let mut response = Response::new(Full::new(Bytes::from_static(body.as_bytes())));
    *response.status_mut() = status;
    response
        .headers_mut()
        .insert(CACHE_CONTROL, HeaderValue::from_static("no-store"));
    response.headers_mut().insert(
        CONTENT_TYPE,
        HeaderValue::from_static("text/plain; charset=utf-8"),
    );
    response
}

fn status_text(status: StatusCode) -> &'static str {
    match status {
        StatusCode::PRECONDITION_REQUIRED => "Precondition Required\n",
        _ => "Bad Request\n",
    }
}

#[cfg(test)]
mod tests {
    use super::{valid_strong_etag, vault_id};

    #[test]
    fn strict_route_and_etag_grammar_reject_traversal_and_weak_values() {
        assert!(vault_id("/v1/vaults/00112233-4455-4677-8899-aabbccddeeff", None).is_some());
        assert!(vault_id("/v1/vaults/../secret", None).is_none());
        assert!(
            vault_id(
                "/v1/vaults/00112233-4455-4677-8899-aabbccddeeff",
                Some("force=true")
            )
            .is_none()
        );
        assert!(valid_strong_etag(&format!("\"{}\"", "a".repeat(64))));
        assert!(!valid_strong_etag("W/\"weak\""));
        assert!(!valid_strong_etag("\"malformed\""));
    }
}
