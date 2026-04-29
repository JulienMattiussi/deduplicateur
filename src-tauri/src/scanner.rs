use std::collections::HashMap;
use std::fs::{self, File};
use std::io::{BufReader, Read};
use std::path::Path;
use std::time::Instant;

use serde::{Deserialize, Serialize};
use xxhash_rust::xxh3::Xxh3;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct DuplicateFile {
    pub path: String,
    pub name: String,
    pub size: u64,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct DuplicateGroup {
    pub id: String,
    pub hash: String,
    pub size: u64,
    pub files: Vec<DuplicateFile>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ScanResult {
    pub groups: Vec<DuplicateGroup>,
    pub total_wasted_bytes: u64,
    pub scanned_files: usize,
    pub duration_ms: u128,
}

pub fn scan_folder(folder: &str) -> Result<ScanResult, String> {
    let start = Instant::now();
    let folder_path = Path::new(folder);

    // Collect all files with their sizes (flat scan, no recursion for phase 1)
    let entries = collect_files(folder_path)?;
    let scanned_files = entries.len();

    // Step 1: group by size — files with unique sizes cannot be duplicates
    let mut by_size: HashMap<u64, Vec<DuplicateFile>> = HashMap::new();
    for entry in entries {
        by_size.entry(entry.size).or_default().push(entry);
    }

    // Step 2: hash only the groups with multiple files
    let mut by_hash: HashMap<String, Vec<DuplicateFile>> = HashMap::new();
    for (_, candidates) in by_size {
        if candidates.len() < 2 {
            continue;
        }
        for file in candidates {
            match hash_file(&file.path) {
                Ok(hash) => by_hash.entry(hash).or_default().push(file),
                Err(_) => {} // skip unreadable files
            }
        }
    }

    // Build result groups
    let mut groups: Vec<DuplicateGroup> = by_hash
        .into_iter()
        .filter(|(_, files)| files.len() >= 2)
        .map(|(hash, files)| {
            let size = files[0].size;
            DuplicateGroup {
                id: uuid::Uuid::new_v4().to_string(),
                hash: hash[..16].to_string(),
                size,
                files,
            }
        })
        .collect();

    // Sort groups by wasted space descending
    groups.sort_by(|a, b| {
        let wa = a.size * (a.files.len() as u64 - 1);
        let wb = b.size * (b.files.len() as u64 - 1);
        wb.cmp(&wa)
    });

    let total_wasted_bytes = groups
        .iter()
        .map(|g| g.size * (g.files.len() as u64 - 1))
        .sum();

    Ok(ScanResult {
        groups,
        total_wasted_bytes,
        scanned_files,
        duration_ms: start.elapsed().as_millis(),
    })
}

fn collect_files(folder: &Path) -> Result<Vec<DuplicateFile>, String> {
    let read_dir = fs::read_dir(folder)
        .map_err(|e| format!("Impossible de lire le dossier : {}", e))?;

    let mut files = Vec::new();
    for entry in read_dir {
        let entry = match entry {
            Ok(e) => e,
            Err(_) => continue,
        };
        let path = entry.path();
        let meta = match fs::metadata(&path) {
            Ok(m) => m,
            Err(_) => continue,
        };
        if !meta.is_file() {
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
            size: meta.len(),
        });
    }
    Ok(files)
}

const CHUNK_SIZE: usize = 64 * 1024; // 64 KB read buffer

fn hash_file(path: &str) -> Result<String, std::io::Error> {
    let file = File::open(path)?;
    let mut reader = BufReader::with_capacity(CHUNK_SIZE, file);
    let mut hasher = Xxh3::new();
    let mut buf = vec![0u8; CHUNK_SIZE];

    loop {
        let n = reader.read(&mut buf)?;
        if n == 0 {
            break;
        }
        hasher.update(&buf[..n]);
    }

    Ok(format!("{:016x}", hasher.digest()))
}
