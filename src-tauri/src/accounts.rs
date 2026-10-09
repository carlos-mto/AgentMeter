//! Named CLI profiles. Only labels/paths are persisted, never OAuth credentials.
use crate::quota::atomic_write;
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use serde::{Deserialize, Serialize};
use std::{
    collections::BTreeMap,
    io::Read,
    path::{Path, PathBuf},
    sync::Mutex,
};

pub const PROVIDERS: [&str; 2] = ["claude", "codex"];
pub const DEFAULT_ACCOUNT: &str = "default";

#[derive(Clone, Deserialize, Serialize)]
pub struct AccountProfile {
    pub id: String,
    pub provider: String,
    pub label: String,
    pub config_dir: PathBuf,
    // Read-only display metadata; registry input cannot supply an identity.
    #[serde(skip_deserializing, skip_serializing_if = "Option::is_none")]
    pub username: Option<String>,
}

#[derive(Clone, Default, Deserialize, Serialize)]
#[serde(default)]
pub struct AccountRegistry {
    pub profiles: Vec<AccountProfile>,
    // Selection controls Strip; Widget shows all accounts. CLI env is unchanged.
    pub selected: BTreeMap<String, String>,
}

#[derive(Clone)]
pub struct AccountContext {
    pub config_dir: PathBuf,
    pub cache_dir: PathBuf,
}

fn provider_env(provider: &str) -> Result<&'static str, String> {
    match provider {
        "claude" => Ok("CLAUDE_CONFIG_DIR"),
        "codex" => Ok("CODEX_HOME"),
        _ => Err("Only Claude and Codex support account profiles.".into()),
    }
}

pub(crate) fn data_dir() -> Result<PathBuf, String> {
    dirs::data_local_dir()
        .map(|dir| dir.join("stackly-agent-manager"))
        .ok_or_else(|| "Could not locate the local application data directory.".into())
}

pub fn default_config_dir(provider: &str) -> Result<PathBuf, String> {
    let env = provider_env(provider)?;
    if let Some(dir) = std::env::var_os(env).filter(|dir| !dir.is_empty()) {
        return Ok(PathBuf::from(dir));
    }
    dirs::home_dir()
        .map(|home| home.join(format!(".{provider}")))
        .ok_or_else(|| "Could not locate the home directory.".into())
}

impl AccountContext {
    fn from_profile(profile: &AccountProfile, root: &Path) -> Self {
        // Preserve the existing default account's cooldown/snapshot on upgrade.
        let cache_dir = if profile.id == DEFAULT_ACCOUNT {
            root.join("provider-cache")
        } else {
            root.join("provider-cache")
                .join(&profile.provider)
                .join(&profile.id)
        };
        Self {
            config_dir: profile.config_dir.clone(),
            cache_dir,
        }
    }
}

// Identity is display-only: decode local metadata, never authenticate with JWT claims
// or publish token strings. Bounded reads also keep large CLI configs off the UI path.
fn read_metadata(path: &Path) -> Option<serde_json::Value> {
    let file = std::fs::File::open(path).ok()?;
    serde_json::from_reader(file.take(4 * 1024 * 1024)).ok()
}

fn username_from_text(raw: &str) -> Option<String> {
    // Prefer the recognizable email username, never its domain.
    let name = raw.trim().split('@').next()?.trim();
    (!name.is_empty() && name.chars().count() <= 64 && !name.chars().any(char::is_control))
        .then(|| name.to_string())
}

fn metadata_name(value: &serde_json::Value) -> Option<String> {
    [
        "emailAddress",
        "email",
        "username",
        "preferred_username",
        "displayName",
        "display_name",
        "name",
        "fullName",
    ]
    .into_iter()
    .filter_map(|key| value.get(key)?.as_str())
    .find_map(username_from_text)
}

