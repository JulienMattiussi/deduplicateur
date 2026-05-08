use std::path::Path;
use sevenz_rust2::{ArchiveReader, Password};
use crate::archive::{ArchiveEntry, EntryCallback, hash_reader, hash_bytes, PHASH_INMEMORY_MAX};
use crate::scanner::hash::{compute_hashes_from_bytes, is_image_path};

pub fn hash_sevenz_entries(path: &Path, compute_phash: bool, on_entry: EntryCallback) -> Result<Vec<ArchiveEntry>, String> {
    let mut reader = ArchiveReader::open(path, Password::empty())
        .map_err(|e| e.to_string())?;
    let mut entries: Vec<ArchiveEntry> = Vec::new();
    reader.for_each_entries(|entry, stream| {
        if entry.is_directory() || !entry.has_stream() {
            return Ok(true);
        }
        let name = entry.name().to_string();
        let size = entry.size();
        let want_phash = compute_phash && is_image_path(&name) && size <= PHASH_INMEMORY_MAX;
        if want_phash {
            let mut buf = Vec::with_capacity(size as usize);
            if stream.read_to_end(&mut buf).is_err() {
                return Ok(true);
            }
            let hash = hash_bytes(&buf);
            let phash = compute_hashes_from_bytes(&buf, 8, 16);
            entries.push(ArchiveEntry { internal_path: name, size, hash, phash });
        } else if let Ok(hash) = hash_reader(stream) {
            entries.push(ArchiveEntry { internal_path: name, size, hash, phash: None });
        }
        // Progress + annulation : on retourne false dans le closure pour stopper for_each
        Ok(on_entry())
    }).map_err(|e| e.to_string())?;
    Ok(entries)
}
