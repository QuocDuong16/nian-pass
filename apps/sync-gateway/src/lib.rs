//! Small authenticated HTTP gateway for opaque encrypted KDBX objects.
//!
//! This crate deliberately has no KDBX parser or vault-domain dependency.

mod auth;
mod server;
mod storage;

pub use auth::{MAX_TOKEN_BYTES, TokenConfigurationError, TokenVerifier};
pub use server::{GatewayState, serve};
pub use storage::{Storage, StorageError};
