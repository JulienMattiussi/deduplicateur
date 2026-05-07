mod archive;
mod audio;
mod cache_io;
mod commands;
mod exact_cache;
mod filters;
mod ignore_list;
mod phash;
mod profiles;
mod scanner;
mod tool_finder;
mod video;

use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::sync::atomic::AtomicBool;
use tauri::Manager;

use scanner::{DuplicateFile, DuplicateGroup};

// ── Types d'etat Tauri ─────────────────────────────────────────────────────

pub struct CancelFlag(pub Arc<AtomicBool>);
pub struct MediaServerPort(pub u16);

pub struct LoadedSession {
    pub summary: ScanSummary,
    pub groups: Vec<DuplicateGroup>,
    pub archive_groups: Vec<crate::scanner::ArchiveGroupResult>,
}

pub struct ScanCache(pub Mutex<Option<LoadedSession>>);

// ── Structs serialisables ──────────────────────────────────────────────────

#[derive(Debug, serde::Serialize, serde::Deserialize, Clone)]
pub struct ScanSummary {
    pub id: String,
    pub folder: String,
    pub total_wasted_bytes: u64,
    pub total_groups: usize,
    pub scanned_files: usize,
    pub duration_ms: u128,
    #[serde(default)]
    pub by_folder: bool,
    #[serde(default)]
    pub total_folders: usize,
    #[serde(default)]
    pub partial: bool,
    #[serde(default)]
    pub recursive: bool,
    #[serde(default)]
    pub find_similar: bool,
    #[serde(default)]
    pub find_similar_videos: bool,
    #[serde(default)]
    pub ffmpeg_missing: bool,
    #[serde(default)]
    pub find_similar_audio: bool,
    #[serde(default)]
    pub fpcalc_missing: bool,
    #[serde(default)]
    pub archive_groups_count: usize,
}

#[derive(Debug, serde::Serialize)]
pub struct GroupsPage {
    pub groups: Vec<DuplicateGroup>,
    pub offset: usize,
    pub total: usize,
    pub has_more: bool,
}

#[derive(serde::Serialize, serde::Deserialize)]
pub struct SessionFile {
    pub summary: ScanSummary,
    pub groups: Vec<DuplicateGroup>,
}

// ── Helpers de session ─────────────────────────────────────────────────────

