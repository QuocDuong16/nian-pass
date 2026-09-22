#[cfg(any(target_os = "android", target_os = "ios"))]
mod app_state;
#[cfg(target_os = "android")]
pub(crate) mod attachment_commands;
mod autofill;
#[cfg(target_os = "android")]
pub(crate) mod autofill_commands;
pub(crate) mod commands;
pub(crate) mod errors;
mod generation;
mod mutations;
#[cfg(target_os = "android")]
mod persistence;
#[cfg(target_os = "android")]
pub(crate) mod read_commands;
mod service_mutations;
mod session;
mod state;
#[cfg(any(target_os = "android", test))]
mod state_attachments;
mod state_autofill;
#[cfg(any(target_os = "ios", test))]
mod state_ios;
mod state_reads;
#[cfg(target_os = "android")]
mod state_security;
mod transaction;

#[cfg(target_os = "android")]
pub(crate) mod security_commands;
#[cfg(target_os = "android")]
pub(crate) mod source;
#[cfg(target_os = "android")]
mod source_attachments;
#[cfg(target_os = "android")]
mod source_autofill;
#[cfg(target_os = "ios")]
pub(crate) mod source_ios;
#[cfg(target_os = "android")]
mod source_security;

#[cfg(target_os = "ios")]
pub(crate) mod ios_commands;

#[cfg(any(target_os = "android", target_os = "ios"))]
pub(crate) use app_state::{MobileAppState, install_state};
pub(crate) use errors::MobileError;

#[cfg(test)]
mod contract;
