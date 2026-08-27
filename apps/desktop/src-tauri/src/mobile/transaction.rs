#![cfg_attr(not(target_os = "android"), allow(dead_code))]

use std::{future::Future, path::PathBuf};

use super::MobileError;

pub(super) struct NativeSavePaths {
    pub(super) transaction_token: String,
    pub(super) current_path: PathBuf,
    pub(super) candidate_path: PathBuf,
}

pub(super) enum NativeCommitOutcome {
    Verified(PathBuf),
    Failed(MobileError),
}

pub(super) struct PreparedSourceCandidate<T> {
    pub(super) baseline: String,
    pub(super) candidate: String,
    pub(super) context: T,
}

/// Backend-only source boundary used by the mobile save coordinator. The
/// platform implementation owns document-provider identity and recovery.
pub(super) trait MobileDocumentSource {
    async fn prepare_save(&self, source_token: &str) -> Result<NativeSavePaths, MobileError>;

    async fn commit_candidate(
        &self,
        source_token: &str,
        transaction_token: &str,
        baseline: &str,
        candidate: &str,
    ) -> Result<NativeCommitOutcome, MobileError>;

    async fn finalize_save(
        &self,
        source_token: &str,
        transaction_token: &str,
    ) -> Result<(), MobileError>;

    async fn abort_save(&self, source_token: &str, transaction_token: &str);
}

/// Runs the Rust-owned save ordering around a platform source transaction.
/// Native code is still responsible for backup, journal, provider write,
/// rollback, and exact read-back; Rust supplies and semantically verifies the
/// encrypted KDBX candidate before the session can become clean.
pub(super) async fn run_save_transaction<S, C, T, P, PF, V, VF>(
    source: &S,
    source_token: &str,
    prepare: P,
    verify: V,
) -> Result<T, MobileError>
where
    S: MobileDocumentSource + Sync,
    P: FnOnce(PathBuf, PathBuf) -> PF,
    PF: Future<Output = Result<PreparedSourceCandidate<C>, MobileError>>,
    V: FnOnce(C, PathBuf) -> VF,
    VF: Future<Output = Result<T, MobileError>>,
{
    let paths = source.prepare_save(source_token).await?;
    let transaction_token = paths.transaction_token.clone();
    let prepared = match prepare(paths.current_path, paths.candidate_path).await {
        Ok(prepared) => prepared,
        Err(error) => {
            source.abort_save(source_token, &transaction_token).await;
            return Err(error);
        }
    };

    let read_back = match source
        .commit_candidate(
            source_token,
            &transaction_token,
            &prepared.baseline,
            &prepared.candidate,
        )
        .await
    {
        Ok(NativeCommitOutcome::Verified(path)) => path,
        Ok(NativeCommitOutcome::Failed(error)) | Err(error) => {
            if matches!(error, MobileError::SaveUncertain) {
                source.abort_save(source_token, &transaction_token).await;
            }
            return Err(error);
        }
    };

    let result = match verify(prepared.context, read_back).await {
        Ok(result) => result,
        Err(_) => {
            source.abort_save(source_token, &transaction_token).await;
            return Err(MobileError::SaveUncertain);
        }
    };
    source
        .finalize_save(source_token, &transaction_token)
        .await?;
    Ok(result)
}

#[cfg(test)]
mod tests {
    use std::{
        fs,
        sync::{
            Arc, Mutex,
            atomic::{AtomicU64, Ordering},
        },
    };

    use super::*;

    static NEXT: AtomicU64 = AtomicU64::new(0);

    #[derive(Clone, Copy)]
    enum Injection {
        None,
        PrepareFailure,
        ExternalChange,
        PreWriteFailure,
        PostWriteMismatch,
        DestructiveFailureRollbackVerified,
        DestructiveFailureRollbackUnverified,
        FinalizeFailure,
    }

    struct FakeState {
        provider: Vec<u8>,
        baseline: Vec<u8>,
        candidate: Vec<u8>,
        backup: Option<Vec<u8>>,
        journal: Option<&'static str>,
        injection: Injection,
        commit_calls: usize,
        abort_calls: usize,
    }

    #[derive(Clone)]
    struct FakeSource {
        root: Arc<PathBuf>,
        state: Arc<Mutex<FakeState>>,
    }

