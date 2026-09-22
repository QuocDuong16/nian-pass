use super::{DesktopError, DesktopVaultService};
use crate::dto::PasswordHealthReportDto;

impl DesktopVaultService {
    /// Builds one local password-health report without returning password
    /// plaintext or equality fingerprints to the WebView.
    pub fn password_health_report(&self) -> Result<PasswordHealthReportDto, DesktopError> {
        let session = self.session.as_ref().ok_or(DesktopError::Locked)?;
        Ok(PasswordHealthReportDto::from_report(
            &session.password_health_report(),
        ))
    }
}