fn jwt_username(token: &str) -> Option<String> {
    let payload = token.split('.').nth(1)?;
    if payload.len() > 64 * 1024 {
        return None;
    }
    let bytes = URL_SAFE_NO_PAD.decode(payload.trim_end_matches('=')).ok()?;
    let claims: serde_json::Value = serde_json::from_slice(&bytes).ok()?;
    let profile = claims.get("https://api.openai.com/profile");
    let email_username = [profile, Some(&claims)]
        .into_iter()
        .flatten()
        .filter_map(|value| value.get("email")?.as_str())
        .find_map(username_from_text);
    email_username
        .or_else(|| metadata_name(&claims))
        .or_else(|| profile.and_then(metadata_name))
}

fn provider_env_is_set(provider: &str) -> bool {
    provider_env(provider)
        .ok()
        .and_then(std::env::var_os)
        .is_some_and(|value| !value.is_empty())
}

fn implicit_default_dir(provider: &str, dir: &Path, home: Option<&Path>, env_set: bool) -> bool {
    !env_set && home.is_some_and(|home| same_directory(dir, &home.join(format!(".{provider}"))))
}

/// True when the CLI for `dir` runs without a config-dir override, i.e. the
/// plain `claude`/`codex` default account.
pub(crate) fn is_implicit_default_dir(provider: &str, dir: &Path) -> bool {
    implicit_default_dir(
        provider,
        dir,
        dirs::home_dir().as_deref(),
        provider_env_is_set(provider),
    )
}

// Without CLAUDE_CONFIG_DIR the CLI keeps its identity in ~/.claude.json, so that
// file is authoritative for the implicit default account. Named/explicit
// profiles only ever read their own directory, never the global identity.
fn claude_identity_paths(dir: &Path, home: Option<&Path>, env_set: bool) -> Vec<PathBuf> {
    let scoped = dir.join(".claude.json");
    match home {
        Some(home) if implicit_default_dir("claude", dir, Some(home), env_set) => {
            vec![home.join(".claude.json"), scoped]
        }
        _ => vec![scoped],
    }
}

fn credential_username(provider: &str, dir: &Path) -> Option<String> {
    match provider {
        "claude" => {
            let credentials = read_metadata(&dir.join(".credentials.json"))?;
            let oauth = credentials.get("claudeAiOauth")?;
            if oauth.get("accessToken")?.as_str()?.trim().is_empty() {
                return None;
            }
            let home = dirs::home_dir();
            let env_set = provider_env_is_set("claude");
            claude_identity_paths(dir, home.as_deref(), env_set)
                .into_iter()
                .find_map(|path| {
                    let config = read_metadata(&path)?;
                    metadata_name(config.get("oauthAccount")?)
                })
                .or_else(|| metadata_name(oauth))
        }
        "codex" => {
            let auth = read_metadata(&dir.join("auth.json"))?;
            let tokens = auth.get("tokens")?;
            ["id_token", "access_token"]
                .into_iter()
                .find_map(|key| jwt_username(tokens.get(key)?.as_str()?))
        }
        _ => None,
    }
}

fn valid_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 48
        && id
            .bytes()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == b'-')
}

fn validate_label(label: &str) -> Result<(), String> {
    if label.trim().is_empty() || label.chars().count() > 64 || label.chars().any(char::is_control)
    {
        return Err(
            "Account names must contain 1–64 characters without control characters.".into(),
        );
    }
    Ok(())
}

fn same_directory(a: &Path, b: &Path) -> bool {
    let a = a.canonicalize().unwrap_or_else(|_| a.to_path_buf());
    let b = b.canonicalize().unwrap_or_else(|_| b.to_path_buf());
    #[cfg(windows)]
    {
        a.to_string_lossy()
            .eq_ignore_ascii_case(&b.to_string_lossy())
    }
    #[cfg(not(windows))]
    {
        a == b
    }
}

impl AccountRegistry {
    fn validate(&self) -> Result<(), String> {
        for (index, profile) in self.profiles.iter().enumerate() {
            provider_env(&profile.provider)?;
            if !valid_id(&profile.id)
                || profile.id == DEFAULT_ACCOUNT
                || !profile.config_dir.is_absolute()
            {
                return Err("Invalid account profile ID or directory.".into());
            }
            validate_label(&profile.label)?;
            if self.profiles[..index].iter().any(|other| {
                other.provider == profile.provider
                    && (other.id == profile.id
                        || same_directory(&other.config_dir, &profile.config_dir))
            }) {
                return Err("Duplicate account profile or directory.".into());
            }
        }
        for (provider, id) in &self.selected {
            provider_env(provider)?;
            if id != DEFAULT_ACCOUNT
                && !self
                    .profiles
                    .iter()
                    .any(|profile| &profile.provider == provider && &profile.id == id)
            {
                return Err("Selected account profile does not exist.".into());
            }
        }
        Ok(())
    }

