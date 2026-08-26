#[cfg(target_os = "android")]
mod app_state;
pub(crate) mod commands;
pub(crate) mod errors;
mod session;
mod state;

#[cfg(target_os = "android")]
pub(crate) mod source;

#[cfg(target_os = "android")]
pub(crate) use app_state::{MobileAppState, install_state};
pub(crate) use errors::MobileError;

#[cfg(test)]
mod contract;
