use std::fs::File;
use std::io::Read;

use image::DynamicImage;
use image_hasher::{HasherConfig, HashAlg};
use xxhash_rust::xxh3::Xxh3;

use super::types::ImageData;

/// Lit les dimensions PNG en parsant l'en-tete IHDR (24 premiers octets).
fn read_png_dimensions(buf: &[u8]) -> Option<(u32, u32)> {
    if buf.len() < 24 { return None; }
    if &buf[0..8] != b"\x89PNG\r\n\x1a\n" { return None; }
    let w = u32::from_be_bytes([buf[16], buf[17], buf[18], buf[19]]);
    let h = u32::from_be_bytes([buf[20], buf[21], buf[22], buf[23]]);
    Some((w, h))
}

/// Lit les dimensions JPEG en scannant les marqueurs jusqu'au premier marqueur SOF.
fn read_jpeg_dimensions(buf: &[u8]) -> Option<(u32, u32)> {
    if buf.len() < 4 || buf[0] != 0xFF || buf[1] != 0xD8 { return None; }
    let mut i = 2usize;
    while i + 1 < buf.len() {
        if buf[i] != 0xFF { return None; }
        let marker = buf[i + 1];
        if matches!(marker, 0xD9 | 0xDA) { return None; } // EOI / SOS
        // Marqueurs SOF (pas DHT=C4, JPG=C8, DAC=CC)
        if matches!(marker, 0xC0..=0xC3 | 0xC5..=0xC7 | 0xC9..=0xCB | 0xCD..=0xCF) {
            if i + 8 >= buf.len() { return None; }
            let h = u16::from_be_bytes([buf[i + 5], buf[i + 6]]) as u32;
            let w = u16::from_be_bytes([buf[i + 7], buf[i + 8]]) as u32;
            return Some((w, h));
        }
        // Marqueurs sans payload (RSTn, TEM...)
        if matches!(marker, 0x01 | 0xD0..=0xD8) { i += 2; continue; }
        if i + 3 >= buf.len() { return None; }
        let seg_len = u16::from_be_bytes([buf[i + 2], buf[i + 3]]) as usize;
        if seg_len < 2 { return None; }
        i += 2 + seg_len;
    }
    None
}

pub const PARTIAL_SIZE: usize = 4 * 1024;
pub const CHUNK_SIZE: usize = 64 * 1024;

pub fn hash_partial(path: &str) -> Result<String, std::io::Error> {
    let mut file = File::open(path)?;
    let mut buf = vec![0u8; PARTIAL_SIZE];
    let n = file.read(&mut buf)?;
    let mut hasher = Xxh3::new();
    hasher.update(&buf[..n]);
    Ok(format!("{:016x}", hasher.digest()))
}

pub fn hash_full(path: &str) -> Result<String, std::io::Error> {
    let mut file = File::open(path)?;
    let mut hasher = Xxh3::new();
    let mut buf = vec![0u8; CHUNK_SIZE];
    loop {
        let n = file.read(&mut buf)?;
        if n == 0 {
            break;
        }
        hasher.update(&buf[..n]);
    }
    Ok(format!("{:016x}", hasher.digest()))
}

/// Lit uniquement les dimensions d'une image (PNG ou JPEG) en lisant au plus 64 Ko de l'en-tete.
/// Retourne None pour les formats non reconnus (WebP, TIFF...) - le filtre d'aspect est alors ignore.
pub fn get_image_dimensions(path: &str) -> Option<(u32, u32)> {
    const BUF: usize = 65536;
    let mut f = File::open(path).ok()?;
    let mut buf = vec![0u8; BUF];
    let n = f.read(&mut buf).ok()?;
    let buf = &buf[..n];
    read_png_dimensions(buf).or_else(|| read_jpeg_dimensions(buf))
}

// --- Extraction du thumbnail EXIF (1.2 + 1.3) ---

fn read_u16_tiff(data: &[u8], off: usize, le: bool) -> Option<u16> {
    if off + 2 > data.len() { return None; }
    let b = [data[off], data[off + 1]];
    Some(if le { u16::from_le_bytes(b) } else { u16::from_be_bytes(b) })
}

