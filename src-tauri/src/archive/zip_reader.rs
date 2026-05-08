use std::path::Path;
use std::io::Read;
use crate::archive::{ArchiveEntry, EntryCallback, hash_reader, hash_bytes, PHASH_INMEMORY_MAX};
use crate::scanner::hash::{compute_hashes_from_bytes, is_image_path};

pub fn hash_zip_entries(path: &Path, compute_phash: bool, on_entry: EntryCallback) -> Result<Vec<ArchiveEntry>, String> {
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

        let want_phash = compute_phash && is_image_path(&name) && size <= PHASH_INMEMORY_MAX;
        if want_phash {
            let mut buf = Vec::with_capacity(size as usize);
            if entry.read_to_end(&mut buf).is_err() { continue; }
            let hash = hash_bytes(&buf);
            let phash = compute_hashes_from_bytes(&buf, 8, 16);
            entries.push(ArchiveEntry { internal_path: name, size, hash, phash });
        } else {
            let hash = match hash_reader(&mut entry) {
                Ok(h) => h,
                Err(_) => continue,
            };
            entries.push(ArchiveEntry { internal_path: name, size, hash, phash: None });
        }
        // Progress + annulation : si callback retourne false, on stoppe l'archive
        if !on_entry() { break; }
    }
    Ok(entries)
}
