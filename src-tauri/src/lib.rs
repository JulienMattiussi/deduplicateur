mod scanner;

use scanner::{scan_folder as do_scan, DuplicateGroup};
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
) -> Result<ScanSummary, String> {
    let app = window.app_handle().clone();
    let cancelled = {
        let state = app.state::<CancelFlag>();
        state.0.store(false, Ordering::Relaxed);
        Arc::clone(&state.0)
    };

    let folder = path.clone();
    let result = tauri::async_runtime::spawn_blocking(move || {
        do_scan(&path, recursive, &excluded, cancelled, |current, total| {
            if current % 50 == 0 || current == total {
                let _ = window.emit(
                    "scan:progress",
                    serde_json::json!({ "current": current, "total": total }),
                );
            }
        })
    })
    .await
    .map_err(|e| e.to_string())??;

    let id = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
        .to_string();

    let summary = ScanSummary {
        id,
        folder,
        total_wasted_bytes: result.total_wasted_bytes,
        total_groups: result.groups.len(),
        scanned_files: result.scanned_files,
        duration_ms: result.duration_ms,
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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
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
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
