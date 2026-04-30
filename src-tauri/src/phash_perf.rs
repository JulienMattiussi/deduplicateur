use std::path::Path;
use serde::{Deserialize, Serialize};
use crate::phash_config::PHashConfig;

/// Metriques d'un scan similaire. Annexees en JSONL dans phash_perf.jsonl.
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct PerfEntry {
    /// Horodatage Unix du scan (secondes).
    pub timestamp: u64,
    /// Nombre total de fichiers image candidats avant filtrage.
    pub total_images: usize,
    /// Apres filtre taille minimale.
    pub after_size_filter: usize,
    /// Apres filtre ratio d'aspect.
    pub after_aspect_filter: usize,
    /// Paires eliminées par le hash grossier (two-pass).
    pub pairs_skipped_coarse: usize,
    /// Paires comparees avec le hash fin.
    pub pairs_compared_fine: usize,
    /// Paires trouvees similaires.
    pub pairs_found_similar: usize,
    /// Hits de cache (hashs recuperes sans decode).
    pub cache_hits: usize,
    /// Misses de cache (images decodees).
    pub cache_misses: usize,
    /// Temps de collecte des chemins image (ms).
    pub ms_collect: u64,
    /// Temps du filtre taille (ms).
    pub ms_size_filter: u64,
    /// Temps de lecture des dimensions pour le filtre ratio (ms).
    pub ms_aspect_filter: u64,
    /// Temps total de calcul des hashs (ms).
    pub ms_hash: u64,
    /// Temps de comparaison O(n^2) (ms).
    pub ms_compare: u64,
    /// Temps total de la phase pHash (ms).
    pub ms_total: u64,
    /// Instantane de la config utilisee pour ce scan.
    pub config: PHashConfig,
}

/// Ajoute une entree de performance dans <data_dir>/phash_perf.jsonl.
/// Cree le fichier si absent, ajoute une ligne JSON sinon.
pub fn append_perf_log(data_dir: &Path, entry: &PerfEntry) -> Result<(), String> {
    use std::io::Write;
    std::fs::create_dir_all(data_dir).map_err(|e| e.to_string())?;
    let path = data_dir.join("phash_perf.jsonl");
    let line = serde_json::to_string(entry).map_err(|e| e.to_string())?;
    let mut file = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&path)
        .map_err(|e| e.to_string())?;
    writeln!(file, "{}", line).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    fn make_entry(total: usize) -> PerfEntry {
        PerfEntry {
            timestamp: 1_000_000,
            total_images: total,
            after_size_filter: total,
            after_aspect_filter: total,
            pairs_skipped_coarse: 0,
            pairs_compared_fine: total * total / 2,
            pairs_found_similar: 2,
            cache_hits: 0,
            cache_misses: total,
            ms_collect: 1,
            ms_size_filter: 0,
            ms_aspect_filter: 0,
            ms_hash: 500,
            ms_compare: 10,
            ms_total: 511,
            config: PHashConfig::default(),
        }
    }

    #[test]
    fn append_cree_le_fichier() {
        let dir = TempDir::new().unwrap();
        append_perf_log(dir.path(), &make_entry(100)).unwrap();
        assert!(dir.path().join("phash_perf.jsonl").exists());
    }

    #[test]
    fn append_ajoute_une_ligne_par_appel() {
        let dir = TempDir::new().unwrap();
        append_perf_log(dir.path(), &make_entry(10)).unwrap();
        append_perf_log(dir.path(), &make_entry(20)).unwrap();
        append_perf_log(dir.path(), &make_entry(30)).unwrap();
        let content = std::fs::read_to_string(dir.path().join("phash_perf.jsonl")).unwrap();
        let lines: Vec<&str> = content.lines().collect();
        assert_eq!(lines.len(), 3);
    }

    #[test]
    fn chaque_ligne_est_du_json_valide() {
        let dir = TempDir::new().unwrap();
        append_perf_log(dir.path(), &make_entry(50)).unwrap();
        let content = std::fs::read_to_string(dir.path().join("phash_perf.jsonl")).unwrap();
        for line in content.lines() {
            let parsed: serde_json::Value = serde_json::from_str(line).unwrap();
            assert_eq!(parsed["total_images"], 50);
        }
    }

    #[test]
    fn entry_contient_config_snapshot() {
        let dir = TempDir::new().unwrap();
        let mut entry = make_entry(5);
        entry.config.cache_enabled = false;
        append_perf_log(dir.path(), &entry).unwrap();
        let content = std::fs::read_to_string(dir.path().join("phash_perf.jsonl")).unwrap();
        let parsed: serde_json::Value = serde_json::from_str(content.lines().next().unwrap()).unwrap();
        assert_eq!(parsed["config"]["cache_enabled"], false);
    }
}
