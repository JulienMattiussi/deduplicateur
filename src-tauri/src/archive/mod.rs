// Types publics
pub use types::{ArchiveComparison, ArchiveDetail, ArchiveEntryResult};

mod types;
mod zip_reader;
mod tar_reader;
mod sevenz_reader;

use std::path::Path;
use std::io::Read;
use xxhash_rust::xxh3::Xxh3;

#[derive(Debug, Clone, PartialEq)]
pub enum ArchiveFormat {
    Zip,
    TarGz,
    TarBz2,
    TarXz,
    TarZst,
    SevenZip,
}

/// Entree dans une archive avec son hash deja calcule.
#[derive(Debug, Clone)]
pub struct ArchiveEntry {
    pub internal_path: String,
    pub size: u64,
    pub hash: u64,
}

/// Detecte le format d'archive selon l'extension du nom de fichier (insensible a la casse).
/// Retourne None pour les formats non supportes (RAR, etc.).
pub fn detect_archive_format(path: &Path) -> Option<ArchiveFormat> {
    let name = path.file_name()?.to_string_lossy().to_lowercase();
    if name.ends_with(".tar.gz") || name.ends_with(".tgz") {
        Some(ArchiveFormat::TarGz)
    } else if name.ends_with(".tar.bz2") || name.ends_with(".tbz2") {
        Some(ArchiveFormat::TarBz2)
    } else if name.ends_with(".tar.xz") || name.ends_with(".txz") {
        Some(ArchiveFormat::TarXz)
    } else if name.ends_with(".tar.zst") {
        Some(ArchiveFormat::TarZst)
    } else if name.ends_with(".zip") || name.ends_with(".cbz") {
        Some(ArchiveFormat::Zip)
    } else if name.ends_with(".7z") {
        Some(ArchiveFormat::SevenZip)
    } else {
        None
    }
}

/// Hash un reader par blocs de 4 Mo, retourne le hash xxh3.
pub fn hash_reader<R: Read + ?Sized>(reader: &mut R) -> Result<u64, String> {
    let mut hasher = Xxh3::new();
    let mut buf = vec![0u8; 4 * 1024 * 1024];
    loop {
        let n = reader.read(&mut buf).map_err(|e| e.to_string())?;
        if n == 0 { break; }
        hasher.update(&buf[..n]);
    }
    Ok(hasher.digest())
}

/// Ouvre une archive et retourne la liste de ses entrees avec hash calcule.
/// Les repertoires, liens symboliques et entrees protegees sont filtres silencieusement.
/// Retourne Err silencieusement transforme en Vec vide par l'appelant.
pub fn hash_archive_entries(path: &Path) -> Result<Vec<ArchiveEntry>, String> {
    let format = detect_archive_format(path)
        .ok_or_else(|| format!("format non supporte: {}", path.display()))?;
    match format {
        ArchiveFormat::Zip => zip_reader::hash_zip_entries(path),
        ArchiveFormat::TarGz => tar_reader::hash_tar_entries(path, ArchiveFormat::TarGz),
        ArchiveFormat::TarBz2 => tar_reader::hash_tar_entries(path, ArchiveFormat::TarBz2),
        ArchiveFormat::TarXz => tar_reader::hash_tar_entries(path, ArchiveFormat::TarXz),
        ArchiveFormat::TarZst => tar_reader::hash_tar_entries(path, ArchiveFormat::TarZst),
        ArchiveFormat::SevenZip => sevenz_reader::hash_sevenz_entries(path),
    }
}

/// Compte les entrees d'une archive sans lire leur contenu (rapide pour ZIP).
/// Utilise pour estimer le travail total avant de lancer le hachage.
/// Retourne 0 si l'estimation n'est pas possible (tar, 7z).
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
        // Pour tar et 7z : estimation grossiere basee sur la taille du fichier
        _ => {
            let size = std::fs::metadata(path).map(|m| m.len()).unwrap_or(0);
            (size / 100_000).max(1) as usize  // 1 entree estimee par 100 Ko
        }
    }
}

