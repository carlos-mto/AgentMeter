//! Grok quota, read from the OAuth token Grok Build leaves on disk.
//! See architecture.md §5.

use std::collections::HashMap;
use std::path::PathBuf;

use serde::Deserialize;

use crate::quota::{http_failure, now, rfc3339_to_unix, ProviderQuota, QuotaWindow, UsageSlice};

const PROVIDER: &str = "grok";
const DEFAULT_BASE_URL: &str = "https://cli-chat-proxy.grok.com/v1";

/// ⚠️ `format` selects a **different quota**, not a different rendering of the
/// same one. `credits` is the subscription window a SuperGrok user cares about;
/// `rate_limits` — which is also what you get with no parameter at all — is the
/// xAI API console credit balance, a separate product. On the development
/// account the two read 44% and 13.7% at the same moment, and both look
/// perfectly reasonable in isolation.
const USAGE_PATH: &str = "/billing?format=credits";

/// The dashboard waits on every provider before it repaints, so a request that
/// never answers would freeze the whole refresh cycle, not just this card.
const REQUEST_TIMEOUT_SECONDS: u64 = 10;

fn usage_client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(REQUEST_TIMEOUT_SECONDS))
        .build()
        .map_err(|e| format!("could not build HTTP client: {e}"))
}

fn base_url() -> String {
    std::env::var("GROK_CLI_CHAT_PROXY_BASE_URL").unwrap_or_else(|_| DEFAULT_BASE_URL.to_string())
}

fn auth_path() -> Option<PathBuf> {
    dirs::home_dir().map(|home| home.join(".grok").join("auth.json"))
}

/// `auth.json` is a map keyed by `"<oidc_issuer>::<client_id>"` rather than a
/// fixed field name, so the entry has to be found by value, not by path.
#[derive(Deserialize)]
struct AuthEntry {
    key: String,
    #[serde(default)]
    expires_at: Option<String>,
}

#[derive(Deserialize)]
struct BillingResponse {
    config: BillingConfig,
}

#[derive(Deserialize)]
struct BillingConfig {
    #[serde(rename = "currentPeriod", default)]
    current_period: Option<Period>,
    #[serde(rename = "creditUsagePercent", default)]
    credit_usage_percent: Option<f64>,
    #[serde(rename = "productUsage", default)]
    product_usage: Vec<ProductUsage>,
}

#[derive(Deserialize)]
struct Period {
    /// e.g. `USAGE_PERIOD_TYPE_WEEKLY`. The provider naming its own window,
    /// which is what the label must come from.
    #[serde(rename = "type", default)]
    kind: Option<String>,
    #[serde(default)]
    start: Option<String>,
    #[serde(default)]
    end: Option<String>,
}

#[derive(Deserialize)]
struct ProductUsage {
    #[serde(default)]
    product: Option<String>,
    #[serde(rename = "usagePercent", default)]
    usage_percent: Option<f64>,
}

/// `USAGE_PERIOD_TYPE_WEEKLY` → `Weekly`. An unfamiliar period keeps its own
/// shape rather than being forced into a known bucket.
fn period_label(raw: &str) -> String {
    let name = raw.strip_prefix("USAGE_PERIOD_TYPE_").unwrap_or(raw);
    let mut chars = name.chars();
    match chars.next() {
        Some(first) => first.to_uppercase().collect::<String>() + &chars.as_str().to_lowercase(),
        None => "Usage".to_string(),
    }
}

/// Pick the credential most likely to be the active session.
///
/// Signing in to a second account adds a second entry, and map iteration order
/// is not stable — taking whichever came first would make the card flip between
/// accounts between polls. An entry that is already expired can never serve a
/// request, so any still-usable one outranks it; a missing `expires_at` means
/// "not known to be expired", not "oldest". Among usable entries the furthest
/// expiry is the freshest sign-in, and the map key breaks ties so the choice is
/// stable between polls.
fn newest_credential(entries: HashMap<String, AuthEntry>, current_time: i64) -> Option<AuthEntry> {
    entries
        .into_iter()
        .max_by_key(|(key, entry)| {
            let expires_at = entry.expires_at.as_deref().and_then(rfc3339_to_unix);
            let usable = expires_at.is_none_or(|at| at > current_time);
            (usable, expires_at, key.clone())
        })
        .map(|(_, entry)| entry)
}

