use std::collections::HashMap;
use std::path::Path;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;
use std::time::Instant;

use base64::engine::general_purpose::STANDARD as BASE64;
use base64::Engine as _;
use rayon::prelude::*;

use crate::phash::{CacheEntry, HashCache, append_perf_log, PerfEntry};
use super::fs::group_folder_key;
use super::hash::{get_image_dimensions, compute_two_pass_hashes, hamming_distance, pair_passes_filters};
use super::types::{DuplicateFile, DuplicateGroup, ImageData, ScanParams, UnionFind};
use super::Ctx;

pub(super) fn run<F>(
    params: &ScanParams,
    ctx: &Ctx,
    phash_candidates_all: Vec<DuplicateFile>,
    existing_groups: &[DuplicateGroup],
    timing_enabled: bool,
    start: &Instant,
    cancelled: &Arc<std::sync::atomic::AtomicBool>,
    on_progress: &F,
) -> (Vec<DuplicateGroup>, bool)
where
    F: Fn(usize, usize, usize, &str, usize, usize, &str) + Send + Sync,
{
    let t_phase_start = Instant::now();
    let cfg = &params.phash_config;
    let data_dir_path = params.data_dir.as_deref().map(Path::new);

    let exact_paths: std::collections::HashSet<String> = existing_groups
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
    super::timing_log(timing_enabled, params.data_dir.as_deref(), start, &format!(
        "phash_after_exact_filter: n={}", total_images
    ));

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
    super::timing_log(timing_enabled, params.data_dir.as_deref(), start, &format!(
        "phash_after_size_filter: n={}", after_size
    ));

    let t_aspect_start = Instant::now();
    let use_aspect_filter = after_size >= cfg.min_images_aspect_filter;

    let mut cache = if cfg.cache_enabled {
        data_dir_path.map_or_else(HashCache::empty, HashCache::load)
    } else {
        HashCache::empty()
    };

    // Verifie le cache sequentiellement (acces &mut) en recuperant aussi l'aspect stocke.
    let cache_results: Vec<Option<(Vec<u8>, Vec<u8>, Option<f32>)>> = candidates
        .iter()
        .map(|f| {
            cache
                .get(&f.path, f.modified, cfg.coarse_hash_size, cfg.fine_hash_size)
                .and_then(|e| {
                    let c = BASE64.decode(&e.coarse).ok()?;
                    let fi = BASE64.decode(&e.fine).ok()?;
                    Some((c, fi, e.aspect))
                })
        })
        .collect();

    let cache_hits = cache_results.iter().filter(|r| r.is_some()).count();

    // Passe parallele combinee : lecture de dimension si necessaire + on_progress pour chaque fichier.
    // - Cache hit avec aspect stocke : aucun I/O disque, on emet juste la progression.
    // - Cache hit sans aspect (ancienne entree) : lecture de l'en-tete image, puis progression.
    // - Cache miss : lecture de l'en-tete image, puis progression (le hash est calcule plus bas).
    // Cela garantit que le pourcentage avance meme quand le cache est froid.
    let phash_done = Arc::new(AtomicUsize::new(0));
    let dimensions: Vec<Option<f32>> = candidates
        .par_iter()
        .zip(cache_results.par_iter())
        .map(|(f, cr)| {
            if cancelled.load(Ordering::Relaxed) {
                return None;
            }
            let aspect = if use_aspect_filter {
                if let Some((_, _, Some(asp))) = cr {
                    Some(*asp)
                } else {
                    get_image_dimensions(&f.path)
                        .map(|(w, h)| if h > 0 { w as f32 / h as f32 } else { 1.0 })
                }
            } else {
                None
            };
            let n = phash_done.fetch_add(1, Ordering::Relaxed) + 1;
            on_progress(ctx.total_to_hash + n, ctx.total_work, ctx.scanned_files, &f.name, n, ctx.analysis_total, "images");
            aspect
        })
        .collect();

    let t_aspect_ms = t_aspect_start.elapsed().as_millis() as u64;
    super::timing_log(timing_enabled, params.data_dir.as_deref(), start, &format!(
        "phash_after_aspect_filter: use_filter={} hits={} misses={}", use_aspect_filter, cache_hits, after_size - cache_hits
    ));

    if cancelled.load(Ordering::Relaxed) {
        return (vec![], true);
    }

    // Calcul des hashs pour les cache misses uniquement (la progression a deja ete emise ci-dessus).
    let t_hash_start = Instant::now();
    let miss_indices: Vec<usize> = cache_results
        .iter()
        .enumerate()
        .filter_map(|(i, r)| if r.is_none() { Some(i) } else { None })
        .collect();

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
            (i, hash)
        })
        .collect();

    if cancelled.load(Ordering::Relaxed) {
        return (vec![], true);
    }

    let mut all_hashes: Vec<Option<(Vec<u8>, Vec<u8>)>> = cache_results
        .into_iter()
        .map(|r| r.map(|(c, fi, _)| (c, fi)))
        .collect();
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
                    aspect: dimensions[i],
                },
            );
            cache_misses += 1;
        }
        all_hashes[i] = hash;
    }
    let t_hash_ms = t_hash_start.elapsed().as_millis() as u64;
    super::timing_log(timing_enabled, params.data_dir.as_deref(), start, &format!(
        "phash_decode_done: cache_misses={}", cache_misses
    ));

    let images: Vec<ImageData> = candidates
        .into_iter()
        .zip(all_hashes.into_iter())
        .zip(dimensions.into_iter())
        .filter_map(|((file, hash_opt), aspect)| {
            let (coarse, fine) = hash_opt?;
            Some(ImageData { file, coarse, fine, aspect })
        })
        .collect();

    let n = images.len();

    let t_compare_start = Instant::now();
    super::timing_log(timing_enabled, params.data_dir.as_deref(), start, &format!(
        "phash_compare_start: n={} pairs={}", n, (n as u64).saturating_mul(n.saturating_sub(1) as u64) / 2
    ));
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
        return (vec![], true);
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
                return (vec![], true);
            }
            for j in (i + 1)..n {
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
    super::timing_log(timing_enabled, params.data_dir.as_deref(), start, &format!(
        "phash_compare_done: pairs_found={} duration_ms={}", pairs_found, t_compare_ms
    ));

    let mut uf = UnionFind::new(n);
    for &(i, j) in &similar_pairs {
        uf.union(i, j);
    }

    let mut hash_groups: HashMap<usize, Vec<usize>> = HashMap::new();
    for i in 0..n {
        let root = uf.find(i);
        hash_groups.entry(root).or_default().push(i);
    }

    let root_path = Path::new(&params.folder);
    let mut new_groups: Vec<DuplicateGroup> = Vec::new();
    for (_, indices) in hash_groups {
        if indices.len() < 2 {
            continue;
        }
        let files: Vec<DuplicateFile> =
            indices.iter().map(|&i| images[i].file.clone()).collect();
        let folder_key = group_folder_key(&files, root_path, params.by_folder);
        let g = DuplicateGroup {
            id: uuid::Uuid::new_v4().to_string(),
            hash: "phash".to_string(),
            size: files[0].size,
            folder_key,
            similar: true,
            video_similar: false,
            audio_similar: false,
            files,
        };
        if ctx.compare_mode && !super::types::is_cross_source_group(&g) {
            continue;
        }
        new_groups.push(g);
    }

    if cfg.cache_enabled {
        if let Some(dir) = data_dir_path {
            let _ = cache.save(dir);
        }
    }

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

    (new_groups, false)
}