fn read_u32_tiff(data: &[u8], off: usize, le: bool) -> Option<u32> {
    if off + 4 > data.len() { return None; }
    let b = [data[off], data[off + 1], data[off + 2], data[off + 3]];
    Some(if le { u32::from_le_bytes(b) } else { u32::from_be_bytes(b) })
}

/// Extrait les bytes JPEG du thumbnail embede dans le segment APP1 EXIF d'un JPEG.
/// Retourne None si le fichier n'est pas JPEG, n'a pas d'EXIF, ou n'a pas de thumbnail en IFD1.
fn try_extract_exif_thumbnail(path: &str) -> Option<Vec<u8>> {
    const MAX_READ: usize = 131_072; // 128 Ko : suffisant pour le header EXIF + petit thumbnail
    let mut f = File::open(path).ok()?;
    let mut buf = vec![0u8; MAX_READ];
    let n = f.read(&mut buf).ok()?;
    let buf = &buf[..n];

    // Verifier magic JPEG
    if buf.len() < 4 || buf[0] != 0xFF || buf[1] != 0xD8 { return None; }

    // Scanner les segments pour trouver APP1 avec "Exif\0\0"
    let mut i = 2usize;
    let tiff_data: &[u8] = loop {
        if i + 3 >= buf.len() { return None; }
        if buf[i] != 0xFF { return None; }
        let marker = buf[i + 1];
        if marker == 0xDA { return None; } // SOS : fin des headers

        // Marqueurs sans payload
        if matches!(marker, 0x01 | 0xD0..=0xD8) { i += 2; continue; }

        let seg_len = u16::from_be_bytes([buf[i + 2], buf[i + 3]]) as usize;
        if seg_len < 2 { return None; }
        let data_start = i + 4;
        let data_end = (data_start + seg_len - 2).min(buf.len());

        if marker == 0xE1 && data_end > data_start + 6 {
            let seg = &buf[data_start..data_end];
            if &seg[..6] == b"Exif\0\0" {
                break &seg[6..]; // debut du bloc TIFF
            }
        }
        i += 2 + seg_len;
    };

    // Parser le header TIFF
    if tiff_data.len() < 8 { return None; }
    let le = match &tiff_data[0..2] {
        b"II" => true,
        b"MM" => false,
        _ => return None,
    };
    if read_u16_tiff(tiff_data, 2, le)? != 42 { return None; } // magic TIFF

    // Offset IFD0
    let ifd0_off = read_u32_tiff(tiff_data, 4, le)? as usize;
    if ifd0_off + 2 > tiff_data.len() { return None; }

    // Compter les entrees IFD0 pour trouver l'offset IFD1
    let ifd0_count = read_u16_tiff(tiff_data, ifd0_off, le)? as usize;
    let ifd1_ptr = ifd0_off + 2 + ifd0_count * 12;
    if ifd1_ptr + 4 > tiff_data.len() { return None; }

    let ifd1_off = read_u32_tiff(tiff_data, ifd1_ptr, le)? as usize;
    if ifd1_off == 0 || ifd1_off + 2 > tiff_data.len() { return None; }

    // Parser IFD1 pour trouver JPEGInterchangeFormat (0x0201) et JPEGInterchangeFormatLength (0x0202)
    let ifd1_count = read_u16_tiff(tiff_data, ifd1_off, le)? as usize;
    let mut thumb_off: Option<usize> = None;
    let mut thumb_len: Option<usize> = None;

    for k in 0..ifd1_count {
        let e = ifd1_off + 2 + k * 12;
        if e + 12 > tiff_data.len() { break; }
        let tag = read_u16_tiff(tiff_data, e, le)?;
        match tag {
            0x0201 => { thumb_off = Some(read_u32_tiff(tiff_data, e + 8, le)? as usize); }
            0x0202 => { thumb_len = Some(read_u32_tiff(tiff_data, e + 8, le)? as usize); }
            _ => {}
        }
    }

    let off = thumb_off?;
    let len = thumb_len?;
    if len == 0 || off + len > tiff_data.len() { return None; }

    Some(tiff_data[off..off + len].to_vec())
}

