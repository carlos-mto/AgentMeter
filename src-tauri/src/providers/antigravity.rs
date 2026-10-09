//! Antigravity quota, read from the IDE or agy CLI over loopback.
//! The IDE requires its per-launch CSRF token; agy's own local server does not.
//! Processes and ports are rediscovered on every poll. No Google credentials
//! are read or refreshed. See architecture.md §6.

use std::path::{Path, PathBuf};
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Mutex,
};
use std::time::Duration;
use std::{collections::hash_map::DefaultHasher, hash::Hash, hash::Hasher};

use serde::{Deserialize, Serialize};

use crate::providers::claude::provider_cache_dir;
use crate::quota::{
    atomic_write, http_failure, now, rfc3339_to_unix, ProviderQuota, QuotaWindow, Stale,
};

const PROVIDER: &str = "antigravity";
const SERVICE_PATH: &str = "exa.language_server_pb.LanguageServerService";
/// The x64 and ARM builds of the language server differ only in name.
const LANGUAGE_SERVER_EXES: [&str; 2] = [
    "language_server_windows_x64.exe",
    "language_server_windows_arm.exe",
];
/// Each server opens a TLS listener, a plaintext twin and sometimes an LSP
/// socket. The wrong ones fail within milliseconds; anything past this count
/// is not a language server port.
const MAX_PORTS_PER_PROCESS: usize = 4;
const MAX_COMMAND_LINE_CHARS: usize = 32_768;
const REQUEST_TIMEOUT_SECONDS: u64 = 5;
/// Discovery plus a handful of loopback requests. Kept under Codex's 10 s so
/// this card never extends the dashboard's joint wait.
const FETCH_DEADLINE_SECONDS: u64 = 8;
/// The client's own state is what matters here: a snapshot older than a day
/// asks for the IDE or CLI instead of pretending to be a reading.
const QUOTA_SNAPSHOT_TTL_SECONDS: i64 = 24 * 60 * 60;
static IS_QUOTA_SNAPSHOT_INVALIDATED: AtomicBool = AtomicBool::new(false);
/// Same policy as the Claude plan: it changes on upgrade and at no other time.
const PLAN_TTL_SECONDS: i64 = 6 * 3600;
const PLAN_RETRY_SECONDS: i64 = 30 * 60;
/// `GetUserStatus` is only asked for the plan name; this metadata is what the
/// IDE's own quota panel sends.
const USER_STATUS_BODY: &str =
    r#"{"metadata":{"ideName":"antigravity","extensionName":"antigravity","locale":"en"}}"#;

static PLAN_CACHE: Mutex<Option<CachedPlan>> = Mutex::new(None);

struct CachedPlan {
    plan: Option<String>,
    at: i64,
    session: u64,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum ProcessKind {
    Ide,
    Agy,
}

/// One running local server. Only agy may omit CSRF. An IDE's token stays in
/// memory, never reaches a log line and never reaches the snapshot.
struct Candidate {
    pid: u32,
    csrf: Option<String>,
    enable_lsp: bool,
    ports: Vec<u16>,
}

struct ParsedCommandLine {
    csrf: String,
    enable_lsp: bool,
}

enum Failure {
    /// Connection, TLS or timeout — a wrong port or a server that just exited.
    Transport(String),
    /// The server answered but this build has no quota summary RPC.
    Unsupported,
    Http(reqwest::StatusCode),
    Shape(String),
}

impl Failure {
    fn message(&self) -> String {
        match self {
            Self::Transport(error) => {
                format!("request to the Antigravity language server failed: {error}")
            }
            Self::Unsupported => "the Antigravity language server has no quota summary".to_string(),
            Self::Http(status) => http_failure(*status, "the Antigravity language server"),
            Self::Shape(error) => format!("could not parse the Antigravity quota summary: {error}"),
        }
    }
}

#[derive(Deserialize)]
struct SummaryResponse {
    #[serde(default)]
    response: Option<Summary>,
}

#[derive(Deserialize, Default)]
struct Summary {
    #[serde(default)]
    groups: Vec<Group>,
}

#[derive(Deserialize)]
struct Group {
    #[serde(rename = "displayName", default)]
    display_name: String,
    #[serde(default)]
    buckets: Vec<Bucket>,
}

/// `remainingFraction` and `remainingAmount` are a oneof; only the fraction
/// has a denominator, so only it can become a percentage.
#[derive(Deserialize)]
struct Bucket {
    #[serde(default)]
    window: String,
    #[serde(rename = "remainingFraction", default)]
    remaining_fraction: Option<f64>,
    #[serde(rename = "resetTime", default)]
    reset_time: Option<String>,
    #[serde(default)]
    disabled: bool,
}

/// Only the two plan-name paths are declared, so serde never materialises the
/// `name` and `email` fields that ride along in the same response.
#[derive(Deserialize)]
struct UserStatusResponse {
    #[serde(rename = "userStatus", default)]
    user_status: Option<UserStatus>,
}

#[derive(Deserialize)]
struct UserStatus {
    #[serde(rename = "userTier", default)]
    user_tier: Option<UserTier>,
    #[serde(rename = "planStatus", default)]
    plan_status: Option<PlanStatus>,
}

#[derive(Deserialize)]
struct UserTier {
    #[serde(default)]
    name: Option<String>,
}

#[derive(Deserialize)]
struct PlanStatus {
    #[serde(rename = "planInfo", default)]
    plan_info: Option<PlanInfo>,
}

#[derive(Deserialize)]
struct PlanInfo {
    #[serde(rename = "planName", default)]
    plan_name: Option<String>,
}

#[derive(Deserialize, Serialize)]
struct CachedQuotaSnapshot {
    plan: Option<String>,
    windows: Vec<QuotaWindow>,
    observed_at: i64,
}

// ── Process discovery ───────────────────────────────────────────────────────

fn process_kind(exe_file: &[u16]) -> Option<ProcessKind> {
    let len = exe_file
        .iter()
        .position(|&char| char == 0)
        .unwrap_or(exe_file.len());
    let name = String::from_utf16_lossy(&exe_file[..len]);
    if LANGUAGE_SERVER_EXES
        .iter()
        .any(|known| name.eq_ignore_ascii_case(known))
    {
        Some(ProcessKind::Ide)
    } else if name.eq_ignore_ascii_case("agy.exe") {
        Some(ProcessKind::Agy)
    } else {
        None
    }
}

/// `--flag value` or `--flag=value`. Whole-token comparison, so
/// `--extension_server_csrf_token` can never stand in for `--csrf_token`.
fn flag_value<'a>(tokens: &[&'a str], flag: &str) -> Option<&'a str> {
    tokens.iter().enumerate().find_map(|(index, token)| {
        if *token == flag {
            tokens.get(index + 1).copied()
        } else {
            token
                .strip_prefix(flag)
                .and_then(|rest| rest.strip_prefix('='))
        }
    })
}

