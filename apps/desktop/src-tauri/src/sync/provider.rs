use serde::Deserialize;
use sync_provider_core::{ProviderError, RemoteObjectProvider, RemoteRead, RemoteRevision};
use sync_provider_gateway::{GatewayConfig, GatewayProvider};
use sync_provider_s3::{S3Config, S3Credentials, S3Provider};
use sync_provider_webdav::{WebDavConfig, WebDavProvider};
use vault_core::SecretString;

use crate::{state::DesktopError, sync::profile::SyncProfileTargetDto};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ProviderCredentialsDto {
    webdav: Option<WebDavCredentialsDto>,
    s3: Option<S3CredentialsDto>,
    gateway: Option<GatewayCredentialsDto>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct WebDavCredentialsDto {
    username: String,
    password: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct S3CredentialsDto {
    access_key_id: String,
    secret_access_key: String,
    session_token: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct GatewayCredentialsDto {
    access_token: String,
}

pub enum DesktopProvider {
    Webdav(WebDavProvider),
    S3(S3Provider),
    Gateway(GatewayProvider),
}

impl DesktopProvider {
    pub fn new(
        target: &SyncProfileTargetDto,
        credentials: ProviderCredentialsDto,
    ) -> Result<Self, DesktopError> {
        match target {
            SyncProfileTargetDto::Webdav { resource_url } => {
                let credentials = credentials
                    .webdav
                    .ok_or(DesktopError::SyncCredentialsRequired)?;
                let config = WebDavConfig::new(resource_url, credentials.username)
                    .map_err(|_| DesktopError::SyncUnsafeProvider)?;
                WebDavProvider::new(config, SecretString::new(credentials.password))
                    .map(Self::Webdav)
                    .map_err(|_| DesktopError::SyncUnsafeProvider)
            }
            SyncProfileTargetDto::S3 {
                endpoint,
                region,
                bucket,
                object_key,
                path_style,
            } => {
                let credentials = credentials
                    .s3
                    .ok_or(DesktopError::SyncCredentialsRequired)?;
                let config = S3Config::new(
                    endpoint.as_deref(),
                    region.clone(),
                    bucket.clone(),
                    object_key.clone(),
                    *path_style,
                )
                .map_err(|_| DesktopError::SyncUnsafeProvider)?;
                let session_token = credentials
                    .session_token
                    .filter(|token| !token.is_empty())
                    .map(SecretString::new);
                let credentials = S3Credentials::new(
                    credentials.access_key_id,
                    SecretString::new(credentials.secret_access_key),
                    session_token,
                )
                .map_err(|_| DesktopError::SyncCredentialsRequired)?;
                Ok(Self::S3(S3Provider::new(config, credentials)))
            }
            SyncProfileTargetDto::Gateway { base_url, vault_id } => {
                let credentials = credentials
                    .gateway
                    .ok_or(DesktopError::SyncCredentialsRequired)?;
                let config = GatewayConfig::new(base_url, vault_id)
                    .map_err(|_| DesktopError::SyncUnsafeProvider)?;
                GatewayProvider::new(config, SecretString::new(credentials.access_token))
                    .map(Self::Gateway)
                    .map_err(|_| DesktopError::SyncCredentialsRequired)
            }
        }
    }
}

impl RemoteObjectProvider for DesktopProvider {
    async fn read(&self) -> Result<RemoteRead, ProviderError> {
        match self {
            Self::Webdav(provider) => provider.read().await,
            Self::S3(provider) => provider.read().await,
            Self::Gateway(provider) => provider.read().await,
        }
    }

    async fn create_if_absent(&self, ciphertext: &[u8]) -> Result<RemoteRevision, ProviderError> {
        match self {
            Self::Webdav(provider) => provider.create_if_absent(ciphertext).await,
            Self::S3(provider) => provider.create_if_absent(ciphertext).await,
            Self::Gateway(provider) => provider.create_if_absent(ciphertext).await,
        }
    }

    async fn replace_if_revision(
        &self,
        expected: &RemoteRevision,
        ciphertext: &[u8],
    ) -> Result<RemoteRevision, ProviderError> {
        match self {
            Self::Webdav(provider) => provider.replace_if_revision(expected, ciphertext).await,
            Self::S3(provider) => provider.replace_if_revision(expected, ciphertext).await,
            Self::Gateway(provider) => provider.replace_if_revision(expected, ciphertext).await,
        }
    }
}
