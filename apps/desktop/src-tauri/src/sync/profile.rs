use std::{
    fs,
    io::{self, Write},
    path::{Path, PathBuf},
};

use atomic_write_file::AtomicWriteFile;
use serde::{Deserialize, Serialize};
use sync_engine::{ProfileId, RecoveryStatus, SourceBinding, SyncStore, TargetBinding};
use sync_provider_core::CiphertextDigest;
use sync_provider_s3::S3Config;
use sync_provider_webdav::WebDavConfig;

use crate::state::DesktopError;

const PROFILE_SCHEMA: u32 = 1;

#[derive(Clone, Eq, PartialEq, Serialize, Deserialize)]
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
    fn normalized(&self) -> Result<Self, DesktopError> {
        match self {
            Self::Webdav { resource_url } => {
                let config = WebDavConfig::new(resource_url, String::new())
                    .map_err(|_| DesktopError::SyncUnsafeProvider)?;
                Ok(Self::Webdav {
                    resource_url: config.resource_url().as_str().to_owned(),
                })
            }
            Self::S3 {
                endpoint,
                region,
                bucket,
                object_key,
                path_style,
            } => {
                let config = S3Config::new(
                    endpoint.as_deref(),
                    region.trim().to_owned(),
                    bucket.trim().to_owned(),
                    object_key.clone(),
                    *path_style,
                )
                .map_err(|_| DesktopError::SyncUnsafeProvider)?;
                Ok(Self::S3 {
                    endpoint: config.endpoint().map(|value| value.as_str().to_owned()),
                    region: config.region().to_owned(),
                    bucket: config.bucket().to_owned(),
                    object_key: config.object_key().to_owned(),
                    path_style: config.path_style(),
                })
            }
        }
    }

    pub(super) fn target_binding(&self) -> Result<TargetBinding, DesktopError> {
        let normalized = self.normalized()?;
        let mut identity = Vec::new();
        match normalized {
            Self::Webdav { resource_url } => {
                identity.extend_from_slice(b"webdav-target-v1");
                append_identity_field(&mut identity, resource_url.as_bytes());
            }
            Self::S3 {
                endpoint,
                region,
                bucket,
                object_key,
                path_style,
            } => {
                identity.extend_from_slice(b"s3-target-v1");
                match endpoint {
                    Some(endpoint) => {
                        identity.push(1);
                        append_identity_field(&mut identity, endpoint.as_bytes());
                    }
                    None => identity.push(0),
                }
                append_identity_field(&mut identity, region.as_bytes());
                append_identity_field(&mut identity, bucket.as_bytes());
                append_identity_field(&mut identity, object_key.as_bytes());
                identity.push(u8::from(path_style));
            }
        }
        TargetBinding::from_sha256(CiphertextDigest::of(&identity).as_str().to_owned())
            .map_err(|_| DesktopError::SyncFailed)
    }
}

