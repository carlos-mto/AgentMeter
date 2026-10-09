//! Provider adapters and provider-specific authentication, cache and retry rules.

pub(crate) mod antigravity;
pub(crate) mod claude;
pub(crate) mod claude_diagnostics;
pub(crate) mod claude_rate_limit;
pub(crate) mod codex;
pub(crate) mod grok;
pub(crate) mod grok_bot;