/// Only an Antigravity language server counts — the same binary also ships
/// with other Codeium-based products, which carry a different `--app_data_dir`.
fn parse_cmdline(command_line: &str) -> Option<ParsedCommandLine> {
    let tokens: Vec<&str> = command_line.split_whitespace().collect();
    let app_data_dir = flag_value(&tokens, "--app_data_dir")?;
    if app_data_dir != "antigravity" && !app_data_dir.starts_with("antigravity-") {
        return None;
    }
    let csrf = flag_value(&tokens, "--csrf_token")?;
    if csrf.len() != 36
        || !csrf
            .chars()
            .all(|char| char.is_ascii_hexdigit() || char == '-')
    {
        return None;
    }
    Some(ParsedCommandLine {
        csrf: csrf.to_string(),
        enable_lsp: tokens
            .iter()
            .any(|token| *token == "--enable_lsp" || token.starts_with("--enable_lsp=")),
    })
}

fn candidate_from_process(
    pid: u32,
    kind: ProcessKind,
    command_line: Option<&str>,
    ports: Vec<u16>,
) -> Option<Candidate> {
    let (csrf, enable_lsp) = match kind {
        ProcessKind::Ide => {
            let parsed = parse_cmdline(command_line?)?;
            (Some(parsed.csrf), parsed.enable_lsp)
        }
        // agy embeds its own server and needs neither IDE flags nor PEB reads.
        ProcessKind::Agy => (None, false),
    };
    Some(Candidate {
        pid,
        csrf,
        enable_lsp,
        ports,
    })
}

/// Preserve IDE preference when both clients run, then try agy. Within the IDE,
/// prefer its global server over workspace servers; pid breaks remaining ties.
fn order_candidates(candidates: &mut [Candidate]) {
    candidates.sort_by_key(|candidate| {
        (
            candidate.csrf.is_none(),
            candidate.enable_lsp,
            candidate.pid,
        )
    });
}

#[cfg(windows)]
mod discovery {
    use std::ffi::c_void;
    use std::ptr;

    use windows_sys::Wdk::System::Threading::{NtQueryInformationProcess, ProcessBasicInformation};
    use windows_sys::Win32::Foundation::{CloseHandle, HANDLE, INVALID_HANDLE_VALUE, NO_ERROR};
    use windows_sys::Win32::NetworkManagement::IpHelper::{
        GetExtendedTcpTable, MIB_TCPTABLE_OWNER_PID, TCP_TABLE_OWNER_PID_LISTENER,
    };
    use windows_sys::Win32::System::Diagnostics::Debug::ReadProcessMemory;
    use windows_sys::Win32::System::Diagnostics::ToolHelp::{
        CreateToolhelp32Snapshot, Process32FirstW, Process32NextW, PROCESSENTRY32W,
        TH32CS_SNAPPROCESS,
    };
    use windows_sys::Win32::System::Threading::{
        OpenProcess, PEB, PROCESS_BASIC_INFORMATION, PROCESS_QUERY_INFORMATION, PROCESS_VM_READ,
        RTL_USER_PROCESS_PARAMETERS,
    };

    use super::{
        candidate_from_process, process_kind, Candidate, ProcessKind, MAX_COMMAND_LINE_CHARS,
    };

    /// `GetExtendedTcpTable` takes the address family as a bare integer; this
    /// is AF_INET, the only family the language server listens on.
    const AF_INET: u32 = 2;

    /// The flag reports a language server whose command line could not be
    /// read at all, which is a different thing from no server being there:
    /// an elevated IDE refuses a reader that is not itself elevated.
    pub(super) fn discover() -> (Vec<Candidate>, bool) {
        let mut unreadable = false;
        let candidates = server_processes()
            .into_iter()
            .filter_map(|(pid, kind)| {
                let command_line = match kind {
                    ProcessKind::Ide => match command_line(pid) {
                        Some(line) => Some(line),
                        None => {
                            unreadable = true;
                            return None;
                        }
                    },
                    ProcessKind::Agy => None,
                };
                candidate_from_process(pid, kind, command_line.as_deref(), listening_ports(pid))
            })
            .collect();
        (candidates, unreadable)
    }

    fn server_processes() -> Vec<(u32, ProcessKind)> {
        let mut pids = Vec::new();
        // SAFETY: the entry is sized as Toolhelp requires and the snapshot
        // handle is closed on every path out of the block.
        unsafe {
            let snapshot = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
            if snapshot == INVALID_HANDLE_VALUE {
                return pids;
            }
            let mut entry: PROCESSENTRY32W = std::mem::zeroed();
            entry.dwSize = std::mem::size_of::<PROCESSENTRY32W>() as u32;
            if Process32FirstW(snapshot, &mut entry) != 0 {
                loop {
                    if let Some(kind) = process_kind(&entry.szExeFile) {
                        pids.push((entry.th32ProcessID, kind));
                    }
                    if Process32NextW(snapshot, &mut entry) == 0 {
                        break;
                    }
                }
            }
            CloseHandle(snapshot);
        }
        pids
    }

    /// The command line lives in the other process's PEB. Reading it needs
    /// only query and read rights, which the same user's processes grant; an
    /// elevated IDE refuses, and the card reports that rather than escalating.
    fn command_line(pid: u32) -> Option<String> {
        // SAFETY: the handle is checked before use and closed on every path.
        unsafe {
            let process = OpenProcess(PROCESS_QUERY_INFORMATION | PROCESS_VM_READ, 0, pid);
            if process.is_null() {
                return None;
            }
            let command_line = read_command_line(process);
            CloseHandle(process);
            command_line
        }
    }

