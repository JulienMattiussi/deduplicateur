// Types publics
pub use types::{ArchiveComparison, ArchiveDetail, ArchiveEntryHash, ArchiveEntryResult};

// Sous-modules eclates pour garder mod.rs sous une taille raisonnable :
// - detect : detect_archive_format, verify_archive_magic, detect_archive_format_verified
// - count : count_entries_fast et variantes filtered + count_and_estimate_*
// - compare : compute_comparison, ensure_cache_for_groups, recompute_group_duplicated_entries
// Les fonctions de hash brut (hash_reader, hash_bytes, hash_archive_entries,
// read_archive_entry_bytes) restent ici car elles sont le coeur dispatcher
// entre les readers format-specifiques (zip_reader, tar_reader, sevenz_reader).
pub use compare::{compute_comparison, ensure_cache_for_groups, recompute_group_duplicated_entries};
pub use count::{
    count_and_estimate_archive_audio_entries,
    count_and_estimate_archive_image_entries, count_entries_fast,
};
pub use detect::{detect_archive_format, detect_archive_format_verified};
// Re-exports utilises uniquement par les tests de ce module (cf. mod tests en bas).
// Ne pas retirer sans aussi changer le `use super::*;` des tests.
#[cfg(test)]
pub use count::{count_and_estimate_archive_entries_filtered, count_archive_entries_filtered};
#[cfg(test)]
pub use detect::verify_archive_magic;

mod compare;
mod count;
mod detect;
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
    /// Format ZIP et tous ses derives techniques (CBZ, JAR, WAR, EAR, APK, IPA, ODT/ODS,
    /// EPUB, etc.) qui sont structurellement des ZIP avec une extension specialisee.
    Zip,
    /// Tar non compresse.
    Tar,
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

// detect_archive_format / verify_archive_magic / detect_archive_format_verified :
// cf. archive/detect.rs (re-exportes au niveau de ce module).

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
        ArchiveFormat::Tar => tar_reader::hash_tar_entries(path, ArchiveFormat::Tar, compute_phash, on_entry),
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
        ArchiveFormat::Tar => read_tar_entry(archive_path, internal_path, |f| Box::new(f)),
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