    fn profile(&self, provider: &str, id: &str) -> Result<AccountProfile, String> {
        provider_env(provider)?;
        if id == DEFAULT_ACCOUNT {
            return Ok(AccountProfile {
                id: id.into(),
                provider: provider.into(),
                label: "Current account".into(),
                config_dir: default_config_dir(provider)?,
                username: None,
            });
        }
        self.profiles
            .iter()
            .find(|profile| profile.provider == provider && profile.id == id)
            .cloned()
            .ok_or_else(|| "Account profile does not exist.".into())
    }

    fn snapshot(&self) -> Result<Self, String> {
        let mut snapshot = self.clone();
        for provider in PROVIDERS.into_iter().rev() {
            snapshot
                .profiles
                .insert(0, self.profile(provider, DEFAULT_ACCOUNT)?);
        }
        for profile in &mut snapshot.profiles {
            profile.username = credential_username(&profile.provider, &profile.config_dir);
        }
        Ok(snapshot)
    }

    fn forget(&mut self, provider: &str, id: &str) -> Result<(), String> {
        if id == DEFAULT_ACCOUNT {
            return Err("The current account cannot be removed.".into());
        }
        self.profile(provider, id)?;
        self.profiles
            .retain(|profile| profile.provider != provider || profile.id != id);
        if self
            .selected
            .get(provider)
            .is_some_and(|selected| selected == id)
        {
            self.selected
                .insert(provider.into(), DEFAULT_ACCOUNT.into());
        }
        Ok(())
    }
}

pub struct AccountState {
    // A corrupt registry is reported, never silently overwritten with defaults.
    registry: Mutex<Result<AccountRegistry, String>>,
    root: Result<PathBuf, String>,
}

impl AccountState {
    pub fn load() -> Self {
        Self::at(data_dir())
    }

    fn at(root: Result<PathBuf, String>) -> Self {
        let registry = root.as_ref().map_err(Clone::clone).and_then(|root| {
            match std::fs::read_to_string(root.join("accounts.json")) {
                Ok(raw) => {
                    let registry: AccountRegistry = serde_json::from_str(&raw)
                        .map_err(|_| "Could not read accounts.json. Restore the file before editing profiles.".to_string())?;
                    registry.validate()?;
                    Ok(registry)
                }
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(AccountRegistry::default()),
                Err(_) => Err("Could not read accounts.json. Profiles were not changed.".into()),
            }
        });
        Self {
            registry: Mutex::new(registry),
            root,
        }
    }

    pub fn snapshot(&self) -> Result<AccountRegistry, String> {
        self.registry
            .lock()
            .map_err(|_| "Account registry lock failed.")?
            .as_ref()
            .map_err(Clone::clone)?
            .snapshot()
    }

    pub fn resolve(&self, provider: &str, id: Option<&str>) -> Result<AccountContext, String> {
        let guard = self
            .registry
            .lock()
            .map_err(|_| "Account registry lock failed.")?;
        let registry = guard.as_ref().map_err(Clone::clone)?;
        let id = id
            .or_else(|| registry.selected.get(provider).map(String::as_str))
            .unwrap_or(DEFAULT_ACCOUNT);
        let profile = registry.profile(provider, id)?;
        Ok(AccountContext::from_profile(
            &profile,
            self.root.as_ref().map_err(Clone::clone)?,
        ))
    }

