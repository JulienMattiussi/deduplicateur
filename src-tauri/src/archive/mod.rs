// Types publics
pub use types::{ArchiveComparison, ArchiveDetail, ArchiveEntryHash, ArchiveEntryResult};

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

/// Lit les bytes d'une entree donnee d'une archive en memoire. Utilise pour la
/// generation de miniatures a la volee dans le comparateur (pas de stockage persistant).
///
/// Performance :
/// - ZIP : random access par chemin (rapide)
/// - 7z : iteration via for_each_entries jusqu'a la cible
/// - tar.* : decompression sequentielle jusqu'a l'entree cible
pub fn read_archive_entry_bytes(archive_path: &Path, internal_path: &str) -> Result<Vec<u8>, String> {
    let format = detect_archive_format(archive_path)
        .ok_or_else(|| format!("format non supporte: {}", archive_path.display()))?;
    match format {
        ArchiveFormat::Zip => {
            let file = std::fs::File::open(archive_path).map_err(|e| e.to_string())?;
            let mut archive = zip::ZipArchive::new(file).map_err(|e| e.to_string())?;
            let mut entry = archive.by_name(internal_path).map_err(|e| e.to_string())?;
            if entry.is_dir() || entry.encrypted() {
                return Err("entree invalide (dossier ou chiffree)".to_string());
            }
            let mut buf = Vec::with_capacity(entry.size() as usize);
            entry.read_to_end(&mut buf).map_err(|e| e.to_string())?;
            Ok(buf)
        }
        ArchiveFormat::SevenZip => {
            use sevenz_rust2::{ArchiveReader, Password};
            let mut reader = ArchiveReader::open(archive_path, Password::empty())
                .map_err(|e| e.to_string())?;
            let mut found: Option<Vec<u8>> = None;
            reader.for_each_entries(|entry, stream| {
                if found.is_some() { return Ok(false); }
                if entry.is_directory() || !entry.has_stream() { return Ok(true); }
                if entry.name() == internal_path {
                    let mut buf = Vec::with_capacity(entry.size() as usize);
                    if stream.read_to_end(&mut buf).is_err() {
                        return Ok(false);
                    }
                    found = Some(buf);
                    return Ok(false);
                }
                Ok(true)
            }).map_err(|e| e.to_string())?;
            found.ok_or_else(|| "entree introuvable".to_string())
        }
        ArchiveFormat::TarGz => read_tar_entry(archive_path, internal_path, |f| Box::new(flate2::read::GzDecoder::new(f))),
        ArchiveFormat::TarBz2 => read_tar_entry(archive_path, internal_path, |f| Box::new(bzip2::read::BzDecoder::new(f))),
        ArchiveFormat::TarXz => read_tar_entry(archive_path, internal_path, |f| Box::new(xz2::read::XzDecoder::new(f))),
        ArchiveFormat::TarZst => {
            let file = std::fs::File::open(archive_path).map_err(|e| e.to_string())?;
            let zst = zstd::Decoder::new(file).map_err(|e| e.to_string())?;
            read_tar_entry_inner(tar::Archive::new(zst), internal_path)
        }
    }
}

fn read_tar_entry(
    archive_path: &Path,
    internal_path: &str,
    decoder: impl FnOnce(std::fs::File) -> Box<dyn Read>,
) -> Result<Vec<u8>, String> {
    let file = std::fs::File::open(archive_path).map_err(|e| e.to_string())?;
    let stream = decoder(file);
    read_tar_entry_inner(tar::Archive::new(stream), internal_path)
}

fn read_tar_entry_inner<R: Read>(mut archive: tar::Archive<R>, internal_path: &str) -> Result<Vec<u8>, String> {
    for entry in archive.entries().map_err(|e| e.to_string())? {
        let mut entry = match entry {
            Ok(e) => e,
            Err(_) => continue,
        };
        let path = match entry.path() {
            Ok(p) => p.to_string_lossy().to_string(),
            Err(_) => continue,
        };
        if path == internal_path {
            let size = entry.header().size().unwrap_or(0);
            let mut buf = Vec::with_capacity(size as usize);
            entry.read_to_end(&mut buf).map_err(|e| e.to_string())?;
            return Ok(buf);
        }
    }
    Err("entree introuvable".to_string())
}

