use std::collections::HashMap;
use std::path::Path;
use serde::{Deserialize, Serialize};
use crate::cache_io::{load_json_map, save_json_map};

/// Entree de cache pour un fichier image.
/// Les hashs sont stockes en base64 pour la serialisation JSON.
/// Les tailles de hash font partie de la cle d'invalidation : si la config change,
/// l'entree n'est pas retournee.
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct CacheEntry {
    /// Date de modification du fichier au moment du calcul (secondes Unix).
    pub mtime: u64,
    /// Taille NxN du hash grossier au moment du calcul.
    pub coarse_size: u32,
    /// Taille NxN du hash fin au moment du calcul.
    pub fine_size: u32,
    /// Hash grossier (coarse) encode en base64.
    pub coarse: String,
    /// Hash fin (fine) encode en base64.
    pub fine: String,
    /// Ratio largeur/hauteur de l'image (w/h). None pour les anciennes entrees de cache.
    #[serde(default)]
    pub aspect: Option<f32>,
}

/// Cache des hashs pHash entre les scans.
/// Cle : chemin absolu du fichier.
/// Invalide automatiquement les entrees dont le mtime ou les tailles de hash ont change.
pub struct HashCache {
    entries: HashMap<String, CacheEntry>,
    dirty: bool,
}

impl HashCache {
    /// Charge le cache depuis <data_dir>/phash_cache.json.
    /// Retourne un cache vide si le fichier est absent ou invalide.
    pub fn load(data_dir: &Path) -> Self {
        HashCache { entries: load_json_map(data_dir, "phash_cache.json"), dirty: false }
    }

    /// Retourne un cache vide sans fichier associe.
    pub fn empty() -> Self {
        HashCache { entries: HashMap::new(), dirty: false }
    }

    /// Sauvegarde le cache si des modifications ont ete apportees.
    /// Ne fait rien si `dirty == false`.
    pub fn save(&mut self, data_dir: &Path) -> Result<(), String> {
        save_json_map(&self.entries, data_dir, "phash_cache.json", &mut self.dirty)
    }

    /// Retourne l'entree si elle existe, si le mtime correspond ET si les tailles de hash
    /// correspondent a la config actuelle.
    /// Retourne None si le fichier a ete modifie ou si la config a change.
    pub fn get(&self, path: &str, mtime: u64, coarse_size: u32, fine_size: u32) -> Option<&CacheEntry> {
        self.entries.get(path).filter(|e| {
            e.mtime == mtime && e.coarse_size == coarse_size && e.fine_size == fine_size
        })
    }

    /// Insere ou met a jour une entree. Marque le cache comme modifie.
    pub fn insert(&mut self, path: String, entry: CacheEntry) {
        self.entries.insert(path, entry);
        self.dirty = true;
    }

    #[allow(dead_code)]
    pub fn len(&self) -> usize {
        self.entries.len()
    }

    #[allow(dead_code)]
    pub fn is_empty(&self) -> bool {
        self.entries.is_empty()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    fn make_entry(mtime: u64) -> CacheEntry {
        CacheEntry {
            mtime,
            coarse_size: 4,
            fine_size: 8,
            coarse: "ABCD".to_string(),
            fine: "ABCDEF0123456789".to_string(),
            aspect: None,
        }
    }

    #[test]
    fn cache_vide_si_fichier_absent() {
        let dir = TempDir::new().unwrap();
        let cache = HashCache::load(dir.path());
        assert!(cache.is_empty());
        assert!(!cache.dirty);
    }

    #[test]
    fn empty_retourne_cache_sans_entrees() {
        let cache = HashCache::empty();
        assert!(cache.is_empty());
        assert!(!cache.dirty);
    }

    #[test]
    fn insert_marque_dirty() {
        let dir = TempDir::new().unwrap();
        let mut cache = HashCache::load(dir.path());
        cache.insert("/img/a.jpg".into(), make_entry(1000));
        assert!(cache.dirty);
        assert_eq!(cache.len(), 1);
    }

    #[test]
    fn get_retourne_entree_si_mtime_et_tailles_corrects() {
        let dir = TempDir::new().unwrap();
        let mut cache = HashCache::load(dir.path());
        cache.insert("/img/a.jpg".into(), make_entry(1000));
        let entry = cache.get("/img/a.jpg", 1000, 4, 8);
        assert!(entry.is_some());
        assert_eq!(entry.unwrap().mtime, 1000);
    }

    #[test]
    fn get_retourne_none_si_mtime_different() {
        let dir = TempDir::new().unwrap();
        let mut cache = HashCache::load(dir.path());
        cache.insert("/img/a.jpg".into(), make_entry(1000));
        assert!(cache.get("/img/a.jpg", 2000, 4, 8).is_none());
    }

    #[test]
    fn get_retourne_none_si_tailles_hash_differentes() {
        let dir = TempDir::new().unwrap();
        let mut cache = HashCache::load(dir.path());
        cache.insert("/img/a.jpg".into(), make_entry(1000));
        // taille coarse differente = config a change = invalide
        assert!(cache.get("/img/a.jpg", 1000, 8, 8).is_none());
        // taille fine differente
        assert!(cache.get("/img/a.jpg", 1000, 4, 16).is_none());
    }

    #[test]
    fn get_retourne_none_si_chemin_absent() {
        let dir = TempDir::new().unwrap();
        let cache = HashCache::load(dir.path());
        assert!(cache.get("/img/inexistant.jpg", 0, 4, 8).is_none());
    }

    #[test]
    fn save_ne_fait_rien_si_pas_dirty() {
        let dir = TempDir::new().unwrap();
        let mut cache = HashCache::load(dir.path());
        cache.save(dir.path()).unwrap();
        assert!(!dir.path().join("phash_cache.json").exists());
    }

    #[test]
    fn round_trip_save_load() {
        let dir = TempDir::new().unwrap();
        let mut cache = HashCache::load(dir.path());
        cache.insert("/img/a.jpg".into(), make_entry(1111));
        cache.insert("/img/b.png".into(), make_entry(2222));
        cache.save(dir.path()).unwrap();
        assert!(!cache.dirty);

        let cache2 = HashCache::load(dir.path());
        assert_eq!(cache2.len(), 2);
        let e = cache2.get("/img/a.jpg", 1111, 4, 8).unwrap();
        assert_eq!(e.mtime, 1111);
        assert!(cache2.get("/img/b.png", 9999, 4, 8).is_none());
        assert!(cache2.get("/img/b.png", 2222, 4, 8).is_some());
    }
}