    fn read_command_line(process: HANDLE) -> Option<String> {
        // SAFETY: every destination is a local of the size passed alongside
        // it, and every source address came from the process's own PEB chain.
        unsafe {
            let mut info: PROCESS_BASIC_INFORMATION = std::mem::zeroed();
            let mut written = 0u32;
            let status = NtQueryInformationProcess(
                process,
                ProcessBasicInformation,
                ptr::from_mut(&mut info).cast::<c_void>(),
                std::mem::size_of::<PROCESS_BASIC_INFORMATION>() as u32,
                &mut written,
            );
            if status != 0 || info.PebBaseAddress.is_null() {
                return None;
            }
            let mut peb: PEB = std::mem::zeroed();
            if ReadProcessMemory(
                process,
                info.PebBaseAddress.cast_const().cast::<c_void>(),
                ptr::from_mut(&mut peb).cast::<c_void>(),
                std::mem::size_of::<PEB>(),
                ptr::null_mut(),
            ) == 0
            {
                return None;
            }
            let mut params: RTL_USER_PROCESS_PARAMETERS = std::mem::zeroed();
            if ReadProcessMemory(
                process,
                peb.ProcessParameters.cast_const().cast::<c_void>(),
                ptr::from_mut(&mut params).cast::<c_void>(),
                std::mem::size_of::<RTL_USER_PROCESS_PARAMETERS>(),
                ptr::null_mut(),
            ) == 0
            {
                return None;
            }
            let chars = usize::from(params.CommandLine.Length) / 2;
            if chars == 0 || chars > MAX_COMMAND_LINE_CHARS {
                return None;
            }
            let mut buffer = vec![0u16; chars];
            if ReadProcessMemory(
                process,
                params.CommandLine.Buffer.cast_const().cast::<c_void>(),
                buffer.as_mut_ptr().cast::<c_void>(),
                chars * 2,
                ptr::null_mut(),
            ) == 0
            {
                return None;
            }
            Some(String::from_utf16_lossy(&buffer))
        }
    }

    /// Every IPv4 port this pid is listening on, ascending. The server picks
    /// its ports at launch and announces them nowhere else.
    fn listening_ports(pid: u32) -> Vec<u16> {
        let mut size = 0u32;
        // SAFETY: the first call only reports the size; the second writes into
        // a buffer of at least that many bytes, aligned for the u32 rows it
        // holds, and the row count comes from the table header it just wrote.
        let mut ports: Vec<u16> = unsafe {
            GetExtendedTcpTable(
                ptr::null_mut(),
                &mut size,
                0,
                AF_INET,
                TCP_TABLE_OWNER_PID_LISTENER,
                0,
            );
            let mut buffer = vec![0u32; (size as usize).div_ceil(4) + 16];
            if GetExtendedTcpTable(
                buffer.as_mut_ptr().cast::<c_void>(),
                &mut size,
                0,
                AF_INET,
                TCP_TABLE_OWNER_PID_LISTENER,
                0,
            ) != NO_ERROR
            {
                return Vec::new();
            }
            let table = &*buffer.as_ptr().cast::<MIB_TCPTABLE_OWNER_PID>();
            std::slice::from_raw_parts(table.table.as_ptr(), table.dwNumEntries as usize)
                .iter()
                .filter(|row| row.dwOwningPid == pid)
                .map(|row| u16::from_be(row.dwLocalPort as u16))
                .collect()
        };
        ports.sort_unstable();
        ports.dedup();
        ports
    }
}

#[cfg(windows)]
use discovery::discover;

#[cfg(not(windows))]
fn discover() -> (Vec<Candidate>, bool) {
    (Vec::new(), false)
}

// ── Loopback requests ───────────────────────────────────────────────────────

/// Built only here. The server presents a self-signed certificate, so this
/// client trusts any certificate — acceptable solely because every URL it is
/// given is formatted from `127.0.0.1` below, no proxy can sit between, and a
/// redirect is refused rather than followed: the CSRF header must never be
/// replayed against a host this module did not choose.
fn local_client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .danger_accept_invalid_certs(true)
        .no_proxy()
        .redirect(reqwest::redirect::Policy::none())
        .timeout(Duration::from_secs(REQUEST_TIMEOUT_SECONDS))
        .build()
        .map_err(|error| format!("could not build HTTP client: {error}"))
}

fn rpc_url(port: u16, rpc: &str) -> String {
    format!("https://127.0.0.1:{port}/{SERVICE_PATH}/{rpc}")
}

fn rpc_request(
    client: &reqwest::Client,
    port: u16,
    csrf: Option<&str>,
    rpc: &str,
    body: &'static str,
) -> reqwest::RequestBuilder {
    let request = client
        .post(rpc_url(port, rpc))
        .header(reqwest::header::CONTENT_TYPE, "application/json")
        .header("Connect-Protocol-Version", "1")
        .body(body);
    match csrf {
        Some(token) => request.header("X-Codeium-Csrf-Token", token),
        None => request,
    }
}

async fn call(
    client: &reqwest::Client,
    port: u16,
    csrf: Option<&str>,
    rpc: &str,
    body: &'static str,
) -> Result<reqwest::Response, Failure> {
    let response = rpc_request(client, port, csrf, rpc, body)
        .send()
        .await
        .map_err(|error| Failure::Transport(error.to_string()))?;
    match response.status() {
        status if status.is_success() => Ok(response),
        reqwest::StatusCode::NOT_FOUND | reqwest::StatusCode::NOT_IMPLEMENTED => {
            Err(Failure::Unsupported)
        }
        status => Err(Failure::Http(status)),
    }
}

async fn summary(
    client: &reqwest::Client,
    port: u16,
    csrf: Option<&str>,
) -> Result<Summary, Failure> {
    let response = call(client, port, csrf, "RetrieveUserQuotaSummary", "{}").await?;
    let body: SummaryResponse = response
        .json()
        .await
        .map_err(|error| Failure::Shape(error.to_string()))?;
    Ok(body.response.unwrap_or_default())
}

fn plan_from(status: &UserStatusResponse) -> Option<String> {
    let user_status = status.user_status.as_ref()?;
    let tier = user_status
        .user_tier
        .as_ref()
        .and_then(|tier| tier.name.as_deref());
    let plan_name = user_status
        .plan_status
        .as_ref()
        .and_then(|plan| plan.plan_info.as_ref())
        .and_then(|info| info.plan_name.as_deref());
    tier.into_iter()
        .chain(plan_name)
        .map(str::trim)
        .find(|name| !name.is_empty())
        .map(str::to_string)
}

/// Never fails the card: the plan is a label on an otherwise complete reading.
async fn fetch_plan(client: &reqwest::Client, port: u16, csrf: Option<&str>) -> Option<String> {
    let response = call(client, port, csrf, "GetUserStatus", USER_STATUS_BODY)
        .await
        .ok()?;
    let status: UserStatusResponse = response.json().await.ok()?;
    plan_from(&status)
}

fn session_fingerprint(pid: u32, port: u16, csrf: Option<&str>) -> u64 {
    let mut hasher = DefaultHasher::new();
    // agy has no CSRF token: never share a plan label across CLI processes or
    // a restarted listener. IDE token rotation still invalidates the cache.
    (pid, port, csrf).hash(&mut hasher);
    hasher.finish()
}