fn append_identity_field(identity: &mut Vec<u8>, value: &[u8]) {
    identity.extend_from_slice(&(value.len() as u64).to_be_bytes());
    identity.extend_from_slice(value);
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
        let target = request.target.normalized()?;
        SourceBinding::from_sha256(source_binding.clone())
            .map_err(|_| DesktopError::InvalidRequest)?;
        let profile_id = match request.profile_id {
            Some(profile_id) => {
                ProfileId::parse(&profile_id).map_err(|_| DesktopError::InvalidRequest)?;
                let existing = self.load(&profile_id)?;
                if existing.source_binding != source_binding || existing.target != target {
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
            target,
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
        let target = profile.target.target_binding()?;
        let store = SyncStore::open(application_data, id, source, target)
            .map_err(|_| DesktopError::SyncFailed)?;
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
    let mut profile: StoredProfile =
        serde_json::from_slice(&fs::read(path).map_err(|_| DesktopError::SyncFailed)?)
            .map_err(|_| DesktopError::SyncFailed)?;
    if profile.schema_version != PROFILE_SCHEMA {
        return Err(DesktopError::SyncFailed);
    }
    ProfileId::parse(&profile.profile_id).map_err(|_| DesktopError::SyncFailed)?;
    SourceBinding::from_sha256(profile.source_binding.clone())
        .map_err(|_| DesktopError::SyncFailed)?;
    profile.target = profile.target.normalized()?;
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
    use std::{fs, path::PathBuf};

    use sync_engine::ProfileId;
    use sync_provider_core::CiphertextDigest;

    use super::{ProfileRepository, SaveSyncProfileRequestDto, SyncProfileTargetDto};
    use crate::state::DesktopError;

    struct TestDirectory(PathBuf);

    impl TestDirectory {
        fn new() -> Self {
            let path = std::env::temp_dir()
                .join(format!("nian-pass-profile-test-{}", uuid::Uuid::new_v4()));
            fs::create_dir(&path).expect("test directory");
            Self(path)
        }
    }

    impl Drop for TestDirectory {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    fn source_binding() -> String {
        CiphertextDigest::of(b"source").as_str().to_owned()
    }

    fn webdav(resource_url: &str) -> SyncProfileTargetDto {
        SyncProfileTargetDto::Webdav {
            resource_url: resource_url.to_owned(),
        }
    }

    fn s3(endpoint: Option<&str>, bucket: &str, object_key: &str) -> SyncProfileTargetDto {
        SyncProfileTargetDto::S3 {
            endpoint: endpoint.map(str::to_owned),
            region: "us-east-1".to_owned(),
            bucket: bucket.to_owned(),
            object_key: object_key.to_owned(),
            path_style: endpoint.is_some(),
        }
    }

    fn save_new(
        repository: &ProfileRepository,
        directory: &TestDirectory,
        target: SyncProfileTargetDto,
    ) -> super::SyncProfileDto {
        repository
            .save(
                SaveSyncProfileRequestDto {
                    profile_id: None,
                    target,
                },
                source_binding(),
                &directory.0,
            )
            .expect("new profile should save")
    }

    fn update(
        repository: &ProfileRepository,
        directory: &TestDirectory,
        profile_id: &str,
        target: SyncProfileTargetDto,
    ) -> Result<super::SyncProfileDto, DesktopError> {
        repository.save(
            SaveSyncProfileRequestDto {
                profile_id: Some(profile_id.to_owned()),
                target,
            },
            source_binding(),
            &directory.0,
        )
    }

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
        let directory = TestDirectory::new();
        let repository = ProfileRepository::open(&directory.0).expect("repository");
        let saved = save_new(
            &repository,
            &directory,
            webdav("https://dav.example.test/vault.kdbx"),
        );
        let encoded = fs::read_to_string(
            directory
                .0
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
    }

    #[test]
    fn existing_webdav_profile_accepts_only_the_same_normalized_target() {
        let directory = TestDirectory::new();
        let repository = ProfileRepository::open(&directory.0).expect("repository");
        let saved = save_new(
            &repository,
            &directory,
            webdav("https://DAV.EXAMPLE.TEST:443/vault.kdbx"),
        );

        let updated = update(
            &repository,
            &directory,
            &saved.profile_id,
            webdav("https://dav.example.test/vault.kdbx"),
        )
        .expect("canonical-equivalent target should update");
        assert_eq!(updated.profile_id, saved.profile_id);
        assert!(matches!(
            update(
                &repository,
                &directory,
                &saved.profile_id,
                webdav("https://dav.example.test/other.kdbx"),
            ),
            Err(DesktopError::InvalidRequest)
        ));
        assert!(matches!(
            update(
                &repository,
                &directory,
                &saved.profile_id,
                s3(None, "bucket", "vault.kdbx"),
            ),
            Err(DesktopError::InvalidRequest)
        ));
    }

    #[test]
    fn existing_s3_profile_rejects_every_remote_identity_change() {
        let directory = TestDirectory::new();
        let repository = ProfileRepository::open(&directory.0).expect("repository");
        let original = s3(Some("https://s3.example.test"), "bucket-a", "vault-a.kdbx");
        let saved = save_new(&repository, &directory, original.clone());
        update(&repository, &directory, &saved.profile_id, original)
            .expect("same S3 target should update");

        for changed_target in [
            s3(Some("https://s3.example.test"), "bucket-b", "vault-a.kdbx"),
            s3(Some("https://s3.example.test"), "bucket-a", "vault-b.kdbx"),
            s3(
                Some("https://other-s3.example.test"),
                "bucket-a",
                "vault-a.kdbx",
            ),
            SyncProfileTargetDto::S3 {
                endpoint: Some("https://s3.example.test".to_owned()),
                region: "eu-west-1".to_owned(),
                bucket: "bucket-a".to_owned(),
                object_key: "vault-a.kdbx".to_owned(),
                path_style: true,
            },
            SyncProfileTargetDto::S3 {
                endpoint: Some("https://s3.example.test".to_owned()),
                region: "us-east-1".to_owned(),
                bucket: "bucket-a".to_owned(),
                object_key: "vault-a.kdbx".to_owned(),
                path_style: false,
            },
        ] {
            assert!(matches!(
                update(&repository, &directory, &saved.profile_id, changed_target,),
                Err(DesktopError::InvalidRequest)
            ));
        }
    }

    #[test]
    fn base_and_active_journal_cannot_be_retargeted() {
        for marker in ["base.json", "journal.json"] {
            let directory = TestDirectory::new();
            let repository = ProfileRepository::open(&directory.0).expect("repository");
            let saved = save_new(
                &repository,
                &directory,
                webdav("https://dav.example.test/a.kdbx"),
            );
            let sync_directory = directory.0.join("sync").join(&saved.profile_id);
            fs::create_dir_all(&sync_directory).expect("sync directory");
            fs::write(sync_directory.join(marker), b"active state").expect("state marker");

            assert!(matches!(
                update(
                    &repository,
                    &directory,
                    &saved.profile_id,
                    webdav("https://dav.example.test/b.kdbx"),
                ),
                Err(DesktopError::InvalidRequest)
            ));
            assert!(sync_directory.join(marker).is_file());
            assert!(matches!(
                repository
                    .load(&saved.profile_id)
                    .expect("original profile")
                    .target,
                SyncProfileTargetDto::Webdav { resource_url }
                    if resource_url == "https://dav.example.test/a.kdbx"
            ));
        }
    }

    #[test]
    fn a_new_target_requires_and_receives_a_fresh_uuid_v4() {
        let directory = TestDirectory::new();
        let repository = ProfileRepository::open(&directory.0).expect("repository");
        let first = save_new(
            &repository,
            &directory,
            webdav("https://dav.example.test/a.kdbx"),
        );
        let second = save_new(
            &repository,
            &directory,
            webdav("https://dav.example.test/b.kdbx"),
        );

        assert_ne!(first.profile_id, second.profile_id);
        ProfileId::parse(&first.profile_id).expect("first UUID v4");
        ProfileId::parse(&second.profile_id).expect("second UUID v4");
    }
}