/// Calcule les hash grossier et fin depuis une image deja decodee.
pub fn compute_hashes_from_image(img: &DynamicImage, coarse_size: u32, fine_size: u32) -> Option<(Vec<u8>, Vec<u8>)> {
    let coarse_hasher = HasherConfig::new()
        .hash_alg(HashAlg::Gradient)
        .hash_size(coarse_size, coarse_size)
        .to_hasher();
    let fine_hasher = HasherConfig::new()
        .hash_alg(HashAlg::Gradient)
        .hash_size(fine_size, fine_size)
        .to_hasher();
    let coarse = coarse_hasher.hash_image(img);
    let fine = fine_hasher.hash_image(img);
    Some((coarse.as_bytes().to_vec(), fine.as_bytes().to_vec()))
}

/// Calcule les hash perceptuels (coarse + fine) d'une image stockee en memoire.
/// Utilise pour les entrees d'archive (zip/7z/tar) : on a deja les bytes en RAM,
/// pas besoin de passer par un fichier disque.
pub fn compute_hashes_from_bytes(bytes: &[u8], coarse_size: u32, fine_size: u32) -> Option<(Vec<u8>, Vec<u8>)> {
    let img = image::load_from_memory(bytes).ok()?;
    compute_hashes_from_image(&img, coarse_size, fine_size)
}

/// Vrai si l'extension du nom indique une image supportee par le pipeline pHash.
pub fn is_image_path(name: &str) -> bool {
    let ext = name.rsplit('.').next().unwrap_or("").to_lowercase();
    matches!(ext.as_str(),
        "jpg" | "jpeg" | "png" | "webp" | "bmp" | "gif" | "tiff" | "tif" | "avif"
    )
}

