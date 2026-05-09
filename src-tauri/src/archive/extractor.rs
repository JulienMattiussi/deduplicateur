//! Extraction d'entrees d'archives (images ou audio) vers un dossier temporaire.
//!
//! Permet de reutiliser les pipelines standards (pHash pour images, fpcalc pour audio)
//! qui travaillent sur des chemins disque, au lieu de decoder en memoire entree par entree.
//!
//! Le `TempDir` est detruit automatiquement quand `EntryExtraction` sort de scope (Drop).
//! Le filtre est passe en parametre : `is_image_path` en mode Image, `is_audio` en mode Audio.

use std::path::{Path, PathBuf};
use std::fs::File;
use std::io::Read;
use tempfile::TempDir;
use sevenz_rust2::{ArchiveReader, Password};

use crate::archive::{ArchiveFormat, EntryCallback, detect_archive_format};
use crate::scanner::hash::is_image_path;

/// Une entree (image ou audio) extraite d'une archive vers un fichier temporaire sur disque.
pub struct ExtractedEntry {
    /// Index de l'archive source dans la liste passee a la fonction d'extraction.
    pub archive_idx: usize,
    /// Chemin interne dans l'archive (ex. "subdir/page01.jpg" ou "music/track.mp3").
    pub internal_path: String,
    /// Chemin sur disque dans le temp dir (valide tant que l'`EntryExtraction` parent vit).
    pub temp_path: PathBuf,
}

/// Resultat de l'extraction. Le `temp_dir` est detruit automatiquement quand on drop
/// cette struct, ce qui supprime tous les fichiers extraits en cascade.
pub struct EntryExtraction {
    /// Garde-fou : la destruction de ce TempDir supprime recursivement le dossier
    /// et tous les fichiers extraits. NE PAS DROP avant d'avoir fini d'utiliser
    /// les `temp_path` des items.
    pub _temp_dir: TempDir,
    pub items: Vec<ExtractedEntry>,
}

/// Alias retro-compatible pour le type item, utilise par archive_phase qui annote
/// explicitement le type des items dans son par_iter (`|img: &ExtractedImage|`).
pub type ExtractedImage = ExtractedEntry;

/// Sous-dossier "scan_temp" sous le data_dir de l'app, parent de tous les TempDir d'extraction.
/// Permet le cleanup_orphan au demarrage de l'app : on peut tout supprimer sous ce parent.
pub fn scan_temp_parent(data_dir: &Path) -> PathBuf {
    data_dir.join("scan_temp")
}

/// Estime la taille totale (bytes) qu'occupera l'extraction des entrees passant le filtre
/// `is_image_path`. Wrapper sur `estimate_extraction_size_filtered` pour retro-compat.
#[allow(dead_code)]
pub fn estimate_extraction_size(archive_paths: &[String]) -> u64 {
    estimate_extraction_size_filtered(archive_paths, |name| is_image_path(name))
}

/// Estime la taille totale (bytes) qu'occupera l'extraction des entrees passant le predicat
/// `filter` (ex. `is_image_path` ou `is_audio`). Lit les headers sans decompresser le contenu.
///
/// **Performance** :
/// - ZIP/7z : lecture de la table d'entrees uniquement, tres rapide
/// - tar.* : on doit decompresser TOUT le flux pour atteindre chaque header (limite
///   du format tar). Pour eviter de bloquer plusieurs minutes sur un dossier avec
///   plusieurs gros tar.gz, on utilise une **estimation approximative** = taille
///   compressee * 4 (ratio typique gz/xz/zst) sans decompresser. C'est une borne
///   superieure realiste, le but est juste de detecter "espace insuffisant".
/// - Parallelisation : toutes les archives sont traitees en parallele via rayon.
pub fn estimate_extraction_size_filtered(
    archive_paths: &[String],
    filter: impl Fn(&str) -> bool + Copy + Send + Sync,
) -> u64 {
    use rayon::prelude::*;
    archive_paths.par_iter()
        .map(|arch_path| {
            let format = match detect_archive_format(Path::new(arch_path)) {
                Some(f) => f,
                None => return 0u64,
            };
            match format {
                ArchiveFormat::Zip => estimate_zip(arch_path, filter),
                ArchiveFormat::Tar | ArchiveFormat::TarGz | ArchiveFormat::TarBz2 | ArchiveFormat::TarXz | ArchiveFormat::TarZst => {
                    estimate_tar_fast(arch_path)
                }
                ArchiveFormat::SevenZip => estimate_sevenz(arch_path, filter),
            }
        })
        .sum()
}

