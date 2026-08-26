#![cfg(target_os = "android")]

use std::sync::{Arc, Mutex};

use tauri::{Manager, Runtime};

use super::state::MobileVaultService;

#[derive(Clone)]
pub(crate) struct MobileAppState {
    pub(crate) service: Arc<Mutex<MobileVaultService>>,
}

impl MobileAppState {
    fn new() -> Self {
        Self {
            service: Arc::new(Mutex::new(MobileVaultService::new())),
        }
    }
}

pub(crate) fn install_state<R: Runtime>(app: &mut tauri::App<R>) {
    app.manage(MobileAppState::new());
}
