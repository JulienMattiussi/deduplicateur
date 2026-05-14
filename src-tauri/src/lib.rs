mod archive;
mod audio;
mod cache_io;
mod commands;
mod exact_cache;
mod filters;
mod ignore_list;
mod native_player;
mod notifications;
mod phash;
mod profiles;
mod scanner;
mod selection;
mod tool_finder;
mod video;

// Re-exports utilises par les commandes Tauri (`commands::*`) qui dependent
// de ces helpers historiquement places dans lib.rs.
pub use notifications::{format_notification_body, should_notify};
pub use selection::select_files_to_delete;

use std::path::PathBuf;
use std::sync::{Arc, Condvar, Mutex};
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;
use tauri::Manager;

use scanner::DuplicateGroup;

// ── Types d'etat Tauri ─────────────────────────────────────────────────────

pub struct CancelFlag(pub Arc<AtomicBool>);
pub struct MediaServerPort(pub u16);

/// Reponse de l'utilisateur a l'alerte d'espace disque insuffisant.
/// Emise pendant la phase counting_archives quand l'estimation d'extraction
/// depasse l'espace libre. Le scan se met en pause sur le Condvar de
/// `DiskDecisionState` jusqu'a ce que le frontend appelle `respond_disk_warning`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DiskDecision {
    /// Continuer sans extraire les archives (phase pHash/audio dans archive_phase saute).
    Skip,
    /// Annuler le scan integralement (positionne le cancel flag).
    Cancel,
}

/// Etat partage pour le rendez-vous "warning disque -> reponse utilisateur".
/// Le scan thread (spawn_blocking) bloque sur le Condvar ; la commande
/// `respond_disk_warning` reveille en posant la decision.
pub struct DiskDecisionState {
    pub inner: Mutex<Option<DiskDecision>>,
    pub cvar: Condvar,
}

impl Default for DiskDecisionState {
    fn default() -> Self { Self::new() }
}

impl DiskDecisionState {
    pub fn new() -> Self {
        DiskDecisionState { inner: Mutex::new(None), cvar: Condvar::new() }
    }
    pub fn reset(&self) {
        *self.inner.lock().unwrap() = None;
    }
    pub fn set(&self, d: DiskDecision) {
        *self.inner.lock().unwrap() = Some(d);
        self.cvar.notify_all();
    }
    /// Bloque jusqu'a reception d'une decision. Verifie le cancel flag toutes les 200ms :
    /// si l'utilisateur appuie sur Annuler (au lieu de repondre via la modale), on sort
    /// en retournant Cancel.
    pub fn wait(&self, cancelled: &Arc<AtomicBool>) -> DiskDecision {
        let mut guard = self.inner.lock().unwrap();
        loop {
            if let Some(d) = *guard { return d; }
            if cancelled.load(Ordering::Relaxed) { return DiskDecision::Cancel; }
            let (g, _) = self.cvar.wait_timeout(guard, Duration::from_millis(200)).unwrap();
            guard = g;
        }
    }
}

