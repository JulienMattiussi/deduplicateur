//! Detection du format d'archive : par extension, puis verification des magic
//! bytes pour eviter les fichiers menteurs (ex. `.cbz` contenant en realite du
//! RAR). Cf. AGENTS.md "Detection de format : extension + magic bytes, jamais
//! l'extension seule".

use super::ArchiveFormat;
use std::io::{Read, Seek, SeekFrom};
use std::path::Path;

/// Detecte le format d'archive selon l'extension du nom de fichier (insensible a la casse).
/// Retourne None pour les formats non supportes (RAR, CAB, ISO, etc.).
///
/// Variantes ZIP supportees : `.zip`, `.cbz` (Comic Book ZIP), `.jar` / `.war` / `.ear`
/// (Java archives), `.apk` (Android), `.ipa` (iOS). Toutes structurellement identiques au
/// ZIP, le `zip` crate les lit directement.
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
    } else if name.ends_with(".tar") {
        Some(ArchiveFormat::Tar)
    } else if name.ends_with(".zip")
        || name.ends_with(".cbz")
        || name.ends_with(".jar")
        || name.ends_with(".war")
        || name.ends_with(".ear")
        || name.ends_with(".apk")
        || name.ends_with(".ipa")
    {
        Some(ArchiveFormat::Zip)
    } else if name.ends_with(".7z") {
        Some(ArchiveFormat::SevenZip)
    } else {
        None
    }
}

/// Verifie que les premiers octets du fichier correspondent au magic number du format
/// annonce par l'extension. Protege contre les fichiers "menteurs" (ex. `.cbz` contenant
/// du RAR) qui font boucler ou bloquer les decoders quand on les leur soumet.
///
/// Magic numbers utilises :
/// - ZIP : `50 4B 03 04` (entree locale), `50 4B 05 06` (ZIP vide / EOCD), `50 4B 07 08` (spanned).
/// - 7z : `37 7A BC AF 27 1C`.
/// - gzip (tar.gz) : `1F 8B`.
/// - bzip2 (tar.bz2) : `42 5A 68` (`BZh`).
/// - xz (tar.xz) : `FD 37 7A 58 5A 00`.
/// - zstd (tar.zst) : `28 B5 2F FD`.
/// - tar (.tar) : `ustar` a l'offset 257 (header POSIX). Les archives V7 historiques
///   (sans signature `ustar`) sont rejetees ici - acceptable, elles sont rares et le risque
///   d'un faux positif est plus eleve que la perte de couverture.
///
/// En cas d'erreur d'ouverture ou de lecture, retourne true (on prefere laisser
/// passer le fichier au decoder qui echouera proprement plutot que de causer une
/// fausse exclusion sur une I/O transitoire). En revanche, un fichier qui s'ouvre
/// mais ne contient pas assez d'octets pour le magic du format demande est rejete :
/// il ne peut structurellement pas etre une archive valide.
pub fn verify_archive_magic(path: &Path, format: &ArchiveFormat) -> bool {
    let mut file = match std::fs::File::open(path) {
        Ok(f) => f,
        Err(_) => return true,
    };
    let mut head = [0u8; 6];
    let n = match file.read(&mut head) {
        Ok(n) => n,
        Err(_) => return true,
    };
    match format {
        ArchiveFormat::Zip => {
            if n < 4 { return false; }
            head[0] == 0x50 && head[1] == 0x4B
                && ((head[2] == 0x03 && head[3] == 0x04)
                    || (head[2] == 0x05 && head[3] == 0x06)
                    || (head[2] == 0x07 && head[3] == 0x08))
        }
        ArchiveFormat::SevenZip => {
            n >= 6
                && head[0] == 0x37 && head[1] == 0x7A && head[2] == 0xBC
                && head[3] == 0xAF && head[4] == 0x27 && head[5] == 0x1C
        }
        ArchiveFormat::TarGz => n >= 2 && head[0] == 0x1F && head[1] == 0x8B,
        ArchiveFormat::TarBz2 => n >= 3 && head[0] == 0x42 && head[1] == 0x5A && head[2] == 0x68,
        ArchiveFormat::TarXz => {
            n >= 6
                && head[0] == 0xFD && head[1] == 0x37 && head[2] == 0x7A
                && head[3] == 0x58 && head[4] == 0x5A && head[5] == 0x00
        }
        ArchiveFormat::TarZst => {
            n >= 4 && head[0] == 0x28 && head[1] == 0xB5 && head[2] == 0x2F && head[3] == 0xFD
        }
        ArchiveFormat::Tar => {
            // Header tar : signature "ustar" a l'offset 257 (POSIX). Les fichiers V7
            // historiques sans signature sont rares et rejetes ici par precaution.
            if file.seek(SeekFrom::Start(257)).is_err() { return true; }
            let mut sig = [0u8; 5];
            match file.read(&mut sig) {
                Ok(5) => &sig == b"ustar",
                _ => false,
            }
        }
    }
}

/// Variante de `detect_archive_format` qui verifie en plus que le contenu du fichier
/// correspond bien au format annonce par l'extension. Indispensable pour la phase
/// archives : un `.cbz` contenant du RAR fait scanner le crate `zip` a la recherche
/// d'une signature EOCD inexistante, et certains decoders (`zip`, `sevenz-rust2`) peuvent
/// boucler ou mettre tres longtemps a echouer sur des octets non conformes. Cout : 1
/// ouverture + lecture de quelques octets par fichier.
pub fn detect_archive_format_verified(path: &Path) -> Option<ArchiveFormat> {
    let format = detect_archive_format(path)?;
    if verify_archive_magic(path, &format) { Some(format) } else { None }
}
