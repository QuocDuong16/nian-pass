use serde::Serialize;
use vault_sync::{MergeConflictFieldKind, MergeConflictKind, MergeConflictObject};

/// Explicit whole-generation conflict choice.
#[derive(Clone, Copy, Eq, PartialEq)]
pub enum ConflictChoice {
    /// Revalidate and conditionally publish the captured local generation.
    KeepLocal,
    /// Revalidate and safely apply the captured remote generation.
    KeepRemote,
}

/// Value-free merge conflict descriptor safe for presentation.
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConflictDescriptor {
    object_kind: &'static str,
    object_id: Option<String>,
    conflict_kind: &'static str,
    field_kind: Option<&'static str>,
}

/// Random process-local single-use conflict authority.
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConflictOperation {
    pub(crate) conflict_operation_id: String,
    pub(crate) initial_conflict: bool,
    pub(crate) conflicts: Vec<ConflictDescriptor>,
}

impl ConflictOperation {
    /// Opaque token required for one explicit resolution.
    #[must_use]
    pub fn id(&self) -> &str {
        &self.conflict_operation_id
    }

    /// Whether this conflict has no proven common BASE.
    #[must_use]
    pub const fn is_initial(&self) -> bool {
        self.initial_conflict
    }

    /// Structured, competing-value-free descriptors.
    #[must_use]
    pub fn conflicts(&self) -> &[ConflictDescriptor] {
        &self.conflicts
    }
}

pub(crate) fn describe(conflict: &vault_sync::MergeConflict) -> ConflictDescriptor {
    let (object_kind, object_id) = describe_object(conflict.object());
    ConflictDescriptor {
        object_kind,
        object_id,
        conflict_kind: describe_kind(conflict.kind()),
        field_kind: conflict.field().map(|field| describe_field(field.kind())),
    }
}

fn describe_object(object: &MergeConflictObject) -> (&'static str, Option<String>) {
    match object {
        MergeConflictObject::Entry(id) => ("entry", Some(id.as_str().to_owned())),
        MergeConflictObject::Group(id) => ("group", Some(id.as_str().to_owned())),
        MergeConflictObject::DatabaseMetadata => ("database", None),
        _ => ("unknown", None),
    }
}

fn describe_kind(kind: MergeConflictKind) -> &'static str {
    match kind {
        MergeConflictKind::FieldEdit => "fieldEdit",
        MergeConflictKind::DeleteVsModify => "deleteVsModify",
        MergeConflictKind::MoveVsMove => "moveVsMove",
        MergeConflictKind::GroupDeleteVsDescendantChange => "groupDeleteVsDescendantChange",
        MergeConflictKind::UuidCollision => "uuidCollision",
        MergeConflictKind::HierarchyCycle => "hierarchyCycle",
        MergeConflictKind::Metadata => "metadata",
        MergeConflictKind::Binary => "binary",
        MergeConflictKind::CustomIcon => "customIcon",
        MergeConflictKind::History => "history",
        MergeConflictKind::UnsupportedSemantic => "unsupportedSemantic",
        _ => "unknown",
    }
}

fn describe_field(kind: MergeConflictFieldKind) -> &'static str {
    match kind {
        MergeConflictFieldKind::Standard => "standard",
        MergeConflictFieldKind::Custom => "custom",
        MergeConflictFieldKind::Reserved => "reserved",
        MergeConflictFieldKind::EntryMetadata => "entryMetadata",
        MergeConflictFieldKind::GroupMetadata => "groupMetadata",
        MergeConflictFieldKind::DatabaseMetadata => "databaseMetadata",
        _ => "unknown",
    }
}

#[cfg(test)]
mod tests {
    use vault_core::{EntryId, GroupId};
    use vault_sync::{MergeConflictFieldKind, MergeConflictKind, MergeConflictObject};

    use super::{describe_field, describe_kind, describe_object};

    #[test]
    fn every_public_conflict_category_has_a_stable_value_free_label() {
        let objects = [
            (
                MergeConflictObject::Entry(EntryId::new("entry-id")),
                "entry",
                Some("entry-id"),
            ),
            (
                MergeConflictObject::Group(GroupId::new("group-id")),
                "group",
                Some("group-id"),
            ),
            (MergeConflictObject::DatabaseMetadata, "database", None),
        ];
        for (object, expected_kind, expected_id) in objects {
            let (kind, id) = describe_object(&object);
            assert_eq!(kind, expected_kind);
            assert_eq!(id.as_deref(), expected_id);
        }

        for (kind, expected) in [
            (MergeConflictKind::FieldEdit, "fieldEdit"),
            (MergeConflictKind::DeleteVsModify, "deleteVsModify"),
            (MergeConflictKind::MoveVsMove, "moveVsMove"),
            (
                MergeConflictKind::GroupDeleteVsDescendantChange,
                "groupDeleteVsDescendantChange",
            ),
            (MergeConflictKind::UuidCollision, "uuidCollision"),
            (MergeConflictKind::HierarchyCycle, "hierarchyCycle"),
            (MergeConflictKind::Metadata, "metadata"),
            (MergeConflictKind::Binary, "binary"),
            (MergeConflictKind::CustomIcon, "customIcon"),
            (MergeConflictKind::History, "history"),
            (
                MergeConflictKind::UnsupportedSemantic,
                "unsupportedSemantic",
            ),
        ] {
            assert_eq!(describe_kind(kind), expected);
        }

        for (kind, expected) in [
            (MergeConflictFieldKind::Standard, "standard"),
            (MergeConflictFieldKind::Custom, "custom"),
            (MergeConflictFieldKind::Reserved, "reserved"),
            (MergeConflictFieldKind::EntryMetadata, "entryMetadata"),
            (MergeConflictFieldKind::GroupMetadata, "groupMetadata"),
            (MergeConflictFieldKind::DatabaseMetadata, "databaseMetadata"),
        ] {
            assert_eq!(describe_field(kind), expected);
        }
    }
}
