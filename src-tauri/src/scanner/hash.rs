use std::fs::File;
use std::io::Read;

use image_hasher::{HasherConfig, HashAlg};
use xxhash_rust::xxh3::Xxh3;

use super::types::ImageData;

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

/// Lit uniquement les dimensions d'une image (lecture partielle de l'en-tete, sans decode complet).
pub fn get_image_dimensions(path: &str) -> Option<(u32, u32)> {
    use image::io::Reader as ImageReader;
    ImageReader::open(path)
        .ok()?
        .with_guessed_format()
        .ok()?
        .into_dimensions()
        .ok()
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
