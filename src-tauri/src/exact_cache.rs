use std::collections::HashMap;
use std::path::Path;
use serde::{Deserialize, Serialize};

/// Entree de cache pour un fichier exact.
/// Stocke les deux hashes (partiel et complet) pour eviter de les recalculer
/// si le fichier n'a pas change (mtime + taille inchanges).
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ExactCacheEntry {
    /// Date de modification du fichier au moment du calcul (secondes Unix).
    pub mtime: u64,
    /// Taille du fichier au moment du calcul (octets).
    pub size: u64,
    /// Hash partiel (4 Ko) encode en hexadecimal.
    pub partial_hash: Option<String>,
    /// Hash complet (xxhash3) encode en hexadecimal.
    pub full_hash: Option<String>,
}

/// Cache des hashes exacts entre les scans.
/// Cle : chemin absolu du fichier.
/// Invalide automatiquement les entrees dont le mtime ou la taille ont change.
pub struct ExactCache {
    entries: HashMap<String, ExactCacheEntry>,
    dirty: bool,
}

impl ExactCache {
    /// Charge le cache depuis <data_dir>/exact_cache.json.
    /// Retourne un cache vide si le fichier est absent ou invalide.
    pub fn load(data_dir: &Path) -> Self {
        let path = data_dir.join("exact_cache.json");
        let entries = std::fs::read_to_string(&path)
            .ok()
            .and_then(|s| serde_json::from_str::<HashMap<String, ExactCacheEntry>>(&s).ok())
            .unwrap_or_default();
        ExactCache { entries, dirty: false }
    }

    /// Retourne un cache vide sans fichier associe.
    pub fn empty() -> Self {
        ExactCache { entries: HashMap::new(), dirty: false }
    }

    /// Sauvegarde le cache si des modifications ont ete apportees.
    /// Ne fait rien si `dirty == false`.
    pub fn save(&mut self, data_dir: &Path) -> Result<(), String> {
        if !self.dirty {
            return Ok(());
        }
        std::fs::create_dir_all(data_dir).map_err(|e| e.to_string())?;
        let json = serde_json::to_string(&self.entries).map_err(|e| e.to_string())?;
        std::fs::write(data_dir.join("exact_cache.json"), json).map_err(|e| e.to_string())?;
        self.dirty = false;
        Ok(())
    }

    /// Retourne l'entree si elle existe et si mtime + taille correspondent.
    /// Retourne None si le fichier a ete modifie ou si l'entree est absente.
    pub fn get(&self, path: &str, mtime: u64, size: u64) -> Option<&ExactCacheEntry> {
        self.entries.get(path).filter(|e| e.mtime == mtime && e.size == size)
    }

    /// Insere ou ecrase une entree avec le hash partiel uniquement.
    /// Appele apres le calcul du hash partiel pour un fichier non cache.
    pub fn insert_partial(&mut self, path: String, mtime: u64, size: u64, partial_hash: String) {
        self.entries.insert(
            path,
            ExactCacheEntry { mtime, size, partial_hash: Some(partial_hash), full_hash: None },
        );
        self.dirty = true;
    }

