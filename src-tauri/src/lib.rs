mod audio_cache;
mod audio_config;
mod audio_hash;
mod cache_io;
mod exact_cache;
mod filters;
mod ignore_list;
mod phash_cache;
mod phash_config;
mod phash_perf;
mod profiles;
mod scanner;
mod tool_finder;
mod video_cache;
mod video_config;
mod video_hash;

use audio_config::AudioConfig;
use ignore_list::{group_ignore_key, IgnoreEntry, IgnoreList};
use phash_config::{load_config, save_config, PHashConfig};
use video_config::VideoConfig;
use scanner::{scan_folder as do_scan, DuplicateFile, DuplicateGroup, ScanParams};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{Emitter, Manager};
use tauri_plugin_notification::NotificationExt;

struct CancelFlag(Arc<AtomicBool>);

struct LoadedSession {
    summary: ScanSummary,
    groups: Vec<DuplicateGroup>,
}

struct ScanCache(Mutex<Option<LoadedSession>>);

#[derive(Debug, serde::Serialize, serde::Deserialize, Clone)]
struct ScanSummary {
    id: String,
    folder: String,
    total_wasted_bytes: u64,
    total_groups: usize,
    scanned_files: usize,
    duration_ms: u128,
    #[serde(default)]
    by_folder: bool,
    #[serde(default)]
    total_folders: usize,
    #[serde(default)]
    partial: bool,
    #[serde(default)]
    recursive: bool,
    #[serde(default)]
    find_similar: bool,
    #[serde(default)]
    find_similar_videos: bool,
    #[serde(default)]
    ffmpeg_missing: bool,
    #[serde(default)]
    find_similar_audio: bool,
    #[serde(default)]
    fpcalc_missing: bool,
}

#[derive(Debug, serde::Serialize)]
struct GroupsPage {
    groups: Vec<DuplicateGroup>,
    offset: usize,
    total: usize,
    has_more: bool,
}

#[derive(serde::Serialize, serde::Deserialize)]
struct SessionFile {
    summary: ScanSummary,
    groups: Vec<DuplicateGroup>,
}

fn app_data_dir(app: &tauri::AppHandle) -> Option<PathBuf> {
    let dir = app.path().app_local_data_dir().ok()?;
    std::fs::create_dir_all(&dir).ok()?;
    Some(dir)
}

fn sessions_dir(app: &tauri::AppHandle) -> Option<PathBuf> {
    let dir = app.path().app_local_data_dir().ok()?.join("sessions");
    std::fs::create_dir_all(&dir).ok()?;
    Some(dir)
}

fn session_path(app: &tauri::AppHandle, id: &str) -> Option<PathBuf> {
    Some(sessions_dir(app)?.join(format!("{}.json", id)))
}

fn save_session(app: &tauri::AppHandle, summary: &ScanSummary, groups: &[DuplicateGroup]) {
    if let Some(path) = session_path(app, &summary.id) {
        if let Ok(json) = serde_json::to_string(&SessionFile {
            summary: summary.clone(),
            groups: groups.to_vec(),
        }) {
            let _ = std::fs::write(&path, json);
        }
    }
}

fn read_session_file(app: &tauri::AppHandle, id: &str) -> Option<SessionFile> {
    let path = session_path(app, id)?;
    let data = std::fs::read_to_string(&path).ok()?;
    serde_json::from_str(&data).ok()
}

/// Retourne si une notification doit etre emise selon la duree du scan.
/// La notification n'est emise que si le scan a dure plus de `threshold_secs` secondes.
pub fn should_notify(duration_ms: u128, threshold_secs: u64) -> bool {
    duration_ms >= (threshold_secs as u128) * 1000
}

/// Formate le corps de la notification selon la langue.
/// lang : "fr" ou autre (-> EN par defaut).
pub fn format_notification_body(groups: usize, wasted_bytes: u64, lang: &str) -> String {
    let size_str = format_size_for_notif(wasted_bytes);
    if lang == "fr" {
        if groups == 0 {
            "Aucun doublon trouve.".to_string()
        } else if groups == 1 {
            format!("1 groupe trouve - {} recuperables", size_str)
        } else {
            format!("{} groupes trouves - {} recuperables", groups, size_str)
        }
    } else {
        if groups == 0 {
            "No duplicates found.".to_string()
        } else if groups == 1 {
            format!("1 group found - {} recoverable", size_str)
        } else {
            format!("{} groups found - {} recoverable", groups, size_str)
        }
    }
}

fn format_size_for_notif(bytes: u64) -> String {
    if bytes >= 1_073_741_824 {
        format!("{:.1} GB", bytes as f64 / 1_073_741_824.0)
    } else if bytes >= 1_048_576 {
        format!("{:.1} MB", bytes as f64 / 1_048_576.0)
    } else if bytes >= 1024 {
        format!("{:.0} KB", bytes as f64 / 1024.0)
    } else {
        format!("{} B", bytes)
    }
}