/// Compte les entrees image d'une archive en lisant uniquement ses headers.
/// Utilise pour estimer le travail de la phase pHash archives upfront, afin que
/// `total_work` du scanner inclue cette phase et que la barre de progression
/// avance de maniere monotone et fiable.
///
/// - ZIP/7z : count exact via central directory / table d'entrees (rapide)
/// - tar.* : approximation = `count_entries_fast / 3` (fraction typique d'images)
///   pour eviter de decompresser le flux entier
pub fn count_archive_image_entries(path: &Path) -> usize {
    use crate::scanner::hash::is_image_path;
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
                    if !entry.is_dir() && !entry.encrypted() && is_image_path(entry.name()) {
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
                if !entry.is_directory() && entry.has_stream() && is_image_path(entry.name()) {
                    n += 1;
                }
                Ok(true)
            });
            n
        }
        // tar.* : decompresser pour compter precisement serait prohibitif. Heuristique :
        // un tiers des entrees sont des images. Conservateur sans surdimensionner.
        _ => count_entries_fast(path) / 3,
    }
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

/// Re-ouvre les archives manquantes du cache pour calculer leurs entrees + hashes.
/// Utilise pour les sessions creees avant l'introduction du cache d'entrees.
/// Modifie `entries_cache` en place pour y ajouter les archives nouvellement hashees.
pub fn ensure_cache_for_groups(
    groups: &[crate::scanner::ArchiveGroupResult],
    entries_cache: &mut std::collections::HashMap<String, Vec<ArchiveEntryHash>>,
) {
    let no_op: EntryCallback = &|| true;
    for group in groups {
        for arch in &group.archives {
            if entries_cache.contains_key(&arch.path) { continue; }
            if !std::path::Path::new(&arch.path).exists() { continue; }
            let entries = hash_archive_entries(std::path::Path::new(&arch.path), true, no_op)
                .unwrap_or_default();
            let entries_hash: Vec<ArchiveEntryHash> = entries.into_iter()
                .map(|e| ArchiveEntryHash {
                    internal_path: e.internal_path,
                    size: e.size,
                    xxh3_hex: format!("{:x}", e.hash),
                    phash_coarse: e.phash.as_ref().map(|p| p.0.clone()),
                    phash_fine: e.phash.map(|p| p.1),
                })
                .collect();
            entries_cache.insert(arch.path.clone(), entries_hash);
        }
    }
}