/// Calcule la comparaison detaillee entre deux archives (entree par entree).
/// Utilise par la commande Tauri get_archive_comparison, appelee en lazy depuis l'UI.
pub fn compute_comparison(path_a: &str, path_b: &str) -> Result<ArchiveComparison, String> {
    let entries_a = hash_archive_entries(Path::new(path_a))
        .unwrap_or_default();
    let entries_b = hash_archive_entries(Path::new(path_b))
        .unwrap_or_default();

    use std::collections::HashMap;
    let map_b: HashMap<u64, &ArchiveEntry> = entries_b.iter().map(|e| (e.hash, e)).collect();
    let map_a: HashMap<u64, &ArchiveEntry> = entries_a.iter().map(|e| (e.hash, e)).collect();

    let a_entries = entries_a.iter().map(|e| {
        let hash_hex = format!("{:x}", e.hash);
        if let Some(other) = map_b.get(&e.hash) {
            ArchiveEntryResult {
                internal_path: e.internal_path.clone(),
                size: e.size,
                status: "duplicate".to_string(),
                duplicate_in: Some(other.internal_path.clone()),
                hash: hash_hex,
            }
        } else {
            ArchiveEntryResult {
                internal_path: e.internal_path.clone(),
                size: e.size,
                status: "unique".to_string(),
                duplicate_in: None,
                hash: hash_hex,
            }
        }
    }).collect();

    let b_entries = entries_b.iter().map(|e| {
        let hash_hex = format!("{:x}", e.hash);
        if let Some(other) = map_a.get(&e.hash) {
            ArchiveEntryResult {
                internal_path: e.internal_path.clone(),
                size: e.size,
                status: "duplicate".to_string(),
                duplicate_in: Some(other.internal_path.clone()),
                hash: hash_hex,
            }
        } else {
            ArchiveEntryResult {
                internal_path: e.internal_path.clone(),
                size: e.size,
                status: "unique".to_string(),
                duplicate_in: None,
                hash: hash_hex,
            }
        }
    }).collect();

    Ok(ArchiveComparison {
        a: ArchiveDetail { path: path_a.to_string(), entries: a_entries },
        b: ArchiveDetail { path: path_b.to_string(), entries: b_entries },
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    use tempfile::NamedTempFile;

    #[test]
    fn detect_zip() {
        assert_eq!(detect_archive_format(Path::new("file.zip")), Some(ArchiveFormat::Zip));
        assert_eq!(detect_archive_format(Path::new("FILE.ZIP")), Some(ArchiveFormat::Zip));
    }

    #[test]
    fn detect_tar_gz() {
        assert_eq!(detect_archive_format(Path::new("file.tar.gz")), Some(ArchiveFormat::TarGz));
        assert_eq!(detect_archive_format(Path::new("file.tgz")), Some(ArchiveFormat::TarGz));
    }

    #[test]
    fn detect_tar_bz2() {
        assert_eq!(detect_archive_format(Path::new("file.tar.bz2")), Some(ArchiveFormat::TarBz2));
        assert_eq!(detect_archive_format(Path::new("file.tbz2")), Some(ArchiveFormat::TarBz2));
    }

    #[test]
    fn detect_tar_xz() {
        assert_eq!(detect_archive_format(Path::new("file.tar.xz")), Some(ArchiveFormat::TarXz));
        assert_eq!(detect_archive_format(Path::new("file.txz")), Some(ArchiveFormat::TarXz));
    }

    #[test]
    fn detect_sevenz() {
        assert_eq!(detect_archive_format(Path::new("file.7z")), Some(ArchiveFormat::SevenZip));
    }

    #[test]
    fn detect_rar_retourne_none() {
        assert_eq!(detect_archive_format(Path::new("file.rar")), None);
    }

    #[test]
    fn detect_cbz_comme_zip() {
        assert_eq!(detect_archive_format(Path::new("comic.cbz")), Some(ArchiveFormat::Zip));
        assert_eq!(detect_archive_format(Path::new("COMIC.CBZ")), Some(ArchiveFormat::Zip));
    }

    #[test]
    fn detect_cbr_retourne_none() {
        // CBR = RAR renomme, pas supporte (comme .rar)
        assert_eq!(detect_archive_format(Path::new("comic.cbr")), None);
    }

    #[test]
    fn detect_inconnu_retourne_none() {
        assert_eq!(detect_archive_format(Path::new("file.txt")), None);
        assert_eq!(detect_archive_format(Path::new("noext")), None);
    }

    fn make_zip(entries: &[(&str, &[u8])]) -> NamedTempFile {
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
    fn hash_zip_retourne_entrees_avec_hash() {
        let zip = make_zip(&[("a.txt", b"hello"), ("b.txt", b"world")]);
        let entries = hash_archive_entries(zip.path()).unwrap();
        assert_eq!(entries.len(), 2);
        let names: Vec<_> = entries.iter().map(|e| e.internal_path.as_str()).collect();
        assert!(names.contains(&"a.txt"));
        assert!(names.contains(&"b.txt"));
    }

    #[test]
    fn hash_zip_filtre_les_repertoires() {
        let mut f = NamedTempFile::with_suffix(".zip").unwrap();
        {
            let mut w = zip::ZipWriter::new(std::io::BufWriter::new(f.as_file_mut()));
            let opts = zip::write::SimpleFileOptions::default();
            w.add_directory("subdir/", opts).unwrap();
            w.start_file("subdir/file.txt", opts).unwrap();
            w.write_all(b"content").unwrap();
            w.finish().unwrap();
        }
        let entries = hash_archive_entries(f.path()).unwrap();
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].internal_path, "subdir/file.txt");
    }

    #[test]
    fn hash_cbz_lu_comme_zip() {
        // Cree un .cbz (en realite un zip avec extension .cbz) et verifie qu'on lit ses entrees
        let mut f = NamedTempFile::with_suffix(".cbz").unwrap();
        {
            let mut w = zip::ZipWriter::new(std::io::BufWriter::new(f.as_file_mut()));
            let opts = zip::write::SimpleFileOptions::default();
            w.start_file("page01.jpg", opts).unwrap();
            w.write_all(b"image data").unwrap();
            w.start_file("page02.jpg", opts).unwrap();
            w.write_all(b"more image data").unwrap();
            w.finish().unwrap();
        }
        let entries = hash_archive_entries(f.path()).unwrap();
        assert_eq!(entries.len(), 2);
    }

    #[test]
    fn hash_zip_contenu_identique_meme_hash() {
        let zip1 = make_zip(&[("a.txt", b"same content")]);
        let zip2 = make_zip(&[("b.txt", b"same content")]);
        let e1 = hash_archive_entries(zip1.path()).unwrap();
        let e2 = hash_archive_entries(zip2.path()).unwrap();
        assert_eq!(e1[0].hash, e2[0].hash);
    }

    fn make_sevenz(entries: &[(&str, &[u8])]) -> NamedTempFile {
        use sevenz_rust2::{ArchiveWriter, ArchiveEntry as SzEntry};
        let f = NamedTempFile::with_suffix(".7z").unwrap();
        {
            let mut w = ArchiveWriter::create(f.path()).unwrap();
            w.set_encrypt_header(false);
            for (name, data) in entries {
                let entry = SzEntry::new_file(*name);
                w.push_archive_entry(entry, Some(*data)).unwrap();
            }
            w.finish().unwrap();
        }
        f
    }

    #[test]
    fn hash_sevenz_retourne_entrees_avec_hash() {
        let sz = make_sevenz(&[("a.txt", b"hello"), ("b.txt", b"world")]);
        let entries = hash_archive_entries(sz.path()).unwrap();
        assert_eq!(entries.len(), 2);
        let names: Vec<_> = entries.iter().map(|e| e.internal_path.as_str()).collect();
        assert!(names.contains(&"a.txt"));
        assert!(names.contains(&"b.txt"));
    }

    #[test]
    fn hash_sevenz_contenu_identique_meme_hash_que_zip() {
        // Un meme contenu produit le meme xxh3 quel que soit le format
        let sz = make_sevenz(&[("x", b"shared content")]);
        let zip = make_zip(&[("y", b"shared content")]);
        let e_sz = hash_archive_entries(sz.path()).unwrap();
        let e_zip = hash_archive_entries(zip.path()).unwrap();
        assert_eq!(e_sz[0].hash, e_zip[0].hash);
    }

    #[test]
    fn compute_comparison_deux_zips() {
        let zip_a = make_zip(&[("common.txt", b"shared"), ("unique_a.txt", b"only in a")]);
        let zip_b = make_zip(&[("common.txt", b"shared"), ("unique_b.txt", b"only in b")]);
        let cmp = compute_comparison(
            zip_a.path().to_str().unwrap(),
            zip_b.path().to_str().unwrap(),
        ).unwrap();
        let dup_a: Vec<_> = cmp.a.entries.iter().filter(|e| e.status == "duplicate").collect();
        let uniq_a: Vec<_> = cmp.a.entries.iter().filter(|e| e.status == "unique").collect();
        assert_eq!(dup_a.len(), 1);
        assert_eq!(uniq_a.len(), 1);
        assert_eq!(dup_a[0].internal_path, "common.txt");
        assert!(dup_a[0].duplicate_in.is_some());
        // Le champ hash doit etre rempli (hex non vide) pour permettre le pairing greedy frontend
        assert!(!dup_a[0].hash.is_empty());
        // Meme contenu => meme hash des deux cotes
        let dup_b: Vec<_> = cmp.b.entries.iter().filter(|e| e.status == "duplicate").collect();
        assert_eq!(dup_a[0].hash, dup_b[0].hash);
    }
}
