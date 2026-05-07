use std::path::Path;
use serde::{Deserialize, Serialize};

/// Configuration du pipeline de detection d'images similaires (pHash).
/// Stockee dans <app_data_dir>/phash_config.json.
/// Chaque parametre controle l'activation et le comportement d'une optimisation.
#[derive(Debug, Serialize, Deserialize, Clone, PartialEq)]
#[serde(default)]
pub struct PHashConfig {
    // --- Filtre de taille ---

    /// Taille minimale d'un fichier image pour etre analyse, en octets.
    /// Les fichiers plus petits (icones, thumbnails) sont ignores.
    /// Defaut : 10240 (10 Ko).
    pub min_file_size_bytes: u64,

    /// Nombre minimal d'images candidates pour activer le filtre de taille.
    /// Defaut : 5.
    pub min_images_size_filter: usize,

    // --- Filtre de rapport d'aspect ---

    /// Tolerance de rapport d'aspect entre deux images pour qu'elles soient comparees.
    /// Calcule comme |r1 - r2| / max(r1, r2). Exemple : 0.20 = 20 % de difference toleree.
    /// Une image 16:9 (ratio 1.78) vs une image 3:4 (ratio 0.75) donne 0.58, donc exclue.
    /// Defaut : 0.20.
    pub aspect_ratio_tolerance: f32,

    /// Nombre minimal d'images pour activer le filtre de rapport d'aspect.
    /// En dessous de ce seuil, toutes les paires sont comparees directement.
    /// Defaut : 10.
    pub min_images_aspect_filter: usize,

    // --- Hash en 2 passes ---

    /// Activer le pre-filtrage par hash grossier avant la comparaison fine.
    /// Les deux hashs (grossier et fin) sont calcules en un seul decodage d'image.
    /// Defaut : true.
    pub two_pass_enabled: bool,

    /// Taille NxN du hash grossier en pixels. Produit N*N bits.
    /// Defaut : 4 (16 bits).
    pub coarse_hash_size: u32,

    /// Taille NxN du hash fin en pixels. Produit N*N bits.
    /// Defaut : 8 (64 bits).
    pub fine_hash_size: u32,

    /// Facteur de relaxation du seuil pour le filtre grossier.
    /// Seuil grossier = seuil_fin * (coarse_size^2 / fine_size^2) * facteur.
    /// Exemple : seuil=10, 4x4 vs 8x8, facteur=2.0 => seuil_grossier = 10*(16/64)*2.0 = 5.
    /// Defaut : 2.0.
    pub coarse_threshold_multiplier: f32,

    /// Nombre minimal d'images pour activer le hash en 2 passes.
    /// Defaut : 20.
    pub min_images_two_pass: usize,

    // --- Cache inter-scans ---

    /// Activer le cache des hashs entre les scans.
    /// Le cache est invalide si le chemin ou la date de modification du fichier change.
    /// Defaut : true.
    pub cache_enabled: bool,

    // --- Comparaison parallele ---

    /// Activer la parallelisation de la comparaison O(n^2) avec Rayon.
    /// Defaut : true.
    pub parallel_compare_enabled: bool,

    /// Nombre minimal d'images pour paralleliser la comparaison.
    /// En dessous de ce seuil, la comparaison est sequentielle.
    /// Defaut : 50.
    pub min_images_parallel_compare: usize,

    // --- Decodage rapide via thumbnail EXIF ---

    /// Utiliser le thumbnail EXIF embarque pour le calcul du pHash (JPEG uniquement).
    /// Evite de decoder l'image entiere : le thumbnail (~160x120 px) suffit pour un hash 8x8.
    /// Si absent ou si le fichier n'est pas un JPEG, repli automatique sur le decodage complet.
    /// Valeur stockee dans le cache pour garantir la coherence inter-scans.
    /// Defaut : true.
    pub use_exif_thumbnail: bool,

    // --- Index par bucket de hash grossier ---

    /// Grouper les images par hash grossier exact et ne comparer que les images du meme bucket.
    /// Efficace uniquement quand le seuil de Hamming grossier est 0 (identite exacte du hash 4x4).
    /// Reduit la comparaison de O(n^2) a O(n * taille_bucket), soit quasi-lineaire pour n grand.
    /// Pour les seuils > 0, repli sur la comparaison O(n^2) classique.
    /// Defaut : true.
    pub use_bucket_index: bool,

