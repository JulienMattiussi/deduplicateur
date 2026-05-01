mod phash_cache;
mod phash_config;
mod phash_perf;
mod scanner;
mod video_hash;

use phash_config::{load_config, save_config, PHashConfig};
use scanner::{scan_folder as do_scan, DuplicateGroup, ScanParams};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{Emitter, Manager};

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

    // Shared progress state written by rayon threads, read by the async emitter task.
    // Never call window.emit() from rayon threads directly - it deadlocks the GTK main loop.
    let progress_state: Arc<Mutex<Option<(usize, usize, String)>>> = Arc::new(Mutex::new(None));
    let progress_for_scan = Arc::clone(&progress_state);
    let progress_for_emit = Arc::clone(&progress_state);

    let window_emit = window.clone();
    let emit_task = tauri::async_runtime::spawn(async move {
        let mut interval = tokio::time::interval(tokio::time::Duration::from_millis(100));
        loop {
            interval.tick().await;
            let snapshot = progress_for_emit.lock().unwrap().clone();
            if let Some((current, total, file)) = snapshot {
                let _ = window_emit.emit(
                    "scan:progress",
                    serde_json::json!({ "current": current, "total": total, "file": file }),
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
            video_frames: 8,
        };
        do_scan(params, cancelled, move |current, total, file: &str| {
            *progress_for_scan.lock().unwrap() = Some((current, total, file.to_string()));
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
    };

    save_session(&app, &summary, &result.groups);
    *app.state::<ScanCache>().0.lock().unwrap() = Some(LoadedSession {
        summary: summary.clone(),
        groups: result.groups,
    });

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
fn smart_select(app: tauri::AppHandle, mode: String) -> Result<Vec<String>, String> {
    let cache = app.state::<ScanCache>();
    let guard = cache.0.lock().unwrap();
    match *guard {
        None => Err("Aucune session chargée".to_string()),
        Some(ref loaded) => {
            let paths: Vec<String> = loaded
                .groups
                .iter()
                .flat_map(|group| {
                    if group.files.is_empty() {
                        return vec![];
                    }
                    let keep = match mode.as_str() {
                        "newest" => group.files.iter().max_by_key(|f| f.modified),
                        "oldest" => group.files.iter().min_by_key(|f| f.modified),
                        _ => group.files.first(),
                    };
                    group
                        .files
                        .iter()
                        .filter(|f| keep.map_or(true, |k| k.path != f.path))
                        .map(|f| f.path.clone())
                        .collect::<Vec<_>>()
                })
                .collect();
            Ok(paths)
        }
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
    std::process::Command::new("explorer")
        .arg(format!("/select,{}", path))
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
    std::process::Command::new("cmd")
        .args(["/C", &format!("start \"\" \"{}\"", path)])
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

#[tauri::command]
fn get_phash_config(app: tauri::AppHandle) -> PHashConfig {
    app_data_dir(&app)
        .as_deref()
        .map(load_config)
        .unwrap_or_default()
}

#[tauri::command]
fn set_phash_config(app: tauri::AppHandle, config: PHashConfig) -> Result<(), String> {
    let dir = app_data_dir(&app).ok_or("Impossible d'acceder au dossier de donnees")?;
    save_config(&dir, &config)
}

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
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