fn estimate_zip(arch_path: &str, filter: impl Fn(&str) -> bool) -> u64 {
    let file = match File::open(arch_path) { Ok(f) => f, Err(_) => return 0 };
    let mut archive = match zip::ZipArchive::new(file) { Ok(a) => a, Err(_) => return 0 };
    let mut sum = 0u64;
    for i in 0..archive.len() {
        let entry = match archive.by_index(i) { Ok(e) => e, Err(_) => continue };
        if entry.is_dir() || entry.encrypted() { continue; }
        if !filter(entry.name()) { continue; }
        sum += entry.size();
    }
    sum
}

/// Estimation conservative pour tar compresse : on NE decompresse PAS (cout prohibitif).
/// On retourne `compressed_size * 4` comme borne superieure realiste, peu importe le filtre.
/// Le but est juste de detecter "espace insuffisant", pas d'etre precis.
fn estimate_tar_fast(arch_path: &str) -> u64 {
    std::fs::metadata(arch_path)
        .map(|m| m.len().saturating_mul(4))
        .unwrap_or(0)
}

fn estimate_sevenz(arch_path: &str, filter: impl Fn(&str) -> bool) -> u64 {
    let mut reader = match ArchiveReader::open(arch_path, Password::empty()) {
        Ok(r) => r,
        Err(_) => return 0,
    };
    let mut sum = 0u64;
    let _ = reader.for_each_entries(|entry, _stream| {
        if entry.is_directory() || !entry.has_stream() { return Ok(true); }
        if filter(entry.name()) {
            sum += entry.size();
        }
        Ok(true)
    });
    sum
}

/// Espace disque disponible (bytes) sur le volume contenant `path`.
pub fn available_disk_space(path: &Path) -> u64 {
    use fs2::available_space;
    available_space(path).unwrap_or(0)
}

/// Extrait toutes les entrees image des archives donnees (filtre `is_image_path`).
/// Wrapper sur `extract_entries_filtered` pour retro-compat avec l'API existante.
pub fn extract_image_entries(
    archive_paths: &[String],
    data_dir: &Path,
    on_entry: EntryCallback,
) -> std::io::Result<EntryExtraction> {
    extract_entries_filtered(archive_paths, data_dir, |name| is_image_path(name), on_entry)
}

/// Extrait toutes les entrees audio des archives donnees (filtre `is_audio`).
pub fn extract_audio_entries(
    archive_paths: &[String],
    data_dir: &Path,
    on_entry: EntryCallback,
) -> std::io::Result<EntryExtraction> {
    extract_entries_filtered(archive_paths, data_dir, |name| crate::audio::is_audio(name), on_entry)
}

/// Extrait toutes les entrees passant le predicat `filter` vers un nouveau dossier
/// temporaire (sous `data_dir/scan_temp/`). `on_entry` est appele apres chaque entree
/// extraite ; retourner false interrompt l'extraction.
pub fn extract_entries_filtered(
    archive_paths: &[String],
    data_dir: &Path,
    filter: impl Fn(&str) -> bool + Copy,
    on_entry: EntryCallback,
) -> std::io::Result<EntryExtraction> {
    let parent = scan_temp_parent(data_dir);
    std::fs::create_dir_all(&parent)?;
    let temp_dir = TempDir::new_in(&parent)?;
    let mut items = Vec::new();

    for (arch_idx, arch_path) in archive_paths.iter().enumerate() {
        let format = match detect_archive_format(Path::new(arch_path)) {
            Some(f) => f,
            None => continue,
        };
        let arch_subdir = temp_dir.path().join(format!("a{}", arch_idx));
        std::fs::create_dir_all(&arch_subdir)?;

        let result = match format {
            ArchiveFormat::Zip => extract_zip(arch_path, arch_idx, &arch_subdir, &mut items, filter, on_entry),
            ArchiveFormat::Tar | ArchiveFormat::TarGz | ArchiveFormat::TarBz2 | ArchiveFormat::TarXz | ArchiveFormat::TarZst => {
                extract_tar(arch_path, format, arch_idx, &arch_subdir, &mut items, filter, on_entry)
            }
            ArchiveFormat::SevenZip => extract_sevenz(arch_path, arch_idx, &arch_subdir, &mut items, filter, on_entry),
        };
        // En cas d'erreur sur une archive, on continue avec les suivantes (extraction best-effort)
        let _ = result;
    }

    Ok(EntryExtraction { _temp_dir: temp_dir, items })
}

fn safe_filename(idx: usize, original: &str) -> String {
    let ext = original.rsplit('.').next().unwrap_or("bin").to_lowercase();
    // Filtrage minimal : on garde juste l'index + l'extension. Les chemins internes
    // peuvent contenir n'importe quoi, on ne tente pas de les preserver.
    format!("e{}.{}", idx, ext)
}

