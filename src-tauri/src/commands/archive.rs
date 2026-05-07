use tauri::State;
use crate::{ScanCache, scanner::ArchiveGroupResult};
use crate::archive::{ArchiveComparison, compute_comparison};

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
) -> Result<ArchiveComparison, String> {
    tauri::async_runtime::spawn_blocking(move || {
        compute_comparison(&path_a, &path_b)
    })
    .await
    .map_err(|e| e.to_string())?
}
