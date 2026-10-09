//! Windows integration. Keep per-implementation cfg gates and portable fallbacks.
//!
//! Do not gate this entire module: activity/startup APIs are used by shared code
//! and retain their non-Windows fallback implementations.

pub(crate) mod activity;
pub(crate) mod startup;
#[cfg(target_os = "windows")]
pub(crate) mod taskbar_overlay;