async fn plan(client: &reqwest::Client, port: u16, candidate: &Candidate) -> Option<String> {
    let csrf = candidate.csrf.as_deref();
    let session = session_fingerprint(candidate.pid, port, csrf);
    // Read and release the lock before any await — a MutexGuard must not be
    // held across one.
    let cached = PLAN_CACHE
        .lock()
        .ok()
        .and_then(|guard| guard.as_ref().map(|c| (c.plan.clone(), c.at, c.session)));

    if let Some((plan, at, cached_session)) = cached {
        let ttl = if plan.is_some() {
            PLAN_TTL_SECONDS
        } else {
            PLAN_RETRY_SECONDS
        };
        if cached_session == session && now() - at < ttl {
            return plan;
        }
    }

    let fetched = fetch_plan(client, port, csrf).await;
    if let Ok(mut guard) = PLAN_CACHE.lock() {
        *guard = Some(CachedPlan {
            plan: fetched.clone(),
            at: now(),
            session,
        });
    }
    fetched
}

// ── Mapping ─────────────────────────────────────────────────────────────────

/// `window` is the provider's own name for the period, like Claude's `kind`.
/// An unrecognised value is passed through rather than dropped.
fn label(window: &str, scope: &str) -> String {
    let base = match window {
        "5h" => "Session (5h)",
        "weekly" => "Weekly",
        other => other,
    };
    if scope.is_empty() {
        base.to_string()
    } else {
        format!("{base} · {scope}")
    }
}

fn window_seconds(window: &str) -> Option<i64> {
    match window {
        "5h" => Some(5 * 60 * 60),
        "weekly" => Some(7 * 24 * 60 * 60),
        _ => None,
    }
}

/// "Gemini Models" → "Gemini", "Claude and GPT models" → "Claude+GPT": short
/// enough for a Widget cell while still being the provider's own grouping.
fn group_short(display_name: &str) -> String {
    let name = display_name.trim();
    let stem = match name.len().checked_sub("models".len()) {
        Some(cut) if name.is_char_boundary(cut) && name[cut..].eq_ignore_ascii_case("models") => {
            name[..cut].trim_end()
        }
        _ => name,
    };
    stem.replace(" and ", "+")
}

fn windows_from(summary: &Summary) -> Vec<QuotaWindow> {
    let mut windows = Vec::new();
    for group in &summary.groups {
        let scope = group_short(&group.display_name);
        for bucket in &group.buckets {
            if bucket.disabled {
                continue;
            }
            let Some(remaining) = bucket.remaining_fraction else {
                continue;
            };
            if !remaining.is_finite() || !(0.0..=1.0).contains(&remaining) {
                continue;
            }
            // At a full allowance `resetTime` is the server's last refresh plus
            // the window length — a placeholder that moves every few minutes,
            // not a deadline. Nothing has been spent, so nothing resets.
            let resets_at = if remaining >= 1.0 {
                None
            } else {
                bucket.reset_time.as_deref().and_then(rfc3339_to_unix)
            };
            windows.push(QuotaWindow {
                label: label(&bucket.window, &scope),
                percent: (1.0 - remaining) * 100.0,
                resets_at,
                window_seconds: window_seconds(&bucket.window),
                severity: None,
            });
        }
    }
    windows
}

/// The call worked and no bucket was usable: nothing is metered on this plan,
/// which is `unavailable`, not an error.
fn model_quota_unavailable() -> ProviderQuota {
    ProviderQuota::unavailable(
        PROVIDER,
        "Signed in to Antigravity, but this account reports no model quota.",
    )
}

// ── Snapshot ────────────────────────────────────────────────────────────────

fn quota_snapshot_path() -> Option<PathBuf> {
    provider_cache_dir().map(|dir| dir.join("antigravity.json"))
}

fn quota_snapshot_exists() -> bool {
    quota_snapshot_path().is_some_and(|path| matches!(path.try_exists(), Ok(true)))
}

fn persist_quota_snapshot(
    snapshot_path: &Path,
    subscription_plan: &Option<String>,
    quota_windows: &[QuotaWindow],
) -> Result<(), String> {
    let parent = snapshot_path
        .parent()
        .ok_or("Antigravity cache path has no parent directory")?;
    std::fs::create_dir_all(parent)
        .map_err(|error| format!("cannot create {}: {error}", parent.display()))?;
    let cached_snapshot = CachedQuotaSnapshot {
        plan: subscription_plan.clone(),
        windows: quota_windows.to_vec(),
        observed_at: now(),
    };
    let snapshot_bytes = serde_json::to_vec(&cached_snapshot)
        .map_err(|error| format!("cannot serialize Antigravity cache: {error}"))?;
    atomic_write(snapshot_path, &snapshot_bytes)
}

fn invalidate_quota_snapshot(snapshot_path: Option<&Path>) {
    // An authoritative empty response supersedes all earlier quotas, even if disk writes fail.
    IS_QUOTA_SNAPSHOT_INVALIDATED.store(true, Ordering::Release);
    if let Some(snapshot_path) = snapshot_path {
        // An empty snapshot preserves configured-client history across restarts.
        let _ = persist_quota_snapshot(snapshot_path, &None, &[]);
    }
}

fn parse_cached_quota_snapshot(
    snapshot_json: &str,
    current_time_seconds: i64,
    failure_reason: &str,
) -> Option<ProviderQuota> {
    let mut cached_snapshot: CachedQuotaSnapshot = serde_json::from_str(snapshot_json).ok()?;
    let snapshot_age_seconds = current_time_seconds.checked_sub(cached_snapshot.observed_at)?;
    if cached_snapshot.observed_at <= 0
        || !(0..=QUOTA_SNAPSHOT_TTL_SECONDS).contains(&snapshot_age_seconds)
    {
        return None;
    }

    // Never carry a spent session window across its reset.
    cached_snapshot.windows.retain(|quota_window| {
        quota_window
            .resets_at
            .is_none_or(|reset_at| reset_at > current_time_seconds)
    });
    if cached_snapshot.windows.is_empty() {
        return None;
    }

    Some(ProviderQuota::ok_stale(
        PROVIDER,
        cached_snapshot.plan,
        cached_snapshot.windows,
        Stale {
            source: "last Antigravity local check".to_string(),
            observed_at: Some(cached_snapshot.observed_at),
            reason: failure_reason.to_string(),
        },
    ))
}

fn load_cached_quota(failure_reason: &str) -> Option<ProviderQuota> {
    if IS_QUOTA_SNAPSHOT_INVALIDATED.load(Ordering::Acquire) {
        return None;
    }
    let snapshot_json = std::fs::read_to_string(quota_snapshot_path()?).ok()?;
    parse_cached_quota_snapshot(&snapshot_json, now(), failure_reason)
}

fn cached_quota_or_error(failure_reason: &str) -> ProviderQuota {
    load_cached_quota(failure_reason)
        .unwrap_or_else(|| ProviderQuota::error(PROVIDER, failure_reason))
}

