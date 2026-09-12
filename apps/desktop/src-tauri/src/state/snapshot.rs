use vault_session::{VaultSession, WriteRestriction};

use crate::dto::{VaultCapabilitiesDto, VaultSnapshotDto, WriteRestrictionDto};

use super::display_file_name;

pub(super) fn from_session(
    session: &VaultSession,
) -> Result<VaultSnapshotDto, vault_session::SessionError> {
    let vault = session.projection()?;
    let file_name = display_file_name(session.path()).unwrap_or_else(|| "vault.kdbx".to_owned());
    let write_restriction = session.write_restriction();
    let capabilities = VaultCapabilitiesDto {
        format_version: session.version().to_string(),
        writable: write_restriction.is_none(),
        write_restriction: write_restriction.map(restriction_dto),
    };
    Ok(VaultSnapshotDto::from_vault(
        &vault,
        session.is_dirty(),
        file_name,
        capabilities,
    ))
}

fn restriction_dto(restriction: WriteRestriction) -> WriteRestrictionDto {
    match restriction {
        WriteRestriction::UnsupportedWriteFormat => WriteRestrictionDto::UnsupportedWriteFormat,
        WriteRestriction::UnsupportedPersistencePlatform => {
            WriteRestrictionDto::UnsupportedPersistencePlatform
        }
        WriteRestriction::ReadOnlySource => WriteRestrictionDto::ReadOnlySource,
    }
}

#[cfg(test)]
mod tests {
    use super::restriction_dto;
    use crate::dto::WriteRestrictionDto;
    use vault_session::WriteRestriction;

    #[test]
    fn all_write_restrictions_have_stable_dto_values() {
        assert!(matches!(
            restriction_dto(WriteRestriction::UnsupportedWriteFormat),
            WriteRestrictionDto::UnsupportedWriteFormat
        ));
        assert!(matches!(
            restriction_dto(WriteRestriction::UnsupportedPersistencePlatform),
            WriteRestrictionDto::UnsupportedPersistencePlatform
        ));
        assert!(matches!(
            restriction_dto(WriteRestriction::ReadOnlySource),
            WriteRestrictionDto::ReadOnlySource
        ));
    }
}