/// Recalcule `duplicated_entries` et `can_delete` pour chaque archive d'un groupe
/// en utilisant le cache (xxh3 + pHash). Une entree est consideree dupliquee si elle
/// matche au moins une entree dans une autre archive du meme groupe (xxh3 identique
/// ou pHash dans le seuil de Hamming).
///
/// Necessaire pour deux raisons :
/// 1. Sessions creees avant que Phase 2 (similaires) compte les similaires dans
///    `duplicated_entries` : la GroupCard affichait 61/90 au lieu de 90/90.
/// 2. Coherence : le comparateur (lazy) refait son propre matching, on s'assure que
///    le compteur affiche est exactement ce que verra l'utilisateur dans le comparateur.
pub fn recompute_group_duplicated_entries(
    groups: &mut [crate::scanner::ArchiveGroupResult],
    entries_cache: &std::collections::HashMap<String, Vec<ArchiveEntryHash>>,
    sim_threshold: u32,
) {
    use crate::scanner::hash::hamming_distance;
    for group in groups.iter_mut() {
        for arch_idx in 0..group.archives.len() {
            let my_path = group.archives[arch_idx].path.clone();
            let my_entries = match entries_cache.get(&my_path) {
                Some(e) => e,
                None => continue,  // pas de cache : laisse le compteur tel quel
            };
            let mut matched: std::collections::HashSet<usize> = std::collections::HashSet::new();
            for other_idx in 0..group.archives.len() {
                if other_idx == arch_idx { continue; }
                let other_entries = match entries_cache.get(&group.archives[other_idx].path) {
                    Some(e) => e,
                    None => continue,
                };
                for (my_idx, my_e) in my_entries.iter().enumerate() {
                    if matched.contains(&my_idx) { continue; }
                    // Match xxh3 exact
                    if other_entries.iter().any(|o| o.xxh3_hex == my_e.xxh3_hex) {
                        matched.insert(my_idx);
                        continue;
                    }
                    // Match pHash similar
                    if let (Some(mc), Some(mf)) = (&my_e.phash_coarse, &my_e.phash_fine) {
                        for o in other_entries {
                            if let (Some(oc), Some(of)) = (&o.phash_coarse, &o.phash_fine) {
                                if hamming_distance(mc, oc) <= sim_threshold
                                    && hamming_distance(mf, of) <= sim_threshold
                                {
                                    matched.insert(my_idx);
                                    break;
                                }
                            }
                        }
                    }
                }
            }
            let dup_count = matched.len();
            let total = group.archives[arch_idx].total_entries;
            group.archives[arch_idx].duplicated_entries = dup_count;
            group.archives[arch_idx].can_delete = total > 0 && dup_count == total;
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
    fn read_archive_entry_bytes_zip_retourne_contenu() {
        let zip = make_zip(&[("a.txt", b"hello world"), ("b.txt", b"another")]);
        let bytes = read_archive_entry_bytes(zip.path(), "a.txt").unwrap();
        assert_eq!(bytes, b"hello world");
        let bytes_b = read_archive_entry_bytes(zip.path(), "b.txt").unwrap();
        assert_eq!(bytes_b, b"another");
    }

    #[test]
    fn read_archive_entry_bytes_zip_entree_inexistante_donne_erreur() {
        let zip = make_zip(&[("a.txt", b"hello")]);
        assert!(read_archive_entry_bytes(zip.path(), "missing.txt").is_err());
    }

    #[test]
    fn read_archive_entry_bytes_sevenz_retourne_contenu() {
        let sz = make_sevenz(&[("a.txt", b"sevenz content"), ("b.txt", b"second")]);
        let bytes = read_archive_entry_bytes(sz.path(), "a.txt").unwrap();
        assert_eq!(bytes, b"sevenz content");
    }

    #[test]
    fn recompute_corrige_compteur_obsolete_avec_similaires() {
        use crate::scanner::{ArchiveGroupResult, ArchiveInGroup};
        use std::collections::HashMap;

        // Cache simulant 2 archives de 2 entrees : 1 paire xxh3 identique + 1 paire pHash proche
        let mut cache: HashMap<String, Vec<ArchiveEntryHash>> = HashMap::new();
        cache.insert("/a.zip".to_string(), vec![
            ArchiveEntryHash {
                internal_path: "exact.txt".to_string(),
                size: 10,
                xxh3_hex: "deadbeef".to_string(),
                phash_coarse: None,
                phash_fine: None,
            },
            ArchiveEntryHash {
                internal_path: "img.png".to_string(),
                size: 1000,
                xxh3_hex: "111".to_string(),
                phash_coarse: Some(vec![0u8; 8]),
                phash_fine: Some(vec![0u8; 32]),
            },
        ]);
        cache.insert("/b.zip".to_string(), vec![
            ArchiveEntryHash {
                internal_path: "exact.txt".to_string(),
                size: 10,
                xxh3_hex: "deadbeef".to_string(),
                phash_coarse: None,
                phash_fine: None,
            },
            ArchiveEntryHash {
                internal_path: "img2.png".to_string(),
                size: 1100,
                xxh3_hex: "222".to_string(),
                phash_coarse: Some(vec![0u8; 8]),
                phash_fine: Some(vec![0u8; 32]),  // pHash identique a img.png
            },
        ]);

        // Groupe avec compteur obsolete : 1 (seulement les exacts) au lieu de 2 (exacts + similaires)
        let mut groups = vec![ArchiveGroupResult {
            id: "g1".to_string(),
            archives: vec![
                ArchiveInGroup {
                    path: "/a.zip".to_string(), size: 0, modified: 0,
                    total_entries: 2, duplicated_entries: 1, can_delete: false, wasted_bytes: 0,
                },
                ArchiveInGroup {
                    path: "/b.zip".to_string(), size: 0, modified: 0,
                    total_entries: 2, duplicated_entries: 1, can_delete: false, wasted_bytes: 0,
                },
            ],
            shared_entry_count: 1,
        }];

        recompute_group_duplicated_entries(&mut groups, &cache, 10);

        // Apres recompute : 2 entrees matchees (1 exacte + 1 similaire) sur 2 totales
        assert_eq!(groups[0].archives[0].duplicated_entries, 2);
        assert_eq!(groups[0].archives[1].duplicated_entries, 2);
        assert!(groups[0].archives[0].can_delete);
        assert!(groups[0].archives[1].can_delete);
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