// ── Fetch ───────────────────────────────────────────────────────────────────

pub async fn fetch() -> ProviderQuota {
    match tokio::time::timeout(Duration::from_secs(FETCH_DEADLINE_SECONDS), try_fetch()).await {
        Ok(quota) => quota,
        Err(_) => cached_quota_or_error("the Antigravity IDE or agy CLI did not answer in time"),
    }
}

/// Neither the IDE nor agy is running, so there is nothing to ask. A snapshot the
/// deck wrote earlier is the only evidence this provider was ever in use.
fn quota_when_client_unavailable() -> ProviderQuota {
    if let Some(quota) = load_cached_quota("Neither Antigravity IDE nor agy CLI is running.") {
        return quota;
    }
    if quota_snapshot_exists() {
        ProviderQuota::action_required(
            PROVIDER,
            "Open Antigravity IDE or run agy in a terminal to refresh its quota.",
        )
    } else {
        ProviderQuota::not_configured(
            PROVIDER,
            "Sign in to Antigravity IDE or agy CLI and keep it running to add Antigravity.",
        )
    }
}

async fn try_fetch() -> ProviderQuota {
    // Toolhelp and PEB reads are synchronous Win32 calls — off the runtime.
    let (mut candidates, unreadable) = tauri::async_runtime::spawn_blocking(discover)
        .await
        .unwrap_or_default();
    if candidates.is_empty() {
        // A server that is running but cannot be inspected is not an absent
        // one, and telling the user to install the IDE would be wrong.
        return if unreadable {
            cached_quota_or_error("cannot inspect the Antigravity language server; if the IDE runs as administrator, start it normally")
        } else {
            quota_when_client_unavailable()
        };
    }
    order_candidates(&mut candidates);

    let client = match local_client() {
        Ok(client) => client,
        Err(message) => return cached_quota_or_error(&message),
    };
    let mut last_failure = None;
    let mut unsupported = false;
    for candidate in &candidates {
        for &port in candidate.ports.iter().take(MAX_PORTS_PER_PROCESS) {
            match summary(&client, port, candidate.csrf.as_deref()).await {
                Ok(summary) => {
                    return quota_from_summary(
                        &client,
                        port,
                        candidate,
                        &summary,
                        quota_snapshot_path().as_deref(),
                    )
                    .await
                }
                Err(Failure::Unsupported) => {
                    unsupported = true;
                }
                Err(failure) => last_failure = Some(failure),
            }
        }
    }
    if unsupported {
        return ProviderQuota::action_required(
            PROVIDER,
            "Update Antigravity IDE or agy CLI to a version that supports quota summaries.",
        );
    }
    let reason = last_failure.map_or_else(
        || "the Antigravity IDE or agy CLI is not listening on any port".to_string(),
        |failure| failure.message(),
    );
    cached_quota_or_error(&reason)
}

