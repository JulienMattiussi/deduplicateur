//! Commandes du menu Maintenance : rapport d'espace occupe, purge ciblee des
//! references obsoletes (caches, ignores) et inventaire des sessions.
//!
//! La purge ciblee respecte le garde-fou volume (cf. `crate::maintenance`) : une
//! reference n'est retiree que si son fichier a disparu ET que son volume est
//! joignable. La purge complete des caches (option nucleaire) reste
//! `settings::purge_cache`, exposee dans le meme menu cote frontend.

use std::path::Path;

use serde::Serialize;
use tauri::Manager;

use crate::audio::AudioCache;
use crate::exact_cache::ExactCache;
use crate::ignore_list::IgnoreList;
use crate::phash::HashCache;
use crate::video::VideoCache;
use crate::SessionFile;

const CACHE_FILES: &[&str] = &[
    "phash_cache.bin",
    "phash_cache.json",
    "video_cache.json",
    "audio_cache.json",
    "exact_cache.json",
];

/// Une session listee dans le menu Maintenance.
#[derive(Serialize)]
pub struct SessionMaintenanceInfo {
    pub id: String,
    pub folder: String,
    /// Le dossier scanne a disparu (et son volume est joignable) : candidat
    /// naturel a la suppression, pre-coche cote frontend. Faux si le volume est
    /// injoignable (disque debranche) : on ne presume pas la suppression.
    pub folder_missing: bool,
    pub total_groups: usize,
    pub total_wasted_bytes: u64,
    /// Taille du fichier de session sur disque (octets).
    pub size_bytes: u64,
}

/// Rapport agrege affiche a l'ouverture du menu Maintenance.
#[derive(Serialize)]
pub struct MaintenanceReport {
    /// Taille totale des fichiers de cache sur disque (octets).
    pub cache_bytes: u64,
    /// Nombre total d'entrees dans les quatre caches de hash.
    pub cache_total_entries: usize,
    /// Nombre d'entrees obsoletes (fichier disparu, volume joignable).
    pub cache_stale_entries: usize,
    /// Nombre total de groupes ignores.
    pub ignored_total: usize,
    /// Nombre de groupes ignores devenus impossibles a re-matcher.
    pub ignored_stale: usize,
    pub sessions: Vec<SessionMaintenanceInfo>,
}

fn cache_bytes(dir: &Path) -> u64 {
    CACHE_FILES
        .iter()
        .map(|n| std::fs::metadata(dir.join(n)).map(|m| m.len()).unwrap_or(0))
        .sum()
}

/// (total, obsoletes) agreges sur les quatre caches de hash.
fn cache_entry_stats(dir: &Path) -> (usize, usize) {
    let ph = HashCache::load(dir);
    let vi = VideoCache::load(dir);
    let au = AudioCache::load(dir);
    let ex = ExactCache::load(dir);
    let total = ph.len() + vi.len() + au.len() + ex.len();
    let stale = ph.count_missing() + vi.count_missing() + au.count_missing() + ex.count_missing();
    (total, stale)
}

/// Charge, purge les entrees obsoletes et re-sauve les quatre caches. Retourne le
/// total d'entrees retirees.
fn purge_caches_in_dir(dir: &Path) -> usize {
    let mut removed = 0;
    let mut ph = HashCache::load(dir);
    removed += ph.prune_missing();
    let _ = ph.save(dir);
    let mut vi = VideoCache::load(dir);
    removed += vi.prune_missing();
    let _ = vi.save(dir);
    let mut au = AudioCache::load(dir);
    removed += au.prune_missing();
    let _ = au.save(dir);
    let mut ex = ExactCache::load(dir);
    removed += ex.prune_missing();
    let _ = ex.save(dir);
    removed
}

/// (total, obsoletes) pour la liste d'ignores.
fn ignored_stats(dir: &Path) -> (usize, usize) {
    let list = IgnoreList::load(dir);
    let entries = list.entries_sorted();
    let total = entries.len();
    let stale = entries
        .iter()
        .filter(|e| crate::maintenance::ignore_key_is_stale(&e.key))
        .count();
    (total, stale)
}

