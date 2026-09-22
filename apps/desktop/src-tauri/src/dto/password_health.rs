use serde::Serialize;

use super::SummaryTextDto;

/// Secret-free local password-health report.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PasswordHealthReportDto {
    pub total_entries: usize,
    pub password_entries: usize,
    pub minimum_length: usize,
    pub weak_score_threshold: u8,
    pub issues: Vec<PasswordHealthIssueDto>,
}

/// One entry that violates at least one local password-health rule.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PasswordHealthIssueDto {
    pub entry_id: String,
    pub group_id: String,
    pub title: SummaryTextDto,
    pub missing_password: bool,
    pub empty_password: bool,
    pub reused_password: bool,
    pub below_minimum_length: bool,
    pub weak_password: bool,
    pub strength_score: Option<u8>,
}

impl PasswordHealthReportDto {
    #[must_use]
    pub fn from_report(report: &kdbx::PasswordHealthReport) -> Self {
        Self {
            total_entries: report.total_entries(),
            password_entries: report.password_entries(),
            minimum_length: kdbx::PASSWORD_POLICY_MIN_LENGTH,
            weak_score_threshold: kdbx::PASSWORD_STRENGTH_WEAK_BELOW,
            issues: report
                .issues()
                .iter()
                .map(|issue| PasswordHealthIssueDto {
                    entry_id: issue.entry_id().as_str().to_owned(),
                    group_id: issue.group_id().as_str().to_owned(),
                    title: issue.title().into(),
                    missing_password: issue.missing_password(),
                    empty_password: issue.empty_password(),
                    reused_password: issue.reused_password(),
                    below_minimum_length: issue.below_minimum_length(),
                    weak_password: issue.weak_password(),
                    strength_score: issue.strength_score(),
                })
                .collect(),
        }
    }
}
