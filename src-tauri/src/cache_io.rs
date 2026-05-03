use std::collections::HashMap;
use std::path::Path;
use serde::{Deserialize, Serialize};

pub fn load_json_map<V>(data_dir: &Path, filename: &str) -> HashMap<String, V>
where
    V: for<'de> Deserialize<'de>,
{
    let path = data_dir.join(filename);
    std::fs::read_to_string(&path)
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

pub fn save_json_map<V>(
    entries: &HashMap<String, V>,
    data_dir: &Path,
    filename: &str,
    dirty: &mut bool,
) -> Result<(), String>
where
    V: Serialize,
{
    if !*dirty {
        return Ok(());
    }
    std::fs::create_dir_all(data_dir).map_err(|e| e.to_string())?;
    let json = serde_json::to_string(entries).map_err(|e| e.to_string())?;
    std::fs::write(data_dir.join(filename), json).map_err(|e| e.to_string())?;
    *dirty = false;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    #[test]
    fn load_json_map_retourne_vide_si_absent() {
        let dir = TempDir::new().unwrap();
        let map: HashMap<String, u64> = load_json_map(dir.path(), "inexistant.json");
        assert!(map.is_empty());
    }

    #[test]
    fn save_et_load_json_map_round_trip() {
        let dir = TempDir::new().unwrap();
        let mut map: HashMap<String, u64> = HashMap::new();
        map.insert("cle1".to_string(), 42);
        map.insert("cle2".to_string(), 100);
        let mut dirty = true;
        save_json_map(&map, dir.path(), "test.json", &mut dirty).unwrap();
        assert!(!dirty, "dirty doit etre false apres la sauvegarde");
        let loaded: HashMap<String, u64> = load_json_map(dir.path(), "test.json");
        assert_eq!(map, loaded);
    }

    #[test]
    fn save_json_map_ne_sauvegarde_pas_si_non_dirty() {
        let dir = TempDir::new().unwrap();
        let map: HashMap<String, String> = HashMap::new();
        let mut dirty = false;
        save_json_map(&map, dir.path(), "test.json", &mut dirty).unwrap();
        assert!(!dir.path().join("test.json").exists(), "le fichier ne doit pas etre cree si dirty=false");
    }

    #[test]
    fn save_json_map_remet_dirty_a_false() {
        let dir = TempDir::new().unwrap();
        let mut map: HashMap<String, String> = HashMap::new();
        map.insert("k".to_string(), "v".to_string());
        let mut dirty = true;
        save_json_map(&map, dir.path(), "test.json", &mut dirty).unwrap();
        assert!(!dirty);
    }

    #[test]
    fn load_json_map_retourne_vide_si_json_invalide() {
        let dir = TempDir::new().unwrap();
        std::fs::write(dir.path().join("corrupt.json"), b"pas du json").unwrap();
        let map: HashMap<String, u64> = load_json_map(dir.path(), "corrupt.json");
        assert!(map.is_empty());
    }
}
