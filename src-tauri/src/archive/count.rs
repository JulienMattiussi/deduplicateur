//! Comptage des entrees d'archive (filtre ou total). Combine deux usages :
//! - estimation du `total_work` du scanner (count exact, paye une fois upfront)
//! - estimation de l'espace disque necessaire avant extraction (count + bytes)
//!
//! Pour les tar.*, on itere reellement le flux pour compter (decompression
//! streaming). C'est plus lent qu'une heuristique sur la taille du fichier mais
//! l'experience a montre que les heuristiques sous-estiment systematiquement
//! les tars denses (cf. regle "Comptage exact, pas heuristique" d'AGENTS.md).

use super::{detect_archive_format, ArchiveFormat};
use std::io::Read;
use std::path::Path;

/// Compte ET estime la taille totale (bytes) d'extraction des entrees image d'une archive,
/// en une seule passe sur les en-tetes. Retourne (count, bytes_decompresses).
/// Utilise pour fusionner le precheck d'espace disque dans la phase counting_archives.
pub fn count_and_estimate_archive_image_entries(path: &Path) -> (usize, u64) {
    count_and_estimate_archive_entries_filtered(path, crate::scanner::hash::is_image_path)
}

/// Compte ET estime la taille totale (bytes) d'extraction des entrees audio d'une archive.
/// Cf. `count_and_estimate_archive_image_entries`.
pub fn count_and_estimate_archive_audio_entries(path: &Path) -> (usize, u64) {
    count_and_estimate_archive_entries_filtered(path, crate::audio::is_audio)
}

/// Compte les entrees passant le filtre + somme leur taille decompressee.
/// - ZIP/7z : lecture des headers (taille connue exacte par entry).
/// - tar.* : iteration du flux pour count, mais estimation par `taille_archive * 4`
///   (impossible de connaitre la taille decompressee par entree sans iterer le contenu :
///   trop couteux). Le but est juste de detecter "espace insuffisant", pas precision.
pub fn count_and_estimate_archive_entries_filtered(
    path: &Path,
    filter: impl Fn(&str) -> bool + Copy,
) -> (usize, u64) {
    let format = match detect_archive_format(path) {
        Some(f) => f,
        None => return (0, 0),
    };
    match format {
        ArchiveFormat::Zip => {
            let file = match std::fs::File::open(path) { Ok(f) => f, Err(_) => return (0, 0) };
            let mut archive = match zip::ZipArchive::new(file) { Ok(a) => a, Err(_) => return (0, 0) };
            let mut n = 0usize;
            let mut bytes = 0u64;
            for i in 0..archive.len() {
                if let Ok(entry) = archive.by_index(i) {
                    if !entry.is_dir() && !entry.encrypted() && filter(entry.name()) {
                        n += 1;
                        bytes = bytes.saturating_add(entry.size());
                    }
                }
            }
            (n, bytes)
        }
        ArchiveFormat::SevenZip => {
            let mut reader = match sevenz_rust2::ArchiveReader::open(path, sevenz_rust2::Password::empty()) {
                Ok(r) => r,
                Err(_) => return (0, 0),
            };
            let mut n = 0usize;
            let mut bytes = 0u64;
            let _ = reader.for_each_entries(|entry, _| {
                if !entry.is_directory() && entry.has_stream() && filter(entry.name()) {
                    n += 1;
                    bytes = bytes.saturating_add(entry.size());
                }
                Ok(true)
            });
            (n, bytes)
        }
        // Pour les tar.*, on compte mais on utilise l'heuristique `compressed_size * 4`
        // pour l'estimation (le decoder fournit pas la taille decompressee par entree sans
        // iterer le contenu, ce qui serait prohibitif). Borne superieure realiste.
        ArchiveFormat::Tar | ArchiveFormat::TarGz | ArchiveFormat::TarBz2
        | ArchiveFormat::TarXz | ArchiveFormat::TarZst => {
            let count = count_archive_entries_filtered(path, filter);
            let bytes = std::fs::metadata(path).map(|m| m.len().saturating_mul(4)).unwrap_or(0);
            (count, bytes)
        }
    }
}

/// Compte les entrees d'une archive qui passent le predicat `filter`.
/// - ZIP/7z : count exact via central directory / iteration des headers (rapide)
/// - tar.* : iteration sequentielle, decompresse le stream pour lire les headers
///   (les bytes des entrees sont auto-skip via Drop). Cout : quelques secondes pour
///   un gros tar.bz2.
///
/// Utilise pour estimer le travail des phases pHash et audio archives upfront,
/// afin que `total_work` du scanner inclue ces phases et que la barre de progression
/// avance de maniere monotone et fiable.
pub fn count_archive_entries_filtered(
    path: &Path,
    filter: impl Fn(&str) -> bool + Copy,
) -> usize {
    let format = match detect_archive_format(path) {
        Some(f) => f,
        None => return 0,
    };
    match format {
        ArchiveFormat::Zip => {
            let file = match std::fs::File::open(path) { Ok(f) => f, Err(_) => return 0 };
            let mut archive = match zip::ZipArchive::new(file) { Ok(a) => a, Err(_) => return 0 };
            let mut n = 0;
            for i in 0..archive.len() {
                if let Ok(entry) = archive.by_index(i) {
                    if !entry.is_dir() && !entry.encrypted() && filter(entry.name()) {
                        n += 1;
                    }
                }
            }
            n
        }
        ArchiveFormat::SevenZip => {
            let mut reader = match sevenz_rust2::ArchiveReader::open(path, sevenz_rust2::Password::empty()) {
                Ok(r) => r,
                Err(_) => return 0,
            };
            let mut n = 0;
            let _ = reader.for_each_entries(|entry, _| {
                if !entry.is_directory() && entry.has_stream() && filter(entry.name()) {
                    n += 1;
                }
                Ok(true)
            });
            n
        }
        ArchiveFormat::Tar => count_tar_filtered(path, filter, |f| Box::new(f)),
        ArchiveFormat::TarGz => count_tar_filtered(path, filter, |f| Box::new(flate2::read::GzDecoder::new(f))),
        ArchiveFormat::TarBz2 => count_tar_filtered(path, filter, |f| Box::new(bzip2::read::BzDecoder::new(f))),
        ArchiveFormat::TarXz => count_tar_filtered(path, filter, |f| Box::new(xz2::read::XzDecoder::new(f))),
        ArchiveFormat::TarZst => {
            let file = match std::fs::File::open(path) { Ok(f) => f, Err(_) => return 0 };
            let zst = match zstd::Decoder::new(file) { Ok(d) => d, Err(_) => return 0 };
            count_tar_filtered_inner(tar::Archive::new(zst), filter)
        }
    }
}

