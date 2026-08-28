use super::{
    MobileError,
    autofill::{AndroidCredentialTarget, AutofillCandidateDto, PreparedAutofillFulfillment},
    state::MobileVaultService,
};

impl MobileVaultService {
    pub(crate) fn autofill_candidates(
        &self,
        target: &AndroidCredentialTarget,
    ) -> Result<Vec<AutofillCandidateDto>, MobileError> {
        if self.active_operation.is_some() {
            return Err(MobileError::Busy);
        }
        self.session
            .as_ref()
            .ok_or(MobileError::Locked)?
            .autofill_candidates(target)
    }

    pub(crate) fn begin_autofill_fulfillment(
        &mut self,
        request_token: String,
        entry_id: &str,
        target: &AndroidCredentialTarget,
    ) -> Result<PreparedAutofillFulfillment, MobileError> {
        if self.active_operation.is_some() {
            return Err(MobileError::Busy);
        }
        let operation = self.next_operation;
        self.next_operation = self.next_operation.checked_add(1).unwrap_or(1);
        self.active_operation = Some(operation);
        let prepared = self
            .session
            .as_ref()
            .ok_or(MobileError::Locked)
            .and_then(|session| {
                session.prepare_autofill_secret(operation, request_token, entry_id, target)
            });
        if prepared.is_err() {
            self.active_operation = None;
        }
        prepared
    }

    pub(crate) fn complete_autofill_fulfillment(
        &mut self,
        operation: u64,
    ) -> Result<(), MobileError> {
        if self.active_operation != Some(operation) || self.session.is_none() {
            return Err(MobileError::CredentialUnavailable);
        }
        self.active_operation = None;
        Ok(())
    }
}