    fn update(
        &self,
        change: impl FnOnce(&mut AccountRegistry) -> Result<(), String>,
    ) -> Result<AccountRegistry, String> {
        let mut guard = self
            .registry
            .lock()
            .map_err(|_| "Account registry lock failed.")?;
        let mut next = guard.as_ref().map_err(Clone::clone)?.clone();
        change(&mut next)?;
        next.validate()?;
        let snapshot = next.snapshot()?;
        let root = self.root.as_ref().map_err(Clone::clone)?;
        std::fs::create_dir_all(root)
            .map_err(|_| "Could not create the account registry directory.")?;
        let bytes = serde_json::to_vec_pretty(&next)
            .map_err(|_| "Could not serialize the account registry.")?;
        atomic_write(&root.join("accounts.json"), &bytes)?;
        *guard = Ok(next);
        Ok(snapshot)
    }

    pub fn add(
        &self,
        provider: &str,
        label: &str,
        directory: Option<&str>,
    ) -> Result<AccountRegistry, String> {
        provider_env(provider)?;
        let label = label.trim();
        validate_label(label)?;
        let id = format!(
            "p{:x}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map_err(|_| "System clock is invalid.")?
                .as_nanos()
        );
        let directory = directory.map(str::trim).filter(|dir| !dir.is_empty());
        let config_dir = if let Some(directory) = directory {
            let path = PathBuf::from(directory);
            if !path.is_absolute() || !path.is_dir() {
                return Err("Choose an existing absolute configuration directory.".into());
            }
            path.canonicalize()
                .map_err(|_| "Could not open the configuration directory.")?
        } else {
            self.root
                .as_ref()
                .map_err(Clone::clone)?
                .join("accounts")
                .join(provider)
                .join(&id)
        };
        self.update(|registry| {
            if same_directory(
                &registry.profile(provider, DEFAULT_ACCOUNT)?.config_dir,
                &config_dir,
            ) || registry.profiles.iter().any(|profile| {
                profile.provider == provider && same_directory(&profile.config_dir, &config_dir)
            }) {
                return Err("This configuration directory is already registered.".into());
            }
            if directory.is_none() {
                std::fs::create_dir_all(&config_dir)
                    .map_err(|_| "Could not create the account configuration directory.")?;
            }
            registry.profiles.push(AccountProfile {
                id,
                provider: provider.into(),
                label: label.into(),
                config_dir,
                username: None,
            });
            Ok(())
        })
    }

    pub fn select(&self, provider: &str, id: &str) -> Result<AccountRegistry, String> {
        self.update(|registry| {
            registry.profile(provider, id)?;
            registry.selected.insert(provider.into(), id.into());
            Ok(())
        })
    }

    pub fn remove(&self, provider: &str, id: &str) -> Result<AccountRegistry, String> {
        // Forgetting never logs out, deletes credential files or disrupts sessions.
        self.update(|registry| registry.forget(provider, id))
    }
}

pub fn cli_candidates(provider: &str) -> Vec<PathBuf> {
    let mut dirs = std::env::var_os("PATH")
        .map(|path| std::env::split_paths(&path).collect::<Vec<_>>())
        .unwrap_or_default();
    if let Some(appdata) = std::env::var_os("APPDATA") {
        dirs.push(PathBuf::from(appdata).join("npm"));
    }
    if let Some(home) = dirs::home_dir() {
        dirs.push(home.join(".local").join("bin"));
    }
    dirs.into_iter()
        .flat_map(|dir| {
            #[cfg(windows)]
            let names = [format!("{provider}.exe"), format!("{provider}.cmd")];
            #[cfg(not(windows))]
            let names = [provider.to_string()];
            names.into_iter().map(move |name| dir.join(name))
        })
        .collect()
}

pub fn launch_cli(context: &AccountContext, provider: &str, login: bool) -> Result<(), String> {
    provider_env(provider)?;
    let executable = cli_candidates(provider)
        .into_iter()
        .find(|path| path.is_file())
        .ok_or_else(|| {
            format!("Install the official {provider} CLI before opening this account.")
        })?;
    std::fs::create_dir_all(&context.config_dir)
        .map_err(|_| "Could not open the account configuration directory.")?;
    #[cfg(windows)]
    {
        terminal_command(context, provider, &executable, login, true)?
            .spawn()
            .map_err(|_| "Could not open the account terminal.")?;
        Ok(())
    }
    #[cfg(not(windows))]
    {
        let _ = (executable, login);
        Err("Account terminals are currently supported on Windows only.".into())
    }
}

