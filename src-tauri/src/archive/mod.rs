// Types publics
pub use types::{ArchiveComparison, ArchiveDetail, ArchiveEntryResult};

mod types;
mod zip_reader;
mod tar_reader;
mod sevenz_reader;
pub mod extractor;

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
    /// pHash perceptuel (coarse, fine) si l'entree est une image et compute_phash=true.
    pub phash: Option<(Vec<u8>, Vec<u8>)>,
}

/// Limite de taille pour le decodage in-memory des entrees image (50 Mo).
/// Au-dela, on saute la pHash pour eviter d'epuiser la RAM.
pub const PHASH_INMEMORY_MAX: u64 = 50 * 1024 * 1024;

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

/// Callback appele apres chaque entree traitee. Permet de remonter la progression et
/// de verifier l'annulation depuis l'appelant. Retourner false pour interrompre la lecture.
/// Pas de bound Send/Sync : l'iteration est sequentielle dans un seul thread (rayon n'est
/// pas utilise ici), donc le callback est invoque depuis le meme thread que son appelant.
pub type EntryCallback<'a> = &'a dyn Fn() -> bool;

/// Ouvre une archive et retourne la liste de ses entrees avec hash calcule.
/// Les repertoires, liens symboliques et entrees protegees sont filtres silencieusement.
/// Retourne Err silencieusement transforme en Vec vide par l'appelant.
/// Si `compute_phash` est true, calcule en plus le pHash perceptuel des entrees image
/// (in-memory tant que l'entree est <= PHASH_INMEMORY_MAX, sinon pHash=None).
/// `on_entry` est appele apres chaque entree non-filtree avec son nom ; retourner false interrompt.
pub fn hash_archive_entries(
    path: &Path,
    compute_phash: bool,
    on_entry: EntryCallback,
) -> Result<Vec<ArchiveEntry>, String> {
    let format = detect_archive_format(path)
        .ok_or_else(|| format!("format non supporte: {}", path.display()))?;
    match format {
        ArchiveFormat::Zip => zip_reader::hash_zip_entries(path, compute_phash, on_entry),
        ArchiveFormat::TarGz => tar_reader::hash_tar_entries(path, ArchiveFormat::TarGz, compute_phash, on_entry),
        ArchiveFormat::TarBz2 => tar_reader::hash_tar_entries(path, ArchiveFormat::TarBz2, compute_phash, on_entry),
        ArchiveFormat::TarXz => tar_reader::hash_tar_entries(path, ArchiveFormat::TarXz, compute_phash, on_entry),
        ArchiveFormat::TarZst => tar_reader::hash_tar_entries(path, ArchiveFormat::TarZst, compute_phash, on_entry),
        ArchiveFormat::SevenZip => sevenz_reader::hash_sevenz_entries(path, compute_phash, on_entry),
    }
}

/// Compte les entrees d'une archive sans lire leur contenu (rapide pour ZIP).
/// Utilise pour estimer le travail total avant de lancer le hachage.
/// Retourne 0 si l'estimation n'est pas possible (tar, 7z).
/// Hash xxh3 de bytes deja en memoire.
pub fn hash_bytes(bytes: &[u8]) -> u64 {
    let mut hasher = Xxh3::new();
    hasher.update(bytes);
    hasher.digest()
}

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
/// Si `find_similar=true`, calcule en plus le pHash sur les entrees image et marque les paires
/// proches (Hamming <= sim_threshold) avec status="similar" + similarity_score.
pub fn compute_comparison(
    path_a: &str,
    path_b: &str,
    find_similar: bool,
    sim_threshold: u32,
) -> Result<ArchiveComparison, String> {
    // Pour le comparateur, pas de progress ni d'annulation : action ponctuelle utilisateur
    let no_op: EntryCallback = &|| true;
    let entries_a = hash_archive_entries(Path::new(path_a), find_similar, no_op)
        .unwrap_or_default();
    let entries_b = hash_archive_entries(Path::new(path_b), find_similar, no_op)
        .unwrap_or_default();

    use std::collections::HashMap;
    let map_b: HashMap<u64, &ArchiveEntry> = entries_b.iter().map(|e| (e.hash, e)).collect();
    let map_a: HashMap<u64, &ArchiveEntry> = entries_a.iter().map(|e| (e.hash, e)).collect();

    // Phase 1 : appariement exact par xxhash
    let a_entries: Vec<ArchiveEntryResult> = entries_a.iter().map(|e| build_result(e, map_b.get(&e.hash).copied())).collect();
    let b_entries: Vec<ArchiveEntryResult> = entries_b.iter().map(|e| build_result(e, map_a.get(&e.hash).copied())).collect();

    // Phase 2 : appariement similaire par pHash sur les entrees encore "unique"
    let (a_entries, b_entries) = if find_similar {
        upgrade_with_similar(a_entries, &entries_a, b_entries, &entries_b, sim_threshold)
    } else {
        (a_entries, b_entries)
    };

    Ok(ArchiveComparison {
        a: ArchiveDetail { path: path_a.to_string(), entries: a_entries },
        b: ArchiveDetail { path: path_b.to_string(), entries: b_entries },
    })
}

