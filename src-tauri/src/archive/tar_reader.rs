use std::path::Path;
use std::io::Read;
use crate::archive::{ArchiveEntry, ArchiveFormat, EntryCallback, hash_reader, hash_bytes, PHASH_INMEMORY_MAX};
use crate::scanner::hash::{compute_hashes_from_bytes, is_image_path};

pub fn hash_tar_entries(
    path: &Path,
    format: ArchiveFormat,
    compute_phash: bool,
    on_entry: EntryCallback,
) -> Result<Vec<ArchiveEntry>, String> {
    let file = std::fs::File::open(path).map_err(|e| e.to_string())?;
    match format {
        ArchiveFormat::TarGz => {
            let gz = flate2::read::GzDecoder::new(file);
            hash_tar_archive(tar::Archive::new(gz), compute_phash, on_entry)
        }
        ArchiveFormat::TarBz2 => {
            let bz = bzip2::read::BzDecoder::new(file);
            hash_tar_archive(tar::Archive::new(bz), compute_phash, on_entry)
        }
        ArchiveFormat::TarXz => {
            let xz = xz2::read::XzDecoder::new(file);
            hash_tar_archive(tar::Archive::new(xz), compute_phash, on_entry)
        }
        ArchiveFormat::TarZst => {
            let zst = zstd::Decoder::new(file).map_err(|e| e.to_string())?;
            hash_tar_archive(tar::Archive::new(zst), compute_phash, on_entry)
        }
        _ => Err("format non-tar".to_string()),
    }
}

fn hash_tar_archive<R: std::io::Read>(
    mut archive: tar::Archive<R>,
    compute_phash: bool,
    on_entry: EntryCallback,
) -> Result<Vec<ArchiveEntry>, String> {
    let mut entries = Vec::new();
    for entry in archive.entries().map_err(|e| e.to_string())? {
        let mut entry = match entry {
            Ok(e) => e,
            Err(_) => continue,
        };
        let header = entry.header();
        match header.entry_type() {
            tar::EntryType::Regular | tar::EntryType::Continuous => {}
            _ => continue,
        }
        let path = match entry.path() {
            Ok(p) => p.to_string_lossy().to_string(),
            Err(_) => continue,
        };
        let size = header.size().unwrap_or(0);
        let want_phash = compute_phash && is_image_path(&path) && size <= PHASH_INMEMORY_MAX;
        if want_phash {
            let mut buf = Vec::with_capacity(size as usize);
            if entry.read_to_end(&mut buf).is_err() { continue; }
            let hash = hash_bytes(&buf);
            let phash = compute_hashes_from_bytes(&buf, 8, 16);
            entries.push(ArchiveEntry { internal_path: path, size, hash, phash });
        } else {
            let hash = match hash_reader(&mut entry) {
                Ok(h) => h,
                Err(_) => continue,
            };
            entries.push(ArchiveEntry { internal_path: path, size, hash, phash: None });
        }
        if !on_entry() { break; }
    }
    Ok(entries)
}
