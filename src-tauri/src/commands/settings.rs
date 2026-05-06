use crate::MediaServerPort;
use crate::audio::AudioConfig;
use crate::phash::{load_config, save_config, PHashConfig};
use crate::profiles;
use crate::video::VideoConfig;

fn app_data_dir(app: &tauri::AppHandle) -> Option<std::path::PathBuf> {
    crate::app_data_dir(app)
}

fn load_cfg<T: Default>(app: &tauri::AppHandle, load: impl Fn(&std::path::Path) -> T) -> T {
    app_data_dir(app).as_deref().map(load).unwrap_or_default()
}

fn save_cfg<T>(
    app: &tauri::AppHandle,
    config: &T,
    save: impl Fn(&std::path::Path, &T) -> Result<(), String>,
) -> Result<(), String> {
    let dir = app_data_dir(app).ok_or("Impossible d'acceder au dossier de donnees")?;
    save(&dir, config)
}

#[tauri::command]
pub fn get_phash_config(app: tauri::AppHandle) -> PHashConfig {
    load_cfg(&app, load_config)
}

#[tauri::command]
pub fn set_phash_config(app: tauri::AppHandle, config: PHashConfig) -> Result<(), String> {
    save_cfg(&app, &config, save_config)
}

#[tauri::command]
pub fn get_video_config(app: tauri::AppHandle) -> VideoConfig {
    load_cfg(&app, crate::video::config::load_config)
}

#[tauri::command]
pub fn set_video_config(app: tauri::AppHandle, config: VideoConfig) -> Result<(), String> {
    save_cfg(&app, &config, crate::video::config::save_config)
}

#[tauri::command]
pub fn get_audio_config(app: tauri::AppHandle) -> AudioConfig {
    load_cfg(&app, crate::audio::config::load_config)
}

#[tauri::command]
pub fn set_audio_config(app: tauri::AppHandle, config: AudioConfig) -> Result<(), String> {
    save_cfg(&app, &config, crate::audio::config::save_config)
}

#[tauri::command]
pub fn get_cache_size(app: tauri::AppHandle) -> u64 {
    const CACHE_FILES: &[&str] = &["phash_cache.json", "video_cache.json", "audio_cache.json", "exact_cache.json"];
    let Some(dir) = app_data_dir(&app) else { return 0; };
    CACHE_FILES.iter().map(|name| {
        std::fs::metadata(dir.join(name)).map(|m| m.len()).unwrap_or(0)
    }).sum()
}

#[tauri::command]
pub fn purge_cache(app: tauri::AppHandle) -> Result<(), String> {
    const CACHE_FILES: &[&str] = &["phash_cache.json", "video_cache.json", "audio_cache.json", "exact_cache.json"];
    let dir = app_data_dir(&app).ok_or("Impossible d'acceder au dossier de donnees")?;
    for name in CACHE_FILES {
        let path = dir.join(name);
        if path.exists() {
            std::fs::remove_file(&path).map_err(|e| format!("{}: {}", name, e))?;
        }
    }
    Ok(())
}

#[tauri::command]
pub fn list_profiles(app: tauri::AppHandle) -> Vec<profiles::ScanProfile> {
    match app_data_dir(&app) {
        Some(dir) => profiles::list_profiles(&dir),
        None => vec![],
    }
}

#[tauri::command]
pub fn save_profile(
    app: tauri::AppHandle,
    profile: profiles::ScanProfile,
) -> Result<profiles::ScanProfile, String> {
    let dir = app_data_dir(&app).ok_or("Impossible d'acceder au dossier de donnees")?;
    profiles::save_profile(&dir, profile)
}

#[tauri::command]
pub fn delete_profile(app: tauri::AppHandle, id: String) -> Result<(), String> {
    let dir = app_data_dir(&app).ok_or("Impossible d'acceder au dossier de donnees")?;
    profiles::delete_profile(&dir, &id)
}

#[tauri::command]
pub async fn check_tools() -> serde_json::Value {
    let ffmpeg_available = tauri::async_runtime::spawn_blocking(crate::video::is_ffmpeg_available)
        .await
        .unwrap_or(false);
    let fpcalc_available = tauri::async_runtime::spawn_blocking(crate::audio::fpcalc_available)
        .await
        .unwrap_or(false);
    serde_json::json!({
        "ffmpeg_available": ffmpeg_available,
        "fpcalc_available": fpcalc_available,
    })
}

#[tauri::command]
pub fn get_media_server_port(state: tauri::State<MediaServerPort>) -> u16 {
    state.0
}
