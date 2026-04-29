use std::collections::HashMap;
use std::fs::{self, File};
use std::io::Read;
use std::path::Path;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::time::Instant;

use rayon::prelude::*;
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

const PARTIAL_SIZE: usize = 4 * 1024; // 4 Ko — filtre rapide avant hash complet
const CHUNK_SIZE: usize = 64 * 1024;  // 64 Ko — buffer de lecture pour hash complet

pub fn scan_folder<F>(folder: &str, recursive: bool, on_progress: F) -> Result<ScanResult, String>
where
    F: Fn(usize, usize) + Send + Sync,
{
    let start = Instant::now();

    // Étape 1 : collecter tous les fichiers du dossier
    let files = collect_files(Path::new(folder), recursive)?;
    let scanned_files = files.len();

    // Étape 2 : grouper par taille — les fichiers de taille unique ne peuvent pas être doublons
    let mut by_size: HashMap<u64, Vec<DuplicateFile>> = HashMap::new();
    for f in files {
        by_size.entry(f.size).or_default().push(f);
    }
    let size_candidates: Vec<Vec<DuplicateFile>> = by_size
        .into_values()
        .filter(|v| v.len() >= 2)
        .collect();

    let total_to_hash: usize = size_candidates.iter().map(|v| v.len()).sum();
    let hashed = AtomicUsize::new(0);

    // Étape 3 : hash partiel (4 Ko) en parallèle — élimine les faux positifs sans lire les fichiers entiers
    let partial_results: Vec<(String, DuplicateFile)> = size_candidates
        .into_par_iter()
        .flat_map(|group| group.into_par_iter())
        .filter_map(|file| {
            let h = hash_partial(&file.path).ok()?;
            let n = hashed.fetch_add(1, Ordering::Relaxed) + 1;
            on_progress(n, total_to_hash);
            Some((h, file))
        })
        .collect();

    let mut by_partial: HashMap<String, Vec<DuplicateFile>> = HashMap::new();
    for (h, f) in partial_results {
        by_partial.entry(h).or_default().push(f);
    }
    let partial_candidates: Vec<Vec<DuplicateFile>> = by_partial
        .into_values()
        .filter(|v| v.len() >= 2)
        .collect();

    // Étape 4 : hash complet en parallèle — seulement les survivants du filtre partiel
    let full_results: Vec<(String, DuplicateFile)> = partial_candidates
        .into_par_iter()
        .flat_map(|group| group.into_par_iter())
        .filter_map(|file| {
            let h = hash_full(&file.path).ok()?;
            Some((h, file))
        })
        .collect();

    let mut by_full: HashMap<String, Vec<DuplicateFile>> = HashMap::new();
    for (h, f) in full_results {
        by_full.entry(h).or_default().push(f);
    }

    // Construire les groupes de doublons
    let mut groups: Vec<DuplicateGroup> = by_full
        .into_iter()
        .filter(|(_, files)| files.len() >= 2)
        .map(|(hash, files)| {
            let size = files[0].size;
            DuplicateGroup {
                id: uuid::Uuid::new_v4().to_string(),
                hash: hash[..16.min(hash.len())].to_string(),
                size,
                files,
            }
        })
        .collect();

    // Trier par espace gaspillé décroissant
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

fn collect_files(folder: &Path, recursive: bool) -> Result<Vec<DuplicateFile>, String> {
    if !folder.exists() {
        return Err(format!("Dossier introuvable : {}", folder.display()));
    }

    let mut files = Vec::new();

    if recursive {
        for entry in walkdir::WalkDir::new(folder)
            .follow_links(false)
            .into_iter()
            .filter_map(|e| e.ok())
        {
            if !entry.file_type().is_file() {
                continue;
            }
            let path = entry.path();
            let size = match entry.metadata() {
                Ok(m) => m.len(),
                Err(_) => continue,
            };
            let name = path
                .file_name()
                .and_then(|n| n.to_str())
                .unwrap_or("")
                .to_string();
            files.push(DuplicateFile {
                path: path.to_string_lossy().to_string(),
                name,
                size,
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
    }

    Ok(files)
}

fn hash_partial(path: &str) -> Result<String, std::io::Error> {
    let mut file = File::open(path)?;
    let mut buf = vec![0u8; PARTIAL_SIZE];
    let n = file.read(&mut buf)?;
    let mut hasher = Xxh3::new();
    hasher.update(&buf[..n]);
    Ok(format!("{:016x}", hasher.digest()))
}

fn hash_full(path: &str) -> Result<String, std::io::Error> {
    let mut file = File::open(path)?;
    let mut hasher = Xxh3::new();
    let mut buf = vec![0u8; CHUNK_SIZE];
    loop {
        let n = file.read(&mut buf)?;
        if n == 0 {
            break;
        }
        hasher.update(&buf[..n]);
    }
    Ok(format!("{:016x}", hasher.digest()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::sync::Arc;
    use tempfile::TempDir;

    fn no_progress(_: usize, _: usize) {}

    fn write_file(dir: &std::path::Path, name: &str, content: &[u8]) {
        fs::write(dir.join(name), content).unwrap();
    }

    #[test]
    fn dossier_vide() {
        let dir = TempDir::new().unwrap();
        let r = scan_folder(dir.path().to_str().unwrap(), false, no_progress).unwrap();
        assert_eq!(r.groups.len(), 0);
        assert_eq!(r.scanned_files, 0);
        assert_eq!(r.total_wasted_bytes, 0);
    }

    #[test]
    fn aucun_doublon() {
        let dir = TempDir::new().unwrap();
        write_file(dir.path(), "a.txt", b"contenu A");
        write_file(dir.path(), "b.txt", b"contenu B");
        write_file(dir.path(), "c.txt", b"contenu C");
        let r = scan_folder(dir.path().to_str().unwrap(), false, no_progress).unwrap();
        assert_eq!(r.groups.len(), 0);
        assert_eq!(r.scanned_files, 3);
    }

    #[test]
    fn deux_fichiers_identiques() {
        let dir = TempDir::new().unwrap();
        write_file(dir.path(), "a.txt", b"contenu duplique");
        write_file(dir.path(), "b.txt", b"contenu duplique");
        let r = scan_folder(dir.path().to_str().unwrap(), false, no_progress).unwrap();
        assert_eq!(r.groups.len(), 1);
        assert_eq!(r.groups[0].files.len(), 2);
    }

    #[test]
    fn trois_copies() {
        let dir = TempDir::new().unwrap();
        write_file(dir.path(), "a.txt", b"triple exemplaire");
        write_file(dir.path(), "b.txt", b"triple exemplaire");
        write_file(dir.path(), "c.txt", b"triple exemplaire");
        let r = scan_folder(dir.path().to_str().unwrap(), false, no_progress).unwrap();
        assert_eq!(r.groups.len(), 1);
        assert_eq!(r.groups[0].files.len(), 3);
    }

    #[test]
    fn meme_taille_contenu_different() {
        let dir = TempDir::new().unwrap();
        write_file(dir.path(), "a.txt", b"aaaaaaa!!");
        write_file(dir.path(), "b.txt", b"bbbbbbb!!");
        let r = scan_folder(dir.path().to_str().unwrap(), false, no_progress).unwrap();
        assert_eq!(r.groups.len(), 0);
    }

    #[test]
    fn tailles_differentes_pas_doublons() {
        let dir = TempDir::new().unwrap();
        write_file(dir.path(), "petit.txt", b"hi");
        write_file(dir.path(), "grand.txt", b"bonjour le monde");
        let r = scan_folder(dir.path().to_str().unwrap(), false, no_progress).unwrap();
        assert_eq!(r.groups.len(), 0);
    }

    #[test]
    fn plusieurs_groupes() {
        let dir = TempDir::new().unwrap();
        write_file(dir.path(), "a1.txt", b"groupe un ici!!");
        write_file(dir.path(), "a2.txt", b"groupe un ici!!");
        write_file(dir.path(), "b1.txt", b"groupe deux la!!");
        write_file(dir.path(), "b2.txt", b"groupe deux la!!");
        write_file(dir.path(), "c.txt",  b"fichier unique !!");
        let r = scan_folder(dir.path().to_str().unwrap(), false, no_progress).unwrap();
        assert_eq!(r.groups.len(), 2);
        assert_eq!(r.scanned_files, 5);
    }

    #[test]
    fn calcul_espace_gaspille() {
        let dir = TempDir::new().unwrap();
        let content = b"exactement ce contenu";
        write_file(dir.path(), "a.txt", content);
        write_file(dir.path(), "b.txt", content);
        write_file(dir.path(), "c.txt", content);
        let r = scan_folder(dir.path().to_str().unwrap(), false, no_progress).unwrap();
        assert_eq!(r.total_wasted_bytes, content.len() as u64 * 2);
    }

    #[test]
    fn recursif_detecte_sous_dossiers() {
        let dir = TempDir::new().unwrap();
        let sub = dir.path().join("sous");
        fs::create_dir(&sub).unwrap();
        write_file(dir.path(), "a.txt", b"contenu commun");
        write_file(&sub, "b.txt", b"contenu commun");

        let r = scan_folder(dir.path().to_str().unwrap(), false, no_progress).unwrap();
        assert_eq!(r.scanned_files, 1);
        assert_eq!(r.groups.len(), 0);

        let r = scan_folder(dir.path().to_str().unwrap(), true, no_progress).unwrap();
        assert_eq!(r.scanned_files, 2);
        assert_eq!(r.groups.len(), 1);
    }

    #[test]
    fn progression_est_appelee() {
        let dir = TempDir::new().unwrap();
        write_file(dir.path(), "a.txt", b"contenu identique");
        write_file(dir.path(), "b.txt", b"contenu identique");
        let count = Arc::new(AtomicUsize::new(0));
        let c = Arc::clone(&count);
        scan_folder(dir.path().to_str().unwrap(), false, move |_, _| {
            c.fetch_add(1, Ordering::Relaxed);
        })
        .unwrap();
        assert!(count.load(Ordering::Relaxed) > 0);
    }

    #[test]
    fn groupes_tries_par_espace_gaspille_decroissant() {
        let dir = TempDir::new().unwrap();
        write_file(dir.path(), "p1.txt", b"petit");
        write_file(dir.path(), "p2.txt", b"petit");
        write_file(dir.path(), "g1.txt", b"grand ici!");
        write_file(dir.path(), "g2.txt", b"grand ici!");
        let r = scan_folder(dir.path().to_str().unwrap(), false, no_progress).unwrap();
        assert_eq!(r.groups.len(), 2);
        assert!(r.groups[0].size >= r.groups[1].size);
    }
}