fn count_tar_filtered(
    path: &Path,
    filter: impl Fn(&str) -> bool + Copy,
    decoder: impl FnOnce(std::fs::File) -> Box<dyn Read>,
) -> usize {
    let file = match std::fs::File::open(path) { Ok(f) => f, Err(_) => return 0 };
    let stream = decoder(file);
    count_tar_filtered_inner(tar::Archive::new(stream), filter)
}

fn count_tar_filtered_inner<R: Read>(
    mut archive: tar::Archive<R>,
    filter: impl Fn(&str) -> bool,
) -> usize {
    let mut n = 0;
    if let Ok(entries) = archive.entries() {
        for entry in entries.flatten() {
            let entry_type = entry.header().entry_type();
            if !matches!(entry_type, tar::EntryType::Regular | tar::EntryType::Continuous) { continue; }
            if let Ok(p) = entry.path() {
                if filter(&p.to_string_lossy()) {
                    n += 1;
                }
            }
        }
    }
    n
}

/// Compte EXACTEMENT le nombre d'entrees fichier d'une archive (filtre dirs et streams vides).
/// - ZIP : random access via central directory (instantane)
/// - 7z : iteration des entrees via for_each_entries (rapide, lit les headers compresses)
/// - tar.* : iteration sequentielle, decompresse le stream pour lire les headers (les bytes
///   d'entree sont auto-skip via Drop). Cout : quelques secondes pour un gros tar.bz2.
///
/// Une heuristique imprecise ici cause un budget total_work errone et fait atteindre
/// 100% trop tot ou jamais. Le cout d'iteration est paye une fois upfront, pour avoir
/// une barre de progression fiable. (Anciennement `size / 100000` qui sous-estimait
/// systematiquement les tars denses comme renpy.tar.bz2 : 200 MB / 100K = 2000 alors
/// que l'archive contient 3134 entrees.)
pub fn count_entries_fast(path: &Path) -> usize {
    let format = match detect_archive_format(path) {
        Some(f) => f,
        None => return 0,
    };
    match format {
        ArchiveFormat::Zip => {
            let file = match std::fs::File::open(path) { Ok(f) => f, Err(_) => return 0 };
            match zip::ZipArchive::new(file) {
                Ok(a) => a.len(),
                Err(_) => 0,
            }
        }
        ArchiveFormat::SevenZip => {
            let mut reader = match sevenz_rust2::ArchiveReader::open(path, sevenz_rust2::Password::empty()) {
                Ok(r) => r,
                Err(_) => return 0,
            };
            let mut n = 0;
            let _ = reader.for_each_entries(|entry, _| {
                if !entry.is_directory() && entry.has_stream() {
                    n += 1;
                }
                Ok(true)
            });
            n
        }
        ArchiveFormat::Tar => count_tar_entries(path, |f| Box::new(f)),
        ArchiveFormat::TarGz => count_tar_entries(path, |f| Box::new(flate2::read::GzDecoder::new(f))),
        ArchiveFormat::TarBz2 => count_tar_entries(path, |f| Box::new(bzip2::read::BzDecoder::new(f))),
        ArchiveFormat::TarXz => count_tar_entries(path, |f| Box::new(xz2::read::XzDecoder::new(f))),
        ArchiveFormat::TarZst => {
            let file = match std::fs::File::open(path) { Ok(f) => f, Err(_) => return 0 };
            let zst = match zstd::Decoder::new(file) { Ok(d) => d, Err(_) => return 0 };
            count_tar_entries_inner(tar::Archive::new(zst))
        }
    }
}

fn count_tar_entries(
    path: &Path,
    decoder: impl FnOnce(std::fs::File) -> Box<dyn Read>,
) -> usize {
    let file = match std::fs::File::open(path) { Ok(f) => f, Err(_) => return 0 };
    let stream = decoder(file);
    count_tar_entries_inner(tar::Archive::new(stream))
}

fn count_tar_entries_inner<R: Read>(mut archive: tar::Archive<R>) -> usize {
    let mut n = 0;
    if let Ok(entries) = archive.entries() {
        for entry in entries.flatten() {
            let entry_type = entry.header().entry_type();
            if matches!(entry_type, tar::EntryType::Regular | tar::EntryType::Continuous) {
                n += 1;
            }
        }
    }
    n
}
