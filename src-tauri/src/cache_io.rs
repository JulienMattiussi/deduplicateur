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