// count_and_estimate_archive_* / count_archive_entries_filtered / count_entries_fast :
// cf. archive/count.rs (re-exportes au niveau de ce module).
//
// compute_comparison / ensure_cache_for_groups / recompute_group_duplicated_entries :
// cf. archive/compare.rs (re-exportes au niveau de ce module).

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
    fn detect_jar_war_ear_apk_ipa_comme_zip() {
        // Toutes ces extensions sont structurellement des ZIP, le crate `zip` les lit.
        assert_eq!(detect_archive_format(Path::new("app.jar")), Some(ArchiveFormat::Zip));
        assert_eq!(detect_archive_format(Path::new("WEBAPP.WAR")), Some(ArchiveFormat::Zip));
        assert_eq!(detect_archive_format(Path::new("module.ear")), Some(ArchiveFormat::Zip));
        assert_eq!(detect_archive_format(Path::new("game.apk")), Some(ArchiveFormat::Zip));
        assert_eq!(detect_archive_format(Path::new("app.ipa")), Some(ArchiveFormat::Zip));
    }

    #[test]
    fn detect_tar_non_compresse() {
        assert_eq!(detect_archive_format(Path::new("backup.tar")), Some(ArchiveFormat::Tar));
        assert_eq!(detect_archive_format(Path::new("ARCHIVE.TAR")), Some(ArchiveFormat::Tar));
    }

    #[test]
    fn detect_inconnu_retourne_none() {
        assert_eq!(detect_archive_format(Path::new("file.txt")), None);
        assert_eq!(detect_archive_format(Path::new("noext")), None);
    }

    // Helper : ecrit `bytes` dans un fichier temporaire avec le suffixe demande.
    fn write_temp(suffix: &str, bytes: &[u8]) -> NamedTempFile {
        let mut f = NamedTempFile::with_suffix(suffix).unwrap();
        f.write_all(bytes).unwrap();
        f.flush().unwrap();
        f
    }

    #[test]
    fn verify_magic_zip_valide_accepte() {
        let zip = make_zip(&[("a.txt", b"x")]);
        assert!(verify_archive_magic(zip.path(), &ArchiveFormat::Zip));
    }

    #[test]
    fn verify_magic_cbz_contenant_rar_rejete() {
        // RAR 4.x magic : 52 61 72 21 1A 07 00 ("Rar!\x1A\x07\x00").
        let rar_bytes = b"Rar!\x1A\x07\x00\x00\x00\x00\x00\x00\x00";
        let f = write_temp(".cbz", rar_bytes);
        // detect_archive_format dit "ZIP" sur l'extension, mais le contenu n'est pas un ZIP.
        assert_eq!(detect_archive_format(f.path()), Some(ArchiveFormat::Zip));
        assert!(!verify_archive_magic(f.path(), &ArchiveFormat::Zip));
        // detect_archive_format_verified doit donc retourner None.
        assert_eq!(detect_archive_format_verified(f.path()), None);
    }

    #[test]
    fn verify_magic_cbz_zip_valide_accepte_par_verified() {
        let zip = make_zip(&[("p.png", b"\x89PNG")]);
        // Renommer en .cbz : ZipArchive::new ne lit que les bytes, pas le nom.
        let cbz_path = zip.path().with_extension("cbz");
        std::fs::copy(zip.path(), &cbz_path).unwrap();
        assert_eq!(
            detect_archive_format_verified(&cbz_path),
            Some(ArchiveFormat::Zip)
        );
        let _ = std::fs::remove_file(&cbz_path);
    }

    #[test]
    fn verify_magic_fichier_tres_court_rejete() {
        let f = write_temp(".zip", b"PK"); // 2 octets : signature ZIP incomplete
        assert!(!verify_archive_magic(f.path(), &ArchiveFormat::Zip));
        assert_eq!(detect_archive_format_verified(f.path()), None);
    }

    #[test]
    fn verify_magic_7z_valide_accepte() {
        let bytes = b"\x37\x7A\xBC\xAF\x27\x1C\x00\x04";
        let f = write_temp(".7z", bytes);
        assert!(verify_archive_magic(f.path(), &ArchiveFormat::SevenZip));
    }

    #[test]
    fn verify_magic_7z_avec_octets_zip_rejete() {
        let bytes = b"PK\x03\x04ZIPGARB";
        let f = write_temp(".7z", bytes);
        assert!(!verify_archive_magic(f.path(), &ArchiveFormat::SevenZip));
        assert_eq!(detect_archive_format_verified(f.path()), None);
    }

    #[test]
    fn verify_magic_targz_valide_accepte() {
        // gzip : 1F 8B
        let f = write_temp(".tar.gz", b"\x1F\x8B\x08\x00xxxx");
        assert!(verify_archive_magic(f.path(), &ArchiveFormat::TarGz));
    }

    #[test]
    fn verify_magic_targz_mauvais_magic_rejete() {
        let f = write_temp(".tar.gz", b"NOTGZIP");
        assert!(!verify_archive_magic(f.path(), &ArchiveFormat::TarGz));
        assert_eq!(detect_archive_format_verified(f.path()), None);
    }

    #[test]
    fn verify_magic_tarbz2_valide_accepte() {
        let f = write_temp(".tar.bz2", b"BZh9blahblah");
        assert!(verify_archive_magic(f.path(), &ArchiveFormat::TarBz2));
    }

    #[test]
    fn verify_magic_tarxz_valide_accepte() {
        let f = write_temp(".tar.xz", b"\xFD\x37\x7A\x58\x5A\x00\x00\x04");
        assert!(verify_archive_magic(f.path(), &ArchiveFormat::TarXz));
    }

    #[test]
    fn verify_magic_tarzst_valide_accepte() {
        let f = write_temp(".tar.zst", b"\x28\xB5\x2F\xFD\x04");
        assert!(verify_archive_magic(f.path(), &ArchiveFormat::TarZst));
    }

    #[test]
    fn verify_magic_tar_ustar_accepte() {
        // 257 octets de zeros puis "ustar".
        let mut bytes = vec![0u8; 257];
        bytes.extend_from_slice(b"ustar\x00");
        bytes.extend(std::iter::repeat(0u8).take(50));
        let f = write_temp(".tar", &bytes);
        assert!(verify_archive_magic(f.path(), &ArchiveFormat::Tar));
    }

    #[test]
    fn verify_magic_tar_sans_signature_rejete() {
        // Fichier trop court pour avoir l'offset 257.
        let f = write_temp(".tar", b"random short bytes");
        assert!(!verify_archive_magic(f.path(), &ArchiveFormat::Tar));
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
    fn count_archive_audio_entries_zip_compte_que_les_audios() {
        let zip = make_zip(&[
            ("readme.txt", b"plain text"),
            ("song.mp3", b"fake mp3 content"),
            ("track.flac", b"fake flac content"),
            ("photo.jpg", b"fake jpg content"),
        ]);
        let (n_audio, _) = count_and_estimate_archive_audio_entries(zip.path());
        assert_eq!(n_audio, 2, "doit compter mp3 + flac uniquement");
        let (n_image, _) = count_and_estimate_archive_image_entries(zip.path());
        assert_eq!(n_image, 1, "doit compter jpg uniquement");
    }

    #[test]
    fn count_and_estimate_zip_renvoie_taille_decompressee_des_entrees_filtrees() {
        // Le ZIP est non compresse (les contenus servent de taille decompressee).
        // bytes_image doit sommer la taille des seuls .jpg, pas du reste.
        let zip = make_zip(&[
            ("readme.txt", b"plain text 12345"),  // 16 bytes, filtre
            ("photo1.jpg", b"fake jpg one"),       // 12 bytes
            ("photo2.jpg", b"fake jpg two long content"),  // 25 bytes
        ]);
        let (n, bytes) = count_and_estimate_archive_image_entries(zip.path());
        assert_eq!(n, 2);
        assert_eq!(bytes, 12 + 25, "doit sommer la taille decompressee des seules images");
    }

    #[test]
    fn count_archive_entries_filtered_predicat_arbitraire() {
        let zip = make_zip(&[
            ("a.txt", b"a"),
            ("b.txt", b"b"),
            ("c.md",  b"c"),
        ]);
        let txt_count = count_archive_entries_filtered(zip.path(), |name| name.ends_with(".txt"));
        let md_count = count_archive_entries_filtered(zip.path(), |name| name.ends_with(".md"));
        assert_eq!(txt_count, 2);
        assert_eq!(md_count, 1);
    }

    #[test]
    fn recompute_detecte_match_audio_via_fingerprint() {
        use crate::scanner::{ArchiveGroupResult, ArchiveInGroup};
        use std::collections::HashMap;

        // Cache simulant 2 archives avec un fichier audio chacune au fingerprint identique
        // (mais xxh3 different : compresse differemment ou metadata differentes).
        let fp = vec![100i32, 200, 300, 400];
        let mut cache: HashMap<String, Vec<ArchiveEntryHash>> = HashMap::new();
        cache.insert("/a.zip".to_string(), vec![
            ArchiveEntryHash {
                internal_path: "song.mp3".to_string(),
                size: 5000,
                xxh3_hex: "aaa".to_string(),
                phash_coarse: None,
                phash_fine: None,
                audio_fingerprint: Some(fp.clone()),
                audio_duration_secs: Some(180.0),
            },
        ]);
        cache.insert("/b.zip".to_string(), vec![
            ArchiveEntryHash {
                internal_path: "song.mp3".to_string(),
                size: 5100,
                xxh3_hex: "bbb".to_string(),
                phash_coarse: None,
                phash_fine: None,
                audio_fingerprint: Some(fp.clone()),  // identique => distance 0
                audio_duration_secs: Some(180.5),  // tolerance large
            },
        ]);

        let mut groups = vec![ArchiveGroupResult {
            id: "g".to_string(),
            archives: vec![
                ArchiveInGroup {
                    path: "/a.zip".to_string(), size: 0, modified: 0,
                    total_entries: 1, duplicated_entries: 0, can_delete: false, wasted_bytes: 0,
                },
                ArchiveInGroup {
                    path: "/b.zip".to_string(), size: 0, modified: 0,
                    total_entries: 1, duplicated_entries: 0, can_delete: false, wasted_bytes: 0,
                },
            ],
            shared_entry_count: 0,
        }];

        recompute_group_duplicated_entries(&mut groups, &cache, 10, 20, 0.20);
        assert_eq!(groups[0].archives[0].duplicated_entries, 1, "audio fingerprint identique = match");
        assert_eq!(groups[0].archives[1].duplicated_entries, 1);
        assert!(groups[0].archives[0].can_delete);
        assert!(groups[0].archives[1].can_delete);
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
                audio_fingerprint: None,
                audio_duration_secs: None,
            },
            ArchiveEntryHash {
                internal_path: "img.png".to_string(),
                size: 1000,
                xxh3_hex: "111".to_string(),
                phash_coarse: Some(vec![0u8; 8]),
                phash_fine: Some(vec![0u8; 32]),
                audio_fingerprint: None,
                audio_duration_secs: None,
            },
        ]);
        cache.insert("/b.zip".to_string(), vec![
            ArchiveEntryHash {
                internal_path: "exact.txt".to_string(),
                size: 10,
                xxh3_hex: "deadbeef".to_string(),
                phash_coarse: None,
                phash_fine: None,
                audio_fingerprint: None,
                audio_duration_secs: None,
            },
            ArchiveEntryHash {
                internal_path: "img2.png".to_string(),
                size: 1100,
                xxh3_hex: "222".to_string(),
                phash_coarse: Some(vec![0u8; 8]),
                phash_fine: Some(vec![0u8; 32]),  // pHash identique a img.png
                audio_fingerprint: None,
                audio_duration_secs: None,
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

        recompute_group_duplicated_entries(&mut groups, &cache, 10, 20, 0.20);

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
