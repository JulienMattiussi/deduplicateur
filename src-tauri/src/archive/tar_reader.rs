use std::path::Path;
use crate::archive::{ArchiveEntry, ArchiveFormat, hash_reader};

pub fn hash_tar_entries(path: &Path, format: ArchiveFormat) -> Result<Vec<ArchiveEntry>, String> {
    let file = std::fs::File::open(path).map_err(|e| e.to_string())?;
    match format {
        ArchiveFormat::TarGz => {
            let gz = flate2::read::GzDecoder::new(file);
            hash_tar_archive(tar::Archive::new(gz))
        }
        ArchiveFormat::TarBz2 => {
            let bz = bzip2::read::BzDecoder::new(file);
            hash_tar_archive(tar::Archive::new(bz))
        }
        ArchiveFormat::TarXz => {
            let xz = xz2::read::XzDecoder::new(file);
            hash_tar_archive(tar::Archive::new(xz))
        }
        ArchiveFormat::TarZst => {
            let zst = zstd::Decoder::new(file).map_err(|e| e.to_string())?;
            hash_tar_archive(tar::Archive::new(zst))
        }
        _ => Err("format non-tar".to_string()),
    }
}

fn hash_tar_archive<R: std::io::Read>(mut archive: tar::Archive<R>) -> Result<Vec<ArchiveEntry>, String> {
    let mut entries = Vec::new();
    for entry in archive.entries().map_err(|e| e.to_string())? {
        let mut entry = match entry {
            Ok(e) => e,
            Err(_) => continue,
        };
        let header = entry.header();
        // Ignorer repertoires et liens
        match header.entry_type() {
            tar::EntryType::Regular | tar::EntryType::Continuous => {}
            _ => continue,
        }
        let path = match entry.path() {
            Ok(p) => p.to_string_lossy().to_string(),
            Err(_) => continue,
        };
        let size = header.size().unwrap_or(0);
        let hash = match hash_reader(&mut entry) {
            Ok(h) => h,
            Err(_) => continue,
        };
        entries.push(ArchiveEntry { internal_path: path, size, hash });
    }
    Ok(entries)
}
