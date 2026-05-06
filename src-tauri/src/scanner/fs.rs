use std::collections::HashMap;
use std::fs;
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use crate::filters::passes_filters;
use super::types::DuplicateFile;

pub fn is_video(path: &str) -> bool {
    let ext = Path::new(path)
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    matches!(
        ext.as_str(),
        "mp4" | "avi" | "mkv" | "mov" | "wmv" | "webm" | "flv" | "m4v" | "mpg" | "mpeg"
            | "3gp" | "ts" | "mts" | "m2ts"
    )
}

pub fn is_image(path: &str) -> bool {
    let ext = Path::new(path)
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    matches!(
        ext.as_str(),
        "jpg" | "jpeg" | "png" | "webp" | "bmp" | "gif" | "tiff" | "tif" | "avif"
    )
}

pub fn collect_files(
    folder: &Path,
    recursive: bool,
    excluded: &[String],
    cancelled: &Arc<AtomicBool>,
    exclude_extensions: &[String],
    include_extensions: &[String],
    min_file_size_bytes: u64,
    max_file_size_bytes: u64,
) -> Result<Vec<DuplicateFile>, String> {
    if !folder.exists() {
        return Err(format!("Dossier introuvable : {}", folder.display()));
    }

    let mut files = Vec::new();

    if recursive {
        for entry in walkdir::WalkDir::new(folder)
            .follow_links(false)
            .into_iter()
            .filter_entry(|e| {
                if e.file_type().is_dir() {
                    let name = e.file_name().to_str().unwrap_or("");
                    e.depth() == 0 || !excluded.iter().any(|ex| ex == name)
                } else {
                    true
                }
            })
        {
            if cancelled.load(Ordering::Relaxed) {
                return Err("cancelled".to_string());
            }
            let entry = match entry {
                Ok(e) => e,
                Err(_) => continue,
            };
            if !entry.file_type().is_file() {
                continue;
            }
            let path = entry.path();
            let (size, modified) = match entry.metadata() {
                Ok(m) => {
                    let modified = m
                        .modified()
                        .ok()
                        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                        .map(|d| d.as_secs())
                        .unwrap_or(0);
                    (m.len(), modified)
                }
                Err(_) => continue,
            };
            if !passes_filters(path, size, exclude_extensions, include_extensions, min_file_size_bytes, max_file_size_bytes) {
                continue;
            }
            let name = path
                .file_name()
                .and_then(|n| n.to_str())
                .unwrap_or("")
                .to_string();
            files.push(DuplicateFile {
                path: path.to_string_lossy().to_string(),
                name,
                size,
                modified,
                video_metadata: None,
                audio_metadata: None,
                source: None,
            });
        }
    } else {
        let read_dir = fs::read_dir(folder)
            .map_err(|e| format!("Impossible de lire le dossier : {}", e))?;
        for entry in read_dir.flatten() {
            let path = entry.path();
            let meta = match fs::metadata(&path) {
                Ok(m) => m,
                Err(_) => continue,
            };
            if !meta.is_file() {
                continue;
            }
            let size = meta.len();
            let modified = meta
                .modified()
                .ok()
                .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                .map(|d| d.as_secs())
                .unwrap_or(0);
            if !passes_filters(&path, size, exclude_extensions, include_extensions, min_file_size_bytes, max_file_size_bytes) {
                continue;
            }
            let name = path
                .file_name()
                .and_then(|n| n.to_str())
                .unwrap_or("")
                .to_string();
            files.push(DuplicateFile {
                path: path.to_string_lossy().to_string(),
                name,
                size,
                modified,
                video_metadata: None,
                audio_metadata: None,
                source: None,
            });
        }
    }

    Ok(files)
}

pub fn first_level_subdir(root: &Path, file_path: &Path) -> String {
    match file_path.strip_prefix(root) {
        Ok(rel) => {
            let mut components = rel.components();
            let first = components.next();
            if components.next().is_some() {
                first
                    .and_then(|c| c.as_os_str().to_str())
                    .unwrap_or("")
                    .to_string()
            } else {
                String::new()
            }
        }
        Err(_) => String::new(),
    }
}

pub fn group_folder_key(files: &[DuplicateFile], root: &Path, by_folder: bool) -> Option<String> {
    if !by_folder {
        return None;
    }
    let mut key: Option<String> = None;
    for f in files {
        let k = first_level_subdir(root, Path::new(&f.path));
        match &key {
            None => key = Some(k),
            Some(prev) if prev != &k => return Some(String::new()),
            _ => {}
        }
    }
    key.or_else(|| Some(String::new()))
}

/// Groupe les fichiers par taille (retourne seulement les tailles avec >= 2 fichiers).
pub fn size_candidates(files: Vec<DuplicateFile>) -> Vec<Vec<DuplicateFile>> {
    let mut by_size: HashMap<u64, Vec<DuplicateFile>> = HashMap::new();
    for f in files {
        by_size.entry(f.size).or_default().push(f);
    }
    by_size.into_values().filter(|v| v.len() >= 2).collect()
}
