use serde::Serialize;

/// Secret-free metadata for one attachment shown in the desktop detail pane.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EntryAttachmentSummaryDto {
    pub name: String,
    pub size_bytes: u64,
    pub protected: bool,
}

impl From<&kdbx::EntryAttachmentSummary> for EntryAttachmentSummaryDto {
    fn from(value: &kdbx::EntryAttachmentSummary) -> Self {
        Self {
            name: value.name().to_owned(),
            size_bytes: value.size_bytes(),
            protected: value.protected(),
        }
    }
}

/// Safe confirmation that one explicit native attachment export completed.
#[cfg(any(desktop, target_os = "android"))]
#[derive(Clone, Copy, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AttachmentExportReceiptDto {
    pub exported: bool,
}
