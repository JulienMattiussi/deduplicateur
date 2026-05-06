use std::path::Path;
use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq)]
#[serde(default)]
pub struct AudioConfig {
    /// Tolerance de duree entre deux fichiers audio pour qu'ils soient compares.
    /// Calcule comme |dur_a - dur_b| / max(dur_a, dur_b).
    /// Exemple : 0.20 = paires dont les durees different de plus de 20% ignorees.
    /// Defaut : 0.20.
    pub duration_tolerance: f64,

    /// Activer le cache des empreintes audio entre les scans (audio_cache.json).
    /// Invalide si le chemin, la date de modification ou la taille du fichier change.
    /// Defaut : true.
    pub cache_enabled: bool,
}

impl Default for AudioConfig {
    fn default() -> Self {
        AudioConfig {
            duration_tolerance: 0.20,
            cache_enabled: true,
        }
    }
}

/// Charge la config depuis <data_dir>/audio_config.json.
/// Retourne les valeurs par defaut si le fichier est absent ou invalide.
pub fn load_config(data_dir: &Path) -> AudioConfig {
    std::fs::read_to_string(data_dir.join("audio_config.json"))
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

/// Sauvegarde la config dans <data_dir>/audio_config.json.
pub fn save_config(data_dir: &Path, config: &AudioConfig) -> Result<(), String> {
    std::fs::create_dir_all(data_dir).map_err(|e| e.to_string())?;
    let json = serde_json::to_string_pretty(config).map_err(|e| e.to_string())?;
    std::fs::write(data_dir.join("audio_config.json"), json).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    #[test]
    fn default_config_a_des_valeurs_raisonnables() {
        let cfg = AudioConfig::default();
        assert!(cfg.duration_tolerance > 0.0 && cfg.duration_tolerance < 1.0);
        assert!(cfg.cache_enabled);
    }

    #[test]
    fn config_round_trip_json() {
        let cfg = AudioConfig {
            duration_tolerance: 0.10,
            cache_enabled: false,
        };
        let json = serde_json::to_string(&cfg).unwrap();
        let loaded: AudioConfig = serde_json::from_str(&json).unwrap();
        assert_eq!(cfg, loaded);
    }

    #[test]
    fn load_config_fallback_si_fichier_absent() {
        let dir = TempDir::new().unwrap();
        let cfg = load_config(dir.path());
        assert_eq!(cfg, AudioConfig::default());
    }

    #[test]
    fn save_et_load_config() {
        let dir = TempDir::new().unwrap();
        let cfg = AudioConfig {
            duration_tolerance: 0.30,
            cache_enabled: false,
        };
        save_config(dir.path(), &cfg).unwrap();
        let loaded = load_config(dir.path());
        assert_eq!(cfg, loaded);
    }
}
