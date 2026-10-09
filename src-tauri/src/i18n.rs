use serde::{Deserialize, Deserializer, Serialize};
use std::sync::OnceLock;

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Language {
    En,
    Es,
    Pt,
    It,
    De,
}

impl Language {
    pub fn parse(code: &str) -> Result<Self, String> {
        match code {
            "en" => Ok(Self::En),
            "es" => Ok(Self::Es),
            "pt" => Ok(Self::Pt),
            "it" => Ok(Self::It),
            "de" => Ok(Self::De),
            _ => Err(format!("unsupported language: {code}")),
        }
    }

    pub fn code(self) -> &'static str {
        match self {
            Self::En => "en",
            Self::Es => "es",
            Self::Pt => "pt",
            Self::It => "it",
            Self::De => "de",
        }
    }
}

fn from_windows_language_id(id: u16) -> Language {
    // PRIMARYLANGID: include regional variants (pt-BR/pt-PT, es-ES/es-MX...).
    match id & 0x03ff {
        0x0a => Language::Es,
        0x16 => Language::Pt,
        0x10 => Language::It,
        0x07 => Language::De,
        _ => Language::En,
    }
}

impl Default for Language {
    fn default() -> Self {
        #[cfg(windows)]
        {
            from_windows_language_id(unsafe {
                windows_sys::Win32::Globalization::GetUserDefaultUILanguage()
            })
        }
        #[cfg(not(windows))]
        {
            Self::En
        }
    }
}

impl<'de> Deserialize<'de> for Language {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        let value = serde_json::Value::deserialize(deserializer)?;
        Ok(value
            .as_str()
            .and_then(|code| Self::parse(code).ok())
            .unwrap_or_default())
    }
}

pub fn text(language: Language, key: &'static str) -> &'static str {
    static CATALOGS: OnceLock<serde_json::Value> = OnceLock::new();
    let catalogs = CATALOGS.get_or_init(|| {
        serde_json::from_str(include_str!("../../src/locales.json"))
            .expect("bundled translation catalog must be valid JSON")
    });
    catalogs
        .get(language.code())
        .and_then(|catalog| catalog.get(key))
        .and_then(|text| text.as_str())
        .or_else(|| {
            catalogs
                .get("en")
                .and_then(|catalog| catalog.get(key))
                .and_then(|text| text.as_str())
        })
        .unwrap_or(key)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn supports_five_languages_and_windows_regional_variants() {
        for (id, expected) in [
            (0x0409, Language::En),
            (0x080a, Language::Es),
            (0x0416, Language::Pt),
            (0x0816, Language::Pt),
            (0x0410, Language::It),
            (0x0807, Language::De),
            (0x0411, Language::En),
        ] {
            assert_eq!(from_windows_language_id(id), expected);
            assert_eq!(Language::parse(expected.code()).unwrap(), expected);
        }
        assert!(Language::parse("fr").is_err());
    }

    #[test]
    fn all_tray_entries_are_translated_and_unknown_keys_fall_back() {
        for language in [
            Language::En,
            Language::Es,
            Language::Pt,
            Language::It,
            Language::De,
        ] {
            for key in [
                "Open dashboard",
                "Show widget",
                "Show strip",
                "Lock widget position",
                "Launch at startup",
                "Quit",
            ] {
                assert!(!text(language, key).is_empty());
                if language != Language::En {
                    assert_ne!(text(language, key), key);
                }
            }
            assert_eq!(text(language, "unknown key"), "unknown key");
        }
    }
}