#[cfg(windows)]
fn terminal_command(
    context: &AccountContext,
    provider: &str,
    executable: &Path,
    login: bool,
    keep_open: bool,
) -> Result<std::process::Command, String> {
    use std::os::windows::process::CommandExt;
    let env = provider_env(provider)?;
    let args = if login {
        if provider == "claude" {
            "auth login"
        } else {
            "login"
        }
    } else {
        ""
    };
    let mut command = std::process::Command::new("cmd.exe");
    // Profile data is never shell source; only a child-local env value.
    command
        .args(["/D", if keep_open { "/K" } else { "/C" }])
        .raw_arg(format!("\"\"{}\" {}\"", executable.display(), args))
        .creation_flags(0x00000010);
    // The implicit default account runs without an override so the CLI uses its
    // own default files (e.g. ~/.claude.json) instead of a divergent copy.
    if !is_implicit_default_dir(provider, &context.config_dir) {
        command.env(env, &context.config_dir);
    }
    if let Some(home) = dirs::home_dir() {
        command.current_dir(home);
    }
    Ok(command)
}

#[cfg(test)]
mod tests {
    use super::*;
    fn root() -> PathBuf {
        static NEXT_DIR: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
        std::env::temp_dir().join(format!(
            "quota-accounts-{}-{}-{:x}",
            std::process::id(),
            NEXT_DIR.fetch_add(1, std::sync::atomic::Ordering::Relaxed),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ))
    }
    #[test]
    fn profiles_persist_select_and_forget_without_touching_credentials() {
        let root = root();
        let state = AccountState::at(Ok(root.clone()));
        assert_eq!(state.snapshot().unwrap().profiles.len(), 2);
        let initial = state.resolve("codex", Some("default")).unwrap();
        let snapshot = state.add("codex", "Trabajo", None).unwrap();
        let profile = snapshot.profiles.last().unwrap();
        let id = profile.id.clone();
        let dir = profile.config_dir.clone();
        std::fs::write(dir.join("auth.json"), "test-credential-marker").unwrap();
        let context = state.resolve("codex", Some(&id)).unwrap();
        assert_ne!(context.config_dir, initial.config_dir);
        assert_ne!(context.cache_dir, initial.cache_dir);
        state.select("codex", &id).unwrap();
        let reloaded = AccountState::at(Ok(root.clone()));
        assert_eq!(reloaded.resolve("codex", None).unwrap().config_dir, dir);
        let raw = std::fs::read_to_string(root.join("accounts.json")).unwrap();
        assert!(!raw.contains("test-credential-marker"));
        assert!(reloaded
            .add("codex", "Duplicated", Some(dir.to_str().unwrap()))
            .is_err());
        assert!(reloaded.remove("codex", "default").is_err());
        reloaded.remove("codex", &id).unwrap();
        assert_eq!(
            reloaded.resolve("codex", None).unwrap().config_dir,
            initial.config_dir
        );
        assert_eq!(
            std::fs::read_to_string(dir.join("auth.json")).unwrap(),
            "test-credential-marker"
        );
        assert!(reloaded.resolve("codex", Some(&id)).is_err());
        let _ = std::fs::remove_dir_all(root);
    }
    #[test]
    fn usernames_are_scoped_local_and_never_persisted_with_profiles() {
        let root = root();
        let directory = root.join("claude-profile");
        std::fs::create_dir_all(&directory).unwrap();
        std::fs::write(
            directory.join(".credentials.json"),
            r#"{"claudeAiOauth":{"accessToken":"secret-identity-marker","displayName":"Token Display Name"}}"#,
        )
        .unwrap();
        std::fs::write(directory.join(".claude.json"), r#"{"oauthAccount":{"displayName":"Scoped Alice","emailAddress":"alice@example.invalid"}}"#).unwrap();
        let state = AccountState::at(Ok(root.join("registry")));
        let snapshot = state
            .add("claude", "Work", Some(directory.to_str().unwrap()))
            .unwrap();
        let profile = snapshot.profiles.last().unwrap();
        assert_eq!(profile.username.as_deref(), Some("alice"));
        let serialized = serde_json::to_string(&snapshot).unwrap();
        assert!(!serialized.contains("secret-identity-marker"));
        assert!(!serialized.contains("example.invalid"));
        state.select("claude", &profile.id).unwrap();
        let stored = std::fs::read_to_string(root.join("registry/accounts.json")).unwrap();
        assert!(!stored.contains("username") && !stored.contains("Scoped Alice"));
        let other = root.join("another-profile");
        std::fs::create_dir_all(&other).unwrap();
        std::fs::write(
            other.join(".credentials.json"),
            r#"{"claudeAiOauth":{"accessToken":"another-secret"}}"#,
        )
        .unwrap();
        assert!(
            credential_username("claude", &other).is_none(),
            "named profiles never borrow the global Claude identity"
        );
        std::fs::write(
            other.join(".claude.json"),
            r#"{"oauthAccount":{"emailAddress":"other@example.invalid"}}"#,
        )
        .unwrap();
        assert_eq!(
            credential_username("claude", &other).as_deref(),
            Some("other")
        );
        std::fs::remove_file(other.join(".credentials.json")).unwrap();
        assert!(credential_username("claude", &other).is_none());
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn codex_identity_claims_are_display_only_and_tolerate_missing_or_invalid_metadata() {
        let root = root();
        std::fs::create_dir_all(&root).unwrap();
        let payload = URL_SAFE_NO_PAD.encode(
            br#"{"name":"Public Display Name","https://api.openai.com/profile":{"email":"sampleuser@example.invalid","name":"Another Display Name"}}"#,
        );
        let token = format!("header.{payload}.signature");
        std::fs::write(
            root.join("auth.json"),
            serde_json::json!({"tokens":{"id_token":token}}).to_string(),
        )
        .unwrap();
        assert_eq!(
            credential_username("codex", &root).as_deref(),
            Some("sampleuser")
        );
        let payload = URL_SAFE_NO_PAD.encode(br#"{"email":"rootuser@example.invalid","name":"Root Display Name","https://api.openai.com/profile":{"name":"Nested Display Name"}}"#);
        assert_eq!(
            jwt_username(&format!("header.{payload}.signature")).as_deref(),
            Some("rootuser")
        );
        assert_eq!(metadata_name(&serde_json::json!({"emailAddress":"shortuser@example.invalid","displayName":"Full Display Name"})).as_deref(), Some("shortuser"));
        assert_eq!(
            metadata_name(&serde_json::json!({"name":"Fallback Name"})).as_deref(),
            Some("Fallback Name")
        );
        assert!(jwt_username("not-a-token").is_none());
        assert!(jwt_username("x.invalid!.y").is_none());
        assert!(metadata_name(&serde_json::json!({"name": "a\nb"})).is_none());
        assert!(metadata_name(&serde_json::json!({"email": "@example.invalid"})).is_none());
        assert!(metadata_name(&serde_json::json!({"name": "a".repeat(65)})).is_none());
        std::fs::write(root.join("auth.json"), "malformed").unwrap();
        assert!(credential_username("codex", &root).is_none());
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn invalid_input_and_corrupt_registry_are_not_overwritten() {
        let root = root();
        let state = AccountState::at(Ok(root.clone()));
        assert!(state.add("antigravity", "Work", None).is_err());
        assert!(state.add("claude", "\n", None).is_err());
        assert!(state.add("claude", "Work", Some("relative/path")).is_err());
        assert!(!root.exists());
        std::fs::create_dir_all(&root).unwrap();
        std::fs::write(root.join("accounts.json"), "invalid-json").unwrap();
        let state = AccountState::at(Ok(root.clone()));
        assert!(state.snapshot().is_err());
        assert!(state.add("claude", "Work", None).is_err());
        assert_eq!(
            std::fs::read_to_string(root.join("accounts.json")).unwrap(),
            "invalid-json"
        );
        let _ = std::fs::remove_dir_all(root);
    }
    #[cfg(windows)]
    #[test]
    fn official_cli_commands_keep_profile_environment_in_the_child() {
        use std::os::windows::process::CommandExt;
        let root = root().join("directory with spaces");
        std::fs::create_dir_all(&root).unwrap();
        let executable = root.join("fake-cli.cmd");
        std::fs::write(
            &executable,
            "@echo off\r\necho \"%CLAUDE_CONFIG_DIR%\"\r\necho \"%CODEX_HOME%\"\r\necho %*\r\n",
        )
        .unwrap();
        let context = AccountContext {
            config_dir: root.join("profile & literal-text"),
            cache_dir: root.join("cache"),
        };
        for (provider, expected) in [("claude", "auth login"), ("codex", "login")] {
            let env = provider_env(provider).unwrap();
            let before = std::env::var_os(env);
            let mut command =
                terminal_command(&context, provider, &executable, true, false).unwrap();
            command.creation_flags(0x08000000);
            let output = command.output().unwrap();
            assert!(output.status.success());
            let stdout = String::from_utf8_lossy(&output.stdout);
            assert!(
                stdout.contains(context.config_dir.to_str().unwrap()),
                "child received the exact directory"
            );
            assert!(
                stdout.contains(expected),
                "official login args are preserved"
            );
            assert_eq!(
                std::env::var_os(env),
                before,
                "parent environment is untouched"
            );
        }
        let _ = std::fs::remove_dir_all(root.parent().unwrap());
    }

    #[test]
    fn implicit_default_reads_global_identity_first_and_overrides_never_do() {
        let root = root();
        let home = root.join("home");
        let default_dir = home.join(".claude");
        let named = root.join("named");
        std::fs::create_dir_all(&default_dir).unwrap();
        std::fs::create_dir_all(&named).unwrap();
        assert!(implicit_default_dir(
            "claude",
            &default_dir,
            Some(&home),
            false
        ));
        assert!(implicit_default_dir(
            "codex",
            &home.join(".codex"),
            Some(&home),
            false
        ));
        assert!(!implicit_default_dir(
            "claude",
            &default_dir,
            Some(&home),
            true
        ));
        assert!(!implicit_default_dir("claude", &default_dir, None, false));
        assert!(!implicit_default_dir("claude", &named, Some(&home), false));
        let scoped = default_dir.join(".claude.json");
        let global = home.join(".claude.json");
        assert_eq!(
            claude_identity_paths(&default_dir, Some(&home), false),
            vec![global.clone(), scoped.clone()]
        );
        assert_eq!(
            claude_identity_paths(&default_dir, Some(&home), true),
            vec![scoped.clone()]
        );
        assert_eq!(
            claude_identity_paths(&named, Some(&home), false),
            vec![named.join(".claude.json")]
        );
        // Stale scoped identity must lose against the global one.
        std::fs::write(
            &scoped,
            r#"{"oauthAccount":{"emailAddress":"stale@example.invalid"}}"#,
        )
        .unwrap();
        std::fs::write(
            &global,
            r#"{"oauthAccount":{"emailAddress":"fresh@example.invalid"}}"#,
        )
        .unwrap();
        let name = |paths: Vec<PathBuf>| {
            paths.into_iter().find_map(|path| {
                let config = read_metadata(&path)?;
                metadata_name(config.get("oauthAccount")?)
            })
        };
        assert_eq!(
            name(claude_identity_paths(&default_dir, Some(&home), false)).as_deref(),
            Some("fresh")
        );
        assert_eq!(
            name(claude_identity_paths(&default_dir, Some(&home), true)).as_deref(),
            Some("stale")
        );
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn path_traversal_and_unknown_selections_are_rejected() {
        for id in ["../outside", "default", "a/b", "a:b", ""] {
            let registry = AccountRegistry {
                profiles: vec![AccountProfile {
                    id: id.into(),
                    provider: "claude".into(),
                    label: "Work".into(),
                    config_dir: root(),
                    username: None,
                }],
                ..Default::default()
            };
            assert!(registry.validate().is_err());
        }
        let registry = AccountRegistry {
            selected: BTreeMap::from([("codex".into(), "unknown".into())]),
            ..Default::default()
        };
        assert!(registry.validate().is_err());
    }
}