fn paid_credential_quota(result: Result<ProviderQuota, String>) -> ProviderQuota {
    match result {
        Ok(quota) => quota,
        Err(message) => ProviderQuota::error(PROVIDER, message),
    }
}

pub async fn fetch() -> ProviderQuota {
    let auth_missing = auth_path().is_some_and(|path| matches!(path.try_exists(), Ok(false)));
    if auth_missing {
        return ProviderQuota::not_configured(PROVIDER, "Sign in with Grok Build to add Grok.");
    }
    paid_credential_quota(try_fetch().await)
}

async fn try_fetch() -> Result<ProviderQuota, String> {
    let path = auth_path().ok_or("could not locate the home directory")?;
    let raw = std::fs::read_to_string(&path).map_err(|e| {
        format!(
            "cannot read {} — is Grok Build installed and signed in? ({e})",
            path.display()
        )
    })?;
    let entries: HashMap<String, AuthEntry> =
        serde_json::from_str(&raw).map_err(|e| format!("unexpected shape in auth.json: {e}"))?;
    let credential = newest_credential(entries, now()).ok_or("auth.json held no credentials")?;

    if credential
        .expires_at
        .as_deref()
        .and_then(rfc3339_to_unix)
        .is_some_and(|expires_at| expires_at <= now())
    {
        return Ok(expired_token());
    }

    let response = usage_client()?
        .get(format!("{}{}", base_url(), USAGE_PATH))
        .bearer_auth(&credential.key)
        .send()
        .await
        .map_err(|e| format!("request to the billing endpoint failed: {e}"))?;

    if response.status() == reqwest::StatusCode::UNAUTHORIZED {
        // Grok's token lives about six hours — far shorter than Claude's or
        // Codex's — so this is an action state, not a transient error. The CLI
        // is not a daemon, and repeating this request cannot refresh its token.
        return Ok(expired_token());
    }
    if !response.status().is_success() {
        return Err(http_failure(response.status(), "the Grok billing endpoint"));
    }

    let body: BillingResponse = response
        .json()
        .await
        .map_err(|e| format!("could not parse the billing response: {e}"))?;

    let Some(percent) = body.config.credit_usage_percent else {
        // Reported by the account owner, not measured here: free Grok has no
        // subscription window, only a daily query allowance that this endpoint
        // does not cover.
        return Ok(ProviderQuota::unavailable(
            PROVIDER,
            "No subscription quota on this account. Free Grok is metered by daily queries, \
             which this endpoint does not report.",
        ));
    };

    let period = body.config.current_period.as_ref();
    let starts_at = period
        .and_then(|p| p.start.as_deref())
        .and_then(rfc3339_to_unix);
    let ends_at = period
        .and_then(|p| p.end.as_deref())
        .and_then(rfc3339_to_unix);
    let window = QuotaWindow {
        label: period
            .and_then(|p| p.kind.as_deref())
            .map(period_label)
            .unwrap_or_else(|| "Usage".to_string()),
        percent,
        resets_at: ends_at,
        // Grok gives both ends of the period, so the duration is exact rather
        // than assumed.
        window_seconds: match (starts_at, ends_at) {
            (Some(start), Some(end)) if end > start => Some(end - start),
            _ => None,
        },
        // Grok reports no severity of its own.
        severity: None,
    };

    let breakdown = body
        .config
        .product_usage
        .iter()
        .filter_map(|item| {
            Some(UsageSlice {
                label: item.product.clone()?,
                percent: item.usage_percent?,
            })
        })
        .collect();

    Ok(
        ProviderQuota::ok(PROVIDER, Some("SuperGrok".to_string()), vec![window])
            .with_breakdown(breakdown),
    )
}

