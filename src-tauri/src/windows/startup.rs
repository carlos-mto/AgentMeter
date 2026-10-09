use std::path::Path;

const RUN_KEY: &str = r"Software\Microsoft\Windows\CurrentVersion\Run";
const VALUE_NAME: &str = "AgentMeter";

fn command_for(executable: &Path) -> String {
    format!("\"{}\" --hidden", executable.display())
}

pub fn background_requested(args: &[String]) -> bool {
    args.iter().any(|argument| argument == "--hidden")
}

pub fn is_background_launch() -> bool {
    std::env::args().any(|argument| argument == "--hidden")
}

#[cfg(windows)]
fn enabled_in(key: &winreg::RegKey) -> bool {
    key.get_value::<String, _>(VALUE_NAME).is_ok()
}

#[cfg(windows)]
pub fn enabled() -> bool {
    use winreg::enums::HKEY_CURRENT_USER;
    use winreg::RegKey;

    RegKey::predef(HKEY_CURRENT_USER)
        .open_subkey(RUN_KEY)
        .map(|key| enabled_in(&key))
        .unwrap_or(false)
}

#[cfg(not(windows))]
pub fn enabled() -> bool {
    false
}

#[cfg(windows)]
fn update_registration(key: &winreg::RegKey, executable: Option<&Path>) -> Result<(), String> {
    if let Some(executable) = executable {
        // Save the new entry first: an error must not remove existing autostart.
        return key
            .set_value(VALUE_NAME, &command_for(executable))
            .map_err(|error| format!("cannot enable launch at startup: {error}"));
    }
    match key.delete_value(VALUE_NAME) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(format!("cannot remove startup entry {VALUE_NAME}: {error}")),
    }
}

#[cfg(windows)]
pub fn set_enabled(enable: bool) -> Result<(), String> {
    use winreg::enums::HKEY_CURRENT_USER;
    use winreg::RegKey;

    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    let (key, _) = hkcu
        .create_subkey(RUN_KEY)
        .map_err(|error| format!("cannot open HKCU\\{RUN_KEY}: {error}"))?;

    if enable {
        let executable = std::env::current_exe()
            .map_err(|error| format!("cannot locate the running executable: {error}"))?;
        update_registration(&key, Some(&executable))
    } else {
        update_registration(&key, None)
    }
}

#[cfg(not(windows))]
pub fn set_enabled(_enable: bool) -> Result<(), String> {
    Err("launch at startup is currently Windows-only".to_string())
}

/// Refresh the executable path of an enabled entry.
/// A disabled entry stays absent.
pub fn refresh_enabled_path() -> Result<(), String> {
    if enabled() {
        set_enabled(true)?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn quotes_paths_for_the_windows_run_key() {
        assert_eq!(
            command_for(Path::new(r"C:\Program Files\AgentMeter\agentmeter.exe")),
            r#""C:\Program Files\AgentMeter\agentmeter.exe" --hidden"#
        );
    }

    #[test]
    fn only_the_hidden_flag_requests_a_background_launch() {
        assert!(background_requested(&[
            "agentmeter.exe".to_string(),
            "--hidden".to_string(),
        ]));
        assert!(!background_requested(&["agentmeter.exe".to_string()]));
    }

    #[cfg(windows)]
    #[test]
    fn autostart_registration_enables_and_disables_without_duplicates() {
        use winreg::enums::HKEY_CURRENT_USER;
        use winreg::RegKey;
        let hkcu = RegKey::predef(HKEY_CURRENT_USER);
        let path = format!(r"Software\AgentMeter\Tests\Startup-{}", std::process::id());
        let (key, _) = hkcu.create_subkey(&path).unwrap();
        let outcome = std::panic::catch_unwind(|| {
            assert!(!enabled_in(&key));
            let executable = Path::new(r"C:\Program Files\AgentMeter\agentmeter.exe");
            let readonly = hkcu.open_subkey(&path).unwrap();
            assert!(update_registration(&readonly, Some(executable)).is_err());
            assert!(!enabled_in(&key));
            drop(readonly);
            update_registration(&key, Some(executable)).unwrap();
            assert_eq!(
                key.get_value::<String, _>(VALUE_NAME).unwrap(),
                command_for(executable)
            );
            assert!(enabled_in(&key));
            update_registration(&key, Some(executable)).unwrap();
            assert_eq!(key.enum_values().count(), 1);
            update_registration(&key, None).unwrap();
            assert!(!enabled_in(&key));
            assert_eq!(key.enum_values().count(), 0);
            update_registration(&key, None).unwrap();
        });
        drop(key);
        hkcu.delete_subkey_all(&path).unwrap();
        if let Err(panic) = outcome {
            std::panic::resume_unwind(panic);
        }
    }
}