async fn quota_from_summary(
    client: &reqwest::Client,
    port: u16,
    candidate: &Candidate,
    quota_summary: &Summary,
    snapshot_path: Option<&Path>,
) -> ProviderQuota {
    let quota_windows = windows_from(quota_summary);
    if quota_windows.is_empty() {
        invalidate_quota_snapshot(snapshot_path);
        return model_quota_unavailable();
    }
    // Plan metadata is read only after a usable quota summary has succeeded.
    let subscription_plan = plan(client, port, candidate).await;
    if let Some(snapshot_path) = snapshot_path {
        if persist_quota_snapshot(snapshot_path, &subscription_plan, &quota_windows).is_ok() {
            IS_QUOTA_SNAPSHOT_INVALIDATED.store(false, Ordering::Release);
        }
    }
    ProviderQuota::ok(PROVIDER, subscription_plan, quota_windows)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Measured from a live IDE; carries no account identifier.
    const SUMMARY_FIXTURE: &str = r#"{"response":{"groups":[
 {"displayName":"Gemini Models","description":"Models within this group: Gemini Flash, Gemini Pro","buckets":[
  {"bucketId":"gemini-weekly","displayName":"Weekly Limit Remaining","description":"You have used some of your weekly limit, it will fully refresh in 2 days, 13 hours.","window":"weekly","remainingFraction":0.99684095,"resetTime":"2026-08-24T02:50:47Z"},
  {"bucketId":"gemini-5h","displayName":"Five Hour Limit Remaining","window":"5h","remainingFraction":1,"resetTime":"2026-08-21T18:06:34Z"}]},
 {"displayName":"Claude and GPT models","description":"Models within this group: Claude Opus, Claude Sonnet, GPT-OSS","buckets":[
  {"bucketId":"3p-weekly","displayName":"Weekly Limit Remaining","window":"weekly","remainingFraction":1,"resetTime":"2026-08-28T13:06:34Z"},
  {"bucketId":"3p-5h","displayName":"Five Hour Limit Remaining","window":"5h","remainingFraction":1,"resetTime":"2026-08-21T18:06:34Z"}]}],
 "description":"Within each group, models share a weekly limit and a 5-hour limit. Quota is consumed proportionally to the cost of the tokens."}}"#;

    const CSRF: &str = "11111111-2222-3333-4444-555555555555";
    const DECOY: &str = "99999999-8888-7777-6666-555555555555";

    fn summary_from(raw: &str) -> Summary {
        serde_json::from_str::<SummaryResponse>(raw)
            .unwrap()
            .response
            .unwrap_or_default()
    }

    fn candidate(pid: u32, enable_lsp: bool) -> Candidate {
        Candidate {
            pid,
            csrf: Some(CSRF.to_string()),
            enable_lsp,
            ports: vec![],
        }
    }

    #[test]
    fn reads_the_csrf_token_in_space_and_equals_forms() {
        let spaced = format!(
            "\"C:\\Antigravity IDE\\language_server_windows_x64.exe\" --extension_server_csrf_token {DECOY} --csrf_token {CSRF} --app_data_dir antigravity"
        );
        let parsed = parse_cmdline(&spaced).unwrap();
        assert_eq!(parsed.csrf, CSRF);
        assert!(!parsed.enable_lsp);

        let equals = format!("ls.exe --app_data_dir=antigravity --csrf_token={CSRF}");
        assert_eq!(parse_cmdline(&equals).unwrap().csrf, CSRF);
    }

    #[test]
    fn rejects_a_server_that_is_not_antigravity() {
        assert!(parse_cmdline(&format!("ls.exe --csrf_token {CSRF}")).is_none());
        assert!(parse_cmdline(&format!(
            "ls.exe --app_data_dir windsurf --csrf_token {CSRF}"
        ))
        .is_none());
        assert!(parse_cmdline(&format!(
            "ls.exe --app_data_dir antigravityfoo --csrf_token {CSRF}"
        ))
        .is_none());
    }

    #[test]
    fn accepts_the_antigravity_ide_data_dir() {
        let parsed = parse_cmdline(&format!(
            "ls.exe --app_data_dir antigravity-ide --csrf_token {CSRF}"
        ))
        .unwrap();
        assert_eq!(parsed.csrf, CSRF);
    }

    #[test]
    fn never_takes_the_extension_server_token() {
        assert!(parse_cmdline(&format!(
            "ls.exe --app_data_dir antigravity-ide --extension_server_csrf_token {DECOY}"
        ))
        .is_none());
        assert!(parse_cmdline(&format!(
            "ls.exe --app_data_dir antigravity-ide --extension_server_csrf_token={DECOY}"
        ))
        .is_none());
        let both = format!(
            "ls.exe --extension_server_csrf_token={DECOY} --app_data_dir antigravity-ide --csrf_token {CSRF}"
        );
        assert_eq!(parse_cmdline(&both).unwrap().csrf, CSRF);
    }

    #[test]
    fn rejects_a_token_that_is_not_a_uuid() {
        assert!(parse_cmdline("ls.exe --app_data_dir antigravity --csrf_token short").is_none());
        assert!(parse_cmdline("ls.exe --app_data_dir antigravity --csrf_token").is_none());
    }

    #[test]
    fn records_the_lsp_flag() {
        let parsed = parse_cmdline(&format!(
            "ls.exe --csrf_token {CSRF} --enable_lsp --workspace_id w --app_data_dir antigravity-ide"
        ))
        .unwrap();
        assert!(parsed.enable_lsp);
    }

    #[test]
    fn prefers_the_server_without_lsp_then_lower_pid() {
        let mut candidates = vec![candidate(7616, true), candidate(25796, false)];
        order_candidates(&mut candidates);
        assert_eq!(candidates[0].pid, 25796);
        assert_eq!(candidates[1].pid, 7616);

        let mut same_kind = vec![candidate(300, false), candidate(200, false)];
        order_candidates(&mut same_kind);
        assert_eq!(same_kind[0].pid, 200);
    }

    #[test]
    fn matches_only_supported_server_names_case_insensitively() {
        let utf16 = |name: &str| {
            let mut chars: Vec<u16> = name.encode_utf16().collect();
            chars.push(0);
            chars.resize(260, 0);
            chars
        };
        assert_eq!(
            process_kind(&utf16("language_server_windows_x64.exe")),
            Some(ProcessKind::Ide)
        );
        assert_eq!(
            process_kind(&utf16("LANGUAGE_SERVER_WINDOWS_ARM.EXE")),
            Some(ProcessKind::Ide)
        );
        assert_eq!(process_kind(&utf16("AGY.EXE")), Some(ProcessKind::Agy));
        for name in [
            "language_server_linux_x64",
            "Antigravity IDE.exe",
            "agy",
            "agy.exe.old",
            "not-agy.exe",
        ] {
            assert_eq!(process_kind(&utf16(name)), None);
        }
    }

    #[test]
    fn maps_the_measured_summary_onto_four_windows() {
        let windows = windows_from(&summary_from(SUMMARY_FIXTURE));
        assert_eq!(windows.len(), 4);

        let labels: Vec<&str> = windows.iter().map(|w| w.label.as_str()).collect();
        assert_eq!(
            labels,
            [
                "Weekly · Gemini",
                "Session (5h) · Gemini",
                "Weekly · Claude+GPT",
                "Session (5h) · Claude+GPT"
            ]
        );

        assert!((windows[0].percent - 0.3159).abs() < 1e-4);
        assert_eq!(windows[1].percent, 0.0);
        assert_eq!(windows[2].percent, 0.0);
        assert_eq!(windows[3].percent, 0.0);

        assert_eq!(windows[0].window_seconds, Some(604_800));
        assert_eq!(windows[1].window_seconds, Some(18_000));
        assert_eq!(windows[2].window_seconds, Some(604_800));
        assert_eq!(windows[3].window_seconds, Some(18_000));

        // Only the bucket with something spent carries a real deadline; the
        // other three report a moving placeholder and get none.
        assert_eq!(windows[0].resets_at, Some(1_787_539_847));
        assert_eq!(
            windows[0].resets_at,
            rfc3339_to_unix("2026-08-24T02:50:47Z")
        );
        assert_eq!(windows[1].resets_at, None);
        assert_eq!(windows[2].resets_at, None);
        assert_eq!(windows[3].resets_at, None);

        assert!(windows.iter().all(|w| w.severity.is_none()));
    }

    #[test]
    fn passes_an_unknown_window_through_without_a_pace() {
        let raw = r#"{"response":{"groups":[{"displayName":"Gemini Models","buckets":[
            {"window":"daily","remainingFraction":0.5,"resetTime":"2026-08-22T00:00:00Z"}]}]}}"#;
        let windows = windows_from(&summary_from(raw));
        assert_eq!(windows.len(), 1);
        assert_eq!(windows[0].label, "daily · Gemini");
        assert_eq!(windows[0].percent, 50.0);
        assert_eq!(windows[0].window_seconds, None);
        assert_eq!(
            windows[0].resets_at,
            rfc3339_to_unix("2026-08-22T00:00:00Z")
        );
    }

    #[test]
    fn skips_disabled_amount_only_and_out_of_range_buckets() {
        let raw = r#"{"response":{"groups":[{"displayName":"Gemini Models","buckets":[
            {"window":"weekly","remainingFraction":0.5,"disabled":true},
            {"window":"weekly","remainingAmount":"12"},
            {"window":"5h","remainingFraction":1.5},
            {"window":"5h","remainingFraction":-0.1},
            {"window":"5h","remainingFraction":0.25}]}]}}"#;
        let windows = windows_from(&summary_from(raw));
        assert_eq!(windows.len(), 1);
        assert_eq!(windows[0].label, "Session (5h) · Gemini");
        assert_eq!(windows[0].percent, 75.0);
    }

    #[test]
    fn nothing_remaining_is_fully_used() {
        let raw = r#"{"response":{"groups":[{"displayName":"Claude and GPT models","buckets":[
            {"window":"weekly","remainingFraction":0,"resetTime":"2026-08-28T13:06:34Z"}]}]}}"#;
        let windows = windows_from(&summary_from(raw));
        assert_eq!(windows.len(), 1);
        assert_eq!(windows[0].label, "Weekly · Claude+GPT");
        assert_eq!(windows[0].percent, 100.0);
        assert_eq!(
            windows[0].resets_at,
            rfc3339_to_unix("2026-08-28T13:06:34Z")
        );
    }

    #[test]
    fn an_empty_summary_is_unavailable_not_an_error() {
        for raw in [
            r#"{"response":{"groups":[]}}"#,
            r#"{"response":{}}"#,
            r#"{}"#,
            r#"{"response":{"groups":[{"displayName":"Gemini Models","buckets":[
                {"window":"weekly","remainingFraction":0.5,"disabled":true}]}]}}"#,
        ] {
            assert!(windows_from(&summary_from(raw)).is_empty());
        }
        let ProviderQuota::Unavailable { provider, .. } = model_quota_unavailable() else {
            panic!("a summary with no usable bucket must be unavailable");
        };
        assert_eq!(provider, PROVIDER);
    }

    #[test]
    fn authoritative_empty_quota_invalidates_cached_windows_even_when_persistence_fails() {
        let unique = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let directory =
            std::env::temp_dir().join(format!("agentmeter-antigravity-invalidation-{unique}"));
        let snapshot_path = directory.join("antigravity.json");
        let quota_summary = summary_from(
            r#"{"response":{"groups":[{"displayName":"Gemini Models","buckets":[{"window":"weekly","remainingFraction":0.5}]}]}}"#,
        );
        let quota_windows = windows_from(&quota_summary);
        persist_quota_snapshot(
            &snapshot_path,
            &Some("previous plan".into()),
            &quota_windows,
        )
        .unwrap();
        let previous_snapshot = std::fs::read_to_string(&snapshot_path).unwrap();
        assert!(parse_cached_quota_snapshot(&previous_snapshot, now(), "offline").is_some());

        let client = local_client().unwrap();
        let candidate = candidate(0, false);
        let empty_summary = summary_from(r#"{"response":{"groups":[]}}"#);
        let quota = tauri::async_runtime::block_on(quota_from_summary(
            &client,
            0,
            &candidate,
            &empty_summary,
            Some(&snapshot_path),
        ));
        assert!(matches!(quota, ProviderQuota::Unavailable { .. }));
        let empty_snapshot = std::fs::read_to_string(&snapshot_path).unwrap();
        assert!(parse_cached_quota_snapshot(&empty_snapshot, now(), "offline").is_none());
        assert!(
            snapshot_path.exists(),
            "configured-client history remains present"
        );

        let quota = tauri::async_runtime::block_on(quota_from_summary(
            &client,
            0,
            &candidate,
            &quota_summary,
            Some(&snapshot_path),
        ));
        assert!(matches!(quota, ProviderQuota::Ok { .. }));
        assert!(!IS_QUOTA_SNAPSHOT_INVALIDATED.load(Ordering::Acquire));
        assert!(parse_cached_quota_snapshot(
            &std::fs::read_to_string(&snapshot_path).unwrap(),
            now(),
            "offline"
        )
        .is_some());

        let blocked_parent = directory.join("blocked");
        std::fs::write(&blocked_parent, b"not a directory").unwrap();
        let quota = tauri::async_runtime::block_on(quota_from_summary(
            &client,
            0,
            &candidate,
            &empty_summary,
            Some(&blocked_parent.join("antigravity.json")),
        ));
        assert!(matches!(quota, ProviderQuota::Unavailable { .. }));
        assert!(IS_QUOTA_SNAPSHOT_INVALIDATED.load(Ordering::Acquire));
        assert!(
            load_cached_quota("offline").is_none(),
            "failed writes cannot revive an invalidated snapshot"
        );
        std::fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn shortens_group_names_without_inventing_them() {
        assert_eq!(group_short("Gemini Models"), "Gemini");
        assert_eq!(group_short("Claude and GPT models"), "Claude+GPT");
        assert_eq!(group_short("Imagen"), "Imagen");
        assert_eq!(label("weekly", ""), "Weekly");
    }

    #[test]
    fn snapshot_round_trips_and_drops_expired_rows() {
        // Observed eleven hours before the fixture's weekly deadline.
        let windows = windows_from(&summary_from(SUMMARY_FIXTURE));
        let raw = serde_json::to_string(&CachedQuotaSnapshot {
            plan: Some("Google AI Pro".to_string()),
            windows: windows.clone(),
            observed_at: 1_787_500_000,
        })
        .unwrap();
        assert!(!raw.contains(CSRF));

        let ProviderQuota::Ok {
            plan,
            windows: cached,
            stale: Some(stale),
            ..
        } = parse_cached_quota_snapshot(
            &raw,
            1_787_500_600,
            "Neither Antigravity IDE nor agy CLI is running.",
        )
        .unwrap()
        else {
            panic!("a recent snapshot should stay visible as cached");
        };
        assert_eq!(plan.as_deref(), Some("Google AI Pro"));
        assert_eq!(cached.len(), 4);
        assert_eq!(cached[0].label, windows[0].label);
        assert_eq!(cached[0].percent, windows[0].percent);
        assert_eq!(cached[0].resets_at, windows[0].resets_at);
        assert_eq!(stale.observed_at, Some(1_787_500_000));
        assert_eq!(stale.source, "last Antigravity local check");

        // At the weekly deadline that row goes (the snapshot is still within a
        // day); the placeholder-free rows have no deadline and stay until the
        // snapshot itself ages out.
        let ProviderQuota::Ok { windows: later, .. } =
            parse_cached_quota_snapshot(&raw, 1_787_539_847, "later").unwrap()
        else {
            panic!("rows without a deadline remain");
        };
        assert_eq!(later.len(), 3);
        assert!(later.iter().all(|w| w.resets_at.is_none()));
    }

    #[test]
    fn a_day_old_snapshot_is_not_presented_as_current() {
        let raw = serde_json::json!({
            "plan": "Google AI Pro",
            "observed_at": 1_000,
            "windows": [{
                "label": "Weekly · Gemini",
                "percent": 20.0,
                "resets_at": null,
                "window_seconds": 604_800,
                "severity": null
            }]
        })
        .to_string();
        assert!(
            parse_cached_quota_snapshot(&raw, 1_000 + QUOTA_SNAPSHOT_TTL_SECONDS, "x").is_some()
        );
        assert!(
            parse_cached_quota_snapshot(&raw, 1_000 + QUOTA_SNAPSHOT_TTL_SECONDS + 1, "x")
                .is_none()
        );
        assert!(parse_cached_quota_snapshot(&raw, 999, "x").is_none());
    }

    #[test]
    fn plan_prefers_the_tier_name_then_the_legacy_plan_name() {
        let both = r#"{"userStatus":{"name":"ignored","email":"ignored","userTier":{"id":"g1-pro-tier","name":"Google AI Pro"},"planStatus":{"planInfo":{"planName":"Pro"}}}}"#;
        let legacy = r#"{"userStatus":{"planStatus":{"planInfo":{"planName":"Pro"}}}}"#;
        let blank_tier = r#"{"userStatus":{"userTier":{"name":""},"planStatus":{"planInfo":{"planName":"Pro"}}}}"#;
        let neither = r#"{"userStatus":{"planStatus":{"availablePromptCredits":500}}}"#;
        let parse = |raw: &str| serde_json::from_str::<UserStatusResponse>(raw).unwrap();
        assert_eq!(plan_from(&parse(both)).as_deref(), Some("Google AI Pro"));
        assert_eq!(plan_from(&parse(legacy)).as_deref(), Some("Pro"));
        assert_eq!(plan_from(&parse(blank_tier)).as_deref(), Some("Pro"));
        assert_eq!(plan_from(&parse(neither)), None);
        assert_eq!(plan_from(&parse("{}")), None);
    }

    #[test]
    fn plan_cache_session_fingerprint_changes_with_the_signed_in_session() {
        assert_eq!(
            session_fingerprint(100, 5000, Some(CSRF)),
            session_fingerprint(100, 5000, Some(CSRF))
        );
        assert_ne!(
            session_fingerprint(100, 5000, Some(CSRF)),
            session_fingerprint(100, 5000, Some(DECOY))
        );
        assert_ne!(
            session_fingerprint(100, 5000, Some(CSRF)),
            session_fingerprint(100, 5000, None)
        );
    }

    #[test]
    fn requests_target_loopback_only() {
        assert_eq!(
            rpc_url(51_887, "RetrieveUserQuotaSummary"),
            "https://127.0.0.1:51887/exa.language_server_pb.LanguageServerService/RetrieveUserQuotaSummary"
        );
    }

    #[test]
    fn agy_needs_no_ide_flags_but_ide_still_requires_valid_csrf() {
        let cli = candidate_from_process(100, ProcessKind::Agy, None, vec![5000]).unwrap();
        assert!(cli.csrf.is_none());
        assert!(!cli.enable_lsp);
        assert_eq!(cli.ports, [5000]);
        assert!(candidate_from_process(100, ProcessKind::Ide, None, vec![]).is_none());
        assert!(candidate_from_process(
            100,
            ProcessKind::Ide,
            Some("ls.exe --app_data_dir antigravity-ide"),
            vec![]
        )
        .is_none());
        assert!(candidate_from_process(
            100,
            ProcessKind::Ide,
            Some(&format!(
                "ls.exe --app_data_dir windsurf --csrf_token {CSRF}"
            )),
            vec![]
        )
        .is_none());
        let line = format!("ls.exe --app_data_dir antigravity-ide --csrf_token {CSRF}");
        let ide = candidate_from_process(200, ProcessKind::Ide, Some(&line), vec![6000]).unwrap();
        assert_eq!(ide.csrf.as_deref(), Some(CSRF));
        assert_eq!(ide.ports, [6000]);
    }

    #[test]
    fn ide_order_is_preserved_with_agy_as_a_fallback() {
        let cli = |pid| candidate_from_process(pid, ProcessKind::Agy, None, vec![]).unwrap();
        let mut candidates = vec![cli(2), candidate(4, true), cli(1), candidate(5, false)];
        order_candidates(&mut candidates);
        assert_eq!(
            candidates.iter().map(|c| c.pid).collect::<Vec<_>>(),
            [5, 4, 1, 2]
        );
    }

    #[test]
    fn agy_plan_cache_is_scoped_to_process_and_listener() {
        let first = session_fingerprint(100, 5000, None);
        assert_eq!(first, session_fingerprint(100, 5000, None));
        assert_ne!(first, session_fingerprint(101, 5000, None));
        assert_ne!(first, session_fingerprint(100, 5001, None));
    }

    #[test]
    fn requests_omit_csrf_only_for_agy_and_keep_the_same_rpc_contract() {
        let client = local_client().unwrap();
        for csrf in [Some(CSRF), None] {
            let request = rpc_request(&client, 5000, csrf, "RetrieveUserQuotaSummary", "{}")
                .build()
                .unwrap();
            assert_eq!(request.url().scheme(), "https");
            assert_eq!(request.url().host_str(), Some("127.0.0.1"));
            assert_eq!(request.method(), reqwest::Method::POST);
            assert_eq!(request.headers()["Connect-Protocol-Version"], "1");
            assert_eq!(request.headers()["Content-Type"], "application/json");
            assert_eq!(
                request
                    .headers()
                    .get("X-Codeium-Csrf-Token")
                    .map(|h| h.to_str().unwrap()),
                csrf
            );
            assert_eq!(request.body().unwrap().as_bytes(), Some(b"{}".as_slice()));
        }
    }

    /// Exercises real Windows discovery, HTTPS, mapping and the quota-only cache.
    #[cfg(windows)]
    #[test]
    #[ignore = "requires a signed-in agy CLI running without Antigravity IDE"]
    fn live_agy_reports_quota_without_ide() {
        let (candidates, _) = discover();
        assert!(!candidates.is_empty(), "run agy and sign in first");
        assert!(
            candidates.iter().all(|c| c.csrf.is_none()),
            "close the IDE for this CLI-only check"
        );
        let quota = tauri::async_runtime::block_on(fetch());
        let ProviderQuota::Ok { windows, stale, .. } = quota else {
            panic!("expected a live agy quota");
        };
        assert!(stale.is_none(), "cached data does not prove CLI support");
        assert!(!windows.is_empty());
        println!(
            "agy live quota: {} windows, no IDE, no cached fallback",
            windows.len()
        );
    }

    /// Needs a signed-in Antigravity IDE running on this machine.
    #[test]
    #[ignore = "requires a running Antigravity IDE"]
    fn live_ide_reports_four_windows() {
        let quota = tauri::async_runtime::block_on(fetch());
        let ProviderQuota::Ok {
            plan,
            windows,
            stale,
            ..
        } = &quota
        else {
            panic!(
                "expected a live reading, got {}",
                serde_json::to_string(&quota).unwrap()
            );
        };
        assert!(stale.is_none(), "a running IDE must answer live");
        assert_eq!(windows.len(), 4);
        for window in windows {
            assert!(
                window.label.starts_with("Weekly") || window.label.starts_with("Session (5h)"),
                "unexpected label {}",
                window.label
            );
        }
        println!("status=ok plan={plan:?}");
        for window in windows {
            println!(
                "  {} percent={:.4} window_seconds={:?} resets_at={:?}",
                window.label, window.percent, window.window_seconds, window.resets_at
            );
        }
    }
}
