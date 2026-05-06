use std::collections::HashMap;
use std::path::Path;
use serde::{Deserialize, Serialize};
use crate::cache_io::{load_json_map, save_json_map};

#[derive(Serialize, Deserialize, Clone)]
pub struct AudioCacheEntry {
    pub mtime: u64,
    pub size: u64,
    pub fingerprint: Vec<i32>,
    pub duration_secs: f64,
}

pub struct AudioCache {
    entries: HashMap<String, AudioCacheEntry>,
    dirty: bool,
}

impl AudioCache {
    pub fn load(data_dir: &Path) -> Self {
        AudioCache { entries: load_json_map(data_dir, "audio_cache.json"), dirty: false }
    }

    pub fn empty() -> Self {
        AudioCache { entries: HashMap::new(), dirty: false }
    }

    pub fn get(&self, path: &str, mtime: u64, size: u64) -> Option<(Vec<i32>, f64)> {
        let e = self.entries.get(path)?;
        if e.mtime == mtime && e.size == size {
            Some((e.fingerprint.clone(), e.duration_secs))
        } else {
            None
        }
    }

    pub fn insert(&mut self, path: String, mtime: u64, size: u64, fingerprint: Vec<i32>, duration_secs: f64) {
        self.entries.insert(path, AudioCacheEntry { mtime, size, fingerprint, duration_secs });
        self.dirty = true;
    }

    pub fn save(&mut self, data_dir: &Path) -> Result<(), String> {
        save_json_map(&self.entries, data_dir, "audio_cache.json", &mut self.dirty)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn get_returns_none_when_empty() {
        assert!(AudioCache::empty().get("/a.mp3", 1000, 100).is_none());
    }

    #[test]
    fn insert_and_get() {
        let mut c = AudioCache::empty();
        c.insert("/a.mp3".to_string(), 1000, 100, vec![1, 2, 3], 183.0);
        let (fp, dur) = c.get("/a.mp3", 1000, 100).unwrap();
        assert_eq!(fp, vec![1, 2, 3]);
        assert_eq!(dur, 183.0);
    }

    #[test]
    fn get_returns_none_on_stale_mtime() {
        let mut c = AudioCache::empty();
        c.insert("/a.mp3".to_string(), 1000, 100, vec![1], 10.0);
        assert!(c.get("/a.mp3", 9999, 100).is_none());
    }

    #[test]
    fn save_and_load_roundtrip() {
        let dir = tempdir().unwrap();
        let mut c = AudioCache::empty();
        c.insert("/a.mp3".to_string(), 111, 222, vec![42, -1], 60.0);
        c.save(dir.path()).unwrap();
        let loaded = AudioCache::load(dir.path());
        let (fp, dur) = loaded.get("/a.mp3", 111, 222).unwrap();
        assert_eq!(fp, vec![42, -1]);
        assert_eq!(dur, 60.0);
    }
}