#[tauri::command]
async fn scan_folder(
    window: tauri::Window,
    path: String,
    recursive: bool,
    excluded: Vec<String>,
    by_folder: bool,
    find_similar: bool,
    sim_threshold: u32,
    find_similar_videos: bool,
    video_sim_threshold: u32,
    exact_cache_enabled: bool,
    exclude_extensions: Vec<String>,
    include_extensions: Vec<String>,
    min_file_size_kb: u64,
    max_file_size_kb: u64,
    find_similar_audio: bool,
    audio_sim_threshold: u32,
    audio_cache_enabled: bool,
    audio_duration_tolerance: f64,
    notification_threshold_secs: Option<u64>,
    notification_lang: Option<String>,
    secondary_folder: Option<String>,
) -> Result<ScanSummary, String> {
    let app = window.app_handle().clone();
    let cancelled = {
        let state = app.state::<CancelFlag>();
        state.0.store(false, Ordering::Relaxed);
        Arc::clone(&state.0)
    };

    let data_dir_str = app.path().app_local_data_dir().ok().map(|p| p.to_string_lossy().to_string());
    let phash_cfg = data_dir_str.as_deref()
        .map(|d| load_config(std::path::Path::new(d)))
        .unwrap_or_default();
    let video_cfg = data_dir_str.as_deref()
        .map(|d| video_config::load_config(std::path::Path::new(d)))
        .unwrap_or_default();
    let audio_cfg = data_dir_str.as_deref()
        .map(|d| audio_config::load_config(std::path::Path::new(d)))
        .unwrap_or_default();
    let ignored_keys = data_dir_str.as_deref()
        .map(|d| IgnoreList::load(std::path::Path::new(d)).keys_set())
        .unwrap_or_default();

    // Shared progress state written by rayon threads, read by the async emitter task.
    // Never call window.emit() from rayon threads directly - it deadlocks the GTK main loop.
    let progress_state: Arc<Mutex<Option<(usize, usize, usize, String)>>> = Arc::new(Mutex::new(None));
    let progress_for_scan = Arc::clone(&progress_state);
    let progress_for_emit = Arc::clone(&progress_state);

    let window_emit = window.clone();
    let emit_task = tauri::async_runtime::spawn(async move {
        let mut interval = tokio::time::interval(tokio::time::Duration::from_millis(100));
        loop {
            interval.tick().await;
            let snapshot = progress_for_emit.lock().unwrap().clone();
            if let Some((current, total, total_files, file)) = snapshot {
                let _ = window_emit.emit(
                    "scan:progress",
                    serde_json::json!({ "current": current, "total": total, "total_files": total_files, "file": file }),
                );
            }
        }
    });

    let folder = path.clone();
    let result = tauri::async_runtime::spawn_blocking(move || {
        let params = ScanParams {
            folder: path,
            recursive,
            excluded,
            by_folder,
            find_similar,
            sim_threshold,
            phash_config: phash_cfg,
            data_dir: data_dir_str,
            find_similar_videos,
            video_sim_threshold,
            video_frames: video_cfg.n_frames,
            video_duration_tolerance: video_cfg.duration_tolerance,
            video_cache_enabled: video_cfg.cache_enabled,
            video_use_dtw: video_cfg.use_dtw,
            exact_cache_enabled,
            exclude_extensions,
            include_extensions,
            min_file_size_kb,
            max_file_size_kb,
            find_similar_audio,
            audio_sim_threshold,
            audio_cache_enabled: audio_cache_enabled && audio_cfg.cache_enabled,
            audio_duration_tolerance,
            ignored_keys,
            secondary_folder,
        };
        do_scan(params, cancelled, move |current, total, total_files, file: &str| {
            *progress_for_scan.lock().unwrap() = Some((current, total, total_files, file.to_string()));
        })
    })
    .await
    .map_err(|e| e.to_string())??;

    emit_task.abort();

    let id = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
        .to_string();

    let total_folders = if by_folder {
        result.groups.iter()
            .filter_map(|g| g.folder_key.as_ref())
            .collect::<std::collections::HashSet<_>>()
            .len()
    } else {
        0
    };

    let summary = ScanSummary {
        id,
        folder,
        total_wasted_bytes: result.total_wasted_bytes,
        total_groups: result.groups.len(),
        scanned_files: result.scanned_files,
        duration_ms: result.duration_ms,
        by_folder,
        total_folders,
        partial: result.partial,
        recursive,
        find_similar,
        find_similar_videos,
        ffmpeg_missing: result.ffmpeg_missing,
        find_similar_audio,
        fpcalc_missing: result.fpcalc_missing,
    };

    save_session(&app, &summary, &result.groups);
    *app.state::<ScanCache>().0.lock().unwrap() = Some(LoadedSession {
        summary: summary.clone(),
        groups: result.groups,
    });

    // Notification de fin de scan (uniquement si le scan a dure assez longtemps).
    let threshold = notification_threshold_secs.unwrap_or(10);
    if should_notify(summary.duration_ms, threshold) {
        let lang = notification_lang.as_deref().unwrap_or("en");
        let title = if lang == "fr" { "Analyse terminee" } else { "Scan complete" };
        let body = format_notification_body(summary.total_groups, summary.total_wasted_bytes, lang);
        let _ = app.notification()
            .builder()
            .title(title)
            .body(body)
            .show();
    }

    Ok(summary)
}

#[tauri::command]
fn cancel_scan(app: tauri::AppHandle) {
    app.state::<CancelFlag>().0.store(true, Ordering::Relaxed);
}

#[tauri::command]
fn list_sessions(app: tauri::AppHandle) -> Vec<ScanSummary> {
    let dir = match sessions_dir(&app) {
        Some(d) => d,
        None => return vec![],
    };
    let mut sessions: Vec<ScanSummary> = std::fs::read_dir(&dir)
        .into_iter()
        .flatten()
        .filter_map(|e| e.ok())
        .filter(|e| e.path().extension().and_then(|x| x.to_str()) == Some("json"))
        .filter_map(|e| {
            let data = std::fs::read_to_string(e.path()).ok()?;
            let file: SessionFile = serde_json::from_str(&data).ok()?;
            Some(file.summary)
        })
        .collect();
    sessions.sort_by(|a, b| b.id.cmp(&a.id));
    sessions
}

