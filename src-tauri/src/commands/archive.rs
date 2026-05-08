use std::path::{Path, PathBuf};
use tauri::State;
use walkdir::WalkDir;
use crate::{ScanCache, scanner::ArchiveGroupResult};
use crate::archive::{ArchiveComparison, compute_comparison, detect_archive_format};
use crate::archive::extractor::{estimate_extraction_size, available_disk_space};

/// Liste les chemins absolus de toutes les archives presentes dans un dossier.
/// Utilise pour le pre-check d'espace disque avant le scan, avant que `scan_folder`
/// ne soit invoque.
/// Async + spawn_blocking : le walk d'un gros dossier prend des secondes, on libere
/// le thread principal Tauri pendant l'operation.
#[tauri::command]
pub async fn list_archive_paths(folder: String, recursive: bool) -> Vec<String> {
    tauri::async_runtime::spawn_blocking(move || {
        let folder_path = Path::new(&folder);
        if !folder_path.is_dir() { return vec![]; }
        let walker = if recursive {
            WalkDir::new(folder_path).follow_links(false)
        } else {
            WalkDir::new(folder_path).max_depth(1).follow_links(false)
        };
        walker
            .into_iter()
            .filter_map(|e| e.ok())
            .filter(|e| e.file_type().is_file())
            .filter_map(|e| {
                let p: PathBuf = e.path().to_path_buf();
                if detect_archive_format(&p).is_some() {
                    p.to_str().map(|s| s.to_string())
                } else {
                    None
                }
            })
            .collect()
    })
    .await
    .unwrap_or_default()
}

/// Marge de securite : on exige `available - needed >= 1 Go` pour ne pas saturer le disque.
const MIN_FREE_AFTER_EXTRACT_BYTES: u64 = 1 << 30;  // 1 Go

#[derive(serde::Serialize)]
pub struct ArchiveDiskCheck {
    /// Taille totale estimee de l'extraction (bytes).
    pub needed_bytes: u64,
    /// Espace disque disponible sur le volume cible (bytes).
    pub available_bytes: u64,
    /// True si `available - needed < 1 Go` : modale d'alerte recommandee.
    pub needs_warning: bool,
    /// Si needs_warning : combien faudrait-il liberer pour passer (bytes).
    /// 0 si needs_warning=false.
    pub deficit_bytes: u64,
}

/// Pre-check d'espace disque avant extraction des archives pour la phase pHash.
/// Appele par le frontend juste avant `scan_folder` si `find_similar && scan_archives && archives_count > 0`.
/// Async + spawn_blocking : `estimate_extraction_size` lit les headers de chaque archive
/// (peut etre lent sur des dizaines de gros zips), on libere le thread Tauri pendant.
#[tauri::command]
pub async fn check_archive_disk_space(
    app: tauri::AppHandle,
    archive_paths: Vec<String>,
) -> ArchiveDiskCheck {
    use tauri::Manager;
    let data_dir = app.path().app_local_data_dir().ok();
    tauri::async_runtime::spawn_blocking(move || {
        let needed = estimate_extraction_size(&archive_paths);
        let available = data_dir.as_ref()
            .map(|d| available_disk_space(d))
            .unwrap_or(0);
        let needs_warning = needed > 0 && available < needed.saturating_add(MIN_FREE_AFTER_EXTRACT_BYTES);
        let deficit = if needs_warning {
            needed.saturating_add(MIN_FREE_AFTER_EXTRACT_BYTES).saturating_sub(available)
        } else { 0 };
        ArchiveDiskCheck {
            needed_bytes: needed,
            available_bytes: available,
            needs_warning,
            deficit_bytes: deficit,
        }
    })
    .await
    .unwrap_or(ArchiveDiskCheck {
        needed_bytes: 0,
        available_bytes: 0,
        needs_warning: false,
        deficit_bytes: 0,
    })
}

#[tauri::command]
pub fn get_archive_groups(state: State<ScanCache>) -> Vec<ArchiveGroupResult> {
    state.0.lock().unwrap()
        .as_ref()
        .map(|s| s.archive_groups.clone())
        .unwrap_or_default()
}

#[tauri::command]
pub async fn get_archive_comparison(
    path_a: String,
    path_b: String,
    find_similar: Option<bool>,
    sim_threshold: Option<u32>,
) -> Result<ArchiveComparison, String> {
    let find_similar = find_similar.unwrap_or(false);
    let sim_threshold = sim_threshold.unwrap_or(10);
    tauri::async_runtime::spawn_blocking(move || {
        compute_comparison(&path_a, &path_b, find_similar, sim_threshold)
    })
    .await
    .map_err(|e| e.to_string())?
}