fn expired_token() -> ProviderQuota {
    ProviderQuota::action_required(
        PROVIDER,
        "Open Grok Build once so it can refresh its sign-in, then refresh this card.",
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn names_the_period_from_the_providers_own_enum() {
        assert_eq!(period_label("USAGE_PERIOD_TYPE_WEEKLY"), "Weekly");
        assert_eq!(period_label("USAGE_PERIOD_TYPE_MONTHLY"), "Monthly");
        assert_eq!(period_label("USAGE_PERIOD_TYPE_DAILY"), "Daily");
    }

    #[test]
    fn passes_an_unfamiliar_period_through() {
        // A period xAI adds later should look odd, not be mislabelled.
        assert_eq!(period_label("USAGE_PERIOD_TYPE_FORTNIGHTLY"), "Fortnightly");
        assert_eq!(period_label("SOMETHING_ELSE"), "Something_else");
    }

    #[test]
    fn paid_credential_attention_is_never_relabelled_as_free() {
        assert!(matches!(
            paid_credential_quota(Ok(expired_token())),
            ProviderQuota::ActionRequired {
                provider: "grok",
                ..
            }
        ));
        assert!(matches!(
            paid_credential_quota(Err("offline".to_string())),
            ProviderQuota::Error {
                provider: "grok",
                ..
            }
        ));
    }

    #[test]
    fn picks_the_credential_with_the_furthest_expiry() {
        let json = r#"{
            "https://auth.x.ai::old": { "key": "stale-token",
                                        "expires_at": "2026-01-01T00:00:00Z" },
            "https://auth.x.ai::new": { "key": "fresh-token",
                                        "expires_at": "2026-06-01T00:00:00Z" }
        }"#;
        let entries: HashMap<String, AuthEntry> = serde_json::from_str(json).unwrap();
        let before_both = rfc3339_to_unix("2025-12-01T00:00:00Z").unwrap();
        assert_eq!(
            newest_credential(entries, before_both).unwrap().key,
            "fresh-token"
        );
    }

    #[test]
    fn survives_a_credential_with_no_expiry() {
        let json = r#"{ "only": { "key": "the-token" } }"#;
        let entries: HashMap<String, AuthEntry> = serde_json::from_str(json).unwrap();
        assert_eq!(newest_credential(entries, 0).unwrap().key, "the-token");
    }

    #[test]
    fn a_usable_credential_without_expiry_beats_an_expired_one_with_a_timestamp() {
        // `None < Some(_)` must not decide this: the timestamped entry is dead,
        // the undated one is the only credential that can still work.
        let json = r#"{
            "https://auth.x.ai::expired": { "key": "dead-token",
                                            "expires_at": "2026-01-01T00:00:00Z" },
            "https://auth.x.ai::open":    { "key": "live-token" }
        }"#;
        let entries: HashMap<String, AuthEntry> = serde_json::from_str(json).unwrap();
        let after_expiry = rfc3339_to_unix("2026-03-01T00:00:00Z").unwrap();
        assert_eq!(
            newest_credential(entries, after_expiry).unwrap().key,
            "live-token"
        );
    }

    #[test]
    fn a_future_expiry_beats_an_expired_one() {
        let json = r#"{
            "https://auth.x.ai::expired": { "key": "dead-token",
                                            "expires_at": "2026-01-01T00:00:00Z" },
            "https://auth.x.ai::live":    { "key": "live-token",
                                            "expires_at": "2026-06-01T00:00:00Z" }
        }"#;
        let entries: HashMap<String, AuthEntry> = serde_json::from_str(json).unwrap();
        let between = rfc3339_to_unix("2026-03-01T00:00:00Z").unwrap();
        assert_eq!(
            newest_credential(entries, between).unwrap().key,
            "live-token"
        );
    }

    #[test]
    fn an_expired_cli_token_requires_action_instead_of_retry_backoff() {
        let ProviderQuota::ActionRequired { message, .. } = expired_token() else {
            panic!("expired Grok credentials must not be a retryable error");
        };
        assert!(message.contains("Open Grok Build once"));
    }
}
