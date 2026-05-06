use std::sync::{Arc, Mutex};
use std::sync::atomic::Ordering;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{Emitter, Manager};
use tauri_plugin_notification::NotificationExt;

use crate::{CancelFlag, LoadedSession, ScanCache, ScanSummary};
use crate::{format_notification_body, save_session, should_notify};
use crate::ignore_list::IgnoreList;
use crate::scanner::{scan_folder as do_scan, ScanParams};

#[tauri::command]
pub async fn scan_folder(
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
    min_modified_timestamp: Option<u64>,
    max_modified_timestamp: Option<u64>,
) -> Result<ScanSummary, String> {
    let app = window.app_handle().clone();
    let cancelled = {
        let state = app.state::<CancelFlag>();
        state.0.store(false, Ordering::Relaxed);
        Arc::clone(&state.0)
    };

    let data_dir_str = app.path().app_local_data_dir().ok().map(|p| p.to_string_lossy().to_string());
    let phash_cfg = data_dir_str.as_deref()
        .map(|d| crate::phash::load_config(std::path::Path::new(d)))
        .unwrap_or_default();
    let video_cfg = data_dir_str.as_deref()
        .map(|d| crate::video::config::load_config(std::path::Path::new(d)))
        .unwrap_or_default();
    let audio_cfg = data_dir_str.as_deref()
        .map(|d| crate::audio::config::load_config(std::path::Path::new(d)))
        .unwrap_or_default();
    let ignored_keys = data_dir_str.as_deref()
        .map(|d| IgnoreList::load(std::path::Path::new(d)).keys_set())
        .unwrap_or_default();

    let progress_state: Arc<Mutex<Option<(usize, usize, usize, String, usize, usize, String)>>> =
        Arc::new(Mutex::new(None));
    let progress_for_scan = Arc::clone(&progress_state);
    let progress_for_emit = Arc::clone(&progress_state);

    let groups_counter = Arc::new(std::sync::atomic::AtomicUsize::new(0));
    let groups_counter_emit = Arc::clone(&groups_counter);

    let _ = window.emit(
        "scan:progress",
        serde_json::json!({ "current": 0, "total": 0, "total_files": 0, "file": "", "phase_current": 0, "phase_total": 0, "phase": "reading", "groups_found": 0 }),
    );

    let window_emit = window.clone();
    let emit_task = tauri::async_runtime::spawn(async move {
        let mut interval = tokio::time::interval(tokio::time::Duration::from_millis(100));
        loop {
            interval.tick().await;
            let snapshot = progress_for_emit.lock().unwrap().clone();
            if let Some((current, total, total_files, file, phase_current, phase_total, phase)) = snapshot {
                let groups_found = groups_counter_emit.load(std::sync::atomic::Ordering::Relaxed);
                let _ = window_emit.emit(
                    "scan:progress",
                    serde_json::json!({ "current": current, "total": total, "total_files": total_files, "file": file, "phase_current": phase_current, "phase_total": phase_total, "phase": phase, "groups_found": groups_found }),
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
            min_modified_timestamp: min_modified_timestamp.unwrap_or(0),
            max_modified_timestamp: max_modified_timestamp.unwrap_or(0),
            groups_counter: Some(Arc::clone(&groups_counter)),
        };
        do_scan(params, cancelled, move |current, total, total_files, file: &str, phase_current, phase_total, phase: &str| {
            *progress_for_scan.lock().unwrap() = Some((current, total, total_files, file.to_string(), phase_current, phase_total, phase.to_string()));
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
pub fn cancel_scan(app: tauri::AppHandle) {
    app.state::<CancelFlag>().0.store(true, std::sync::atomic::Ordering::Relaxed);
}