/// Retire de la liste d'ignores les groupes devenus impossibles a re-matcher.
/// Retourne le nombre retire.
fn purge_ignored_in_dir(dir: &Path) -> usize {
    let mut list = IgnoreList::load(dir);
    let stale: Vec<String> = list
        .entries_sorted()
        .into_iter()
        .filter(|e| crate::maintenance::ignore_key_is_stale(&e.key))
        .map(|e| e.key)
        .collect();
    for k in &stale {
        list.remove(k);
    }
    let _ = list.save(dir);
    stale.len()
}

fn sessions_info(sessions_dir: &Path) -> Vec<SessionMaintenanceInfo> {
    let mut infos: Vec<SessionMaintenanceInfo> = std::fs::read_dir(sessions_dir)
        .into_iter()
        .flatten()
        .filter_map(|e| e.ok())
        .filter(|e| e.path().extension().and_then(|x| x.to_str()) == Some("json"))
        .filter_map(|e| {
            let size_bytes = e.metadata().map(|m| m.len()).unwrap_or(0);
            let data = std::fs::read_to_string(e.path()).ok()?;
            let file: SessionFile = serde_json::from_str(&data).ok()?;
            let folder_missing = crate::maintenance::is_purgeable(&file.summary.folder);
            Some(SessionMaintenanceInfo {
                id: file.summary.id,
                folder: file.summary.folder,
                folder_missing,
                total_groups: file.summary.total_groups,
                total_wasted_bytes: file.summary.total_wasted_bytes,
                size_bytes,
            })
        })
        .collect();
    infos.sort_by(|a, b| b.id.cmp(&a.id));
    infos
}

