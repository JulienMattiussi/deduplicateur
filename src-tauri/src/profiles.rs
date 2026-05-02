use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ScanProfile {
    #[serde(default)]
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub created_at: u64,
    pub folder: String,
    #[serde(default)]
    pub recursive: bool,
    #[serde(default = "default_scan_mode")]
    pub scan_mode: String,
    #[serde(default = "default_detection_mode")]
    pub detection_mode: String,
    #[serde(default = "default_similarity")]
    pub sim_similarity: u32,
    #[serde(default = "default_similarity")]
    pub video_similarity: u32,
    #[serde(default)]
    pub excluded: Vec<String>,
    #[serde(default)]
    pub exclude_extensions: Vec<String>,
    #[serde(default)]
    pub include_extensions: Vec<String>,
    #[serde(default)]
    pub min_file_size_kb: u64,
    #[serde(default)]
    pub max_file_size_kb: u64,
    #[serde(default = "default_true")]
    pub exact_cache_enabled: bool,
    #[serde(default = "default_audio_similarity")]
    pub audio_similarity: u32,
}

fn default_scan_mode() -> String { "all".to_string() }
fn default_detection_mode() -> String { "files".to_string() }
fn default_similarity() -> u32 { 100 }
fn default_audio_similarity() -> u32 { 100 }
fn default_true() -> bool { true }

fn profiles_dir(data_dir: &Path) -> PathBuf {
    let dir = data_dir.join("profiles");
    let _ = std::fs::create_dir_all(&dir);
    dir
}

pub fn list_profiles(data_dir: &Path) -> Vec<ScanProfile> {
    let dir = profiles_dir(data_dir);
    let mut profiles: Vec<ScanProfile> = std::fs::read_dir(&dir)
        .into_iter()
        .flatten()
        .filter_map(|e| e.ok())
        .filter(|e| e.path().extension().and_then(|x| x.to_str()) == Some("json"))
        .filter_map(|e| {
            let data = std::fs::read_to_string(e.path()).ok()?;
            serde_json::from_str(&data).ok()
        })
        .collect();
    profiles.sort_by(|a, b| b.created_at.cmp(&a.created_at));
    profiles
}

pub fn save_profile(data_dir: &Path, mut profile: ScanProfile) -> Result<ScanProfile, String> {
    if profile.id.is_empty() {
        profile.id = Uuid::new_v4().to_string();
        profile.created_at = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis() as u64;
    }
    let path = profiles_dir(data_dir).join(format!("{}.json", profile.id));
    let json = serde_json::to_string(&profile).map_err(|e| e.to_string())?;
    std::fs::write(&path, json).map_err(|e| e.to_string())?;
    Ok(profile)
}

pub fn delete_profile(data_dir: &Path, id: &str) -> Result<(), String> {
    let path = profiles_dir(data_dir).join(format!("{}.json", id));
    if path.exists() {
        std::fs::remove_file(&path).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    fn make_profile(name: &str) -> ScanProfile {
        ScanProfile {
            id: String::new(),
            name: name.to_string(),
            created_at: 0,
            folder: "/home/test".to_string(),
            recursive: true,
            scan_mode: "all".to_string(),
            detection_mode: "files".to_string(),
            sim_similarity: 100,
            video_similarity: 100,
            excluded: vec![],
            exclude_extensions: vec![],
            include_extensions: vec![],
            min_file_size_kb: 0,
            max_file_size_kb: 0,
            exact_cache_enabled: true,
            audio_similarity: 100,
        }
    }

    #[test]
    fn save_generates_id_and_timestamp() {
        let dir = tempdir().unwrap();
        let saved = save_profile(dir.path(), make_profile("test")).unwrap();
        assert!(!saved.id.is_empty());
        assert!(saved.created_at > 0);
    }

    #[test]
    fn save_and_list_roundtrip() {
        let dir = tempdir().unwrap();
        save_profile(dir.path(), make_profile("alpha")).unwrap();
        save_profile(dir.path(), make_profile("beta")).unwrap();
        let list = list_profiles(dir.path());
        assert_eq!(list.len(), 2);
        assert!(list.iter().any(|p| p.name == "alpha"));
        assert!(list.iter().any(|p| p.name == "beta"));
    }

    #[test]
    fn delete_removes_profile() {
        let dir = tempdir().unwrap();
        let p = save_profile(dir.path(), make_profile("to_remove")).unwrap();
        assert_eq!(list_profiles(dir.path()).len(), 1);
        delete_profile(dir.path(), &p.id).unwrap();
        assert_eq!(list_profiles(dir.path()).len(), 0);
    }

    #[test]
    fn delete_nonexistent_is_ok() {
        let dir = tempdir().unwrap();
        assert!(delete_profile(dir.path(), "no-such-id").is_ok());
    }

    #[test]
    fn save_preserves_fields() {
        let dir = tempdir().unwrap();
        let mut p = make_profile("full");
        p.folder = "/my/folder".to_string();
        p.recursive = false;
        p.detection_mode = "images".to_string();
        p.sim_similarity = 85;
        p.excluded = vec!["node_modules".to_string()];
        let saved = save_profile(dir.path(), p).unwrap();
        let list = list_profiles(dir.path());
        assert_eq!(list[0].folder, "/my/folder");
        assert!(!list[0].recursive);
        assert_eq!(list[0].detection_mode, "images");
        assert_eq!(list[0].sim_similarity, 85);
        assert_eq!(saved.excluded, vec!["node_modules"]);
    }
}