fn extract_zip(
    arch_path: &str,
    arch_idx: usize,
    out_dir: &Path,
    items: &mut Vec<ExtractedEntry>,
    filter: impl Fn(&str) -> bool,
    on_entry: EntryCallback,
) -> std::io::Result<()> {
    let file = File::open(arch_path)?;
    let mut archive = zip::ZipArchive::new(file)
        .map_err(|e| std::io::Error::other(e.to_string()))?;
    for i in 0..archive.len() {
        let mut entry = match archive.by_index(i) {
            Ok(e) => e,
            Err(_) => continue,
        };
        if entry.is_dir() || entry.encrypted() { continue; }
        let name = entry.name().to_string();
        if !filter(&name) { continue; }
        let temp_path = out_dir.join(safe_filename(i, &name));
        let mut out = File::create(&temp_path)?;
        std::io::copy(&mut entry, &mut out)?;
        items.push(ExtractedEntry {
            archive_idx: arch_idx,
            internal_path: name,
            temp_path,
        });
        if !on_entry() { break; }
    }
    Ok(())
}

fn extract_tar(
    arch_path: &str,
    format: ArchiveFormat,
    arch_idx: usize,
    out_dir: &Path,
    items: &mut Vec<ExtractedEntry>,
    filter: impl Fn(&str) -> bool,
    on_entry: EntryCallback,
) -> std::io::Result<()> {
    let file = File::open(arch_path)?;
    match format {
        ArchiveFormat::Tar => extract_tar_inner(tar::Archive::new(file), arch_idx, out_dir, items, filter, on_entry),
        ArchiveFormat::TarGz => extract_tar_inner(tar::Archive::new(flate2::read::GzDecoder::new(file)), arch_idx, out_dir, items, filter, on_entry),
        ArchiveFormat::TarBz2 => extract_tar_inner(tar::Archive::new(bzip2::read::BzDecoder::new(file)), arch_idx, out_dir, items, filter, on_entry),
        ArchiveFormat::TarXz => extract_tar_inner(tar::Archive::new(xz2::read::XzDecoder::new(file)), arch_idx, out_dir, items, filter, on_entry),
        ArchiveFormat::TarZst => {
            let zst = zstd::Decoder::new(file)?;
            extract_tar_inner(tar::Archive::new(zst), arch_idx, out_dir, items, filter, on_entry)
        }
        _ => Ok(()),
    }
}

fn extract_tar_inner<R: Read>(
    mut archive: tar::Archive<R>,
    arch_idx: usize,
    out_dir: &Path,
    items: &mut Vec<ExtractedEntry>,
    filter: impl Fn(&str) -> bool,
    on_entry: EntryCallback,
) -> std::io::Result<()> {
    let mut idx = 0;
    for entry in archive.entries()? {
        let mut entry = match entry {
            Ok(e) => e,
            Err(_) => { idx += 1; continue; }
        };
        let header = entry.header();
        match header.entry_type() {
            tar::EntryType::Regular | tar::EntryType::Continuous => {}
            _ => { idx += 1; continue; }
        }
        let path = match entry.path() {
            Ok(p) => p.to_string_lossy().to_string(),
            Err(_) => { idx += 1; continue; }
        };
        if !filter(&path) { idx += 1; continue; }
        let temp_path = out_dir.join(safe_filename(idx, &path));
        let mut out = File::create(&temp_path)?;
        std::io::copy(&mut entry, &mut out)?;
        items.push(ExtractedEntry {
            archive_idx: arch_idx,
            internal_path: path,
            temp_path,
        });
        idx += 1;
        if !on_entry() { break; }
    }
    Ok(())
}