    impl FakeSource {
        fn new(injection: Injection) -> Self {
            let root = std::env::temp_dir().join(format!(
                "nian-pass-mobile-transaction-{}-{}",
                std::process::id(),
                NEXT.fetch_add(1, Ordering::Relaxed)
            ));
            fs::create_dir(&root).expect("test directory");
            Self {
                root: Arc::new(root),
                state: Arc::new(Mutex::new(FakeState {
                    provider: b"generation-a".to_vec(),
                    baseline: b"generation-a".to_vec(),
                    candidate: b"generation-b".to_vec(),
                    backup: None,
                    journal: None,
                    injection,
                    commit_calls: 0,
                    abort_calls: 0,
                })),
            }
        }

        fn identity(bytes: &[u8]) -> String {
            format!("{}:{:02x}", bytes.len(), bytes[0])
        }

        fn snapshot(&self) -> (Vec<u8>, Option<Vec<u8>>, Option<&'static str>, usize, usize) {
            let state = self.state.lock().expect("fake state");
            (
                state.provider.clone(),
                state.backup.clone(),
                state.journal,
                state.commit_calls,
                state.abort_calls,
            )
        }
    }

    impl Drop for FakeSource {
        fn drop(&mut self) {
            if Arc::strong_count(&self.root) == 1 {
                let _ = fs::remove_dir_all(self.root.as_path());
            }
        }
    }

    impl MobileDocumentSource for FakeSource {
        async fn prepare_save(&self, _source_token: &str) -> Result<NativeSavePaths, MobileError> {
            let state = self.state.lock().expect("fake state");
            if matches!(state.injection, Injection::PrepareFailure) {
                return Err(MobileError::SaveFailed);
            }
            let current = self.root.join("current.kdbx");
            let candidate = self.root.join("candidate.kdbx");
            fs::write(&current, &state.provider).expect("stage provider");
            fs::write(&candidate, &state.candidate).expect("stage candidate");
            Ok(NativeSavePaths {
                transaction_token: "transaction-token".to_owned(),
                current_path: current,
                candidate_path: candidate,
            })
        }

        async fn commit_candidate(
            &self,
            _source_token: &str,
            _transaction_token: &str,
            baseline: &str,
            candidate: &str,
        ) -> Result<NativeCommitOutcome, MobileError> {
            let mut state = self.state.lock().expect("fake state");
            state.commit_calls += 1;
            if matches!(state.injection, Injection::ExternalChange) {
                state.provider = b"external-generation".to_vec();
            }
            if state.provider != state.baseline || baseline != Self::identity(&state.baseline) {
                return Ok(NativeCommitOutcome::Failed(MobileError::ExternalChange));
            }
            if matches!(state.injection, Injection::PreWriteFailure) {
                return Ok(NativeCommitOutcome::Failed(MobileError::SaveFailed));
            }

            state.backup = Some(state.provider.clone());
            state.journal = Some("PREPARED");
            state.journal = Some("WRITE_STARTED");
            state.provider = state.candidate.clone();
            if candidate != Self::identity(&state.candidate) {
                return Ok(NativeCommitOutcome::Failed(MobileError::SaveUncertain));
            }
            match state.injection {
                Injection::PostWriteMismatch => {
                    state.provider = b"mismatched-generation".to_vec();
                    Ok(NativeCommitOutcome::Failed(MobileError::SaveUncertain))
                }
                Injection::DestructiveFailureRollbackVerified => {
                    state.provider = state.baseline.clone();
                    state.backup = None;
                    state.journal = None;
                    Ok(NativeCommitOutcome::Failed(MobileError::SaveFailed))
                }
                Injection::DestructiveFailureRollbackUnverified => {
                    state.provider = b"unknown-generation".to_vec();
                    Ok(NativeCommitOutcome::Failed(MobileError::SaveUncertain))
                }
                _ => {
                    let read_back = self.root.join("readback.kdbx");
                    fs::write(&read_back, &state.provider).expect("read back");
                    Ok(NativeCommitOutcome::Verified(read_back))
                }
            }
        }

        async fn finalize_save(
            &self,
            _source_token: &str,
            _transaction_token: &str,
        ) -> Result<(), MobileError> {
            let mut state = self.state.lock().expect("fake state");
            if matches!(state.injection, Injection::FinalizeFailure) {
                return Err(MobileError::SaveUncertain);
            }
            state.backup = None;
            state.journal = None;
            Ok(())
        }

        async fn abort_save(&self, _source_token: &str, _transaction_token: &str) {
            self.state.lock().expect("fake state").abort_calls += 1;
        }
    }