    // --- Tri par ratio d'aspect avant comparaison ---

    /// Trier les images par ratio d'aspect et utiliser une recherche binaire pour trouver
    /// la plage de paires compatibles. Elimine les paires incompatibles en O(log n) par image
    /// plutot que O(1) par paire, en evitant d'iterer les paires hors tolerance.
    /// Activé uniquement si le filtre d'aspect est actif.
    /// Defaut : true.
    pub use_sorted_aspect: bool,

    // --- Mode developpeur ---

    /// Enregistrer les metriques de performance dans <app_data_dir>/phash_perf.jsonl.
    /// Chaque scan similaire produit une ligne JSON avec les timings et les compteurs.
    /// Defaut : false.
    pub perf_log_enabled: bool,
}

impl Default for PHashConfig {
    fn default() -> Self {
        PHashConfig {
            min_file_size_bytes: 10_240,
            min_images_size_filter: 50,
            aspect_ratio_tolerance: 0.20,
            min_images_aspect_filter: 10,
            two_pass_enabled: true,
            coarse_hash_size: 4,
            fine_hash_size: 8,
            coarse_threshold_multiplier: 2.0,
            min_images_two_pass: 20,
            cache_enabled: true,
            parallel_compare_enabled: true,
            min_images_parallel_compare: 200,
            use_exif_thumbnail: true,
            use_bucket_index: true,
            use_sorted_aspect: true,
            perf_log_enabled: false,
        }
    }
}

/// Charge la config depuis <data_dir>/phash_config.json.
/// Retourne les valeurs par defaut si le fichier est absent ou invalide.
pub fn load_config(data_dir: &Path) -> PHashConfig {
    let path = data_dir.join("phash_config.json");
    std::fs::read_to_string(&path)
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

/// Sauvegarde la config dans <data_dir>/phash_config.json.
pub fn save_config(data_dir: &Path, config: &PHashConfig) -> Result<(), String> {
    std::fs::create_dir_all(data_dir).map_err(|e| e.to_string())?;
    let json = serde_json::to_string_pretty(config).map_err(|e| e.to_string())?;
    std::fs::write(data_dir.join("phash_config.json"), json).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    #[test]
    fn default_config_a_des_valeurs_raisonnables() {
        let cfg = PHashConfig::default();
        assert!(cfg.min_file_size_bytes > 0);
        assert!(cfg.aspect_ratio_tolerance > 0.0 && cfg.aspect_ratio_tolerance < 1.0);
        assert!(cfg.coarse_hash_size < cfg.fine_hash_size);
        assert!(cfg.coarse_threshold_multiplier >= 1.0);
        assert!(cfg.min_images_size_filter > 0);
        assert!(cfg.min_images_aspect_filter > 0);
        assert!(cfg.min_images_two_pass > 0);
        assert!(cfg.min_images_parallel_compare > 0);
        assert!(cfg.use_exif_thumbnail);
        assert!(cfg.use_bucket_index);
        assert!(cfg.use_sorted_aspect);
    }

    #[test]
    fn config_round_trip_json() {
        let cfg = PHashConfig {
            min_file_size_bytes: 8192,
            aspect_ratio_tolerance: 0.15,
            ..Default::default()
        };
        let json = serde_json::to_string(&cfg).unwrap();
        let loaded: PHashConfig = serde_json::from_str(&json).unwrap();
        assert_eq!(cfg, loaded);
    }

    #[test]
    fn load_config_fallback_si_fichier_absent() {
        let dir = TempDir::new().unwrap();
        let cfg = load_config(dir.path());
        assert_eq!(cfg, PHashConfig::default());
    }

    #[test]
    fn save_et_load_config() {
        let dir = TempDir::new().unwrap();
        let cfg = PHashConfig {
            min_file_size_bytes: 20_480,
            cache_enabled: false,
            perf_log_enabled: true,
            ..Default::default()
        };
        save_config(dir.path(), &cfg).unwrap();
        let loaded = load_config(dir.path());
        assert_eq!(cfg, loaded);
    }
}