#[tauri::command]
pub async fn get_maintenance_report(app: tauri::AppHandle) -> Result<MaintenanceReport, String> {
    let dir = crate::app_data_dir(&app).ok_or("Impossible d'acceder au dossier de donnees")?;
    let sessions_dir = app
        .path()
        .app_local_data_dir()
        .map_err(|e| e.to_string())?
        .join("sessions");
    tauri::async_runtime::spawn_blocking(move || {
        let (cache_total_entries, cache_stale_entries) = cache_entry_stats(&dir);
        let (ignored_total, ignored_stale) = ignored_stats(&dir);
        MaintenanceReport {
            cache_bytes: cache_bytes(&dir),
            cache_total_entries,
            cache_stale_entries,
            ignored_total,
            ignored_stale,
            sessions: sessions_info(&sessions_dir),
        }
    })
    .await
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn purge_stale_caches(app: tauri::AppHandle) -> Result<usize, String> {
    let dir = crate::app_data_dir(&app).ok_or("Impossible d'acceder au dossier de donnees")?;
    tauri::async_runtime::spawn_blocking(move || purge_caches_in_dir(&dir))
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn purge_stale_ignored(app: tauri::AppHandle) -> Result<usize, String> {
    let dir = crate::app_data_dir(&app).ok_or("Impossible d'acceder au dossier de donnees")?;
    Ok(purge_ignored_in_dir(&dir))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ignore_list::{group_ignore_key, IgnoreEntry};
    use crate::phash::CacheEntry;
    use crate::ScanSummary;
    use tempfile::TempDir;

    fn touch(dir: &Path, name: &str) -> String {
        let p = dir.join(name);
        std::fs::write(&p, b"x").unwrap();
        p.to_str().unwrap().to_string()
    }

    fn phash_entry() -> CacheEntry {
        CacheEntry {
            mtime: 1,
            coarse_size: 4,
            fine_size: 8,
            coarse: "AAAA".into(),
            fine: "BBBBBBBB".into(),
            aspect: None,
            thumbnail_setting: false,
        }
    }

    #[test]
    fn cache_stats_compte_les_obsoletes_et_purge_les_retire() {
        let dir = TempDir::new().unwrap();
        let present = touch(dir.path(), "present.jpg");
        let missing = dir.path().join("missing.jpg").to_str().unwrap().to_string();

        let mut ex = ExactCache::load(dir.path());
        ex.insert_partial(present.clone(), 1, 1, "h1".into());
        ex.insert_partial(missing.clone(), 1, 1, "h2".into());
        ex.save(dir.path()).unwrap();

        let mut ph = HashCache::load(dir.path());
        ph.insert(present.clone(), phash_entry());
        ph.insert(missing.clone(), phash_entry());
        ph.save(dir.path()).unwrap();

        let (total, stale) = cache_entry_stats(dir.path());
        assert_eq!(total, 4, "2 entrees x 2 caches");
        assert_eq!(stale, 2, "1 entree manquante par cache");

        assert_eq!(purge_caches_in_dir(dir.path()), 2);

        let (total2, stale2) = cache_entry_stats(dir.path());
        assert_eq!(total2, 2);
        assert_eq!(stale2, 0);
    }

    #[test]
    fn ignored_stats_et_purge() {
        let dir = TempDir::new().unwrap();
        let a = touch(dir.path(), "a.jpg");
        let b = touch(dir.path(), "b.jpg");
        let gone = dir.path().join("gone.jpg").to_str().unwrap().to_string();

        let mut list = IgnoreList::load(dir.path());
        list.add(IgnoreEntry {
            key: group_ignore_key(&[a.clone(), b.clone()]),
            display_names: vec![],
            ignored_at: 1,
        });
        list.add(IgnoreEntry {
            key: group_ignore_key(&[a.clone(), gone.clone()]),
            display_names: vec![],
            ignored_at: 2,
        });
        list.save(dir.path()).unwrap();

        let (total, stale) = ignored_stats(dir.path());
        assert_eq!(total, 2);
        assert_eq!(stale, 1);

        assert_eq!(purge_ignored_in_dir(dir.path()), 1);
        let (total2, stale2) = ignored_stats(dir.path());
        assert_eq!(total2, 1);
        assert_eq!(stale2, 0);
    }

    fn write_session(sessions_dir: &Path, id: &str, folder: &str) {
        let summary = ScanSummary {
            id: id.to_string(),
            folder: folder.to_string(),
            total_wasted_bytes: 1024,
            total_groups: 3,
            scanned_files: 10,
            duration_ms: 0,
            by_folder: false,
            total_folders: 0,
            partial: false,
            recursive: false,
            find_similar: false,
            find_similar_videos: false,
            ffmpeg_missing: false,
            find_similar_audio: false,
            fpcalc_missing: false,
            archive_groups_count: 0,
            scan_archives: false,
            sim_threshold: None,
            video_sim_threshold: None,
            audio_sim_threshold: None,
        };
        let file = SessionFile {
            summary,
            groups: vec![],
            archive_groups: vec![],
            archive_entries_cache: Default::default(),
        };
        std::fs::write(
            sessions_dir.join(format!("{id}.json")),
            serde_json::to_string(&file).unwrap(),
        )
        .unwrap();
    }

    #[test]
    fn sessions_info_marque_le_dossier_disparu_et_trie_par_id_desc() {
        let dir = TempDir::new().unwrap();
        let sessions = dir.path().join("sessions");
        std::fs::create_dir_all(&sessions).unwrap();

        let live_folder = dir.path().join("scanned");
        std::fs::create_dir_all(&live_folder).unwrap();
        write_session(&sessions, "200", live_folder.to_str().unwrap());

        let dead_folder = dir.path().join("deleted-folder");
        write_session(&sessions, "100", dead_folder.to_str().unwrap());

        let infos = sessions_info(&sessions);
        assert_eq!(infos.len(), 2);
        assert_eq!(infos[0].id, "200", "tri par id decroissant");
        assert!(!infos[0].folder_missing);
        assert_eq!(infos[1].id, "100");
        assert!(infos[1].folder_missing);
        assert!(infos[0].size_bytes > 0);
    }
}