    async fn run(
        source: &FakeSource,
        prepare_error: Option<MobileError>,
        verify: bool,
    ) -> Result<(), MobileError> {
        run_save_transaction(
            source,
            "opaque-source-token",
            |current, candidate| async move {
                if let Some(error) = prepare_error {
                    return Err(error);
                }
                let baseline_bytes = fs::read(current).expect("current bytes");
                let candidate_bytes = fs::read(candidate).expect("candidate bytes");
                Ok(PreparedSourceCandidate {
                    baseline: FakeSource::identity(&baseline_bytes),
                    candidate: FakeSource::identity(&candidate_bytes),
                    context: (),
                })
            },
            move |(), read_back| async move {
                if verify && fs::read(read_back).expect("readback") == b"generation-b" {
                    Ok(())
                } else {
                    Err(MobileError::Internal)
                }
            },
        )
        .await
    }

    fn block_on(future: impl Future<Output = Result<(), MobileError>>) -> Result<(), MobileError> {
        tauri::async_runtime::block_on(future)
    }

    #[test]
    fn wrong_credential_and_candidate_failure_never_call_provider_commit() {
        for error in [
            MobileError::SaveAuthenticationFailed,
            MobileError::SaveFailed,
        ] {
            let source = FakeSource::new(Injection::None);
            assert!(
                matches!(block_on(run(&source, Some(error), true)), Err(value) if value == error)
            );
            let (provider, _, _, commits, aborts) = source.snapshot();
            assert_eq!(provider, b"generation-a");
            assert_eq!(commits, 0);
            assert_eq!(aborts, 1);
        }
    }

    #[test]
    fn source_preparation_and_prewrite_failure_leave_provider_unchanged() {
        for injection in [Injection::PrepareFailure, Injection::PreWriteFailure] {
            let source = FakeSource::new(injection);
            assert!(matches!(
                block_on(run(&source, None, true)),
                Err(MobileError::SaveFailed)
            ));
            let (provider, _, _, _, _) = source.snapshot();
            assert_eq!(provider, b"generation-a");
        }
    }

    #[test]
    fn external_change_is_never_overwritten() {
        let source = FakeSource::new(Injection::ExternalChange);
        assert!(matches!(
            block_on(run(&source, None, true)),
            Err(MobileError::ExternalChange)
        ));
        let (provider, _, _, _, _) = source.snapshot();
        assert_eq!(provider, b"external-generation");
    }

    #[test]
    fn verified_save_cleans_transaction_only_after_rust_verification() {
        let source = FakeSource::new(Injection::None);
        block_on(run(&source, None, true)).expect("verified save");
        let (provider, backup, journal, commits, _) = source.snapshot();
        assert_eq!(provider, b"generation-b");
        assert!(backup.is_none());
        assert!(journal.is_none());
        assert_eq!(commits, 1);
    }

    #[test]
    fn mismatch_or_semantic_failure_is_uncertain_and_retains_recovery() {
        for (injection, verify) in [
            (Injection::PostWriteMismatch, true),
            (Injection::None, false),
            (Injection::FinalizeFailure, true),
        ] {
            let source = FakeSource::new(injection);
            assert!(matches!(
                block_on(run(&source, None, verify)),
                Err(MobileError::SaveUncertain)
            ));
            let (_, backup, journal, _, _) = source.snapshot();
            assert!(backup.is_some());
            assert_eq!(journal, Some("WRITE_STARTED"));
        }
    }

    #[test]
    fn destructive_failure_requires_verified_rollback() {
        let restored = FakeSource::new(Injection::DestructiveFailureRollbackVerified);
        assert!(matches!(
            block_on(run(&restored, None, true)),
            Err(MobileError::SaveFailed)
        ));
        let (provider, backup, journal, _, _) = restored.snapshot();
        assert_eq!(provider, b"generation-a");
        assert!(backup.is_none());
        assert!(journal.is_none());

        let uncertain = FakeSource::new(Injection::DestructiveFailureRollbackUnverified);
        assert!(matches!(
            block_on(run(&uncertain, None, true)),
            Err(MobileError::SaveUncertain)
        ));
        let (provider, backup, journal, _, _) = uncertain.snapshot();
        assert_eq!(provider, b"unknown-generation");
        assert!(backup.is_some());
        assert_eq!(journal, Some("WRITE_STARTED"));
    }
}