    /// Met a jour ou cree une entree avec le hash complet.
    /// Si l'entree existe et que mtime + taille correspondent, conserve le hash partiel existant.
    pub fn insert_full(&mut self, path: String, mtime: u64, size: u64, full_hash: String) {
        let entry = self.entries.entry(path).or_insert_with(|| ExactCacheEntry {
            mtime,
            size,
            partial_hash: None,
            full_hash: None,
        });
        if entry.mtime == mtime && entry.size == size {
            entry.full_hash = Some(full_hash);
        } else {
            *entry = ExactCacheEntry { mtime, size, partial_hash: None, full_hash: Some(full_hash) };
        }
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

    fn make_entry(mtime: u64, size: u64) -> ExactCacheEntry {
        ExactCacheEntry {
            mtime,
            size,
            partial_hash: Some("deadbeef".to_string()),
            full_hash: Some("cafebabe01234567".to_string()),
        }
    }

    #[test]
    fn cache_vide_si_fichier_absent() {
        let dir = TempDir::new().unwrap();
        let cache = ExactCache::load(dir.path());
        assert!(cache.is_empty());
        assert!(!cache.dirty);
    }

    #[test]
    fn empty_retourne_cache_sans_entrees() {
        let cache = ExactCache::empty();
        assert!(cache.is_empty());
        assert!(!cache.dirty);
    }

    #[test]
    fn insert_partial_marque_dirty() {
        let dir = TempDir::new().unwrap();
        let mut cache = ExactCache::load(dir.path());
        cache.insert_partial("/file.txt".into(), 1000, 512, "abc123".into());
        assert!(cache.dirty);
        assert_eq!(cache.len(), 1);
        let e = cache.get("/file.txt", 1000, 512).unwrap();
        assert_eq!(e.partial_hash.as_deref(), Some("abc123"));
        assert!(e.full_hash.is_none());
    }

    #[test]
    fn insert_full_conserve_partial_existant() {
        let dir = TempDir::new().unwrap();
        let mut cache = ExactCache::load(dir.path());
        cache.insert_partial("/file.txt".into(), 1000, 512, "partial_h".into());
        cache.insert_full("/file.txt".into(), 1000, 512, "full_hash".into());
        let e = cache.get("/file.txt", 1000, 512).unwrap();
        assert_eq!(e.partial_hash.as_deref(), Some("partial_h"));
        assert_eq!(e.full_hash.as_deref(), Some("full_hash"));
    }

    #[test]
    fn insert_full_ecrase_si_mtime_different() {
        let dir = TempDir::new().unwrap();
        let mut cache = ExactCache::load(dir.path());
        cache.insert_partial("/file.txt".into(), 1000, 512, "old_partial".into());
        cache.insert_full("/file.txt".into(), 2000, 512, "new_full".into());
        let e = cache.get("/file.txt", 2000, 512).unwrap();
        assert!(e.partial_hash.is_none());
        assert_eq!(e.full_hash.as_deref(), Some("new_full"));
    }

    #[test]
    fn get_retourne_none_si_mtime_different() {
        let dir = TempDir::new().unwrap();
        let mut cache = ExactCache::load(dir.path());
        cache.insert_partial("/file.txt".into(), 1000, 512, "abc".into());
        assert!(cache.get("/file.txt", 2000, 512).is_none());
    }

    #[test]
    fn get_retourne_none_si_taille_differente() {
        let dir = TempDir::new().unwrap();
        let mut cache = ExactCache::load(dir.path());
        cache.insert_partial("/file.txt".into(), 1000, 512, "abc".into());
        assert!(cache.get("/file.txt", 1000, 1024).is_none());
    }

    #[test]
    fn save_ne_fait_rien_si_pas_dirty() {
        let dir = TempDir::new().unwrap();
        let mut cache = ExactCache::load(dir.path());
        cache.save(dir.path()).unwrap();
        assert!(!dir.path().join("exact_cache.json").exists());
    }

    #[test]
    fn round_trip_save_load() {
        let dir = TempDir::new().unwrap();
        let mut cache = ExactCache::load(dir.path());
        cache.entries.insert("/a.txt".into(), make_entry(111, 1024));
        cache.entries.insert("/b.txt".into(), make_entry(222, 2048));
        cache.dirty = true;
        cache.save(dir.path()).unwrap();
        assert!(!cache.dirty);

        let cache2 = ExactCache::load(dir.path());
        assert_eq!(cache2.len(), 2);
        let e = cache2.get("/a.txt", 111, 1024).unwrap();
        assert_eq!(e.partial_hash.as_deref(), Some("deadbeef"));
        assert!(cache2.get("/b.txt", 9999, 2048).is_none());
        assert!(cache2.get("/b.txt", 222, 2048).is_some());
    }
}
