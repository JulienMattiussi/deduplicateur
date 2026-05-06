use std::fs::File;
use std::io::Read;

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

/// Calcule les hash grossier et fin en un seul decodage d'image.
/// Retourne (coarse_bytes, fine_bytes) ou None si le fichier ne peut pas etre decode.
pub fn compute_two_pass_hashes(
    path: &str,
    coarse_size: u32,
    fine_size: u32,
) -> Option<(Vec<u8>, Vec<u8>)> {
    let img = image::open(path).ok()?;
    let coarse_hasher = HasherConfig::new()
        .hash_alg(HashAlg::Gradient)
        .hash_size(coarse_size, coarse_size)
        .to_hasher();
    let fine_hasher = HasherConfig::new()
        .hash_alg(HashAlg::Gradient)
        .hash_size(fine_size, fine_size)
        .to_hasher();
    let coarse = coarse_hasher.hash_image(&img);
    let fine = fine_hasher.hash_image(&img);
    Some((coarse.as_bytes().to_vec(), fine.as_bytes().to_vec()))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn png_header(w: u32, h: u32) -> Vec<u8> {
        let mut buf = vec![0u8; 24];
        buf[0..8].copy_from_slice(b"\x89PNG\r\n\x1a\n");
        // IHDR length (4 octets) + type "IHDR" (4 octets) = octets 8-15
        buf[8..12].copy_from_slice(&13u32.to_be_bytes());
        buf[12..16].copy_from_slice(b"IHDR");
        buf[16..20].copy_from_slice(&w.to_be_bytes());
        buf[20..24].copy_from_slice(&h.to_be_bytes());
        buf
    }

    fn jpeg_header(w: u16, h: u16) -> Vec<u8> {
        let mut buf = Vec::new();
        buf.extend_from_slice(b"\xFF\xD8");           // SOI
        buf.extend_from_slice(b"\xFF\xE0");           // APP0 marker
        buf.extend_from_slice(&10u16.to_be_bytes());  // APP0 length = 10
        buf.extend_from_slice(&[0u8; 8]);             // APP0 payload (8 octets)
        buf.extend_from_slice(b"\xFF\xC0");           // SOF0 marker
        buf.extend_from_slice(&11u16.to_be_bytes());  // SOF0 length = 11
        buf.push(8);                                  // precision
        buf.extend_from_slice(&h.to_be_bytes());      // height
        buf.extend_from_slice(&w.to_be_bytes());      // width
        buf.push(3);                                  // components
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
        // buffer trop court pour contenir le SOF
        let buf = b"\xFF\xD8\xFF\xE0\x00\x10";
        assert_eq!(read_jpeg_dimensions(buf), None);
    }

    #[test]
    fn jpeg_stoppe_sur_sos() {
        let mut buf = jpeg_header(100, 100);
        // insere un marqueur SOS avant le SOF
        let sos = b"\xFF\xDA";
        let mut truncated = vec![0xFFu8, 0xD8];
        truncated.extend_from_slice(sos);
        assert_eq!(read_jpeg_dimensions(&truncated), None);
    }

    #[test]
    fn format_non_reconnu_retourne_none() {
        assert_eq!(read_png_dimensions(b"RIFF\x00\x00\x00\x00WEBP"), None);
        assert_eq!(read_jpeg_dimensions(b"RIFF\x00\x00\x00\x00WEBP"), None);
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