fn build_result(e: &ArchiveEntry, other: Option<&ArchiveEntry>) -> ArchiveEntryResult {
    let hash_hex = format!("{:x}", e.hash);
    if let Some(o) = other {
        ArchiveEntryResult {
            internal_path: e.internal_path.clone(),
            size: e.size,
            status: "duplicate".to_string(),
            duplicate_in: Some(o.internal_path.clone()),
            hash: hash_hex,
            similarity_score: None,
        }
    } else {
        ArchiveEntryResult {
            internal_path: e.internal_path.clone(),
            size: e.size,
            status: "unique".to_string(),
            duplicate_in: None,
            hash: hash_hex,
            similarity_score: None,
        }
    }
}

/// Promeut les entrees "unique" (cote A et B) en "similar" si elles ont un pHash proche.
/// Pairing greedy : chaque entrée unique côté A est appariée à au plus 1 entrée unique côté B
/// (la plus proche dans la limite du seuil). Score = (1 - hamming_fine/64) * 100.
fn upgrade_with_similar(
    mut a_results: Vec<ArchiveEntryResult>,
    a_entries: &[ArchiveEntry],
    mut b_results: Vec<ArchiveEntryResult>,
    b_entries: &[ArchiveEntry],
    sim_threshold: u32,
) -> (Vec<ArchiveEntryResult>, Vec<ArchiveEntryResult>) {
    use crate::scanner::hash::hamming_distance;

    let mut used_b: std::collections::HashSet<usize> = std::collections::HashSet::new();
    for ai in 0..a_results.len() {
        if a_results[ai].status != "unique" { continue; }
        let Some((ac, af)) = a_entries[ai].phash.as_ref() else { continue; };
        let mut best: Option<(usize, u32)> = None;
        for bi in 0..b_results.len() {
            if used_b.contains(&bi) { continue; }
            if b_results[bi].status != "unique" { continue; }
            let Some((bc, bf)) = b_entries[bi].phash.as_ref() else { continue; };
            if hamming_distance(ac, bc) > sim_threshold { continue; }
            let dfine = hamming_distance(af, bf);
            if dfine > sim_threshold { continue; }
            if best.is_none_or(|(_, d)| dfine < d) {
                best = Some((bi, dfine));
            }
        }
        if let Some((bi, dfine)) = best {
            // 64 bits dans le hash fin (hash_size 16x16 / 4 nibbles -> en realite 8x8=64 pour gradient).
            // Le hasher image_hasher::Gradient produit `coarse_size * coarse_size` bits.
            // Pour fine_size=16 → 256 bits ; pour coarse_size=8 → 64 bits. On normalise sur la longueur reelle.
            let total_bits = (b_entries[bi].phash.as_ref().map(|p| p.1.len() * 8).unwrap_or(64)) as f32;
            let score = (1.0 - dfine as f32 / total_bits) * 100.0;
            a_results[ai].status = "similar".to_string();
            a_results[ai].duplicate_in = Some(b_results[bi].internal_path.clone());
            a_results[ai].similarity_score = Some(score);
            b_results[bi].status = "similar".to_string();
            b_results[bi].duplicate_in = Some(a_results[ai].internal_path.clone());
            b_results[bi].similarity_score = Some(score);
            used_b.insert(bi);
        }
    }
    (a_results, b_results)
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
        let entries = hash_archive_entries(zip.path(), false, &|| true).unwrap();
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
        let entries = hash_archive_entries(f.path(), false, &|| true).unwrap();
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
        let entries = hash_archive_entries(f.path(), false, &|| true).unwrap();
        assert_eq!(entries.len(), 2);
    }

    #[test]
    fn hash_zip_contenu_identique_meme_hash() {
        let zip1 = make_zip(&[("a.txt", b"same content")]);
        let zip2 = make_zip(&[("b.txt", b"same content")]);
        let e1 = hash_archive_entries(zip1.path(), false, &|| true).unwrap();
        let e2 = hash_archive_entries(zip2.path(), false, &|| true).unwrap();
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
        let entries = hash_archive_entries(sz.path(), false, &|| true).unwrap();
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
        let e_sz = hash_archive_entries(sz.path(), false, &|| true).unwrap();
        let e_zip = hash_archive_entries(zip.path(), false, &|| true).unwrap();
        assert_eq!(e_sz[0].hash, e_zip[0].hash);
    }

    #[test]
    fn compute_comparison_deux_zips() {
        let zip_a = make_zip(&[("common.txt", b"shared"), ("unique_a.txt", b"only in a")]);
        let zip_b = make_zip(&[("common.txt", b"shared"), ("unique_b.txt", b"only in b")]);
        let cmp = compute_comparison(
            zip_a.path().to_str().unwrap(),
            zip_b.path().to_str().unwrap(),
            false,
            10,
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