#[tauri::command]
fn load_session(app: tauri::AppHandle, id: String) -> Result<ScanSummary, String> {
    {
        let cache = app.state::<ScanCache>();
        let guard = cache.0.lock().unwrap();
        if let Some(ref loaded) = *guard {
            if loaded.summary.id == id {
                return Ok(loaded.summary.clone());
            }
        }
    }

    let file = read_session_file(&app, &id)
        .ok_or_else(|| "Session introuvable".to_string())?;

    let summary = file.summary.clone();
    *app.state::<ScanCache>().0.lock().unwrap() = Some(LoadedSession {
        summary: file.summary,
        groups: file.groups,
    });
    Ok(summary)
}

#[tauri::command]
fn delete_session(app: tauri::AppHandle, id: String) {
    {
        let cache = app.state::<ScanCache>();
        let mut guard = cache.0.lock().unwrap();
        if let Some(ref loaded) = *guard {
            if loaded.summary.id == id {
                *guard = None;
            }
        }
    }
    if let Some(path) = session_path(&app, &id) {
        let _ = std::fs::remove_file(&path);
    }
}

#[tauri::command]
fn get_groups_page(app: tauri::AppHandle, offset: usize, limit: usize) -> Result<GroupsPage, String> {
    let cache = app.state::<ScanCache>();
    let guard = cache.0.lock().unwrap();
    match *guard {
        Some(ref loaded) => Ok(make_page(&loaded.groups, offset, limit)),
        None => Err("Aucune session chargée".to_string()),
    }
}

fn make_page(groups: &[DuplicateGroup], offset: usize, limit: usize) -> GroupsPage {
    let total = groups.len();
    let end = (offset + limit).min(total);
    GroupsPage {
        groups: if offset < total { groups[offset..end].to_vec() } else { vec![] },
        offset,
        total,
        has_more: end < total,
    }
}

/// Retourne le nombre de pixels (largeur x hauteur) pour un fichier.
/// Pour les videos, utilise les metadonnees deja chargees.
/// Pour les images, lit l'en-tete via le crate image (pas de decode complet).
fn pixel_count_for_file(file: &DuplicateFile) -> Option<u64> {
    if let Some(ref vm) = file.video_metadata {
        return Some(vm.width as u64 * vm.height as u64);
    }
    image::image_dimensions(&file.path)
        .ok()
        .map(|(w, h)| w as u64 * h as u64)
}

/// Logique pure de selection : retourne les chemins a supprimer (un fichier garde par groupe).
///
/// Modes :
/// - "newest" / "oldest" : par date de modification
/// - "largest_size" : par taille de fichier (plus grand = garde), tie-break par newest
/// - "highest_resolution" : pixels (video_metadata ou en-tete image), tie-break par largest_size puis newest;
///   si aucun fichier du groupe n'a de resolution detectable, le groupe est ignore (aucun fichier coche)
/// - "priority_folder" : garde le fichier dont le chemin commence par `folder_prefix`;
///   si aucun ne matche, le groupe est ignore (aucun fichier coche); si plusieurs matchent, garde le plus recent
pub fn select_files_to_delete(
    groups: &[DuplicateGroup],
    mode: &str,
    folder_prefix: Option<&str>,
) -> Vec<String> {
    groups
        .iter()
        .flat_map(|group| {
            if group.files.is_empty() {
                return vec![];
            }
            let keep: Option<&DuplicateFile> = match mode {
                "newest" => group.files.iter().max_by_key(|f| f.modified),
                "oldest" => group.files.iter().min_by_key(|f| f.modified),
                "largest_size" => group.files.iter().max_by(|a, b| {
                    a.size.cmp(&b.size).then(a.modified.cmp(&b.modified))
                }),
                "highest_resolution" => {
                    let any_has_resolution =
                        group.files.iter().any(|f| pixel_count_for_file(f).is_some());
                    if !any_has_resolution {
                        return vec![];
                    }
                    group.files.iter().max_by(|a, b| {
                        let pa = pixel_count_for_file(a).unwrap_or(0);
                        let pb = pixel_count_for_file(b).unwrap_or(0);
                        pa.cmp(&pb)
                            .then(a.size.cmp(&b.size))
                            .then(a.modified.cmp(&b.modified))
                    })
                }
                "priority_folder" => {
                    let prefix = folder_prefix.unwrap_or("");
                    let in_priority: Vec<&DuplicateFile> = group
                        .files
                        .iter()
                        .filter(|f| f.path.starts_with(prefix))
                        .collect();
                    if in_priority.is_empty() {
                        return vec![];
                    }
                    in_priority.into_iter().max_by_key(|f| f.modified)
                }
                _ => group.files.first(),
            };
            group
                .files
                .iter()
                .filter(|f| keep.map_or(true, |k| k.path != f.path))
                .map(|f| f.path.clone())
                .collect::<Vec<_>>()
        })
        .collect()
}

#[tauri::command]
fn select_all_duplicates(app: tauri::AppHandle) -> Result<Vec<String>, String> {
    let cache = app.state::<ScanCache>();
    let guard = cache.0.lock().unwrap();
    match *guard {
        None => Err("Aucune session chargée".to_string()),
        Some(ref loaded) => {
            let paths: Vec<String> = loaded
                .groups
                .iter()
                .flat_map(|group| group.files.iter().skip(1).map(|f| f.path.clone()))
                .collect();
            Ok(paths)
        }
    }
}

