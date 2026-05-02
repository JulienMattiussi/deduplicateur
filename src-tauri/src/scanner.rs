use std::collections::{HashMap, HashSet};
use std::fs::{self, File};
use std::io::Read;
use std::path::Path;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::Arc;
use std::time::Instant;

use base64::engine::general_purpose::STANDARD as BASE64;
use base64::Engine as _;
use image_hasher::{HasherConfig, HashAlg};
use rayon::prelude::*;
use serde::{Deserialize, Serialize};
use xxhash_rust::xxh3::Xxh3;

use crate::audio_cache::AudioCache;
use crate::audio_hash::{self, compute_fingerprint, fingerprint_distance, is_audio, AudioMetadata};
use crate::exact_cache::ExactCache;
use crate::filters::passes_filters;
use crate::phash_cache::{CacheEntry, HashCache};
use crate::phash_config::PHashConfig;
use crate::phash_perf::{append_perf_log, PerfEntry};
use crate::video_cache::{VideoCache, VideoCacheEntry};
use crate::video_hash::{
    dtw_distance, extract_frame_hashes, get_video_metadata, is_ffmpeg_available, sequence_distance,
    VideoMetadata,
};

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct DuplicateFile {
    pub path: String,
    pub name: String,
    pub size: u64,
    pub modified: u64,
    #[serde(default)]
    pub video_metadata: Option<VideoMetadata>,
    #[serde(default)]
    pub audio_metadata: Option<AudioMetadata>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct DuplicateGroup {
    pub id: String,
    pub hash: String,
    pub size: u64,
    pub files: Vec<DuplicateFile>,
    #[serde(default)]
    pub folder_key: Option<String>,
    #[serde(default)]
    pub similar: bool,
    #[serde(default)]
    pub video_similar: bool,
    #[serde(default)]
    pub audio_similar: bool,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ScanResult {
    pub groups: Vec<DuplicateGroup>,
    pub total_wasted_bytes: u64,
    pub scanned_files: usize,
    pub duration_ms: u128,
    #[serde(default)]
    pub partial: bool,
    pub ffmpeg_missing: bool,
    pub fpcalc_missing: bool,
}

/// Parametres d'un scan. Utiliser `ScanParams::new(folder)` pour les valeurs par defaut.
pub struct ScanParams {
    pub folder: String,
    pub recursive: bool,
    pub excluded: Vec<String>,
    pub by_folder: bool,
    pub find_similar: bool,
    /// Seuil de distance de Hamming pour la similarite pHash (en bits).
    pub sim_threshold: u32,
    /// Config du pipeline pHash (filtres, cache, perf log...).
    pub phash_config: PHashConfig,
    /// Dossier de donnees de l'app (pour le cache et le perf log).
    /// None = cache et perf log desactives.
    pub data_dir: Option<String>,
    pub find_similar_videos: bool,
    /// Seuil de distance de Hamming moyenne sur les frames (en bits, sur 64).
    pub video_sim_threshold: u32,
    /// Nombre de frames a extraire par video pour le hash.
    pub video_frames: usize,
    /// Tolerance de duree pour le filtre de paires (0.0-1.0). Defaut : 0.20.
    pub video_duration_tolerance: f64,
    /// Activer le cache inter-scans des frame hashes.
    pub video_cache_enabled: bool,
    /// Utiliser DTW pour la comparaison des sequences de frames.
    pub video_use_dtw: bool,
    /// Activer le cache inter-scans des hashes exacts (exact_cache.json).
    pub exact_cache_enabled: bool,
    /// Extensions a exclure du scan (sans point, ex. "tmp").
    /// Si vide, aucune extension n'est exclue.
    pub exclude_extensions: Vec<String>,
    /// Extensions a inclure exclusivement (sans point, ex. "jpg").
    /// Si vide, toutes les extensions sont incluses.
    pub include_extensions: Vec<String>,
    /// Taille minimale des fichiers en Ko (0 = pas de minimum).
    pub min_file_size_kb: u64,
    /// Taille maximale des fichiers en Ko (0 = pas de maximum).
    pub max_file_size_kb: u64,
    pub find_similar_audio: bool,
    /// Seuil de distance de fingerprint audio (0.0-1.0). Defaut : 0.20 (80% similarite).
    pub audio_sim_threshold: u32,
    pub audio_cache_enabled: bool,
    /// Tolerance de duree pour le filtre de paires (0.0-1.0). Defaut : 0.20.
    pub audio_duration_tolerance: f64,
}

impl ScanParams {
    #[allow(dead_code)]
    pub fn new(folder: &str) -> Self {
        ScanParams {
            folder: folder.to_string(),
            recursive: false,
            excluded: vec![],
            by_folder: false,
            find_similar: false,
            sim_threshold: 10,
            phash_config: PHashConfig::default(),
            data_dir: None,
            find_similar_videos: false,
            video_sim_threshold: 10,
            video_frames: 8,
            video_duration_tolerance: 0.20,
            video_cache_enabled: true,
            video_use_dtw: false,
            exact_cache_enabled: true,
            exclude_extensions: vec![],
            include_extensions: vec![],
            min_file_size_kb: 0,
            max_file_size_kb: 0,
            find_similar_audio: false,
            audio_sim_threshold: 20,
            audio_cache_enabled: true,
            audio_duration_tolerance: 0.20,
        }
    }
}

const PARTIAL_SIZE: usize = 4 * 1024;
const CHUNK_SIZE: usize = 64 * 1024;

struct UnionFind {
    parent: Vec<usize>,
    rank: Vec<usize>,
}

impl UnionFind {
    fn new(n: usize) -> Self {
        UnionFind {
            parent: (0..n).collect(),
            rank: vec![0; n],
        }
    }

    fn find(&mut self, x: usize) -> usize {
        if self.parent[x] != x {
            self.parent[x] = self.find(self.parent[x]);
        }
        self.parent[x]
    }

    fn union(&mut self, x: usize, y: usize) {
        let rx = self.find(x);
        let ry = self.find(y);
        if rx == ry {
            return;
        }
        if self.rank[rx] < self.rank[ry] {
            self.parent[rx] = ry;
        } else if self.rank[rx] > self.rank[ry] {
            self.parent[ry] = rx;
        } else {
            self.parent[ry] = rx;
            self.rank[rx] += 1;
        }
    }
}

struct ImageData {
    file: DuplicateFile,
    coarse: Vec<u8>,
    fine: Vec<u8>,
    /// Ratio largeur/hauteur. None si les dimensions n'ont pas ete lues.
    aspect: Option<f32>,
}

struct VideoData {
    file: DuplicateFile,
    hashes: Vec<u64>,
    metadata: VideoMetadata,
}

fn is_video(path: &str) -> bool {
    let ext = Path::new(path)
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    matches!(
        ext.as_str(),
        "mp4" | "avi" | "mkv" | "mov" | "wmv" | "webm" | "flv" | "m4v" | "mpg" | "mpeg"
            | "3gp" | "ts" | "mts" | "m2ts"
    )
}

fn is_image(path: &str) -> bool {
    let ext = Path::new(path)
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    matches!(
        ext.as_str(),
        "jpg" | "jpeg" | "png" | "webp" | "bmp" | "gif" | "tiff" | "tif" | "avif"
    )
}

/// Lit uniquement les dimensions d'une image (lecture partielle de l'en-tete, sans decode complet).
fn get_image_dimensions(path: &str) -> Option<(u32, u32)> {
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
fn compute_two_pass_hashes(
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

fn hamming_distance(a: &[u8], b: &[u8]) -> u32 {
    a.iter().zip(b.iter()).map(|(x, y)| (x ^ y).count_ones()).sum()
}

/// Retourne true si la paire (a, b) passe tous les filtres de comparaison pHash :
/// 1. Filtre de rapport d'aspect (si use_aspect_filter)
/// 2. Filtre hash grossier (si use_two_pass)
/// 3. Comparaison hash fin (seuil de Hamming)
fn pair_passes_filters(
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

pub fn scan_folder<F>(
    params: ScanParams,
    cancelled: Arc<AtomicBool>,
    on_progress: F,
) -> Result<ScanResult, String>
where
    F: Fn(usize, usize, usize, &str) + Send + Sync,
{
    let start = Instant::now();
    let mut was_cancelled = false;

    let all_files = collect_files(
        Path::new(&params.folder),
        params.recursive,
        &params.excluded,
        &cancelled,
        &params.exclude_extensions,
        &params.include_extensions,
        params.min_file_size_kb.saturating_mul(1024),
        params.max_file_size_kb.saturating_mul(1024),
    )?;
    let scanned_files = all_files.len();

    // In media-specific modes (images/videos/audio), restrict all phases to files of that type.
    // This prevents e.g. PDF exact duplicates from appearing in an audio-only scan.
    let files: Vec<DuplicateFile> = if params.find_similar_audio && !params.find_similar && !params.find_similar_videos {
        all_files.into_iter().filter(|f| is_audio(&f.path)).collect()
    } else if params.find_similar && !params.find_similar_videos && !params.find_similar_audio {
        all_files.into_iter().filter(|f| is_image(&f.path)).collect()
    } else if params.find_similar_videos && !params.find_similar && !params.find_similar_audio {
        all_files.into_iter().filter(|f| is_video(&f.path)).collect()
    } else {
        all_files
    };

    // Collect image candidates before partitioning (avoids a second collect_files in pHash phase).
    let phash_candidates_all: Vec<DuplicateFile> = if params.find_similar {
        files.iter().filter(|f| is_image(&f.path)).cloned().collect()
    } else {
        vec![]
    };
    let phash_estimate = phash_candidates_all.len();

    let video_candidates_all: Vec<DuplicateFile> = if params.find_similar_videos {
        files.iter().filter(|f| is_video(&f.path)).cloned().collect()
    } else {
        vec![]
    };
    let video_estimate = video_candidates_all.len();

    let audio_candidates_all: Vec<DuplicateFile> = if params.find_similar_audio {
        files.iter().filter(|f| is_audio(&f.path)).cloned().collect()
    } else {
        vec![]
    };
    let audio_estimate = audio_candidates_all.len();

    let partitions: Vec<(Option<String>, Vec<DuplicateFile>)> = if params.by_folder {
        let root = Path::new(&params.folder);
        let mut map: HashMap<String, Vec<DuplicateFile>> = HashMap::new();
        for f in files {
            let key = first_level_subdir(root, Path::new(&f.path));
            map.entry(key).or_default().push(f);
        }
        map.into_iter().map(|(k, v)| (Some(k), v)).collect()
    } else {
        vec![(None, files)]
    };

    let partition_candidates: Vec<(Option<String>, Vec<Vec<DuplicateFile>>)> = partitions
        .iter()
        .map(|(key, files)| {
            let mut by_size: HashMap<u64, Vec<DuplicateFile>> = HashMap::new();
            for f in files {
                by_size.entry(f.size).or_default().push(f.clone());
            }
            let candidates: Vec<Vec<DuplicateFile>> =
                by_size.into_values().filter(|v| v.len() >= 2).collect();
            (key.clone(), candidates)
        })
        .collect();

    let total_to_hash: usize = partition_candidates
        .iter()
        .map(|(_, cands)| cands.iter().map(|v| v.len()).sum::<usize>())
        .sum();

    let total_work = total_to_hash + phash_estimate + video_estimate + audio_estimate;

    let hashed = Arc::new(AtomicUsize::new(0));
    let mut groups: Vec<DuplicateGroup> = Vec::new();

    // Cache inter-scans des hashes exacts. Charge une seule fois avant la boucle.
    let mut exact_cache = if params.exact_cache_enabled {
        params.data_dir.as_deref()
            .map(|d| ExactCache::load(Path::new(d)))
            .unwrap_or_else(ExactCache::empty)
    } else {
        ExactCache::empty()
    };

    // --- Phase 1 : doublons exacts ---
    for (folder_key, size_candidates) in partition_candidates {
        if cancelled.load(Ordering::Relaxed) {
            was_cancelled = true;
            break;
        }

        // Chaque tuple : (hash_partiel, fichier, Option<(path, mtime, size, hash)> a inserer en cache)
        let partial_raw: Vec<(String, DuplicateFile, Option<(String, u64, u64, String)>)> =
            size_candidates
                .into_par_iter()
                .flat_map(|group| group.into_par_iter())
                .filter_map(|file| {
                    if cancelled.load(Ordering::Relaxed) {
                        return None;
                    }
                    // Essayer le cache d'abord (lecture seule, pas de mutex necessaire).
                    if let Some(entry) = exact_cache.get(&file.path, file.modified, file.size) {
                        if let Some(ph) = &entry.partial_hash {
                            let n = hashed.fetch_add(1, Ordering::Relaxed) + 1;
                            on_progress(n, total_work, scanned_files, &file.name);
                            return Some((ph.clone(), file, None));
                        }
                    }
                    let h = hash_partial(&file.path).ok()?;
                    let n = hashed.fetch_add(1, Ordering::Relaxed) + 1;
                    on_progress(n, total_work, scanned_files, &file.name);
                    let ins = (file.path.clone(), file.modified, file.size, h.clone());
                    Some((h, file, Some(ins)))
                })
                .collect();

        // Appliquer les nouvelles entrees de cache (apres la section parallele).
        for (_, _, ins) in &partial_raw {
            if let Some((p, m, s, ph)) = ins {
                exact_cache.insert_partial(p.clone(), *m, *s, ph.clone());
            }
        }

        let partial_results: Vec<(String, DuplicateFile)> =
            partial_raw.into_iter().map(|(h, f, _)| (h, f)).collect();

        if cancelled.load(Ordering::Relaxed) {
            was_cancelled = true;
            break;
        }

        let mut by_partial: HashMap<String, Vec<DuplicateFile>> = HashMap::new();
        for (h, f) in partial_results {
            by_partial.entry(h).or_default().push(f);
        }
        let partial_candidates: Vec<Vec<DuplicateFile>> =
            by_partial.into_values().filter(|v| v.len() >= 2).collect();

        let full_raw: Vec<(String, DuplicateFile, Option<(String, u64, u64, String)>)> =
            partial_candidates
                .into_par_iter()
                .flat_map(|group| group.into_par_iter())
                .filter_map(|file| {
                    if cancelled.load(Ordering::Relaxed) {
                        return None;
                    }
                    if let Some(entry) = exact_cache.get(&file.path, file.modified, file.size) {
                        if let Some(fh) = &entry.full_hash {
                            return Some((fh.clone(), file, None));
                        }
                    }
                    let h = hash_full(&file.path).ok()?;
                    let ins = (file.path.clone(), file.modified, file.size, h.clone());
                    Some((h, file, Some(ins)))
                })
                .collect();

        for (_, _, ins) in &full_raw {
            if let Some((p, m, s, fh)) = ins {
                exact_cache.insert_full(p.clone(), *m, *s, fh.clone());
            }
        }

        let full_results: Vec<(String, DuplicateFile)> =
            full_raw.into_iter().map(|(h, f, _)| (h, f)).collect();

        if cancelled.load(Ordering::Relaxed) {
            was_cancelled = true;
            break;
        }

        let mut by_full: HashMap<String, Vec<DuplicateFile>> = HashMap::new();
        for (h, f) in full_results {
            by_full.entry(h).or_default().push(f);
        }

        let partition_groups: Vec<DuplicateGroup> = by_full
            .into_iter()
            .filter(|(_, files)| files.len() >= 2)
            .map(|(hash, files)| {
                let size = files[0].size;
                DuplicateGroup {
                    id: uuid::Uuid::new_v4().to_string(),
                    hash: hash[..16.min(hash.len())].to_string(),
                    size,
                    folder_key: folder_key.clone(),
                    similar: false,
                    video_similar: false,
                    audio_similar: false,
                    files,
                }
            })
            .collect();

        groups.extend(partition_groups);
    }

    // Sauvegarder le cache exact apres la boucle (y compris en cas d'annulation partielle).
    if params.exact_cache_enabled {
        if let Some(data_dir) = params.data_dir.as_deref() {
            let _ = exact_cache.save(Path::new(data_dir));
        }
    }

    // --- Phase 2 : images similaires (pHash) ---
    if params.find_similar && !was_cancelled && !cancelled.load(Ordering::Relaxed) {
        'phash: {
        let t_phase_start = Instant::now();
        let cfg = &params.phash_config;
        let data_dir_path = params.data_dir.as_deref().map(Path::new);

        // Exclure les doublons exacts deja detectes.
        let exact_paths: HashSet<String> = groups
            .iter()
            .flat_map(|g| g.files.iter().map(|f| f.path.clone()))
            .collect();

        let t_collect_start = Instant::now();
        let candidates: Vec<DuplicateFile> = phash_candidates_all
            .into_iter()
            .filter(|f| !exact_paths.contains(&f.path))
            .collect();
        let t_collect_ms = t_collect_start.elapsed().as_millis() as u64;
        let total_images = candidates.len();

        // Optimisation 1 : filtre de taille minimale.
        let t_size_start = Instant::now();
        let candidates: Vec<DuplicateFile> = if total_images >= cfg.min_images_size_filter {
            candidates
                .into_iter()
                .filter(|f| f.size >= cfg.min_file_size_bytes)
                .collect()
        } else {
            candidates
        };
        let after_size = candidates.len();
        let t_size_ms = t_size_start.elapsed().as_millis() as u64;

        // Optimisation 2 : lecture des dimensions pour le filtre de ratio d'aspect.
        let t_aspect_start = Instant::now();
        let use_aspect_filter = after_size >= cfg.min_images_aspect_filter;
        let dimensions: Vec<Option<(u32, u32)>> = if use_aspect_filter {
            candidates.par_iter().map(|f| {
                if cancelled.load(Ordering::Relaxed) { return None; }
                get_image_dimensions(&f.path)
            }).collect()
        } else {
            vec![None; after_size]
        };
        let t_aspect_ms = t_aspect_start.elapsed().as_millis() as u64;

        if cancelled.load(Ordering::Relaxed) {
            was_cancelled = true;
            break 'phash;
        }

        // Optimisation 3 : cache inter-scans.
        let mut cache = if cfg.cache_enabled {
            data_dir_path.map_or_else(HashCache::empty, HashCache::load)
        } else {
            HashCache::empty()
        };

        // Optimisation 4 : calcul des hashs (cache + decode parallele).
        let t_hash_start = Instant::now();

        // Compteur partagé hits + misses pour que le progress avance meme si tout est en cache.
        let phash_done = Arc::new(AtomicUsize::new(0));
        let phash_done_for_decode = Arc::clone(&phash_done);

        let cache_results: Vec<Option<(Vec<u8>, Vec<u8>)>> = candidates
            .iter()
            .map(|f| {
                let result = cache
                    .get(&f.path, f.modified, cfg.coarse_hash_size, cfg.fine_hash_size)
                    .and_then(|e| {
                        let c = BASE64.decode(&e.coarse).ok()?;
                        let fi = BASE64.decode(&e.fine).ok()?;
                        Some((c, fi))
                    });
                if result.is_some() {
                    let n = phash_done.fetch_add(1, Ordering::Relaxed) + 1;
                    on_progress(total_to_hash + n, total_work, scanned_files, &f.name);
                }
                result
            })
            .collect();

        let cache_hits = cache_results.iter().filter(|r| r.is_some()).count();

        let miss_indices: Vec<usize> = cache_results
            .iter()
            .enumerate()
            .filter_map(|(i, r)| if r.is_none() { Some(i) } else { None })
            .collect();

        let _n_to_decode = miss_indices.len();

        let miss_hashes: Vec<(usize, Option<(Vec<u8>, Vec<u8>)>)> = miss_indices
            .into_par_iter()
            .map(|i| {
                if cancelled.load(Ordering::Relaxed) {
                    return (i, None);
                }
                let hash = compute_two_pass_hashes(
                    &candidates[i].path,
                    cfg.coarse_hash_size,
                    cfg.fine_hash_size,
                );
                let n = phash_done_for_decode.fetch_add(1, Ordering::Relaxed) + 1;
                on_progress(total_to_hash + n, total_work, scanned_files, &candidates[i].name);
                (i, hash)
            })
            .collect();

        if cancelled.load(Ordering::Relaxed) {
            was_cancelled = true;
            break 'phash;
        }

        let mut all_hashes: Vec<Option<(Vec<u8>, Vec<u8>)>> = cache_results;
        let mut cache_misses = 0usize;
        for (i, hash) in miss_hashes {
            if let Some((ref coarse_bytes, ref fine_bytes)) = hash {
                cache.insert(
                    candidates[i].path.clone(),
                    CacheEntry {
                        mtime: candidates[i].modified,
                        coarse_size: cfg.coarse_hash_size,
                        fine_size: cfg.fine_hash_size,
                        coarse: BASE64.encode(coarse_bytes),
                        fine: BASE64.encode(fine_bytes),
                    },
                );
                cache_misses += 1;
            }
            all_hashes[i] = hash;
        }
        let t_hash_ms = t_hash_start.elapsed().as_millis() as u64;

        let images: Vec<ImageData> = candidates
            .into_iter()
            .zip(all_hashes.into_iter())
            .zip(dimensions.into_iter())
            .filter_map(|((file, hash_opt), dim_opt)| {
                let (coarse, fine) = hash_opt?;
                let aspect =
                    dim_opt.map(|(w, h)| if h > 0 { w as f32 / h as f32 } else { 1.0 });
                Some(ImageData { file, coarse, fine, aspect })
            })
            .collect();

        let n = images.len();

        // Optimisation 5 : comparaison O(n^2) parallele ou sequentielle.
        let t_compare_start = Instant::now();
        let use_two_pass = cfg.two_pass_enabled && n >= cfg.min_images_two_pass;
        let use_parallel = cfg.parallel_compare_enabled && n >= cfg.min_images_parallel_compare;

        let coarse_threshold: u32 = {
            let bits_coarse = (cfg.coarse_hash_size * cfg.coarse_hash_size) as f32;
            let bits_fine = (cfg.fine_hash_size * cfg.fine_hash_size) as f32;
            ((params.sim_threshold as f32) * (bits_coarse / bits_fine)
                * cfg.coarse_threshold_multiplier)
                .floor() as u32
        };

        let skipped_coarse = Arc::new(AtomicUsize::new(0));
        let compared_fine = Arc::new(AtomicUsize::new(0));

        if cancelled.load(Ordering::Relaxed) {
            was_cancelled = true;
            break 'phash;
        }

        let similar_pairs: Vec<(usize, usize)> = if use_parallel {
            let sc = Arc::clone(&skipped_coarse);
            let cf = Arc::clone(&compared_fine);
            (0..n)
                .into_par_iter()
                .flat_map_iter(|i| {
                    if cancelled.load(Ordering::Relaxed) {
                        return vec![].into_iter();
                    }
                    let sc = Arc::clone(&sc);
                    let cf = Arc::clone(&cf);
                    let mut local = Vec::new();
                    for j in (i + 1)..n {
                        // Filtre grossier separe pour comptabiliser skipped_coarse avant
                        // d'appeler pair_passes_filters
                        if use_two_pass
                            && hamming_distance(&images[i].coarse, &images[j].coarse)
                                > coarse_threshold
                        {
                            sc.fetch_add(1, Ordering::Relaxed);
                            continue;
                        }
                        cf.fetch_add(1, Ordering::Relaxed);
                        if pair_passes_filters(
                            &images[i],
                            &images[j],
                            use_aspect_filter,
                            cfg.aspect_ratio_tolerance,
                            false,
                            0,
                            params.sim_threshold,
                        ) {
                            local.push((i, j));
                        }
                    }
                    local.into_iter()
                })
                .collect()
        } else {
            let mut pairs = Vec::new();
            let mut sc = 0usize;
            let mut cf = 0usize;
            for i in 0..n {
                if cancelled.load(Ordering::Relaxed) {
                    was_cancelled = true;
                    break 'phash;
                }
                for j in (i + 1)..n {
                    // Filtre grossier separe pour comptabiliser sc avant d'appeler
                    // pair_passes_filters
                    if use_two_pass
                        && hamming_distance(&images[i].coarse, &images[j].coarse)
                            > coarse_threshold
                    {
                        sc += 1;
                        continue;
                    }
                    cf += 1;
                    if pair_passes_filters(
                        &images[i],
                        &images[j],
                        use_aspect_filter,
                        cfg.aspect_ratio_tolerance,
                        false,
                        0,
                        params.sim_threshold,
                    ) {
                        pairs.push((i, j));
                    }
                }
            }
            skipped_coarse.store(sc, Ordering::Relaxed);
            compared_fine.store(cf, Ordering::Relaxed);
            pairs
        };
        let t_compare_ms = t_compare_start.elapsed().as_millis() as u64;
        let pairs_found = similar_pairs.len();

        // Union-Find pour la detection transitive.
        let mut uf = UnionFind::new(n);
        for &(i, j) in &similar_pairs {
            uf.union(i, j);
        }

        let mut hash_groups: HashMap<usize, Vec<usize>> = HashMap::new();
        for i in 0..n {
            let root = uf.find(i);
            hash_groups.entry(root).or_default().push(i);
        }

        for (_, indices) in hash_groups {
            if indices.len() < 2 {
                continue;
            }
            let files: Vec<DuplicateFile> =
                indices.iter().map(|&i| images[i].file.clone()).collect();
            let size = files[0].size;
            groups.push(DuplicateGroup {
                id: uuid::Uuid::new_v4().to_string(),
                hash: "phash".to_string(),
                size,
                folder_key: None,
                similar: true,
                video_similar: false,
                audio_similar: false,
                files,
            });
        }

        // Sauvegarde du cache.
        if cfg.cache_enabled {
            if let Some(dir) = data_dir_path {
                let _ = cache.save(dir);
            }
        }

        // Enregistrement des metriques de performance.
        if cfg.perf_log_enabled {
            if let Some(dir) = data_dir_path {
                use std::time::{SystemTime, UNIX_EPOCH};
                let timestamp = SystemTime::now()
                    .duration_since(UNIX_EPOCH)
                    .map(|d| d.as_secs())
                    .unwrap_or(0);
                let _ = append_perf_log(
                    dir,
                    &PerfEntry {
                        timestamp,
                        total_images,
                        after_size_filter: after_size,
                        after_aspect_filter: n,
                        pairs_skipped_coarse: skipped_coarse.load(Ordering::Relaxed),
                        pairs_compared_fine: compared_fine.load(Ordering::Relaxed),
                        pairs_found_similar: pairs_found,
                        cache_hits,
                        cache_misses,
                        ms_collect: t_collect_ms,
                        ms_size_filter: t_size_ms,
                        ms_aspect_filter: t_aspect_ms,
                        ms_hash: t_hash_ms,
                        ms_compare: t_compare_ms,
                        ms_total: t_phase_start.elapsed().as_millis() as u64,
                        config: cfg.clone(),
                    },
                );
            }
        }
        }  // end 'phash
    }

    // --- Phase 3 : videos similaires ---
    let ffmpeg_missing = params.find_similar_videos && !is_ffmpeg_available();
    let fpcalc_missing = params.find_similar_audio && !audio_hash::fpcalc_available();
    if params.find_similar_videos && !was_cancelled && !cancelled.load(Ordering::Relaxed)
        && !ffmpeg_missing
    {
        'video: {
        let exact_paths: HashSet<String> = groups
            .iter()
            .flat_map(|g| g.files.iter().map(|f| f.path.clone()))
            .collect();

        let candidates: Vec<DuplicateFile> = video_candidates_all
            .into_iter()
            .filter(|f| !exact_paths.contains(&f.path))
            .collect();

        let offset = total_to_hash + phash_estimate;

        // Charger le cache video
        let mut vcache = if params.video_cache_enabled {
            params.data_dir.as_deref()
                .map_or_else(VideoCache::empty, |d| VideoCache::load(Path::new(d)))
        } else {
            VideoCache::empty()
        };

        // Etape 1 : metadonnees en parallele (ffprobe - rapide)
        let meta_results: Vec<Option<VideoMetadata>> = candidates
            .par_iter()
            .map(|f| {
                if cancelled.load(Ordering::Relaxed) { return None; }
                get_video_metadata(&f.path)
            })
            .collect();

        if cancelled.load(Ordering::Relaxed) {
            was_cancelled = true;
            break 'video;
        }

        // Etape 2 : verifier le cache, compter les hits immediatement
        let video_done = Arc::new(AtomicUsize::new(0));
        let video_done_for_extract = Arc::clone(&video_done);

        let cache_results: Vec<Option<Vec<u64>>> = candidates.iter()
            .zip(meta_results.iter())
            .map(|(f, meta_opt)| {
                if meta_opt.is_none() {
                    let n = video_done.fetch_add(1, Ordering::Relaxed) + 1;
                    on_progress(offset + n, total_work, scanned_files, &f.name);
                    return None;
                }
                let cached = vcache.get(&f.path, f.modified, f.size, params.video_frames)
                    .map(|h| h.to_vec());
                if cached.is_some() {
                    let n = video_done.fetch_add(1, Ordering::Relaxed) + 1;
                    on_progress(offset + n, total_work, scanned_files, &f.name);
                }
                cached
            })
            .collect();

        // Etape 3 : extraction parallele des frames manquantes (ffmpeg via rayon)
        let miss_indices: Vec<usize> = cache_results.iter().enumerate()
            .filter_map(|(i, r)| {
                if r.is_none() && meta_results[i].is_some() { Some(i) } else { None }
            })
            .collect();

        let miss_hashes: Vec<(usize, Option<Vec<u64>>)> = miss_indices
            .into_par_iter()
            .map(|i| {
                if cancelled.load(Ordering::Relaxed) {
                    return (i, None);
                }
                let meta = meta_results[i].as_ref().unwrap();
                let hashes = extract_frame_hashes(
                    &candidates[i].path,
                    params.video_frames,
                    meta.duration_secs,
                );
                let n = video_done_for_extract.fetch_add(1, Ordering::Relaxed) + 1;
                on_progress(offset + n, total_work, scanned_files, &candidates[i].name);
                (i, hashes)
            })
            .collect();

        if cancelled.load(Ordering::Relaxed) {
            was_cancelled = true;
            break 'video;
        }

        // Fusionner cache + extractions, mettre a jour le cache
        let mut all_hashes: Vec<Option<Vec<u64>>> = cache_results;
        for (i, hashes) in miss_hashes {
            if let Some(ref h) = hashes {
                vcache.insert(candidates[i].path.clone(), VideoCacheEntry {
                    mtime: candidates[i].modified,
                    size: candidates[i].size,
                    n_frames: params.video_frames,
                    hashes: h.clone(),
                });
            }
            all_hashes[i] = hashes;
        }
        if params.video_cache_enabled {
            if let Some(dir) = params.data_dir.as_deref() {
                let _ = vcache.save(Path::new(dir));
            }
        }

        // Construire video_data avec metadonnees
        let video_data: Vec<VideoData> = candidates.iter()
            .zip(all_hashes.iter())
            .zip(meta_results.iter())
            .filter_map(|((file, hash_opt), meta_opt)| {
                let hashes = hash_opt.as_ref()?.clone();
                let metadata = meta_opt.as_ref()?.clone();
                let mut file_with_meta = file.clone();
                file_with_meta.video_metadata = Some(metadata.clone());
                Some(VideoData { file: file_with_meta, hashes, metadata })
            })
            .collect();

        let n = video_data.len();
        let threshold = params.video_sim_threshold as f64;
        let duration_tolerance = params.video_duration_tolerance;
        let use_dtw = params.video_use_dtw;

        if cancelled.load(Ordering::Relaxed) {
            was_cancelled = true;
            break 'video;
        }

        // Etape 4 : comparaison O(n^2) en parallele avec filtre de duree
        let similar_pairs: Vec<(usize, usize)> = (0..n)
            .into_par_iter()
            .flat_map_iter(|i| {
                if cancelled.load(Ordering::Relaxed) {
                    return vec![].into_iter();
                }
                let mut local = Vec::new();
                for j in (i + 1)..n {
                    let dur_i = video_data[i].metadata.duration_secs;
                    let dur_j = video_data[j].metadata.duration_secs;
                    let max_dur = dur_i.max(dur_j);
                    if max_dur > 0.0 && (dur_i - dur_j).abs() / max_dur > duration_tolerance {
                        continue;
                    }
                    let dist = if use_dtw {
                        dtw_distance(&video_data[i].hashes, &video_data[j].hashes)
                    } else {
                        sequence_distance(&video_data[i].hashes, &video_data[j].hashes)
                    };
                    if dist <= threshold {
                        local.push((i, j));
                    }
                }
                local.into_iter()
            })
            .collect();

        // Union-Find pour la detection transitive
        let mut uf = UnionFind::new(n);
        for &(i, j) in &similar_pairs {
            uf.union(i, j);
        }

        let mut group_map: HashMap<usize, Vec<usize>> = HashMap::new();
        for i in 0..n {
            let root = uf.find(i);
            group_map.entry(root).or_default().push(i);
        }

        for (_, indices) in group_map {
            if indices.len() < 2 {
                continue;
            }
            let files: Vec<DuplicateFile> =
                indices.iter().map(|&i| video_data[i].file.clone()).collect();
            let size = files[0].size;
            groups.push(DuplicateGroup {
                id: uuid::Uuid::new_v4().to_string(),
                hash: "video".to_string(),
                size,
                folder_key: None,
                similar: false,
                video_similar: true,
                audio_similar: false,
                files,
            });
        }
        } // end 'video
    }

    // --- Phase 4 : audio similaire ---
    if params.find_similar_audio && !was_cancelled && !cancelled.load(Ordering::Relaxed)
        && !fpcalc_missing
    {
        'audio: {
        let exact_paths: HashSet<String> = groups
            .iter()
            .flat_map(|g| g.files.iter().map(|f| f.path.clone()))
            .collect();

        let candidates: Vec<DuplicateFile> = audio_candidates_all
            .into_iter()
            .filter(|f| !exact_paths.contains(&f.path))
            .collect();

        let offset = total_to_hash + phash_estimate + video_estimate;

        let mut acache = if params.audio_cache_enabled {
            params.data_dir.as_deref()
                .map_or_else(AudioCache::empty, |d| AudioCache::load(Path::new(d)))
        } else {
            AudioCache::empty()
        };

        let audio_done = Arc::new(AtomicUsize::new(0));
        let audio_done_for_extract = Arc::clone(&audio_done);

        let cache_results: Vec<Option<(Vec<i32>, f64)>> = candidates.iter()
            .map(|f| {
                let cached = acache.get(&f.path, f.modified, f.size);
                if cached.is_some() {
                    let n = audio_done.fetch_add(1, Ordering::Relaxed) + 1;
                    on_progress(offset + n, total_work, scanned_files, &f.name);
                }
                cached
            })
            .collect();

        let miss_indices: Vec<usize> = cache_results.iter().enumerate()
            .filter_map(|(i, r)| if r.is_none() { Some(i) } else { None })
            .collect();

        let miss_results: Vec<(usize, Option<(Vec<i32>, f64)>)> = miss_indices
            .into_par_iter()
            .map(|i| {
                if cancelled.load(Ordering::Relaxed) { return (i, None); }
                let result = compute_fingerprint(&candidates[i].path);
                let n = audio_done_for_extract.fetch_add(1, Ordering::Relaxed) + 1;
                on_progress(offset + n, total_work, scanned_files, &candidates[i].name);
                (i, result)
            })
            .collect();

        if cancelled.load(Ordering::Relaxed) {
            was_cancelled = true;
            break 'audio;
        }

        let mut all_fingerprints: Vec<Option<(Vec<i32>, f64)>> = cache_results;
        for (i, result) in miss_results {
            if let Some((ref fp, dur)) = result {
                acache.insert(candidates[i].path.clone(), candidates[i].modified, candidates[i].size, fp.clone(), dur);
            }
            all_fingerprints[i] = result;
        }
        if params.audio_cache_enabled {
            if let Some(dir) = params.data_dir.as_deref() {
                let _ = acache.save(Path::new(dir));
            }
        }

        struct AudioData {
            file: DuplicateFile,
            fingerprint: Vec<i32>,
            duration_secs: f64,
        }

        let audio_data: Vec<AudioData> = candidates.iter()
            .zip(all_fingerprints.iter())
            .filter_map(|(file, fp_opt)| {
                let (fp, dur) = fp_opt.as_ref()?;
                let mut f = file.clone();
                f.audio_metadata = Some(AudioMetadata { duration_secs: *dur });
                Some(AudioData { file: f, fingerprint: fp.clone(), duration_secs: *dur })
            })
            .collect();

        let n = audio_data.len();
        let threshold = params.audio_sim_threshold as f64 / 100.0;
        let duration_tolerance = params.audio_duration_tolerance;

        if cancelled.load(Ordering::Relaxed) {
            was_cancelled = true;
            break 'audio;
        }

        let similar_pairs: Vec<(usize, usize)> = (0..n)
            .into_par_iter()
            .flat_map_iter(|i| {
                if cancelled.load(Ordering::Relaxed) { return vec![].into_iter(); }
                let mut local = Vec::new();
                for j in (i + 1)..n {
                    let dur_i = audio_data[i].duration_secs;
                    let dur_j = audio_data[j].duration_secs;
                    let max_dur = dur_i.max(dur_j);
                    if max_dur > 0.0 && (dur_i - dur_j).abs() / max_dur > duration_tolerance {
                        continue;
                    }
                    let dist = fingerprint_distance(&audio_data[i].fingerprint, &audio_data[j].fingerprint);
                    if dist <= threshold {
                        local.push((i, j));
                    }
                }
                local.into_iter()
            })
            .collect();

        let mut uf = UnionFind::new(n);
        for &(i, j) in &similar_pairs {
            uf.union(i, j);
        }

        let mut group_map: HashMap<usize, Vec<usize>> = HashMap::new();
        for i in 0..n {
            let root = uf.find(i);
            group_map.entry(root).or_default().push(i);
        }

        for (_, indices) in group_map {
            if indices.len() < 2 { continue; }
            let files: Vec<DuplicateFile> = indices.iter().map(|&i| audio_data[i].file.clone()).collect();
            let size = files[0].size;
            groups.push(DuplicateGroup {
                id: uuid::Uuid::new_v4().to_string(),
                hash: "audio".to_string(),
                size,
                folder_key: None,
                similar: false,
                video_similar: false,
                audio_similar: true,
                files,
            });
        }
        } // end 'audio
    }

    if params.by_folder {
        groups.sort_by(|a, b| {
            let ka = a.folder_key.as_deref().unwrap_or("");
            let kb = b.folder_key.as_deref().unwrap_or("");
            let wa = a.size * (a.files.len() as u64 - 1);
            let wb = b.size * (b.files.len() as u64 - 1);
            ka.cmp(kb).then_with(|| wb.cmp(&wa))
        });
    } else {
        groups.sort_by(|a, b| {
            let wa = a.size * (a.files.len() as u64 - 1);
            let wb = b.size * (b.files.len() as u64 - 1);
            wb.cmp(&wa)
        });
    }

    let total_wasted_bytes = groups
        .iter()
        .map(|g| g.size * (g.files.len() as u64 - 1))
        .sum();

    Ok(ScanResult {
        groups,
        total_wasted_bytes,
        scanned_files,
        duration_ms: start.elapsed().as_millis(),
        partial: was_cancelled,
        ffmpeg_missing,
        fpcalc_missing,
    })
}

fn first_level_subdir(root: &Path, file_path: &Path) -> String {
    match file_path.strip_prefix(root) {
        Ok(rel) => {
            let mut components = rel.components();
            let first = components.next();
            if components.next().is_some() {
                first
                    .and_then(|c| c.as_os_str().to_str())
                    .unwrap_or("")
                    .to_string()
            } else {
                String::new()
            }
        }
        Err(_) => String::new(),
    }
}

fn collect_files(
    folder: &Path,
    recursive: bool,
    excluded: &[String],
    cancelled: &Arc<AtomicBool>,
    exclude_extensions: &[String],
    include_extensions: &[String],
    min_file_size_bytes: u64,
    max_file_size_bytes: u64,
) -> Result<Vec<DuplicateFile>, String> {
    if !folder.exists() {
        return Err(format!("Dossier introuvable : {}", folder.display()));
    }

    let mut files = Vec::new();

    if recursive {
        for entry in walkdir::WalkDir::new(folder)
            .follow_links(false)
            .into_iter()
            .filter_entry(|e| {
                if e.file_type().is_dir() {
                    let name = e.file_name().to_str().unwrap_or("");
                    e.depth() == 0 || !excluded.iter().any(|ex| ex == name)
                } else {
                    true
                }
            })
        {
            if cancelled.load(Ordering::Relaxed) {
                return Err("cancelled".to_string());
            }
            let entry = match entry {
                Ok(e) => e,
                Err(_) => continue,
            };
            if !entry.file_type().is_file() {
                continue;
            }
            let path = entry.path();
            let (size, modified) = match entry.metadata() {
                Ok(m) => {
                    let modified = m
                        .modified()
                        .ok()
                        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                        .map(|d| d.as_secs())
                        .unwrap_or(0);
                    (m.len(), modified)
                }
                Err(_) => continue,
            };
            if !passes_filters(path, size, exclude_extensions, include_extensions, min_file_size_bytes, max_file_size_bytes) {
                continue;
            }
            let name = path
                .file_name()
                .and_then(|n| n.to_str())
                .unwrap_or("")
                .to_string();
            files.push(DuplicateFile {
                path: path.to_string_lossy().to_string(),
                name,
                size,
                modified,
                video_metadata: None,
                audio_metadata: None,
            });
        }
    } else {
        let read_dir = fs::read_dir(folder)
            .map_err(|e| format!("Impossible de lire le dossier : {}", e))?;
        for entry in read_dir.flatten() {
            let path = entry.path();
            let meta = match fs::metadata(&path) {
                Ok(m) => m,
                Err(_) => continue,
            };
            if !meta.is_file() {
                continue;
            }
            let size = meta.len();
            let modified = meta
                .modified()
                .ok()
                .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                .map(|d| d.as_secs())
                .unwrap_or(0);
            if !passes_filters(&path, size, exclude_extensions, include_extensions, min_file_size_bytes, max_file_size_bytes) {
                continue;
            }
            let name = path
                .file_name()
                .and_then(|n| n.to_str())
                .unwrap_or("")
                .to_string();
            files.push(DuplicateFile {
                path: path.to_string_lossy().to_string(),
                name,
                size,
                modified,
                video_metadata: None,
                audio_metadata: None,
            });
        }
    }

    Ok(files)
}

fn hash_partial(path: &str) -> Result<String, std::io::Error> {
    let mut file = File::open(path)?;
    let mut buf = vec![0u8; PARTIAL_SIZE];
    let n = file.read(&mut buf)?;
    let mut hasher = Xxh3::new();
    hasher.update(&buf[..n]);
    Ok(format!("{:016x}", hasher.digest()))
}

fn hash_full(path: &str) -> Result<String, std::io::Error> {
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

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::sync::atomic::Ordering;
    use std::sync::Arc;
    use tempfile::TempDir;

    fn no_progress(_: usize, _: usize, _: usize, _: &str) {}
    fn no_cancel() -> Arc<AtomicBool> {
        Arc::new(AtomicBool::new(false))
    }

    fn write_file(dir: &std::path::Path, name: &str, content: &[u8]) {
        fs::write(dir.join(name), content).unwrap();
    }

    fn write_solid_png(dir: &std::path::Path, name: &str, color: [u8; 3], size: u32) {
        write_solid_png_dims(dir, name, color, size, size);
    }

    fn write_solid_png_dims(
        dir: &std::path::Path,
        name: &str,
        color: [u8; 3],
        width: u32,
        height: u32,
    ) {
        use image::{ImageBuffer, Rgb};
        let img: ImageBuffer<Rgb<u8>, Vec<u8>> =
            ImageBuffer::from_pixel(width, height, Rgb(color));
        img.save(dir.join(name)).unwrap();
    }

    // --- Tests doublons exacts ---

    #[test]
    fn dossier_vide() {
        let dir = TempDir::new().unwrap();
        let r = scan_folder(ScanParams::new(dir.path().to_str().unwrap()), no_cancel(), no_progress).unwrap();
        assert_eq!(r.groups.len(), 0);
        assert_eq!(r.scanned_files, 0);
        assert_eq!(r.total_wasted_bytes, 0);
    }

    #[test]
    fn aucun_doublon() {
        let dir = TempDir::new().unwrap();
        write_file(dir.path(), "a.txt", b"contenu A");
        write_file(dir.path(), "b.txt", b"contenu B");
        write_file(dir.path(), "c.txt", b"contenu C");
        let r = scan_folder(ScanParams::new(dir.path().to_str().unwrap()), no_cancel(), no_progress).unwrap();
        assert_eq!(r.groups.len(), 0);
        assert_eq!(r.scanned_files, 3);
    }

    #[test]
    fn deux_fichiers_identiques() {
        let dir = TempDir::new().unwrap();
        write_file(dir.path(), "a.txt", b"contenu duplique");
        write_file(dir.path(), "b.txt", b"contenu duplique");
        let r = scan_folder(ScanParams::new(dir.path().to_str().unwrap()), no_cancel(), no_progress).unwrap();
        assert_eq!(r.groups.len(), 1);
        assert_eq!(r.groups[0].files.len(), 2);
    }

    #[test]
    fn trois_copies() {
        let dir = TempDir::new().unwrap();
        write_file(dir.path(), "a.txt", b"triple exemplaire");
        write_file(dir.path(), "b.txt", b"triple exemplaire");
        write_file(dir.path(), "c.txt", b"triple exemplaire");
        let r = scan_folder(ScanParams::new(dir.path().to_str().unwrap()), no_cancel(), no_progress).unwrap();
        assert_eq!(r.groups.len(), 1);
        assert_eq!(r.groups[0].files.len(), 3);
    }

    #[test]
    fn meme_taille_contenu_different() {
        let dir = TempDir::new().unwrap();
        write_file(dir.path(), "a.txt", b"aaaaaaa!!");
        write_file(dir.path(), "b.txt", b"bbbbbbb!!");
        let r = scan_folder(ScanParams::new(dir.path().to_str().unwrap()), no_cancel(), no_progress).unwrap();
        assert_eq!(r.groups.len(), 0);
    }

    #[test]
    fn tailles_differentes_pas_doublons() {
        let dir = TempDir::new().unwrap();
        write_file(dir.path(), "petit.txt", b"hi");
        write_file(dir.path(), "grand.txt", b"bonjour le monde");
        let r = scan_folder(ScanParams::new(dir.path().to_str().unwrap()), no_cancel(), no_progress).unwrap();
        assert_eq!(r.groups.len(), 0);
    }

    #[test]
    fn plusieurs_groupes() {
        let dir = TempDir::new().unwrap();
        write_file(dir.path(), "a1.txt", b"groupe un ici!!");
        write_file(dir.path(), "a2.txt", b"groupe un ici!!");
        write_file(dir.path(), "b1.txt", b"groupe deux la!!");
        write_file(dir.path(), "b2.txt", b"groupe deux la!!");
        write_file(dir.path(), "c.txt",  b"fichier unique !!");
        let r = scan_folder(ScanParams::new(dir.path().to_str().unwrap()), no_cancel(), no_progress).unwrap();
        assert_eq!(r.groups.len(), 2);
        assert_eq!(r.scanned_files, 5);
    }

    #[test]
    fn calcul_espace_gaspille() {
        let dir = TempDir::new().unwrap();
        let content = b"exactement ce contenu";
        write_file(dir.path(), "a.txt", content);
        write_file(dir.path(), "b.txt", content);
        write_file(dir.path(), "c.txt", content);
        let r = scan_folder(ScanParams::new(dir.path().to_str().unwrap()), no_cancel(), no_progress).unwrap();
        assert_eq!(r.total_wasted_bytes, content.len() as u64 * 2);
    }

    #[test]
    fn recursif_detecte_sous_dossiers() {
        let dir = TempDir::new().unwrap();
        let sub = dir.path().join("sous");
        fs::create_dir(&sub).unwrap();
        write_file(dir.path(), "a.txt", b"contenu commun");
        write_file(&sub, "b.txt", b"contenu commun");

        let r = scan_folder(ScanParams::new(dir.path().to_str().unwrap()), no_cancel(), no_progress).unwrap();
        assert_eq!(r.scanned_files, 1);
        assert_eq!(r.groups.len(), 0);

        let r = scan_folder(
            ScanParams { recursive: true, ..ScanParams::new(dir.path().to_str().unwrap()) },
            no_cancel(), no_progress,
        ).unwrap();
        assert_eq!(r.scanned_files, 2);
        assert_eq!(r.groups.len(), 1);
    }

    #[test]
    fn exclusion_de_dossier() {
        let dir = TempDir::new().unwrap();
        let nm = dir.path().join("node_modules");
        fs::create_dir(&nm).unwrap();
        write_file(dir.path(), "a.txt", b"contenu commun");
        write_file(&nm, "b.txt", b"contenu commun");

        let r = scan_folder(
            ScanParams {
                recursive: true,
                excluded: vec!["node_modules".to_string()],
                ..ScanParams::new(dir.path().to_str().unwrap())
            },
            no_cancel(), no_progress,
        ).unwrap();
        assert_eq!(r.scanned_files, 1);
        assert_eq!(r.groups.len(), 0);
    }

    #[test]
    fn annulation_retourne_resultat_partiel() {
        let dir = TempDir::new().unwrap();
        write_file(dir.path(), "a.txt", b"contenu identique");
        write_file(dir.path(), "b.txt", b"contenu identique");
        let cancelled = Arc::new(AtomicBool::new(true));
        let r = scan_folder(ScanParams::new(dir.path().to_str().unwrap()), cancelled, no_progress);
        let result = r.expect("scan_folder doit reussir meme si annule");
        assert!(result.partial, "le resultat doit etre marque partiel");
    }

    #[test]
    fn progression_est_appelee() {
        let dir = TempDir::new().unwrap();
        write_file(dir.path(), "a.txt", b"contenu identique");
        write_file(dir.path(), "b.txt", b"contenu identique");
        let count = Arc::new(AtomicUsize::new(0));
        let c = Arc::clone(&count);
        scan_folder(
            ScanParams::new(dir.path().to_str().unwrap()),
            no_cancel(),
            move |_, _, _, _: &str| { c.fetch_add(1, Ordering::Relaxed); },
        ).unwrap();
        assert!(count.load(Ordering::Relaxed) > 0);
    }

    #[test]
    fn modified_est_populate() {
        let dir = TempDir::new().unwrap();
        write_file(dir.path(), "a.txt", b"hello world");
        write_file(dir.path(), "b.txt", b"hello world");
        let r = scan_folder(ScanParams::new(dir.path().to_str().unwrap()), no_cancel(), no_progress).unwrap();
        assert_eq!(r.groups.len(), 1);
        for f in &r.groups[0].files {
            assert!(f.modified > 0, "modified doit etre un timestamp unix non nul");
        }
    }

    #[test]
    fn groupes_tries_par_espace_gaspille_decroissant() {
        let dir = TempDir::new().unwrap();
        write_file(dir.path(), "p1.txt", b"petit");
        write_file(dir.path(), "p2.txt", b"petit");
        write_file(dir.path(), "g1.txt", b"grand ici!");
        write_file(dir.path(), "g2.txt", b"grand ici!");
        let r = scan_folder(ScanParams::new(dir.path().to_str().unwrap()), no_cancel(), no_progress).unwrap();
        assert_eq!(r.groups.len(), 2);
        assert!(r.groups[0].size >= r.groups[1].size);
    }

    #[test]
    fn by_folder_isole_les_dossiers() {
        let dir = TempDir::new().unwrap();
        let sub_a = dir.path().join("A");
        let sub_b = dir.path().join("B");
        fs::create_dir(&sub_a).unwrap();
        fs::create_dir(&sub_b).unwrap();

        write_file(&sub_a, "f.txt", b"contenu commun");
        write_file(&sub_b, "f.txt", b"contenu commun");
        write_file(&sub_a, "f2.txt", b"contenu commun");

        let r = scan_folder(
            ScanParams { recursive: true, ..ScanParams::new(dir.path().to_str().unwrap()) },
            no_cancel(), no_progress,
        ).unwrap();
        assert_eq!(r.groups.len(), 1);
        assert_eq!(r.groups[0].files.len(), 3);
        assert!(r.groups[0].folder_key.is_none());

        let r = scan_folder(
            ScanParams {
                recursive: true,
                by_folder: true,
                ..ScanParams::new(dir.path().to_str().unwrap())
            },
            no_cancel(), no_progress,
        ).unwrap();
        assert_eq!(r.groups.len(), 1);
        assert_eq!(r.groups[0].files.len(), 2);
        assert_eq!(r.groups[0].folder_key.as_deref(), Some("A"));
    }

    #[test]
    fn by_folder_met_a_plat_les_sous_sous_dossiers() {
        let dir = TempDir::new().unwrap();
        let sub_a = dir.path().join("A");
        let sub_a_deep = sub_a.join("deep").join("deeper");
        fs::create_dir_all(&sub_a_deep).unwrap();

        write_file(&sub_a, "f1.txt", b"contenu commun");
        write_file(&sub_a_deep, "f2.txt", b"contenu commun");

        let r = scan_folder(
            ScanParams {
                recursive: true,
                by_folder: true,
                ..ScanParams::new(dir.path().to_str().unwrap())
            },
            no_cancel(), no_progress,
        ).unwrap();
        assert_eq!(r.groups.len(), 1);
        assert_eq!(r.groups[0].files.len(), 2);
        assert_eq!(r.groups[0].folder_key.as_deref(), Some("A"));
    }

    #[test]
    fn by_folder_trie_par_dossier_puis_espace() {
        let dir = TempDir::new().unwrap();
        let sub_a = dir.path().join("A");
        let sub_b = dir.path().join("B");
        fs::create_dir(&sub_a).unwrap();
        fs::create_dir(&sub_b).unwrap();

        write_file(&sub_b, "big1.txt", b"grand contenu!!");
        write_file(&sub_b, "big2.txt", b"grand contenu!!");
        write_file(&sub_a, "s1.txt", b"petit");
        write_file(&sub_a, "s2.txt", b"petit");

        let r = scan_folder(
            ScanParams {
                recursive: true,
                by_folder: true,
                ..ScanParams::new(dir.path().to_str().unwrap())
            },
            no_cancel(), no_progress,
        ).unwrap();
        assert_eq!(r.groups.len(), 2);
        assert_eq!(r.groups[0].folder_key.as_deref(), Some("A"));
        assert_eq!(r.groups[1].folder_key.as_deref(), Some("B"));
    }

    #[test]
    fn by_folder_fichiers_racine_ont_cle_vide() {
        let dir = TempDir::new().unwrap();
        write_file(dir.path(), "a.txt", b"contenu racine");
        write_file(dir.path(), "b.txt", b"contenu racine");

        let r = scan_folder(
            ScanParams {
                recursive: true,
                by_folder: true,
                ..ScanParams::new(dir.path().to_str().unwrap())
            },
            no_cancel(), no_progress,
        ).unwrap();
        assert_eq!(r.groups.len(), 1);
        assert_eq!(r.groups[0].folder_key.as_deref(), Some(""));
    }

    // --- Tests pHash ---

    #[test]
    fn phash_ignore_les_non_images() {
        let dir = TempDir::new().unwrap();
        write_file(dir.path(), "a.txt", b"texte quelconque");
        write_file(dir.path(), "b.txt", b"autre texte ici");
        let r = scan_folder(
            ScanParams { find_similar: true, ..ScanParams::new(dir.path().to_str().unwrap()) },
            no_cancel(), no_progress,
        ).unwrap();
        assert_eq!(r.groups.len(), 0);
    }

    #[test]
    fn phash_ne_duplique_pas_les_doublons_exacts() {
        let dir = TempDir::new().unwrap();
        write_solid_png(dir.path(), "a.png", [255, 0, 0], 50);
        fs::copy(dir.path().join("a.png"), dir.path().join("b.png")).unwrap();

        let r = scan_folder(
            ScanParams { find_similar: true, ..ScanParams::new(dir.path().to_str().unwrap()) },
            no_cancel(), no_progress,
        ).unwrap();
        assert_eq!(r.groups.len(), 1);
        assert!(!r.groups[0].similar);
    }

    #[test]
    fn phash_groupe_images_identiques_differentes_tailles() {
        let dir = TempDir::new().unwrap();
        write_solid_png(dir.path(), "small.png", [0, 128, 255], 30);
        write_solid_png(dir.path(), "large.png", [0, 128, 255], 120);

        let r = scan_folder(
            ScanParams { find_similar: true, ..ScanParams::new(dir.path().to_str().unwrap()) },
            no_cancel(), no_progress,
        ).unwrap();
        let similar_groups: Vec<_> = r.groups.iter().filter(|g| g.similar).collect();
        assert_eq!(similar_groups.len(), 1);
        assert_eq!(similar_groups[0].files.len(), 2);
    }

    // --- Tests des optimisations ---

    #[test]
    fn phash_filtre_taille_exclut_images_sous_seuil() {
        let dir = TempDir::new().unwrap();
        // 6 petites images identiques (couleur unie 5x5, ~100 octets)
        for i in 0..6 {
            write_solid_png(dir.path(), &format!("small_{}.png", i), [200, 100, 50], 5);
        }

        let path = dir.path().to_str().unwrap();
        let mut cfg = PHashConfig::default();
        // Seuil de taille : fichiers < 5000 octets exclus, active a partir de 5 images
        cfg.min_file_size_bytes = 5000;
        cfg.min_images_size_filter = 5;

        let r = scan_folder(
            ScanParams {
                find_similar: true,
                phash_config: cfg,
                ..ScanParams::new(path)
            },
            no_cancel(), no_progress,
        ).unwrap();
        // Toutes les images sont sous le seuil de taille = exclues = 0 groupes similaires
        let similar: Vec<_> = r.groups.iter().filter(|g| g.similar).collect();
        assert_eq!(similar.len(), 0);
    }

    #[test]
    fn phash_filtre_taille_inactif_sous_seuil_dimages() {
        let dir = TempDir::new().unwrap();
        // Seulement 3 images (< min_images_size_filter=5) : le filtre ne s'active pas.
        // Dimensions differentes pour eviter la detection comme doublons exacts,
        // meme couleur unie pour que le pHash soit identique.
        write_solid_png(dir.path(), "a.png", [200, 100, 50], 5);
        write_solid_png(dir.path(), "b.png", [200, 100, 50], 6);
        write_solid_png(dir.path(), "c.png", [200, 100, 50], 7);

        let path = dir.path().to_str().unwrap();
        let mut cfg = PHashConfig::default();
        cfg.min_file_size_bytes = 5000;
        cfg.min_images_size_filter = 5; // filtre inactif car seulement 3 images

        let r = scan_folder(
            ScanParams {
                find_similar: true,
                phash_config: cfg,
                ..ScanParams::new(path)
            },
            no_cancel(), no_progress,
        ).unwrap();
        // Filtre inactif = les images sont traitees malgre leur petite taille
        let similar: Vec<_> = r.groups.iter().filter(|g| g.similar).collect();
        assert_eq!(similar.len(), 1);
        assert_eq!(similar[0].files.len(), 3);
    }

    #[test]
    fn phash_aspect_ratio_exclut_paires_incompatibles() {
        let dir = TempDir::new().unwrap();
        // Portrait tres allonge (10x100) et paysage tres allonge (100x10)
        // Meme couleur unie = meme hash pHash (gradient nul)
        // Mais ratio d'aspect tres different : 0.1 vs 10.0
        write_solid_png_dims(dir.path(), "portrait.png", [128, 64, 32], 10, 100);
        write_solid_png_dims(dir.path(), "landscape.png", [128, 64, 32], 100, 10);

        let path = dir.path().to_str().unwrap();
        let mut cfg = PHashConfig::default();
        cfg.aspect_ratio_tolerance = 0.20;
        cfg.min_images_aspect_filter = 2; // actif des 2 images

        let with_filter = scan_folder(
            ScanParams {
                find_similar: true,
                phash_config: cfg,
                ..ScanParams::new(path)
            },
            no_cancel(), no_progress,
        ).unwrap();
        // Avec le filtre, les ratios incompatibles ne sont pas compares
        let similar_with: Vec<_> = with_filter.groups.iter().filter(|g| g.similar).collect();
        assert_eq!(similar_with.len(), 0, "le filtre ratio doit exclure portrait vs paysage");

        // Sans filtre (tolerance 100%) : les images sont groupees
        let mut cfg_no_filter = PHashConfig::default();
        cfg_no_filter.aspect_ratio_tolerance = 1.0; // 100% de tolerance = pas de filtre
        cfg_no_filter.min_images_aspect_filter = 2;

        let without_filter = scan_folder(
            ScanParams {
                find_similar: true,
                phash_config: cfg_no_filter,
                ..ScanParams::new(path)
            },
            no_cancel(), no_progress,
        ).unwrap();
        let similar_without: Vec<_> = without_filter.groups.iter().filter(|g| g.similar).collect();
        assert_eq!(similar_without.len(), 1, "sans filtre ratio, les images solides sont groupees");
    }

    #[test]
    fn phash_deux_passes_meme_resultat_que_une_passe() {
        let dir = TempDir::new().unwrap();
        write_solid_png(dir.path(), "a.png", [0, 200, 100], 40);
        write_solid_png(dir.path(), "b.png", [0, 200, 100], 80);
        write_solid_png(dir.path(), "c.png", [255, 0, 0], 40);

        let path = dir.path().to_str().unwrap();

        let mut cfg_with = PHashConfig::default();
        cfg_with.two_pass_enabled = true;
        cfg_with.min_images_two_pass = 2;

        let mut cfg_without = PHashConfig::default();
        cfg_without.two_pass_enabled = false;

        let r_with = scan_folder(
            ScanParams { find_similar: true, phash_config: cfg_with, ..ScanParams::new(path) },
            no_cancel(), no_progress,
        ).unwrap();
        let r_without = scan_folder(
            ScanParams { find_similar: true, phash_config: cfg_without, ..ScanParams::new(path) },
            no_cancel(), no_progress,
        ).unwrap();

        let similar_with: usize = r_with.groups.iter().filter(|g| g.similar).map(|g| g.files.len()).sum();
        let similar_without: usize = r_without.groups.iter().filter(|g| g.similar).map(|g| g.files.len()).sum();
        assert_eq!(similar_with, similar_without, "deux-passes doit donner le meme resultat");
    }

    #[test]
    fn phash_comparaison_parallele_meme_resultat_que_sequentielle() {
        let dir = TempDir::new().unwrap();
        write_solid_png(dir.path(), "a.png", [100, 150, 200], 30);
        write_solid_png(dir.path(), "b.png", [100, 150, 200], 60);
        write_solid_png(dir.path(), "c.png", [50, 50, 50], 30);

        let path = dir.path().to_str().unwrap();

        let mut cfg_par = PHashConfig::default();
        cfg_par.parallel_compare_enabled = true;
        cfg_par.min_images_parallel_compare = 2;

        let mut cfg_seq = PHashConfig::default();
        cfg_seq.parallel_compare_enabled = false;

        let r_par = scan_folder(
            ScanParams { find_similar: true, phash_config: cfg_par, ..ScanParams::new(path) },
            no_cancel(), no_progress,
        ).unwrap();
        let r_seq = scan_folder(
            ScanParams { find_similar: true, phash_config: cfg_seq, ..ScanParams::new(path) },
            no_cancel(), no_progress,
        ).unwrap();

        let groups_par: usize = r_par.groups.iter().filter(|g| g.similar).count();
        let groups_seq: usize = r_seq.groups.iter().filter(|g| g.similar).count();
        assert_eq!(groups_par, groups_seq, "parallele et sequentiel doivent trouver les memes groupes");
    }

    // --- Nouveaux tests ---

    #[test]
    fn annulation_pendant_phash_retourne_resultat_partiel() {
        let dir = TempDir::new().unwrap();
        write_solid_png(dir.path(), "a.png", [255, 0, 0], 20);
        write_solid_png(dir.path(), "b.png", [0, 255, 0], 20);
        write_solid_png(dir.path(), "c.png", [0, 0, 255], 20);
        write_solid_png(dir.path(), "d.png", [128, 128, 0], 20);

        let path = dir.path().to_str().unwrap();
        let cancelled = Arc::new(AtomicBool::new(true));

        let r = scan_folder(
            ScanParams {
                find_similar: true,
                phash_config: PHashConfig { cache_enabled: false, ..PHashConfig::default() },
                ..ScanParams::new(path)
            },
            cancelled,
            no_progress,
        ).expect("scan_folder doit reussir meme si annule");

        assert!(r.partial, "le resultat doit etre marque partiel quand annule pendant phash");
    }

    #[test]
    fn phash_cache_invalide_si_mtime_change() {
        let dir = TempDir::new().unwrap();
        let cache_dir = TempDir::new().unwrap();
        write_solid_png(dir.path(), "a.png", [10, 20, 30], 30);
        write_solid_png(dir.path(), "b.png", [10, 20, 30], 30);

        let path = dir.path().to_str().unwrap();
        let data_dir = cache_dir.path().to_str().unwrap().to_string();

        // Scan 1 : peuple le cache
        let r1 = scan_folder(
            ScanParams {
                find_similar: true,
                phash_config: PHashConfig { cache_enabled: true, ..PHashConfig::default() },
                data_dir: Some(data_dir.clone()),
                ..ScanParams::new(path)
            },
            no_cancel(),
            no_progress,
        ).expect("scan 1 doit reussir");
        assert!(!r1.partial, "scan 1 ne doit pas etre partiel");

        // Modification du fichier pour changer son mtime
        write_solid_png(dir.path(), "a.png", [255, 128, 64], 30);

        // Attendre que le mtime change (resolution 1 seconde sur certains systemes)
        std::thread::sleep(std::time::Duration::from_millis(10));

        // Scan 2 : le cache doit detecter le changement de mtime et ne pas planter
        let r2 = scan_folder(
            ScanParams {
                find_similar: true,
                phash_config: PHashConfig { cache_enabled: true, ..PHashConfig::default() },
                data_dir: Some(data_dir),
                ..ScanParams::new(path)
            },
            no_cancel(),
            no_progress,
        ).expect("scan 2 doit reussir meme apres changement de mtime");

        // Le resultat doit etre valide (pas de panique, pas de crash)
        assert!(!r2.partial, "scan 2 ne doit pas etre partiel");
    }

    #[test]
    fn phash_aspect_ratio_exclut_exactement_au_seuil() {
        let dir = TempDir::new().unwrap();
        // 1x4 (portrait tres etroit, ratio 0.25) et 4x1 (paysage tres large, ratio 4.0)
        // Meme couleur unie = meme gradient hash
        write_solid_png_dims(dir.path(), "portrait.png", [100, 200, 150], 1, 4);
        write_solid_png_dims(dir.path(), "landscape.png", [100, 200, 150], 4, 1);

        let path = dir.path().to_str().unwrap();

        // Tolerance stricte : 0.1 (10%)
        // Ratios : 0.25 et 4.0, diff relative = |0.25 - 4.0| / 4.0 = 0.9375 >> 0.1
        let mut cfg = PHashConfig::default();
        cfg.aspect_ratio_tolerance = 0.1;
        cfg.min_images_aspect_filter = 2; // actif des 2 images
        cfg.cache_enabled = false;

        let r = scan_folder(
            ScanParams {
                find_similar: true,
                phash_config: cfg,
                ..ScanParams::new(path)
            },
            no_cancel(),
            no_progress,
        ).unwrap();

        let similar: Vec<_> = r.groups.iter().filter(|g| g.similar).collect();
        assert_eq!(
            similar.len(), 0,
            "avec tolerance stricte, portrait et paysage ne doivent pas etre groupes"
        );
    }

    // --- Tests filtres dans scan_folder ---

    #[test]
    fn filtre_extension_exclue_reduit_scan() {
        let dir = TempDir::new().unwrap();
        write_file(dir.path(), "a.txt", b"contenu duplique");
        write_file(dir.path(), "b.txt", b"contenu duplique");
        write_file(dir.path(), "c.tmp", b"contenu duplique");
        write_file(dir.path(), "d.tmp", b"contenu duplique");
        let path = dir.path().to_str().unwrap();
        let r = scan_folder(
            ScanParams {
                exclude_extensions: vec!["tmp".to_string()],
                ..ScanParams::new(path)
            },
            no_cancel(),
            no_progress,
        ).unwrap();
        // Les .tmp sont exclus : seuls a.txt et b.txt sont scannés
        assert_eq!(r.scanned_files, 2);
        assert_eq!(r.groups.len(), 1);
    }

    #[test]
    fn filtre_extension_incluse_restreint_scan() {
        let dir = TempDir::new().unwrap();
        write_file(dir.path(), "a.txt", b"contenu duplique");
        write_file(dir.path(), "b.txt", b"contenu duplique");
        write_file(dir.path(), "c.jpg", b"contenu duplique");
        write_file(dir.path(), "d.jpg", b"contenu duplique");
        let path = dir.path().to_str().unwrap();
        let r = scan_folder(
            ScanParams {
                include_extensions: vec!["jpg".to_string()],
                ..ScanParams::new(path)
            },
            no_cancel(),
            no_progress,
        ).unwrap();
        // Seuls les .jpg sont inclus
        assert_eq!(r.scanned_files, 2);
        assert_eq!(r.groups.len(), 1);
        assert!(r.groups[0].files.iter().all(|f| f.name.ends_with(".jpg")));
    }

    #[test]
    fn filtre_taille_min_exclut_petits_fichiers() {
        let dir = TempDir::new().unwrap();
        write_file(dir.path(), "a.txt", b"x");
        write_file(dir.path(), "b.txt", b"x");
        // min = 1 Ko : les fichiers de 1 octet sont exclus
        let path = dir.path().to_str().unwrap();
        let r = scan_folder(
            ScanParams { min_file_size_kb: 1, ..ScanParams::new(path) },
            no_cancel(),
            no_progress,
        ).unwrap();
        assert_eq!(r.scanned_files, 0);
        assert_eq!(r.groups.len(), 0);
    }

    #[test]
    fn filtre_taille_max_exclut_grands_fichiers() {
        let dir = TempDir::new().unwrap();
        // 2 Ko chacun
        let content = vec![b'A'; 2048];
        write_file(dir.path(), "a.bin", &content);
        write_file(dir.path(), "b.bin", &content);
        // max = 1 Ko : les fichiers de 2 Ko sont exclus
        let path = dir.path().to_str().unwrap();
        let r = scan_folder(
            ScanParams { max_file_size_kb: 1, ..ScanParams::new(path) },
            no_cancel(),
            no_progress,
        ).unwrap();
        assert_eq!(r.scanned_files, 0);
        assert_eq!(r.groups.len(), 0);
    }

    // --- Tests cache exact ---

    #[test]
    fn cache_exact_cree_apres_scan() {
        let dir = TempDir::new().unwrap();
        write_file(dir.path(), "a.txt", b"contenu duplique");
        write_file(dir.path(), "b.txt", b"contenu duplique");
        let path = dir.path().to_str().unwrap();
        let r = scan_folder(
            ScanParams {
                exact_cache_enabled: true,
                data_dir: Some(dir.path().to_str().unwrap().to_string()),
                ..ScanParams::new(path)
            },
            no_cancel(),
            no_progress,
        ).unwrap();
        assert_eq!(r.groups.len(), 1);
        assert!(dir.path().join("exact_cache.json").exists(), "le cache doit etre cree apres le scan");
    }

    #[test]
    fn cache_exact_rescan_retrouve_memes_doublons() {
        let dir = TempDir::new().unwrap();
        write_file(dir.path(), "a.txt", b"contenu duplique");
        write_file(dir.path(), "b.txt", b"contenu duplique");
        write_file(dir.path(), "c.txt", b"unique");
        let path = dir.path().to_str().unwrap();
        let data_dir = dir.path().to_str().unwrap().to_string();

        let make_params = || ScanParams {
            exact_cache_enabled: true,
            data_dir: Some(data_dir.clone()),
            ..ScanParams::new(path)
        };

        let r1 = scan_folder(make_params(), no_cancel(), no_progress).unwrap();
        assert_eq!(r1.groups.len(), 1);

        // Deuxieme scan : le cache est chaud, le resultat doit etre identique.
        let r2 = scan_folder(make_params(), no_cancel(), no_progress).unwrap();
        assert_eq!(r2.groups.len(), 1);
        assert_eq!(
            r2.groups[0].files.len(),
            r1.groups[0].files.len()
        );
    }

    #[test]
    fn audio_phase_desactivee_par_defaut() {
        let dir = TempDir::new().unwrap();
        write_file(dir.path(), "a.mp3", b"audio content");
        let result = scan_folder(ScanParams::new(dir.path().to_str().unwrap()), no_cancel(), no_progress).unwrap();
        assert!(!result.fpcalc_missing, "fpcalc_missing doit etre false quand find_similar_audio=false");
    }

    #[test]
    fn audio_fpcalc_missing_quand_active_et_absent() {
        let dir = TempDir::new().unwrap();
        write_file(dir.path(), "a.mp3", b"audio1");
        write_file(dir.path(), "b.mp3", b"audio2");
        // Ce test ne verifie fpcalc_missing que si fpcalc est absent du systeme.
        if audio_hash::fpcalc_available() {
            return;
        }
        let result = scan_folder(
            ScanParams { find_similar_audio: true, ..ScanParams::new(dir.path().to_str().unwrap()) },
            no_cancel(),
            no_progress,
        ).unwrap();
        assert!(result.fpcalc_missing, "fpcalc_missing doit etre true quand fpcalc est absent");
        assert!(!result.groups.iter().any(|g| g.audio_similar));
    }

    #[test]
    fn audio_phase_ignore_non_audio() {
        let dir = TempDir::new().unwrap();
        write_file(dir.path(), "doc.txt", b"texte");
        write_file(dir.path(), "image.jpg", b"image");
        let result = scan_folder(
            ScanParams { find_similar_audio: true, ..ScanParams::new(dir.path().to_str().unwrap()) },
            no_cancel(),
            no_progress,
        ).unwrap();
        // pas de fichiers audio : aucun groupe audio_similar
        assert!(!result.groups.iter().any(|g| g.audio_similar));
    }
}