pub struct LoadedSession {
    pub summary: ScanSummary,
    pub groups: Vec<DuplicateGroup>,
    pub archive_groups: Vec<crate::scanner::ArchiveGroupResult>,
    /// Cache des entrees d'archive (xxh3 + pHash) pour le comparateur lazy.
    pub archive_entries_cache: std::collections::HashMap<String, Vec<crate::archive::ArchiveEntryHash>>,
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
    #[serde(default)]
    pub scan_archives: bool,
    /// Seuil de similarite Hamming utilise pour les images (None = scan exact).
    #[serde(default)]
    pub sim_threshold: Option<u32>,
    /// Seuil de similarite Hamming utilise pour les videos (None = scan exact).
    #[serde(default)]
    pub video_sim_threshold: Option<u32>,
    /// Seuil de difference fingerprint audio (None = scan exact). En %, pas en bits Hamming.
    #[serde(default)]
    pub audio_sim_threshold: Option<u32>,
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
    #[serde(default)]
    pub archive_groups: Vec<crate::scanner::ArchiveGroupResult>,
    /// Cache des entrees d'archive (xxh3 + pHash) - rétro-compatible via #[serde(default)].
    #[serde(default, skip_serializing_if = "std::collections::HashMap::is_empty")]
    pub archive_entries_cache: std::collections::HashMap<String, Vec<crate::archive::ArchiveEntryHash>>,
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

pub fn save_session(
    app: &tauri::AppHandle,
    summary: &ScanSummary,
    groups: &[DuplicateGroup],
    archive_groups: &[crate::scanner::ArchiveGroupResult],
    archive_entries_cache: &std::collections::HashMap<String, Vec<crate::archive::ArchiveEntryHash>>,
) {
    if let Some(path) = session_path(app, &summary.id) {
        if let Ok(json) = serde_json::to_string(&SessionFile {
            summary: summary.clone(),
            groups: groups.to_vec(),
            archive_groups: archive_groups.to_vec(),
            archive_entries_cache: archive_entries_cache.clone(),
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

// notifications (should_notify, format_notification_body) : cf. notifications.rs
// selection intelligente (select_files_to_delete) : cf. selection.rs

// ── Point d'entree ─────────────────────────────────────────────────────────

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    use commands::archive::{get_archive_comparison, get_archive_groups};
    use commands::files::{
        check_path_is_dir, delete_files, get_archive_entry_thumbnail, get_archive_entry_url,
        get_image_meta, get_image_thumbnail, get_image_url, get_video_metadata, get_video_thumbnail,
        open_archive_entry, open_file, prepare_video_for_playback, reveal_in_folder,
    };
    use commands::ignore::{clear_all_ignored, clear_ignore_entry, get_ignore_list, ignore_group};
    use commands::native_player::{
        native_player_available, native_player_create, native_player_destroy,
        native_player_get_state, native_player_load, native_player_pause_pair,
        native_player_play_pair, native_player_seek_pair, native_player_set_geometry,
        native_player_set_visible, native_player_set_volume,
    };
    use commands::scan::{cancel_scan, respond_disk_warning, scan_folder};
    use commands::export::export_results;
    use commands::session::{
        delete_session, get_folder_groups_page, get_groups_page,
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
            // Cleanup silencieux des temp dirs orphelins laisses par un crash precedent
            if let Ok(data_dir) = app.path().app_local_data_dir() {
                let scan_temp = archive::extractor::scan_temp_parent(&data_dir);
                if scan_temp.exists() {
                    let _ = std::fs::remove_dir_all(&scan_temp);
                }
                // Purge des previsualisations d'entrees d'archive ouvertes au session precedente.
                // Les fichiers temporaires ne sont pas supprimes apres `open_file_default`
                // (le viewer externe les lit en asynchrone), mais ils sont nettoyes au boot.
                let archive_preview = data_dir.join("archive_preview");
                if archive_preview.exists() {
                    let _ = std::fs::remove_dir_all(&archive_preview);
                }
                // Purge des remux video temporaires de la session precedente.
                video::purge_remux_cache(&data_dir);
            }
            if let Some(window) = app.get_webview_window("main") {
                let icon_bytes = include_bytes!("../icons/128x128.png");
                if let Ok(icon) = tauri::image::Image::from_bytes(icon_bytes) {
                    let _ = window.set_icon(icon);
                }
            }
            Ok(())
        })
        .manage(CancelFlag(Arc::new(AtomicBool::new(false))))
        .manage(Arc::new(DiskDecisionState::new()))
        .manage(ScanCache(Mutex::new(None)))
        // Arc autour du registre : permet de cloner l'Arc dans les commandes pour
        // dispatcher vers le thread principal Tauri (run_on_main_thread) sans probleme
        // de lifetime sur tauri::State.
        .manage(Arc::new(native_player::NativePlayerRegistry::new()))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_fs::init())
        .invoke_handler(tauri::generate_handler![
            scan_folder,
            cancel_scan,
            respond_disk_warning,
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
            get_image_url,
            get_video_thumbnail,
            get_archive_entry_thumbnail,
            open_archive_entry,
            get_archive_entry_url,
            get_phash_config,
            set_phash_config,
            get_video_config,
            set_video_config,
            get_audio_config,
            set_audio_config,
            check_path_is_dir,
            get_video_metadata,
            prepare_video_for_playback,
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
            native_player_available,
            native_player_create,
            native_player_destroy,
            native_player_load,
            native_player_play_pair,
            native_player_pause_pair,
            native_player_seek_pair,
            native_player_set_geometry,
            native_player_set_visible,
            native_player_set_volume,
            native_player_get_state,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

// ── Tests ──────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use scanner::{ArchiveGroupResult, ArchiveInGroup, DuplicateFile, DuplicateGroup};
    use video::VideoMetadata;
    use std::thread;

    // ── DiskDecisionState ───────────────────────────────────────────────────────

    #[test]
    fn disk_decision_state_set_avant_wait_renvoie_immediatement() {
        let state = Arc::new(DiskDecisionState::new());
        let cancelled = Arc::new(AtomicBool::new(false));
        state.set(DiskDecision::Skip);
        let d = state.wait(&cancelled);
        assert_eq!(d, DiskDecision::Skip);
    }

    #[test]
    fn disk_decision_state_set_pendant_wait_reveille_thread() {
        let state = Arc::new(DiskDecisionState::new());
        let cancelled = Arc::new(AtomicBool::new(false));
        let state_w = Arc::clone(&state);
        let cancelled_w = Arc::clone(&cancelled);
        let handle = thread::spawn(move || state_w.wait(&cancelled_w));
        // laisse le wait s'engager puis pose la decision
        thread::sleep(Duration::from_millis(50));
        state.set(DiskDecision::Cancel);
        let d = handle.join().unwrap();
        assert_eq!(d, DiskDecision::Cancel);
    }

    #[test]
    fn disk_decision_state_wait_sort_si_cancel_flag_passe_a_true() {
        let state = Arc::new(DiskDecisionState::new());
        let cancelled = Arc::new(AtomicBool::new(false));
        let state_w = Arc::clone(&state);
        let cancelled_w = Arc::clone(&cancelled);
        let handle = thread::spawn(move || state_w.wait(&cancelled_w));
        thread::sleep(Duration::from_millis(50));
        cancelled.store(true, Ordering::Relaxed);
        let d = handle.join().unwrap();
        assert_eq!(d, DiskDecision::Cancel, "cancel flag doit reveiller wait et renvoyer Cancel");
    }

    #[test]
    fn disk_decision_state_reset_efface_decision_precedente() {
        let state = DiskDecisionState::new();
        state.set(DiskDecision::Skip);
        state.reset();
        assert!(state.inner.lock().unwrap().is_none());
    }

    // ── Round-trip session serialisation ────────────────────────────────────────

    #[test]
    fn session_file_roundtrip_avec_archive_groups() {
        let summary = ScanSummary {
            id: "abc".to_string(),
            folder: "/test".to_string(),
            total_wasted_bytes: 1024,
            total_groups: 1,
            scanned_files: 10,
            duration_ms: 500,
            by_folder: false,
            total_folders: 0,
            partial: false,
            recursive: true,
            find_similar: false,
            find_similar_videos: false,
            ffmpeg_missing: false,
            find_similar_audio: false,
            fpcalc_missing: false,
            archive_groups_count: 1,
            scan_archives: true,
            sim_threshold: None,
            video_sim_threshold: None,
            audio_sim_threshold: None,
        };
        let archive_groups = vec![ArchiveGroupResult {
            id: "ag1".to_string(),
            shared_entry_count: 3,
            archives: vec![
                ArchiveInGroup {
                    path: "/a.zip".to_string(),
                    size: 1024,
                    modified: 1700000000,
                    total_entries: 5,
                    duplicated_entries: 3,
                    can_delete: false,
                    wasted_bytes: 0,
                },
                ArchiveInGroup {
                    path: "/b.zip".to_string(),
                    size: 2048,
                    modified: 1700001000,
                    total_entries: 3,
                    duplicated_entries: 3,
                    can_delete: true,
                    wasted_bytes: 512,
                },
            ],
        }];
        let file = SessionFile { summary, groups: vec![], archive_groups, archive_entries_cache: std::collections::HashMap::new() };
        let json = serde_json::to_string(&file).unwrap();
        let restored: SessionFile = serde_json::from_str(&json).unwrap();
        assert_eq!(restored.archive_groups.len(), 1);
        assert_eq!(restored.archive_groups[0].shared_entry_count, 3);
        assert_eq!(restored.archive_groups[0].archives.len(), 2);
        assert_eq!(restored.archive_groups[0].archives[1].size, 2048);
        assert_eq!(restored.archive_groups[0].archives[1].modified, 1700001000);
        assert!(restored.archive_groups[0].archives[1].can_delete);
    }

    #[test]
    fn session_file_retrocompatible_sans_archive_groups() {
        // Un ancien fichier de session sans le champ archive_groups doit etre lu sans erreur
        let json_old = r#"{"summary":{"id":"x","folder":"/y","total_wasted_bytes":0,"total_groups":0,"scanned_files":0,"duration_ms":0,"ffmpeg_missing":false,"fpcalc_missing":false},"groups":[]}"#;
        let file: SessionFile = serde_json::from_str(json_old).unwrap();
        assert_eq!(file.archive_groups.len(), 0);
    }

    // ── Tests purge_deleted_from_session / recalc_wasted_bytes ───────────────

    fn make_file(path: &str, size: u64, modified: u64) -> DuplicateFile {
        DuplicateFile {
            path: path.to_string(),
            name: path.split('/').next_back().unwrap_or(path).to_string(),
            size,
            modified,
            video_metadata: None,
            audio_metadata: None,
            source: None,
        }
    }

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
