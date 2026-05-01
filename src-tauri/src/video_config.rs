use std::path::Path;
use serde::{Deserialize, Serialize};

/// Configuration du pipeline de detection de videos similaires.
/// Stockee dans <app_data_dir>/video_config.json.
#[derive(Debug, Serialize, Deserialize, Clone, PartialEq)]
#[serde(default)]
pub struct VideoConfig {
    /// Nombre de frames echantillonnees par video (2-30).
    /// Plus de frames = plus precis mais N fois plus lent (N appels ffmpeg par video).
    /// Defaut : 8.
    pub n_frames: usize,

    /// Tolerance de duree entre deux videos pour qu'elles soient comparees.
    /// Calcule comme |dur_a - dur_b| / max(dur_a, dur_b).
    /// Exemple : 0.20 = paires dont les durees different de plus de 20% ignorees.
    /// Defaut : 0.20.
    pub duration_tolerance: f64,

    /// Activer le cache des frame hashes entre les scans (video_cache.json).
    /// Invalide si le chemin, la date de modification ou la taille du fichier change.
    /// Defaut : true.
    pub cache_enabled: bool,

    /// Utiliser DTW (Dynamic Time Warping) pour comparer les sequences de frames.
    /// Detecte les videos avec intro/credits courts (< ~15% de la duree).
    /// Plus lent que la comparaison sequentielle simple (O(n*w) au lieu de O(n)).
    /// Defaut : false.
    pub use_dtw: bool,
}

impl Default for VideoConfig {
    fn default() -> Self {
        VideoConfig {
            n_frames: 8,
            duration_tolerance: 0.20,
            cache_enabled: true,
            use_dtw: false,
        }
    }
}

/// Charge la config depuis <data_dir>/video_config.json.
/// Retourne les valeurs par defaut si le fichier est absent ou invalide.
pub fn load_config(data_dir: &Path) -> VideoConfig {
    std::fs::read_to_string(data_dir.join("video_config.json"))
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

/// Sauvegarde la config dans <data_dir>/video_config.json.
pub fn save_config(data_dir: &Path, config: &VideoConfig) -> Result<(), String> {
    std::fs::create_dir_all(data_dir).map_err(|e| e.to_string())?;
    let json = serde_json::to_string_pretty(config).map_err(|e| e.to_string())?;
    std::fs::write(data_dir.join("video_config.json"), json).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    #[test]
    fn default_config_a_des_valeurs_raisonnables() {
        let cfg = VideoConfig::default();
        assert!(cfg.n_frames >= 2 && cfg.n_frames <= 30);
        assert!(cfg.duration_tolerance > 0.0 && cfg.duration_tolerance < 1.0);
        assert!(cfg.cache_enabled);
    }

    #[test]
    fn config_round_trip_json() {
        let cfg = VideoConfig {
            n_frames: 16,
            duration_tolerance: 0.10,
            cache_enabled: false,
            use_dtw: true,
        };
        let json = serde_json::to_string(&cfg).unwrap();
        let loaded: VideoConfig = serde_json::from_str(&json).unwrap();
        assert_eq!(cfg, loaded);
    }

    #[test]
    fn load_config_fallback_si_fichier_absent() {
        let dir = TempDir::new().unwrap();
        let cfg = load_config(dir.path());
        assert_eq!(cfg, VideoConfig::default());
    }

    #[test]
    fn save_et_load_config() {
        let dir = TempDir::new().unwrap();
        let cfg = VideoConfig {
            n_frames: 12,
            duration_tolerance: 0.30,
            cache_enabled: false,
            use_dtw: true,
        };
        save_config(dir.path(), &cfg).unwrap();
        let loaded = load_config(dir.path());
        assert_eq!(cfg, loaded);
    }
}
