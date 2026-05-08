use std::path::Path;
use sevenz_rust2::{ArchiveReader, Password};
use crate::archive::{ArchiveEntry, hash_reader};

pub fn hash_sevenz_entries(path: &Path) -> Result<Vec<ArchiveEntry>, String> {
    let mut reader = ArchiveReader::open(path, Password::empty())
        .map_err(|e| e.to_string())?;
    let mut entries: Vec<ArchiveEntry> = Vec::new();
    reader.for_each_entries(|entry, stream| {
        if entry.is_directory() || !entry.has_stream() {
            return Ok(true);
        }
        let name = entry.name().to_string();
        let size = entry.size();
        if let Ok(hash) = hash_reader(stream) {
            entries.push(ArchiveEntry { internal_path: name, size, hash });
        }
        // sinon entree corrompue : skip silencieux
        Ok(true)
    }).map_err(|e| e.to_string())?;
    Ok(entries)
}