fn extract_sevenz(
    arch_path: &str,
    arch_idx: usize,
    out_dir: &Path,
    items: &mut Vec<ExtractedEntry>,
    filter: impl Fn(&str) -> bool,
    on_entry: EntryCallback,
) -> std::io::Result<()> {
    let mut reader = ArchiveReader::open(arch_path, Password::empty())
        .map_err(|e| std::io::Error::other(e.to_string()))?;
    let mut idx = 0usize;
    let mut io_err: Option<std::io::Error> = None;
    let _ = reader.for_each_entries(|entry, stream| {
        if entry.is_directory() || !entry.has_stream() {
            idx += 1;
            return Ok(true);
        }
        let name = entry.name().to_string();
        if !filter(&name) {
            idx += 1;
            return Ok(true);
        }
        let temp_path = out_dir.join(safe_filename(idx, &name));
        let result: std::io::Result<()> = (|| {
            let mut out = File::create(&temp_path)?;
            std::io::copy(stream, &mut out)?;
            Ok(())
        })();
        if let Err(e) = result {
            io_err = Some(e);
            return Ok(false);
        }
        items.push(ExtractedEntry {
            archive_idx: arch_idx,
            internal_path: name,
            temp_path,
        });
        idx += 1;
        Ok(on_entry())
    });
    if let Some(e) = io_err { return Err(e); }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    use tempfile::NamedTempFile;

    fn make_zip_with_images(entries: &[(&str, &[u8])]) -> NamedTempFile {
        let mut f = NamedTempFile::with_suffix(".zip").unwrap();
        {
            let mut w = zip::ZipWriter::new(std::io::BufWriter::new(f.as_file_mut()));
            let opts = zip::write::SimpleFileOptions::default();
            for (name, data) in entries {
                w.start_file(*name, opts).unwrap();
                w.write_all(data).unwrap();
            }
            w.finish().unwrap();
        }
        f
    }

    #[test]
    fn extract_filtre_les_non_images() {
        let zip = make_zip_with_images(&[
            ("readme.txt", b"texte"),
            ("page1.jpg", b"\xFF\xD8\xFF"),  // JPEG magic mais pas valide, peu importe
            ("script.ts", b"code"),
            ("page2.png", b"\x89PNG"),
        ]);
        let tmp = TempDir::new().unwrap();
        let result = extract_image_entries(
            &[zip.path().to_str().unwrap().to_string()],
            tmp.path(),
            &|| true,
        ).unwrap();
        assert_eq!(result.items.len(), 2, "seules les 2 images doivent etre extraites");
        let paths: Vec<&str> = result.items.iter().map(|i| i.internal_path.as_str()).collect();
        assert!(paths.contains(&"page1.jpg"));
        assert!(paths.contains(&"page2.png"));
    }

    #[test]
    fn extraction_bytes_correspondent_au_zip_source() {
        let zip = make_zip_with_images(&[("img.jpg", b"contenu_image_xyz")]);
        let tmp = TempDir::new().unwrap();
        let result = extract_image_entries(
            &[zip.path().to_str().unwrap().to_string()],
            tmp.path(),
            &|| true,
        ).unwrap();
        assert_eq!(result.items.len(), 1);
        let bytes = std::fs::read(&result.items[0].temp_path).unwrap();
        assert_eq!(bytes, b"contenu_image_xyz");
    }

    #[test]
    fn temp_dir_supprime_apres_drop() {
        let zip = make_zip_with_images(&[("img.jpg", b"data")]);
        let tmp = TempDir::new().unwrap();
        let temp_path = {
            let result = extract_image_entries(
                &[zip.path().to_str().unwrap().to_string()],
                tmp.path(),
                &|| true,
            ).unwrap();
            result.items[0].temp_path.clone()
        };
        // Apres le drop de result, le fichier ne doit plus exister
        assert!(!temp_path.exists(), "le fichier extrait doit etre supprime apres Drop");
    }

    #[test]
    fn estimate_compte_uniquement_les_images() {
        let zip = make_zip_with_images(&[
            ("readme.txt", &vec![0u8; 1000]),  // 1000 bytes texte (ignored)
            ("page1.jpg", &vec![1u8; 500]),    // 500 bytes image
            ("page2.png", &vec![2u8; 300]),    // 300 bytes image
        ]);
        let estimate = estimate_extraction_size(&[zip.path().to_str().unwrap().to_string()]);
        assert_eq!(estimate, 800, "doit sommer uniquement les entrees image (500 + 300)");
    }

    #[test]
    fn estimate_archives_inexistantes_retourne_zero() {
        let estimate = estimate_extraction_size(&["/chemin/inexistant.zip".to_string()]);
        assert_eq!(estimate, 0);
    }

    #[test]
    fn cancel_via_callback_arrete_l_extraction() {
        let zip = make_zip_with_images(&[
            ("img1.jpg", b"a"),
            ("img2.jpg", b"b"),
            ("img3.jpg", b"c"),
        ]);
        let tmp = TempDir::new().unwrap();
        let count = std::cell::Cell::new(0);
        let cancel_after_first: EntryCallback = &|| {
            count.set(count.get() + 1);
            count.get() < 1  // false des le 1er = stop apres extraction de la 1ere image
        };
        let result = extract_image_entries(
            &[zip.path().to_str().unwrap().to_string()],
            tmp.path(),
            cancel_after_first,
        ).unwrap();
        assert_eq!(result.items.len(), 1, "extraction stoppee apres la 1ere image");
    }
}
