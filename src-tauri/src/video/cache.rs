use std::collections::HashMap;
use std::path::Path;
use serde::{Deserialize, Serialize};
use crate::cache_io::{load_json_map, save_json_map};

/// Entree de cache pour un fichier video.
/// Cle d'invalidation : mtime + size + n_frames (si l'un change, l'entree est ignoree).
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct VideoCacheEntry {
    pub mtime: u64,
    pub size: u64,
    pub n_frames: usize,
    pub hashes: Vec<u64>,
    pub duration_secs: f64,
    pub width: u32,
    pub height: u32,
    pub codec: String,
}

/// Cache des frame hashes video entre les scans.
/// Stocke dans <data_dir>/video_cache.json.
pub struct VideoCache {
    entries: HashMap<String, VideoCacheEntry>,
    dirty: bool,
}

impl VideoCache {
    /// Charge le cache depuis <data_dir>/video_cache.json.
    /// Retourne un cache vide si le fichier est absent ou invalide.
    pub fn load(data_dir: &Path) -> Self {
        VideoCache { entries: load_json_map(data_dir, "video_cache.json"), dirty: false }
    }

    pub fn empty() -> Self {
        VideoCache { entries: HashMap::new(), dirty: false }
    }

    /// Sauvegarde le cache si des modifications ont ete apportees.
    pub fn save(&mut self, data_dir: &Path) -> Result<(), String> {
        save_json_map(&self.entries, data_dir, "video_cache.json", &mut self.dirty)
    }

    /// Retourne l'entree si elle est valide (mtime, size et n_frames identiques).
    pub fn get(&self, path: &str, mtime: u64, size: u64, n_frames: usize) -> Option<&VideoCacheEntry> {
        self.entries.get(path).filter(|e| {
            e.mtime == mtime && e.size == size && e.n_frames == n_frames
        })
    }

    pub fn insert(&mut self, path: String, entry: VideoCacheEntry) {
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

    fn make_entry(mtime: u64, size: u64, n_frames: usize) -> VideoCacheEntry {
        VideoCacheEntry { mtime, size, n_frames, hashes: vec![0u64, 1u64, 2u64], duration_secs: 10.0, width: 1920, height: 1080, codec: "h264".into() }
    }

    #[test]
    fn cache_vide_si_fichier_absent() {
        let dir = TempDir::new().unwrap();
        let cache = VideoCache::load(dir.path());
        assert!(cache.is_empty());
        assert!(!cache.dirty);
    }

    #[test]
    fn empty_retourne_cache_sans_entrees() {
        let cache = VideoCache::empty();
        assert!(cache.is_empty());
        assert!(!cache.dirty);
    }

    #[test]
    fn insert_et_get_fonctionne() {
        let mut cache = VideoCache::empty();
        cache.insert("/video/a.mp4".into(), make_entry(1000, 5000, 8));
        let h = cache.get("/video/a.mp4", 1000, 5000, 8);
        assert!(h.is_some());
        assert_eq!(h.unwrap().hashes, &[0u64, 1u64, 2u64]);
        assert_eq!(h.unwrap().duration_secs, 10.0);
        assert_eq!(h.unwrap().width, 1920);
        assert!(cache.dirty);
    }

    #[test]
    fn get_invalide_si_mtime_different() {
        let mut cache = VideoCache::empty();
        cache.insert("/video/a.mp4".into(), make_entry(1000, 5000, 8));
        assert!(cache.get("/video/a.mp4", 9999, 5000, 8).is_none());
    }

    #[test]
    fn get_invalide_si_taille_differente() {
        let mut cache = VideoCache::empty();
        cache.insert("/video/a.mp4".into(), make_entry(1000, 5000, 8));
        assert!(cache.get("/video/a.mp4", 1000, 9999, 8).is_none());
    }

    #[test]
    fn get_invalide_si_n_frames_different() {
        let mut cache = VideoCache::empty();
        cache.insert("/video/a.mp4".into(), make_entry(1000, 5000, 8));
        assert!(cache.get("/video/a.mp4", 1000, 5000, 16).is_none());
    }

    #[test]
    fn save_ne_fait_rien_si_pas_dirty() {
        let dir = TempDir::new().unwrap();
        let mut cache = VideoCache::load(dir.path());
        cache.save(dir.path()).unwrap();
        assert!(!dir.path().join("video_cache.json").exists());
    }

    #[test]
    fn round_trip_save_load() {
        let dir = TempDir::new().unwrap();
        let mut cache = VideoCache::empty();
        cache.insert("/video/a.mp4".into(), make_entry(1111, 2222, 8));
        cache.insert("/video/b.mkv".into(), make_entry(3333, 4444, 16));
        cache.save(dir.path()).unwrap();
        assert!(!cache.dirty);

        let cache2 = VideoCache::load(dir.path());
        assert_eq!(cache2.len(), 2);
        assert!(cache2.get("/video/a.mp4", 1111, 2222, 8).is_some());
        assert!(cache2.get("/video/b.mkv", 3333, 4444, 16).is_some());
        assert!(cache2.get("/video/a.mp4", 9999, 2222, 8).is_none());
    }
}
