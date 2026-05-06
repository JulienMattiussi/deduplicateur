use std::time::{SystemTime, UNIX_EPOCH};
use tauri::Manager;

use crate::ScanCache;
use crate::ignore_list::{group_ignore_key, IgnoreEntry, IgnoreList};

#[tauri::command]
pub async fn ignore_group(app: tauri::AppHandle, group_id: String) -> Result<(), String> {
    let (key, display_names) = {
        let cache = app.state::<ScanCache>();
        let guard = cache.0.lock().unwrap();
        let loaded = guard.as_ref().ok_or("Aucune session chargee")?;
        let group = loaded
            .groups
            .iter()
            .find(|g| g.id == group_id)
            .ok_or("Groupe introuvable")?;
        let paths: Vec<String> = group.files.iter().map(|f| f.path.clone()).collect();
        let names: Vec<String> = group.files.iter().map(|f| f.name.clone()).collect();
        (group_ignore_key(&paths), names)
    };
    let dir = crate::app_data_dir(&app).ok_or("Impossible d'acceder au dossier de donnees")?;
    tauri::async_runtime::spawn_blocking(move || {
        let mut list = IgnoreList::load(&dir);
        let ignored_at = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs();
        list.add(IgnoreEntry { key, display_names, ignored_at });
        list.save(&dir).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn get_ignore_list(app: tauri::AppHandle) -> Result<Vec<IgnoreEntry>, String> {
    let dir = crate::app_data_dir(&app).ok_or("Impossible d'acceder au dossier de donnees")?;
    tauri::async_runtime::spawn_blocking(move || Ok(IgnoreList::load(&dir).entries_sorted()))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn clear_ignore_entry(app: tauri::AppHandle, key: String) -> Result<(), String> {
    let dir = crate::app_data_dir(&app).ok_or("Impossible d'acceder au dossier de donnees")?;
    tauri::async_runtime::spawn_blocking(move || {
        let mut list = IgnoreList::load(&dir);
        list.remove(&key);
        list.save(&dir).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn clear_all_ignored(app: tauri::AppHandle) -> Result<(), String> {
    let dir = crate::app_data_dir(&app).ok_or("Impossible d'acceder au dossier de donnees")?;
    tauri::async_runtime::spawn_blocking(move || {
        let mut list = IgnoreList::load(&dir);
        list.clear();
        list.save(&dir).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}