#[tauri::command]
async fn smart_select(
    app: tauri::AppHandle,
    mode: String,
    folder_prefix: Option<String>,
) -> Result<Vec<String>, String> {
    let cache = app.state::<ScanCache>();
    let groups = {
        let guard = cache.0.lock().unwrap();
        match *guard {
            None => return Err("Aucune session chargée".to_string()),
            Some(ref loaded) => loaded.groups.clone(),
        }
    };
    tauri::async_runtime::spawn_blocking(move || {
        Ok(select_files_to_delete(&groups, &mode, folder_prefix.as_deref()))
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    use scanner::{DuplicateFile, DuplicateGroup};
    use video_hash::VideoMetadata;

    // ── Tests notifications ────────────────────────────────────────────────────

    #[test]
    fn test_should_notify_above_threshold() {
        assert!(should_notify(15_000, 10), "15s > seuil 10s");
        assert!(should_notify(10_000, 10), "exactement le seuil");
        assert!(should_notify(60_000, 10), "60s > seuil 10s");
    }

    #[test]
    fn test_should_notify_below_threshold() {
        assert!(!should_notify(9_999, 10), "9.999s < seuil 10s");
        assert!(!should_notify(0, 10), "0ms < seuil 10s");
        assert!(!should_notify(5_000, 10), "5s < seuil 10s");
    }

    #[test]
    fn test_should_notify_zero_threshold() {
        assert!(should_notify(0, 0), "seuil 0 = toujours notifier");
        assert!(should_notify(1, 0), "seuil 0 = toujours notifier");
    }

    #[test]
    fn test_format_notification_body_fr_no_groups() {
        let body = format_notification_body(0, 0, "fr");
        assert_eq!(body, "Aucun doublon trouve.");
    }

    #[test]
    fn test_format_notification_body_fr_one_group() {
        let body = format_notification_body(1, 2_097_152, "fr");
        assert!(body.contains("1 groupe"), "corps FR singulier");
        assert!(body.contains("2.0 MB"), "taille en MB");
    }

    #[test]
    fn test_format_notification_body_fr_many_groups() {
        let body = format_notification_body(42, 1_073_741_824, "fr");
        assert!(body.contains("42 groupes"), "corps FR pluriel");
        assert!(body.contains("1.0 GB"), "taille en GB");
    }

    #[test]
    fn test_format_notification_body_en_no_groups() {
        let body = format_notification_body(0, 0, "en");
        assert_eq!(body, "No duplicates found.");
    }

    #[test]
    fn test_format_notification_body_en_one_group() {
        let body = format_notification_body(1, 512 * 1024, "en");
        assert!(body.contains("1 group found"), "corps EN singulier");
        assert!(body.contains("512 KB"), "taille en KB");
    }

    #[test]
    fn test_format_notification_body_en_many_groups() {
        let body = format_notification_body(7, 1024, "en");
        assert!(body.contains("7 groups found"), "corps EN pluriel");
        assert!(body.contains("1 KB"), "taille 1 KB");
    }

    #[test]
    fn test_format_notification_body_unknown_lang_defaults_to_en() {
        let body = format_notification_body(3, 3_145_728, "de");
        assert!(body.contains("groups found"), "langue inconnue -> EN");
    }

    #[test]
    fn test_format_size_bytes() {
        let body = format_notification_body(1, 500, "en");
        assert!(body.contains("500 B"), "octets bruts");
    }

    fn make_file(path: &str, size: u64, modified: u64) -> DuplicateFile {
        DuplicateFile {
            path: path.to_string(),
            name: path.split('/').last().unwrap_or(path).to_string(),
            size,
            modified,
            video_metadata: None,
            audio_metadata: None,
            source: None,
        }
    }

    fn make_group(files: Vec<DuplicateFile>) -> DuplicateGroup {
        DuplicateGroup {
            id: "test".to_string(),
            hash: "abc".to_string(),
            size: files.first().map_or(0, |f| f.size),
            files,
            folder_key: None,
            similar: false,
            video_similar: false,
            audio_similar: false,
        }
    }

    #[test]
    fn test_largest_size_keeps_biggest() {
        let groups = vec![make_group(vec![
            make_file("/a/small.jpg", 100, 100),
            make_file("/a/large.jpg", 300, 50),
            make_file("/a/medium.jpg", 200, 200),
        ])];
        let result = select_files_to_delete(&groups, "largest_size", None);
        assert_eq!(result.len(), 2);
        assert!(!result.contains(&"/a/large.jpg".to_string()));
        assert!(result.contains(&"/a/small.jpg".to_string()));
        assert!(result.contains(&"/a/medium.jpg".to_string()));
    }

    #[test]
    fn test_largest_size_tiebreak_newest() {
        let groups = vec![make_group(vec![
            make_file("/a/old.jpg", 100, 50),
            make_file("/a/new.jpg", 100, 200),
        ])];
        let result = select_files_to_delete(&groups, "largest_size", None);
        assert_eq!(result.len(), 1);
        assert!(result.contains(&"/a/old.jpg".to_string()));
    }

    #[test]
    fn test_priority_folder_keeps_matching() {
        let groups = vec![make_group(vec![
            make_file("/other/file.jpg", 100, 50),
            make_file("/priority/file.jpg", 100, 50),
        ])];
        let result = select_files_to_delete(&groups, "priority_folder", Some("/priority"));
        assert_eq!(result.len(), 1);
        assert!(result.contains(&"/other/file.jpg".to_string()));
    }

    #[test]
    fn test_priority_folder_no_match_skips_group() {
        let groups = vec![make_group(vec![
            make_file("/a/old.jpg", 100, 50),
            make_file("/a/new.jpg", 100, 200),
        ])];
        let result =
            select_files_to_delete(&groups, "priority_folder", Some("/not-matching"));
        assert!(result.is_empty(), "aucun fichier coché si aucun ne correspond au préfixe");
    }

    #[test]
    fn test_priority_folder_multiple_matches_keeps_newest() {
        let groups = vec![make_group(vec![
            make_file("/priority/old.jpg", 100, 50),
            make_file("/priority/new.jpg", 100, 200),
            make_file("/other/file.jpg", 100, 300),
        ])];
        let result = select_files_to_delete(&groups, "priority_folder", Some("/priority"));
        assert_eq!(result.len(), 2);
        assert!(!result.contains(&"/priority/new.jpg".to_string()));
        assert!(result.contains(&"/priority/old.jpg".to_string()));
        assert!(result.contains(&"/other/file.jpg".to_string()));
    }

    #[test]
    fn test_highest_resolution_video_keeps_hd() {
        let mut hd = make_file("/a/hd.mp4", 1000, 100);
        hd.video_metadata = Some(VideoMetadata {
            duration_secs: 60.0,
            width: 1920,
            height: 1080,
            codec: "h264".to_string(),
        });
        let mut sd = make_file("/a/sd.mp4", 500, 200);
        sd.video_metadata = Some(VideoMetadata {
            duration_secs: 60.0,
            width: 1280,
            height: 720,
            codec: "h264".to_string(),
        });
        let groups = vec![make_group(vec![sd, hd])];
        let result = select_files_to_delete(&groups, "highest_resolution", None);
        assert_eq!(result.len(), 1);
        assert!(result.contains(&"/a/sd.mp4".to_string()));
    }

    #[test]
    fn test_highest_resolution_tiebreak_largest_then_newest() {
        let mut a = make_file("/a/a.mp4", 100, 100);
        a.video_metadata = Some(VideoMetadata {
            duration_secs: 60.0,
            width: 1920,
            height: 1080,
            codec: "h264".to_string(),
        });
        let mut b = make_file("/a/b.mp4", 200, 50);
        b.video_metadata = Some(VideoMetadata {
            duration_secs: 60.0,
            width: 1920,
            height: 1080,
            codec: "h264".to_string(),
        });
        let groups = vec![make_group(vec![a, b])];
        let result = select_files_to_delete(&groups, "highest_resolution", None);
        assert_eq!(result.len(), 1);
        assert!(result.contains(&"/a/a.mp4".to_string()));
    }

    #[test]
    #[test]
    fn test_select_empty_group_returns_empty() {
        let groups = vec![make_group(vec![])];
        let result = select_files_to_delete(&groups, "largest_size", None);
        assert!(result.is_empty());
    }

    #[test]
    fn test_highest_resolution_no_metadata_skips_group() {
        let groups = vec![make_group(vec![
            make_file("/a/doc1.pdf", 100, 100),
            make_file("/a/doc2.pdf", 200, 200),
        ])];
        let result = select_files_to_delete(&groups, "highest_resolution", None);
        assert!(result.is_empty(), "aucun fichier coché si aucune résolution détectable");
    }

    #[test]
    fn test_highest_resolution_mixed_keeps_image_over_no_metadata() {
        let mut img = make_file("/a/photo.jpg", 50, 100);
        img.video_metadata = Some(VideoMetadata {
            duration_secs: 0.0,
            width: 1920,
            height: 1080,
            codec: "jpeg".to_string(),
        });
        let other = make_file("/a/doc.pdf", 200, 200);
        let groups = vec![make_group(vec![other, img])];
        let result = select_files_to_delete(&groups, "highest_resolution", None);
        assert_eq!(result.len(), 1);
        assert!(result.contains(&"/a/doc.pdf".to_string()));
    }
}

#[derive(serde::Serialize)]
struct FolderSummary {
    folder_key: String,
    group_count: usize,
    total_wasted_bytes: u64,
}

#[tauri::command]
fn list_folder_keys(app: tauri::AppHandle) -> Result<Vec<FolderSummary>, String> {
    let cache = app.state::<ScanCache>();
    let guard = cache.0.lock().unwrap();
    match *guard {
        None => Err("Aucune session chargée".to_string()),
        Some(ref loaded) => {
            let mut summaries: Vec<FolderSummary> = Vec::new();
            for group in &loaded.groups {
                let key = group.folder_key.clone().unwrap_or_default();
                let wasted = group.size * (group.files.len() as u64 - 1);
                match summaries.last_mut() {
                    Some(last) if last.folder_key == key => {
                        last.group_count += 1;
                        last.total_wasted_bytes += wasted;
                    }
                    _ => summaries.push(FolderSummary {
                        folder_key: key,
                        group_count: 1,
                        total_wasted_bytes: wasted,
                    }),
                }
            }
            Ok(summaries)
        }
    }
}

#[tauri::command]
fn get_folder_groups_page(
    app: tauri::AppHandle,
    folder_key: String,
    offset: usize,
    limit: usize,
) -> Result<GroupsPage, String> {
    let cache = app.state::<ScanCache>();
    let guard = cache.0.lock().unwrap();
    match *guard {
        None => Err("Aucune session chargée".to_string()),
        Some(ref loaded) => {
            let folder_groups: Vec<DuplicateGroup> = loaded.groups.iter()
                .filter(|g| g.folder_key.as_deref().unwrap_or("") == folder_key.as_str())
                .cloned()
                .collect();
            Ok(make_page(&folder_groups, offset, limit))
        }
    }
}

#[cfg(target_os = "windows")]
fn open_in_file_manager(path: &str) -> std::io::Result<()> {
    use std::os::windows::process::CommandExt;
    let win_path = path.replace('/', "\\");
    std::process::Command::new("explorer.exe")
        .raw_arg(format!("/select,\"{}\"", win_path))
        .creation_flags(0x08000000)
        .spawn()
        .map(|_| ())
}

#[cfg(target_os = "macos")]
fn open_in_file_manager(path: &str) -> std::io::Result<()> {
    std::process::Command::new("open")
        .args(["-R", path])
        .spawn()
        .map(|_| ())
}

#[cfg(not(any(target_os = "windows", target_os = "macos")))]
fn open_in_file_manager(path: &str) -> std::io::Result<()> {
    let dir = std::path::Path::new(path)
        .parent()
        .unwrap_or_else(|| std::path::Path::new(path));
    std::process::Command::new("xdg-open")
        .arg(dir)
        .spawn()
        .map(|_| ())
}

#[tauri::command]
fn reveal_in_folder(path: String) -> Result<(), String> {
    open_in_file_manager(&path).map_err(|e| e.to_string())
}

#[cfg(target_os = "windows")]
fn open_file_default(path: &str) -> std::io::Result<()> {
    std::process::Command::new("explorer.exe")
        .arg(path)
        .spawn()
        .map(|_| ())
}

#[cfg(target_os = "macos")]
fn open_file_default(path: &str) -> std::io::Result<()> {
    std::process::Command::new("open").arg(path).spawn().map(|_| ())
}

#[cfg(not(any(target_os = "windows", target_os = "macos")))]
fn open_file_default(path: &str) -> std::io::Result<()> {
    std::process::Command::new("xdg-open").arg(path).spawn().map(|_| ())
}

#[tauri::command]
fn open_file(path: String) -> Result<(), String> {
    open_file_default(&path).map_err(|e| e.to_string())
}

#[tauri::command]
fn delete_files(paths: Vec<String>) -> Result<(), String> {
    let mut errors: Vec<String> = Vec::new();
    for path in &paths {
        if !std::path::Path::new(path).exists() {
            continue; // fichier déjà absent, on considère c'est ok
        }
        if let Err(e) = trash::delete(path) {
            errors.push(format!("{}: {}", path, e));
        }
    }
    if errors.is_empty() {
        Ok(())
    } else {
        Err(errors.join("\n"))
    }
}

fn load_cfg<T: Default>(app: &tauri::AppHandle, load: impl Fn(&std::path::Path) -> T) -> T {
    app_data_dir(app).as_deref().map(load).unwrap_or_default()
}

fn save_cfg<T>(app: &tauri::AppHandle, config: &T, save: impl Fn(&std::path::Path, &T) -> Result<(), String>) -> Result<(), String> {
    let dir = app_data_dir(app).ok_or("Impossible d'acceder au dossier de donnees")?;
    save(&dir, config)
}

#[tauri::command]
fn get_phash_config(app: tauri::AppHandle) -> PHashConfig { load_cfg(&app, load_config) }

#[tauri::command]
fn set_phash_config(app: tauri::AppHandle, config: PHashConfig) -> Result<(), String> { save_cfg(&app, &config, save_config) }

#[tauri::command]
fn get_video_config(app: tauri::AppHandle) -> VideoConfig { load_cfg(&app, video_config::load_config) }

#[tauri::command]
fn set_video_config(app: tauri::AppHandle, config: VideoConfig) -> Result<(), String> { save_cfg(&app, &config, video_config::save_config) }

#[tauri::command]
fn get_audio_config(app: tauri::AppHandle) -> AudioConfig { load_cfg(&app, audio_config::load_config) }

#[tauri::command]
fn set_audio_config(app: tauri::AppHandle, config: AudioConfig) -> Result<(), String> { save_cfg(&app, &config, audio_config::save_config) }

#[tauri::command]
async fn get_image_thumbnail(path: String, max_size: u32) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let img = image::open(&path).map_err(|e| e.to_string())?;
        let thumb = img.thumbnail(max_size, max_size);
        let mut buf = Vec::new();
        thumb
            .write_to(&mut std::io::Cursor::new(&mut buf), image::ImageOutputFormat::Jpeg(75))
            .map_err(|e| e.to_string())?;
        use base64::Engine;
        let encoded = base64::engine::general_purpose::STANDARD.encode(&buf);
        Ok(format!("data:image/jpeg;base64,{}", encoded))
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn get_video_thumbnail(path: String, max_size: u32, duration: Option<f64>) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let dur = match duration.filter(|&d| d > 0.0) {
            Some(d) => d,
            None => video_hash::get_video_metadata(&path)
                .ok_or_else(|| "impossible de lire les metadonnees video".to_string())?
                .duration_secs,
        };
        video_hash::extract_thumbnail(&path, dur, max_size)
            .ok_or_else(|| "impossible d'extraire la frame".to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
fn check_path_is_dir(path: String) -> bool {
    std::path::Path::new(&path).is_dir()
}

#[tauri::command]
async fn get_video_metadata(path: String) -> Result<video_hash::VideoMetadata, String> {
    tauri::async_runtime::spawn_blocking(move || {
        video_hash::get_video_metadata(&path)
            .ok_or_else(|| "impossible de lire les metadonnees video".to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[derive(Debug, serde::Serialize)]
struct ImageMeta {
    width: u32,
    height: u32,
    format: String,
    exif_date: Option<String>,
}

fn try_read_exif_date(path: &str) -> Option<String> {
    let file = std::fs::File::open(path).ok()?;
    let mut buf = std::io::BufReader::new(file);
    let exif = exif::Reader::new().read_from_container(&mut buf).ok()?;
    let field = exif.get_field(exif::Tag::DateTimeOriginal, exif::In::PRIMARY)?;
    Some(field.display_value().to_string())
}

fn export_size(bytes: u64) -> String {
    if bytes >= 1_073_741_824 {
        format!("{:.2} Go", bytes as f64 / 1_073_741_824.0)
    } else if bytes >= 1_048_576 {
        format!("{:.1} Mo", bytes as f64 / 1_048_576.0)
    } else if bytes >= 1024 {
        format!("{:.1} Ko", bytes as f64 / 1024.0)
    } else {
        format!("{} o", bytes)
    }
}

fn csv_escape(s: &str) -> String {
    if s.contains(',') || s.contains('"') || s.contains('\n') {
        format!("\"{}\"", s.replace('"', "\"\""))
    } else {
        s.to_string()
    }
}

fn html_esc(s: &str) -> String {
    s.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;").replace('"', "&quot;")
}

fn generate_csv(groups: &[DuplicateGroup]) -> String {
    let mut out = String::from("Group ID,File Path,File Name,Size (bytes),Modified (Unix),Status\n");
    for group in groups {
        for (i, file) in group.files.iter().enumerate() {
            let status = if i == 0 { "kept" } else { "duplicate" };
            out.push_str(&format!(
                "{},{},{},{},{},{}\n",
                csv_escape(&group.id),
                csv_escape(&file.path),
                csv_escape(&file.name),
                file.size,
                file.modified,
                status
            ));
        }
    }
    out
}

fn generate_html(summary: &ScanSummary, groups: &[DuplicateGroup]) -> String {
    let wasted = export_size(summary.total_wasted_bytes);
    let mut rows = String::new();
    for group in groups {
        let kind = if group.similar {
            "similar images"
        } else if group.video_similar {
            "similar videos"
        } else {
            "identical"
        };
        let wasted_group = group.size * (group.files.len() as u64).saturating_sub(1);
        rows.push_str(&format!(
            "<tr class=\"gr\"><td colspan=\"4\">{} &bull; {} files &bull; {} wasted</td></tr>\n",
            kind,
            group.files.len(),
            html_esc(&export_size(wasted_group))
        ));
        for (i, file) in group.files.iter().enumerate() {
            let cls = if i % 2 == 0 { "" } else { " odd" };
            let status_cls = if i == 0 { "kept" } else { "dup" };
            let status = if i == 0 { "kept" } else { "duplicate" };
            let uri = format!("file://{}", file.path);
            rows.push_str(&format!(
                "<tr class=\"fr{}\"><td><a href=\"{}\">{}</a></td><td>{}</td><td><span class=\"ts\" data-ts=\"{}\">{}</span></td><td class=\"{}\">{}</td></tr>\n",
                cls,
                html_esc(&uri), html_esc(&file.name),
                html_esc(&export_size(file.size)),
                file.modified, file.modified,
                status_cls, status
            ));
        }
    }
    format!(
        r#"<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><title>Deduplicator Report</title><style>
body{{font-family:system-ui,sans-serif;margin:0;padding:32px;background:#f8fafc;color:#1e293b}}
h1{{margin:0 0 24px;font-size:22px;color:#1e40af}}
.stats{{background:#fff;border:1px solid #e2e8f0;border-radius:10px;padding:20px;display:flex;gap:32px;flex-wrap:wrap;margin-bottom:24px}}
.sv{{font-size:26px;font-weight:700;color:#1e40af}}.sl{{font-size:12px;color:#64748b}}
table{{width:100%;border-collapse:collapse;background:#fff;border:1px solid #e2e8f0;border-radius:10px;overflow:hidden;font-size:13px}}
thead tr{{background:#1e3a5f;color:#fff}}th{{padding:10px 14px;text-align:left}}
.gr{{background:#dbeafe;font-weight:600}}.gr td{{padding:6px 14px;color:#1e40af;font-size:12px}}
.fr td{{padding:7px 14px;border-bottom:1px solid #f1f5f9}}.fr.odd{{background:#f8fafc}}
a{{color:#2563eb;text-decoration:none}}a:hover{{text-decoration:underline}}
.kept{{color:#16a34a;font-weight:600}}.dup{{color:#dc2626}}
</style></head><body>
<h1>Deduplicator Report</h1>
<div class="stats">
<div><div class="sv">{}</div><div class="sl">files scanned</div></div>
<div><div class="sv">{}</div><div class="sl">duplicate groups</div></div>
<div><div class="sv">{}</div><div class="sl">recoverable</div></div>
<div><div class="sv" style="font-size:13px;padding-top:8px">{}</div><div class="sl">folder</div></div>
</div>
<table><thead><tr><th>File</th><th>Size</th><th>Modified</th><th>Status</th></tr></thead>
<tbody>{}</tbody></table>
<script>document.querySelectorAll('.ts').forEach(function(e){{var t=+e.dataset.ts;if(t)e.textContent=new Date(t*1000).toLocaleDateString();}});</script>
</body></html>"#,
        summary.scanned_files,
        summary.total_groups,
        html_esc(&wasted),
        html_esc(&summary.folder),
        rows
    )
}

#[tauri::command]
async fn export_results(
    app: tauri::AppHandle,
    session_id: String,
    format: String,
    output_path: String,
) -> Result<(), String> {
    let file = read_session_file(&app, &session_id)
        .ok_or_else(|| "Session introuvable".to_string())?;
    let content = match format.as_str() {
        "csv" => generate_csv(&file.groups),
        "html" => generate_html(&file.summary, &file.groups),
        _ => return Err(format!("Format inconnu: {}", format)),
    };
    std::fs::write(&output_path, content).map_err(|e| e.to_string())
}

#[tauri::command]
fn list_profiles(app: tauri::AppHandle) -> Vec<profiles::ScanProfile> {
    match app_data_dir(&app) {
        Some(dir) => profiles::list_profiles(&dir),
        None => vec![],
    }
}

#[tauri::command]
fn save_profile(
    app: tauri::AppHandle,
    profile: profiles::ScanProfile,
) -> Result<profiles::ScanProfile, String> {
    let dir = app_data_dir(&app).ok_or("Impossible d'acceder au dossier de donnees")?;
    profiles::save_profile(&dir, profile)
}

#[tauri::command]
fn delete_profile(app: tauri::AppHandle, id: String) -> Result<(), String> {
    let dir = app_data_dir(&app).ok_or("Impossible d'acceder au dossier de donnees")?;
    profiles::delete_profile(&dir, &id)
}

#[tauri::command]
async fn get_image_meta(path: String) -> Result<ImageMeta, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let (width, height) = image::image_dimensions(&path).map_err(|e| e.to_string())?;
        let format = image::io::Reader::open(&path)
            .map_err(|e| e.to_string())?
            .with_guessed_format()
            .map_err(|e| e.to_string())?
            .format()
            .map(|f| format!("{:?}", f))
            .unwrap_or_else(|| {
                std::path::Path::new(&path)
                    .extension()
                    .and_then(|e| e.to_str())
                    .map(|e| e.to_uppercase())
                    .unwrap_or_else(|| "?".to_string())
            });
        let exif_date = try_read_exif_date(&path);
        Ok(ImageMeta { width, height, format, exif_date })
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn check_tools() -> serde_json::Value {
    let ffmpeg_available = tauri::async_runtime::spawn_blocking(video_hash::is_ffmpeg_available)
        .await
        .unwrap_or(false);
    let fpcalc_available = tauri::async_runtime::spawn_blocking(audio_hash::fpcalc_available)
        .await
        .unwrap_or(false);
    serde_json::json!({
        "ffmpeg_available": ffmpeg_available,
        "fpcalc_available": fpcalc_available,
    })
}

#[tauri::command]
async fn ignore_group(app: tauri::AppHandle, group_id: String) -> Result<(), String> {
    let (key, display_names) = {
        let cache = app.state::<ScanCache>();
        let guard = cache.0.lock().unwrap();
        let loaded = guard.as_ref().ok_or("Aucune session chargée")?;
        let group = loaded
            .groups
            .iter()
            .find(|g| g.id == group_id)
            .ok_or("Groupe introuvable")?;
        let paths: Vec<String> = group.files.iter().map(|f| f.path.clone()).collect();
        let names: Vec<String> = group.files.iter().map(|f| f.name.clone()).collect();
        (group_ignore_key(&paths), names)
    };
    let dir = app_data_dir(&app).ok_or("Impossible d'acceder au dossier de donnees")?;
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
async fn get_ignore_list(app: tauri::AppHandle) -> Result<Vec<IgnoreEntry>, String> {
    let dir = app_data_dir(&app).ok_or("Impossible d'acceder au dossier de donnees")?;
    tauri::async_runtime::spawn_blocking(move || {
        Ok(IgnoreList::load(&dir).entries_sorted())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn clear_ignore_entry(app: tauri::AppHandle, key: String) -> Result<(), String> {
    let dir = app_data_dir(&app).ok_or("Impossible d'acceder au dossier de donnees")?;
    tauri::async_runtime::spawn_blocking(move || {
        let mut list = IgnoreList::load(&dir);
        list.remove(&key);
        list.save(&dir).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn clear_all_ignored(app: tauri::AppHandle) -> Result<(), String> {
    let dir = app_data_dir(&app).ok_or("Impossible d'acceder au dossier de donnees")?;
    tauri::async_runtime::spawn_blocking(move || {
        let mut list = IgnoreList::load(&dir);
        list.clear();
        list.save(&dir).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            if let Some(window) = app.get_webview_window("main") {
                let icon_bytes = include_bytes!("../icons/128x128.png");
                if let Ok(icon) = tauri::image::Image::from_bytes(icon_bytes) {
                    let _ = window.set_icon(icon);
                }
            }
            Ok(())
        })
        .manage(CancelFlag(Arc::new(AtomicBool::new(false))))
        .manage(ScanCache(Mutex::new(None)))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_fs::init())
        .invoke_handler(tauri::generate_handler![
            scan_folder,
            cancel_scan,
            delete_files,
            get_groups_page,
            list_sessions,
            load_session,
            delete_session,
            smart_select,
            select_all_duplicates,
            list_folder_keys,
            get_folder_groups_page,
            reveal_in_folder,
            open_file,
            get_image_thumbnail,
            get_video_thumbnail,
            get_phash_config,
            set_phash_config,
            get_video_config,
            set_video_config,
            get_audio_config,
            set_audio_config,
            check_path_is_dir,
            get_video_metadata,
            get_image_meta,
            export_results,
            list_profiles,
            save_profile,
            delete_profile,
            check_tools,
            ignore_group,
            get_ignore_list,
            clear_ignore_entry,
            clear_all_ignored,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