/// Calcule les hash grossier et fin en un seul decodage d'image.
/// Si use_exif_thumbnail est true, tente d'utiliser le thumbnail EXIF embarque (JPEG uniquement) :
/// le thumbnail (~160x120 px) suffit pour un gradient hash 8x8 et evite de decoder l'image entiere.
/// Repli automatique sur image::open si le thumbnail est absent ou si le fichier n'est pas JPEG.
pub fn compute_two_pass_hashes(
    path: &str,
    coarse_size: u32,
    fine_size: u32,
    use_exif_thumbnail: bool,
) -> Option<(Vec<u8>, Vec<u8>)> {
    if use_exif_thumbnail {
        if let Some(thumb_bytes) = try_extract_exif_thumbnail(path) {
            if let Ok(img) = image::load_from_memory(&thumb_bytes) {
                return compute_hashes_from_image(&img, coarse_size, fine_size);
            }
        }
    }
    let img = image::open(path).ok()?;
    compute_hashes_from_image(&img, coarse_size, fine_size)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn png_header(w: u32, h: u32) -> Vec<u8> {
        let mut buf = vec![0u8; 24];
        buf[0..8].copy_from_slice(b"\x89PNG\r\n\x1a\n");
        buf[8..12].copy_from_slice(&13u32.to_be_bytes());
        buf[12..16].copy_from_slice(b"IHDR");
        buf[16..20].copy_from_slice(&w.to_be_bytes());
        buf[20..24].copy_from_slice(&h.to_be_bytes());
        buf
    }

    fn jpeg_header(w: u16, h: u16) -> Vec<u8> {
        let mut buf = Vec::new();
        buf.extend_from_slice(b"\xFF\xD8");
        buf.extend_from_slice(b"\xFF\xE0");
        buf.extend_from_slice(&10u16.to_be_bytes());
        buf.extend_from_slice(&[0u8; 8]);
        buf.extend_from_slice(b"\xFF\xC0");
        buf.extend_from_slice(&11u16.to_be_bytes());
        buf.push(8);
        buf.extend_from_slice(&h.to_be_bytes());
        buf.extend_from_slice(&w.to_be_bytes());
        buf.push(3);
        buf
    }

    #[test]
    fn png_dimensions_valides() {
        assert_eq!(read_png_dimensions(&png_header(1920, 1080)), Some((1920, 1080)));
        assert_eq!(read_png_dimensions(&png_header(100, 200)), Some((100, 200)));
    }

    #[test]
    fn png_mauvaise_magic() {
        let mut buf = png_header(100, 100);
        buf[0] = 0x00;
        assert_eq!(read_png_dimensions(&buf), None);
    }

    #[test]
    fn png_buffer_trop_court() {
        assert_eq!(read_png_dimensions(&[0u8; 23]), None);
        assert_eq!(read_png_dimensions(&[]), None);
    }

    #[test]
    fn jpeg_dimensions_valides() {
        assert_eq!(read_jpeg_dimensions(&jpeg_header(1280, 720)), Some((1280, 720)));
        assert_eq!(read_jpeg_dimensions(&jpeg_header(640, 480)), Some((640, 480)));
    }

    #[test]
    fn jpeg_mauvais_magic() {
        let mut buf = jpeg_header(100, 100);
        buf[0] = 0x00;
        assert_eq!(read_jpeg_dimensions(&buf), None);
    }

    #[test]
    fn jpeg_sof_absent_dans_buffer() {
        let buf = b"\xFF\xD8\xFF\xE0\x00\x10";
        assert_eq!(read_jpeg_dimensions(buf), None);
    }

    #[test]
    fn jpeg_stoppe_sur_sos() {
        let mut truncated = vec![0xFFu8, 0xD8];
        truncated.extend_from_slice(b"\xFF\xDA");
        assert_eq!(read_jpeg_dimensions(&truncated), None);
    }

    #[test]
    fn format_non_reconnu_retourne_none() {
        assert_eq!(read_png_dimensions(b"RIFF\x00\x00\x00\x00WEBP"), None);
        assert_eq!(read_jpeg_dimensions(b"RIFF\x00\x00\x00\x00WEBP"), None);
    }

    #[test]
    fn exif_thumbnail_retourne_none_si_pas_jpeg() {
        // Un PNG ne contient pas d'EXIF JPEG
        let png = png_header(100, 100);
        // Ecrire dans un fichier temporaire
        let dir = tempfile::TempDir::new().unwrap();
        let p = dir.path().join("test.png");
        std::fs::write(&p, &png).unwrap();
        assert!(try_extract_exif_thumbnail(p.to_str().unwrap()).is_none());
    }

    #[test]
    fn exif_thumbnail_retourne_none_si_jpeg_sans_app1() {
        // JPEG minimal sans segment APP1
        let jpeg = jpeg_header(100, 100);
        let dir = tempfile::TempDir::new().unwrap();
        let p = dir.path().join("test.jpg");
        std::fs::write(&p, &jpeg).unwrap();
        assert!(try_extract_exif_thumbnail(p.to_str().unwrap()).is_none());
    }

    #[test]
    fn exif_thumbnail_retourne_none_si_jpeg_avec_app1_non_exif() {
        // JPEG avec APP1 mais sans header "Exif\0\0"
        let mut jpeg = vec![0xFF_u8, 0xD8];
        let app1_data = b"XMP \x00fake_xmp_data";
        let seg_len = (app1_data.len() + 2) as u16;
        jpeg.extend_from_slice(b"\xFF\xE1");
        jpeg.extend_from_slice(&seg_len.to_be_bytes());
        jpeg.extend_from_slice(app1_data);
        let dir = tempfile::TempDir::new().unwrap();
        let p = dir.path().join("test.jpg");
        std::fs::write(&p, &jpeg).unwrap();
        assert!(try_extract_exif_thumbnail(p.to_str().unwrap()).is_none());
    }
}

pub fn hamming_distance(a: &[u8], b: &[u8]) -> u32 {
    a.iter().zip(b.iter()).map(|(x, y)| (x ^ y).count_ones()).sum()
}

/// Retourne true si la paire (a, b) passe tous les filtres de comparaison pHash.
pub fn pair_passes_filters(
    a: &ImageData,
    b: &ImageData,
    use_aspect_filter: bool,
    aspect_tolerance: f32,
    use_two_pass: bool,
    coarse_threshold: u32,
    threshold: u32,
) -> bool {
    if use_aspect_filter {
        if let (Some(ai), Some(aj)) = (a.aspect, b.aspect) {
            let max_r = ai.max(aj);
            if max_r > 0.0 && (ai - aj).abs() / max_r > aspect_tolerance {
                return false;
            }
        }
    }
    if use_two_pass && hamming_distance(&a.coarse, &b.coarse) > coarse_threshold {
        return false;
    }
    hamming_distance(&a.fine, &b.fine) <= threshold
}