pub fn app_data_dir(app: &tauri::AppHandle) -> Option<PathBuf> {
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

pub fn save_session(app: &tauri::AppHandle, summary: &ScanSummary, groups: &[DuplicateGroup]) {
    if let Some(path) = session_path(app, &summary.id) {
        if let Ok(json) = serde_json::to_string(&SessionFile {
            summary: summary.clone(),
            groups: groups.to_vec(),
        }) {
            let _ = std::fs::write(&path, json);
        }
    }
}

pub fn read_session_file(app: &tauri::AppHandle, id: &str) -> Option<SessionFile> {
    let path = session_path(app, id)?;
    let data = std::fs::read_to_string(&path).ok()?;
    serde_json::from_str(&data).ok()
}

pub fn recalc_wasted_bytes(groups: &[DuplicateGroup]) -> u64 {
    groups.iter().map(|g| g.size * (g.files.len() as u64 - 1)).sum()
}

pub fn purge_deleted_from_session(
    groups: &mut Vec<DuplicateGroup>,
    deleted: &std::collections::HashSet<String>,
) {
    for group in groups.iter_mut() {
        group.files.retain(|f| !deleted.contains(&f.path));
    }
    groups.retain(|g| g.files.len() >= 2);
}

// ── Logique de notification ────────────────────────────────────────────────

pub fn should_notify(duration_ms: u128, threshold_secs: u64) -> bool {
    duration_ms >= (threshold_secs as u128) * 1000
}

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

// ── Selection intelligente ─────────────────────────────────────────────────

fn pixel_count_for_file(file: &DuplicateFile) -> Option<u64> {
    if let Some(ref vm) = file.video_metadata {
        return Some(vm.width as u64 * vm.height as u64);
    }
    image::image_dimensions(&file.path)
        .ok()
        .map(|(w, h)| w as u64 * h as u64)
}

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

// ── Point d'entree ─────────────────────────────────────────────────────────

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    use commands::archive::{get_archive_comparison, get_archive_groups};
    use commands::files::{
        check_path_is_dir, delete_files, get_image_meta, get_image_thumbnail, get_video_metadata,
        get_video_thumbnail, open_file, reveal_in_folder,
    };
    use commands::ignore::{clear_all_ignored, clear_ignore_entry, get_ignore_list, ignore_group};
    use commands::scan::{cancel_scan, scan_folder};
    use commands::session::{
        delete_session, export_results, get_folder_groups_page, get_groups_page,
        list_folder_keys, list_sessions, load_session, select_all_duplicates, smart_select,
    };
    use commands::settings::{
        check_tools, delete_profile, get_audio_config, get_cache_size, get_media_server_port,
        get_phash_config, get_video_config, list_profiles, purge_cache, save_profile,
        set_audio_config, set_phash_config, set_video_config,
    };

    tauri::Builder::default()
        .setup(|app| {
            app.manage(MediaServerPort(video::media_server::start()));
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
            get_media_server_port,
            get_cache_size,
            purge_cache,
            get_archive_groups,
            get_archive_comparison,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

// ── Tests ──────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use scanner::{DuplicateFile, DuplicateGroup};
    use video::VideoMetadata;

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
        assert!(result.is_empty(), "aucun fichier coche si aucun ne correspond au prefixe");
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
        assert!(result.is_empty(), "aucun fichier coche si aucune resolution detectable");
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

    // ── Tests purge_deleted_from_session / recalc_wasted_bytes ───────────────

    fn make_group_with_size(id: &str, size: u64, files: Vec<DuplicateFile>) -> DuplicateGroup {
        DuplicateGroup {
            id: id.to_string(),
            hash: id.to_string(),
            size,
            files,
            folder_key: None,
            similar: false,
            video_similar: false,
            audio_similar: false,
        }
    }

    #[test]
    fn test_purge_removes_deleted_files_from_groups() {
        let mut groups = vec![
            make_group_with_size("g1", 100, vec![
                make_file("/a/1.jpg", 100, 0),
                make_file("/a/2.jpg", 100, 0),
                make_file("/a/3.jpg", 100, 0),
            ]),
        ];
        let deleted: std::collections::HashSet<String> =
            vec!["/a/2.jpg".to_string()].into_iter().collect();
        purge_deleted_from_session(&mut groups, &deleted);
        assert_eq!(groups.len(), 1);
        assert_eq!(groups[0].files.len(), 2);
        assert!(!groups[0].files.iter().any(|f| f.path == "/a/2.jpg"));
    }

    #[test]
    fn test_purge_removes_group_when_only_one_file_remains() {
        let mut groups = vec![
            make_group_with_size("g1", 100, vec![
                make_file("/a/1.jpg", 100, 0),
                make_file("/a/2.jpg", 100, 0),
            ]),
        ];
        let deleted: std::collections::HashSet<String> =
            vec!["/a/2.jpg".to_string()].into_iter().collect();
        purge_deleted_from_session(&mut groups, &deleted);
        assert!(groups.is_empty(), "groupe a 1 fichier doit etre supprime");
    }

    #[test]
    fn test_purge_keeps_untouched_groups() {
        let mut groups = vec![
            make_group_with_size("g1", 100, vec![
                make_file("/a/1.jpg", 100, 0),
                make_file("/a/2.jpg", 100, 0),
            ]),
            make_group_with_size("g2", 200, vec![
                make_file("/b/x.jpg", 200, 0),
                make_file("/b/y.jpg", 200, 0),
            ]),
        ];
        let deleted: std::collections::HashSet<String> =
            vec!["/a/2.jpg".to_string()].into_iter().collect();
        purge_deleted_from_session(&mut groups, &deleted);
        assert_eq!(groups.len(), 1, "g1 supprime, g2 conserve");
        assert_eq!(groups[0].id, "g2");
    }

    #[test]
    fn test_recalc_wasted_bytes() {
        let groups = vec![
            make_group_with_size("g1", 100, vec![
                make_file("/a/1.jpg", 100, 0),
                make_file("/a/2.jpg", 100, 0),
                make_file("/a/3.jpg", 100, 0),
            ]),
            make_group_with_size("g2", 500, vec![
                make_file("/b/x.jpg", 500, 0),
                make_file("/b/y.jpg", 500, 0),
            ]),
        ];
        // g1 : 100 * (3-1) = 200, g2 : 500 * (2-1) = 500 -> total 700
        assert_eq!(recalc_wasted_bytes(&groups), 700);
    }

    #[test]
    fn test_recalc_wasted_bytes_empty() {
        assert_eq!(recalc_wasted_bytes(&[]), 0);
    }

    // ── Tests filtrage load_session (fichiers inexistants) ───────────────────

    #[test]
    fn test_load_session_purge_missing_files() {
        let dir = tempfile::tempdir().unwrap();
        let existing = dir.path().join("kept.jpg");
        std::fs::write(&existing, b"data").unwrap();
        let missing = dir.path().join("gone.jpg");

        let mut groups = vec![
            make_group_with_size("g1", 100, vec![
                make_file(existing.to_str().unwrap(), 100, 0),
                make_file(missing.to_str().unwrap(), 100, 0),
            ]),
        ];

        for group in groups.iter_mut() {
            group.files.retain(|f| std::path::Path::new(&f.path).exists());
        }
        groups.retain(|g| g.files.len() >= 2);

        assert!(groups.is_empty(), "groupe avec 1 fichier manquant doit disparaitre");
    }

    #[test]
    fn test_load_session_keeps_group_when_all_files_exist() {
        let dir = tempfile::tempdir().unwrap();
        let f1 = dir.path().join("a.jpg");
        let f2 = dir.path().join("b.jpg");
        std::fs::write(&f1, b"data").unwrap();
        std::fs::write(&f2, b"data").unwrap();

        let mut groups = vec![
            make_group_with_size("g1", 100, vec![
                make_file(f1.to_str().unwrap(), 100, 0),
                make_file(f2.to_str().unwrap(), 100, 0),
            ]),
        ];

        for group in groups.iter_mut() {
            group.files.retain(|f| std::path::Path::new(&f.path).exists());
        }
        groups.retain(|g| g.files.len() >= 2);

        assert_eq!(groups.len(), 1, "groupe intact si tous les fichiers existent");
        assert_eq!(groups[0].files.len(), 2);
    }

    // ── Tests get_cache_size / purge_cache (logique pure) ─────────────────────

    fn sum_cache_files(dir: &std::path::Path) -> u64 {
        const CACHE_FILES: &[&str] = &["phash_cache.json", "video_cache.json", "audio_cache.json", "exact_cache.json"];
        CACHE_FILES.iter().map(|name| {
            std::fs::metadata(dir.join(name)).map(|m| m.len()).unwrap_or(0)
        }).sum()
    }

    fn purge_cache_files(dir: &std::path::Path) {
        const CACHE_FILES: &[&str] = &["phash_cache.json", "video_cache.json", "audio_cache.json", "exact_cache.json"];
        for name in CACHE_FILES {
            let _ = std::fs::remove_file(dir.join(name));
        }
    }

    #[test]
    fn test_get_cache_size_no_files() {
        let dir = tempfile::tempdir().unwrap();
        assert_eq!(sum_cache_files(dir.path()), 0);
    }

    #[test]
    fn test_get_cache_size_with_files() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("phash_cache.json"), b"ABCDE").unwrap();
        std::fs::write(dir.path().join("video_cache.json"), b"XY").unwrap();
        assert_eq!(sum_cache_files(dir.path()), 7);
    }

    #[test]
    fn test_purge_cache_removes_all_cache_files() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("phash_cache.json"), b"data1").unwrap();
        std::fs::write(dir.path().join("video_cache.json"), b"data2").unwrap();
        std::fs::write(dir.path().join("audio_cache.json"), b"data3").unwrap();
        std::fs::write(dir.path().join("exact_cache.json"), b"data4").unwrap();
        purge_cache_files(dir.path());
        assert_eq!(sum_cache_files(dir.path()), 0);
    }

    #[test]
    fn test_purge_cache_no_error_when_files_absent() {
        let dir = tempfile::tempdir().unwrap();
        purge_cache_files(dir.path());
        assert_eq!(sum_cache_files(dir.path()), 0);
    }
}
