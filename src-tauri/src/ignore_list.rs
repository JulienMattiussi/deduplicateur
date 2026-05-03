use std::collections::{HashMap, HashSet};
use std::path::Path;
use serde::{Deserialize, Serialize};
use crate::cache_io::{load_json_map, save_json_map};

const FILENAME: &str = "ignore_list.json";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IgnoreEntry {
    pub key: String,
    pub display_names: Vec<String>,
    pub ignored_at: u64,
}

pub struct IgnoreList {
    entries: HashMap<String, IgnoreEntry>,
    dirty: bool,
}

/// Cle canonique d'un groupe : chemins tries et joints par |
pub fn group_ignore_key(paths: &[String]) -> String {
    let mut sorted: Vec<&str> = paths.iter().map(|s| s.as_str()).collect();
    sorted.sort_unstable();
    sorted.join("|")
}

impl IgnoreList {
    pub fn load(data_dir: &Path) -> Self {
        let entries = load_json_map(data_dir, FILENAME);
        IgnoreList { entries, dirty: false }
    }

    pub fn save(&mut self, data_dir: &Path) -> Result<(), String> {
        save_json_map(&self.entries, data_dir, FILENAME, &mut self.dirty)
    }

    pub fn add(&mut self, entry: IgnoreEntry) {
        self.entries.insert(entry.key.clone(), entry);
        self.dirty = true;
    }

    pub fn remove(&mut self, key: &str) -> bool {
        let removed = self.entries.remove(key).is_some();
        if removed {
            self.dirty = true;
        }
        removed
    }

    pub fn contains(&self, key: &str) -> bool {
        self.entries.contains_key(key)
    }

    pub fn entries_sorted(&self) -> Vec<IgnoreEntry> {
        let mut v: Vec<IgnoreEntry> = self.entries.values().cloned().collect();
        v.sort_by(|a, b| b.ignored_at.cmp(&a.ignored_at));
        v
    }

    pub fn clear(&mut self) {
        if !self.entries.is_empty() {
            self.entries.clear();
            self.dirty = true;
        }
    }

    pub fn len(&self) -> usize {
        self.entries.len()
    }

    pub fn keys_set(&self) -> HashSet<String> {
        self.entries.keys().cloned().collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    fn entry(key: &str, names: &[&str]) -> IgnoreEntry {
        IgnoreEntry {
            key: key.to_string(),
            display_names: names.iter().map(|s| s.to_string()).collect(),
            ignored_at: 1000,
        }
    }

    #[test]
    fn group_ignore_key_est_canonique() {
        let paths_a = vec!["/b/file.jpg".to_string(), "/a/file.jpg".to_string()];
        let paths_b = vec!["/a/file.jpg".to_string(), "/b/file.jpg".to_string()];
        assert_eq!(group_ignore_key(&paths_a), group_ignore_key(&paths_b));
    }

    #[test]
    fn group_ignore_key_varie_selon_chemins() {
        let a = vec!["/a/file.jpg".to_string()];
        let b = vec!["/b/file.jpg".to_string()];
        assert_ne!(group_ignore_key(&a), group_ignore_key(&b));
    }

    #[test]
    fn add_and_contains() {
        let dir = tempdir().unwrap();
        let mut list = IgnoreList::load(dir.path());
        assert!(!list.contains("key1"));
        list.add(entry("key1", &["a.jpg", "b.jpg"]));
        assert!(list.contains("key1"));
        assert_eq!(list.len(), 1);
    }

    #[test]
    fn remove_existant_retourne_true() {
        let dir = tempdir().unwrap();
        let mut list = IgnoreList::load(dir.path());
        list.add(entry("key1", &["a.jpg"]));
        assert!(list.remove("key1"));
        assert!(!list.contains("key1"));
    }

    #[test]
    fn remove_absent_retourne_false() {
        let dir = tempdir().unwrap();
        let mut list = IgnoreList::load(dir.path());
        assert!(!list.remove("inexistant"));
    }

    #[test]
    fn clear_vide_la_liste() {
        let dir = tempdir().unwrap();
        let mut list = IgnoreList::load(dir.path());
        list.add(entry("k1", &["a.jpg"]));
        list.add(entry("k2", &["b.jpg"]));
        list.clear();
        assert_eq!(list.len(), 0);
        assert!(list.keys_set().is_empty());
    }

    #[test]
    fn round_trip_json() {
        let dir = tempdir().unwrap();
        let mut list = IgnoreList::load(dir.path());
        list.add(entry("k1", &["a.jpg", "b.jpg"]));
        list.add(entry("k2", &["c.jpg"]));
        list.save(dir.path()).unwrap();

        let loaded = IgnoreList::load(dir.path());
        assert!(loaded.contains("k1"));
        assert!(loaded.contains("k2"));
        assert_eq!(loaded.len(), 2);
    }

    #[test]
    fn entries_sorted_par_date_decroissante() {
        let dir = tempdir().unwrap();
        let mut list = IgnoreList::load(dir.path());
        list.add(IgnoreEntry { key: "old".to_string(), display_names: vec![], ignored_at: 100 });
        list.add(IgnoreEntry { key: "new".to_string(), display_names: vec![], ignored_at: 200 });
        let entries = list.entries_sorted();
        assert_eq!(entries[0].key, "new");
        assert_eq!(entries[1].key, "old");
    }
}
