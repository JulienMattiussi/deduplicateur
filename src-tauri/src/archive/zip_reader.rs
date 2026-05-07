use std::path::Path;
use crate::archive::{ArchiveEntry, hash_reader};

pub fn hash_zip_entries(path: &Path) -> Result<Vec<ArchiveEntry>, String> {
    let file = std::fs::File::open(path).map_err(|e| e.to_string())?;
    let mut archive = zip::ZipArchive::new(file).map_err(|e| e.to_string())?;
    let mut entries = Vec::new();
    for i in 0..archive.len() {
        let mut entry = match archive.by_index(i) {
            Ok(e) => e,
            Err(_) => continue,  // entree inaccessible (protegee, corrompue) : skip
        };
        if entry.is_dir() { continue; }
        // Entree protegee par mot de passe : skip silencieux
        if entry.encrypted() { continue; }
        let name = entry.name().to_string();
        let size = entry.size();
        let hash = match hash_reader(&mut entry) {
            Ok(h) => h,
            Err(_) => continue,
        };
        entries.push(ArchiveEntry { internal_path: name, size, hash });
    }
    Ok(entries)
}
