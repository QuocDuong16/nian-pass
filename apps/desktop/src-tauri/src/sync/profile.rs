use std::{
    fs,
    io::{self, Write},
    path::{Path, PathBuf},
};

use atomic_write_file::AtomicWriteFile;
use serde::{Deserialize, Serialize};
use sync_engine::{ProfileId, RecoveryStatus, SourceBinding, SyncStore};
use sync_provider_s3::S3Config;
use sync_provider_webdav::WebDavConfig;

use crate::state::DesktopError;

const PROFILE_SCHEMA: u32 = 1;

#[derive(Clone, Serialize, Deserialize)]
#[serde(tag = "provider", rename_all = "camelCase", deny_unknown_fields)]
pub enum SyncProfileTargetDto {
    Webdav {
        #[serde(rename = "resourceUrl")]
        resource_url: String,
    },
    S3 {
        endpoint: Option<String>,
        region: String,
        bucket: String,
        #[serde(rename = "objectKey")]
        object_key: String,
        #[serde(rename = "pathStyle")]
        path_style: bool,
    },
}

impl SyncProfileTargetDto {
    fn validate(&self) -> Result<(), DesktopError> {
        match self {
            Self::Webdav { resource_url } => WebDavConfig::new(resource_url, String::new())
                .map(|_| ())
                .map_err(|_| DesktopError::SyncUnsafeProvider),
            Self::S3 {
                endpoint,
                region,
                bucket,
                object_key,
                path_style,
            } => S3Config::new(
                endpoint.as_deref(),
                region.clone(),
                bucket.clone(),
                object_key.clone(),
                *path_style,
            )
            .map(|_| ())
            .map_err(|_| DesktopError::SyncUnsafeProvider),
        }
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SaveSyncProfileRequestDto {
    profile_id: Option<String>,
    target: SyncProfileTargetDto,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncProfileDto {
    pub profile_id: String,
    pub target: SyncProfileTargetDto,
    pub available: bool,
    pub recovery_required: bool,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct StoredProfile {
    schema_version: u32,
    pub profile_id: String,
    pub source_binding: String,
    pub target: SyncProfileTargetDto,
}

pub struct ProfileRepository {
    directory: PathBuf,
}

impl ProfileRepository {
    pub fn open(application_data: &Path) -> Result<Self, DesktopError> {
        let directory = application_data.join("sync-profiles");
        create_private_directory(&directory)?;
        Ok(Self { directory })
    }

    pub fn list(
        &self,
        current_source: Option<&str>,
        application_data: &Path,
    ) -> Result<Vec<SyncProfileDto>, DesktopError> {
        let mut profiles = Vec::new();
        let entries = fs::read_dir(&self.directory).map_err(|_| DesktopError::SyncFailed)?;
        for entry in entries {
            let entry = entry.map_err(|_| DesktopError::SyncFailed)?;
            let path = entry.path();
            if path.extension().and_then(|value| value.to_str()) != Some("json") {
                continue;
            }
            let profile = read_profile(&path)?;
            let recovery_required =
                super::recovery_status(application_data, &profile)? == RecoveryStatus::Required;
            profiles.push(SyncProfileDto {
                available: current_source == Some(profile.source_binding.as_str()),
                recovery_required,
                profile_id: profile.profile_id,
                target: profile.target,
            });
        }
        profiles.sort_by(|left, right| left.profile_id.cmp(&right.profile_id));
        Ok(profiles)
    }

    pub fn save(
        &self,
        request: SaveSyncProfileRequestDto,
        source_binding: String,
        application_data: &Path,
    ) -> Result<SyncProfileDto, DesktopError> {
        request.target.validate()?;
        SourceBinding::from_sha256(source_binding.clone())
            .map_err(|_| DesktopError::InvalidRequest)?;
        let profile_id = match request.profile_id {
            Some(profile_id) => {
                ProfileId::parse(&profile_id).map_err(|_| DesktopError::InvalidRequest)?;
                let existing = self.load(&profile_id)?;
                if existing.source_binding != source_binding {
                    return Err(DesktopError::InvalidRequest);
                }
                profile_id
            }
            None => ProfileId::random().to_canonical_string(),
        };
        let profile = StoredProfile {
            schema_version: PROFILE_SCHEMA,
            profile_id: profile_id.clone(),
            source_binding: source_binding.clone(),
            target: request.target,
        };
        let bytes = serde_json::to_vec(&profile).map_err(|_| DesktopError::SyncFailed)?;
        atomic_write(&self.path(&profile_id), &bytes)?;
        let recovery_required =
            super::recovery_status(application_data, &profile)? == RecoveryStatus::Required;
        Ok(SyncProfileDto {
            profile_id,
            target: profile.target,
            available: true,
            recovery_required,
        })
    }

    pub fn load(&self, profile_id: &str) -> Result<StoredProfile, DesktopError> {
        ProfileId::parse(profile_id).map_err(|_| DesktopError::InvalidRequest)?;
        read_profile(&self.path(profile_id))
    }

    pub fn delete(&self, profile_id: &str, application_data: &Path) -> Result<(), DesktopError> {
        let profile = self.load(profile_id)?;
        let id = ProfileId::parse(profile_id).map_err(|_| DesktopError::InvalidRequest)?;
        let source = SourceBinding::from_sha256(profile.source_binding)
            .map_err(|_| DesktopError::InvalidRequest)?;
        let store =
            SyncStore::open(application_data, id, source).map_err(|_| DesktopError::SyncFailed)?;
        if store
            .recovery_status()
            .map_err(|_| DesktopError::SyncFailed)?
            == RecoveryStatus::Required
        {
            return Err(DesktopError::SyncRecoveryRequired);
        }
        remove_regular_file(&self.path(profile_id))?;
        let sync_directory = application_data.join("sync").join(profile_id);
        match fs::symlink_metadata(&sync_directory) {
            Ok(metadata) if metadata.file_type().is_dir() && !metadata.file_type().is_symlink() => {
                fs::remove_dir_all(sync_directory).map_err(|_| DesktopError::SyncFailed)?;
            }
            Ok(_) => return Err(DesktopError::SyncFailed),
            Err(error) if error.kind() == io::ErrorKind::NotFound => {}
            Err(_) => return Err(DesktopError::SyncFailed),
        }
        Ok(())
    }

    fn path(&self, profile_id: &str) -> PathBuf {
        self.directory.join(format!("{profile_id}.json"))
    }
}

fn read_profile(path: &Path) -> Result<StoredProfile, DesktopError> {
    let metadata = fs::symlink_metadata(path).map_err(|_| DesktopError::SyncFailed)?;
    if metadata.file_type().is_symlink() || !metadata.file_type().is_file() {
        return Err(DesktopError::SyncFailed);
    }
    let profile: StoredProfile =
        serde_json::from_slice(&fs::read(path).map_err(|_| DesktopError::SyncFailed)?)
            .map_err(|_| DesktopError::SyncFailed)?;
    if profile.schema_version != PROFILE_SCHEMA {
        return Err(DesktopError::SyncFailed);
    }
    ProfileId::parse(&profile.profile_id).map_err(|_| DesktopError::SyncFailed)?;
    SourceBinding::from_sha256(profile.source_binding.clone())
        .map_err(|_| DesktopError::SyncFailed)?;
    profile.target.validate()?;
    Ok(profile)
}

fn create_private_directory(path: &Path) -> Result<(), DesktopError> {
    fs::create_dir_all(path).map_err(|_| DesktopError::SyncFailed)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt as _;
        fs::set_permissions(path, fs::Permissions::from_mode(0o700))
            .map_err(|_| DesktopError::SyncFailed)?;
    }
    Ok(())
}

fn atomic_write(path: &Path, bytes: &[u8]) -> Result<(), DesktopError> {
    let options = AtomicWriteFile::options();
    #[cfg(unix)]
    let options = {
        use std::os::unix::fs::OpenOptionsExt as _;
        let mut options = options;
        options.mode(0o600);
        options
    };
    let mut file = options.open(path).map_err(|_| DesktopError::SyncFailed)?;
    file.write_all(bytes)
        .map_err(|_| DesktopError::SyncFailed)?;
    file.flush().map_err(|_| DesktopError::SyncFailed)?;
    file.commit().map_err(|_| DesktopError::SyncFailed)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt as _;
        fs::set_permissions(path, fs::Permissions::from_mode(0o600))
            .map_err(|_| DesktopError::SyncFailed)?;
    }
    Ok(())
}

fn remove_regular_file(path: &Path) -> Result<(), DesktopError> {
    let metadata = fs::symlink_metadata(path).map_err(|_| DesktopError::SyncFailed)?;
    if metadata.file_type().is_symlink() || !metadata.file_type().is_file() {
        return Err(DesktopError::SyncFailed);
    }
    fs::remove_file(path).map_err(|_| DesktopError::SyncFailed)
}

#[cfg(test)]
mod tests {
    use std::fs;

    use sync_provider_core::CiphertextDigest;

    use super::{ProfileRepository, SaveSyncProfileRequestDto, SyncProfileTargetDto};

    #[test]
    fn persistent_profile_request_has_no_secret_fields() {
        let request = SaveSyncProfileRequestDto {
            profile_id: None,
            target: SyncProfileTargetDto::S3 {
                endpoint: None,
                region: "us-east-1".to_owned(),
                bucket: "bucket".to_owned(),
                object_key: "vault.kdbx".to_owned(),
                path_style: false,
            },
        };
        let value = serde_json::to_value(&request.target).expect("target should serialize");
        let encoded = value.to_string();
        assert!(!encoded.contains("secret"));
        assert!(!encoded.contains("password"));
        assert!(!encoded.contains("sessionToken"));
    }

    #[test]
    fn persisted_profile_contains_only_non_secret_target_and_source_binding() {
        let directory =
            std::env::temp_dir().join(format!("nian-pass-profile-test-{}", uuid::Uuid::new_v4()));
        fs::create_dir(&directory).expect("test directory");
        let repository = ProfileRepository::open(&directory).expect("repository");
        let saved = repository
            .save(
                SaveSyncProfileRequestDto {
                    profile_id: None,
                    target: SyncProfileTargetDto::Webdav {
                        resource_url: "https://dav.example.test/vault.kdbx".to_owned(),
                    },
                },
                CiphertextDigest::of(b"source").as_str().to_owned(),
                &directory,
            )
            .expect("profile should save");
        let encoded = fs::read_to_string(
            directory
                .join("sync-profiles")
                .join(format!("{}.json", saved.profile_id)),
        )
        .expect("profile should read");
        for marker in [
            "SECRET_WEBDAV_PASSWORD",
            "SECRET_S3_ACCESS_SECRET",
            "password",
            "secretAccessKey",
            "sessionToken",
            "masterPassword",
        ] {
            assert!(!encoded.contains(marker));
        }
        fs::remove_dir_all(directory).expect("test cleanup");
    }
}
