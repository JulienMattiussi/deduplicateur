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
use super::types::{DuplicateFile, DuplicateGroup, ImageData, ScanParams, build_similar_groups, filter_exact_candidates};
use super::Ctx;

// Phase pHash : 9 args + types intermediaires complexes (cache_results, miss_hashes).
// Boucles a indices conservees pour rester en O(n²) avec fenetre coulissante optimisee.
#[allow(clippy::too_many_arguments, clippy::type_complexity, clippy::needless_range_loop)]
pub(super) fn run<F>(
    params: &ScanParams,
    ctx: &Ctx,
    phash_candidates_all: Vec<DuplicateFile>,
    existing_groups: &[DuplicateGroup],
    timing_enabled: bool,
    start: &Instant,
    cancelled: &Arc<std::sync::atomic::AtomicBool>,
    on_progress: &F,
    groups_counter: &Arc<std::sync::atomic::AtomicUsize>,
) -> (Vec<DuplicateGroup>, bool)
where
    F: Fn(usize, usize, usize, &str, usize, usize, &str) + Send + Sync,
{
    let t_phase_start = Instant::now();
    let cfg = &params.phash_config;
    let data_dir_path = params.data_dir.as_deref().map(Path::new);

    let t_collect_start = Instant::now();
    let candidates = filter_exact_candidates(phash_candidates_all, existing_groups);
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
                .get(&f.path, f.modified, cfg.coarse_hash_size, cfg.fine_hash_size, cfg.use_exif_thumbnail)
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

    // Calcul des hashs pour les cache misses.
    // Si le cache etait vide (tous les fichiers sont des misses), on emet aussi la progression
    // ici pour que l'UI avance pendant le decodage (potentiellement long).
    let t_hash_start = Instant::now();
    let miss_indices: Vec<usize> = cache_results
        .iter()
        .enumerate()
        .filter_map(|(i, r)| if r.is_none() { Some(i) } else { None })
        .collect();

    let total_misses = miss_indices.len();
    let emit_hash_progress = total_misses > cache_hits; // majority are misses -> cache was cold
    let hash_done = Arc::new(AtomicUsize::new(0));

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
                cfg.use_exif_thumbnail,
            );
            if emit_hash_progress {
                let n = hash_done.fetch_add(1, Ordering::Relaxed) + 1;
                // Reporte la progression en ecrasant le compteur de la passe precedente
                on_progress(ctx.total_to_hash + n, ctx.total_work, ctx.scanned_files, &candidates[i].name, n, ctx.analysis_total, "images");
            }
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
                    thumbnail_setting: cfg.use_exif_thumbnail,
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
        .zip(all_hashes)
        .zip(dimensions)
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

    let compare_base = ctx.total_to_hash + ctx.phash_estimate;
    let compare_counter = Arc::new(AtomicUsize::new(0));

    // 2.1 : bucket index actif uniquement quand coarse_threshold == 0 (identite exacte du hash grossier)
    let use_bucket = cfg.use_bucket_index && coarse_threshold == 0;

    let similar_pairs: Vec<(usize, usize)> = if use_bucket {
        // Grouper par hash grossier exact : O(n * taille_bucket) au lieu de O(n^2)
        let mut buckets: HashMap<Vec<u8>, Vec<usize>> = HashMap::new();
        for (i, img) in images.iter().enumerate().take(n) {
            buckets.entry(img.coarse.clone()).or_default().push(i);
        }
        let bucket_vecs: Vec<Vec<usize>> = buckets.into_values().collect();

        if use_parallel {
            let num_buckets = bucket_vecs.len();
            let cf = Arc::clone(&compared_fine);
            let cc = Arc::clone(&compare_counter);
            bucket_vecs
                .into_par_iter()
                .flat_map_iter(|bucket| {
                    if cancelled.load(Ordering::Relaxed) {
                        return vec![].into_iter();
                    }
                    let cnt = cc.fetch_add(1, Ordering::Relaxed);
                    let bucket_name = bucket.first().map(|&i| images[i].file.name.as_str()).unwrap_or("");
                    on_progress(compare_base + cnt, ctx.total_work, ctx.scanned_files, bucket_name, cnt, num_buckets, "images");
                    let cf = Arc::clone(&cf);
                    let m = bucket.len();
                    let mut local = Vec::new();
                    for a in 0..m {
                        for b in (a + 1)..m {
                            let (i, j) = (bucket[a], bucket[b]);
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
                    }
                    local.into_iter()
                })
                .collect()
        } else {
            let num_buckets = bucket_vecs.len();
            let mut pairs = Vec::new();
            let mut cf = 0usize;
            for (b_idx, bucket) in bucket_vecs.iter().enumerate() {
                if cancelled.load(Ordering::Relaxed) {
                    return (vec![], true);
                }
                let cnt = compare_counter.fetch_add(1, Ordering::Relaxed);
                let bucket_name = bucket.first().map(|&i| images[i].file.name.as_str()).unwrap_or("");
                on_progress(compare_base + cnt, ctx.total_work, ctx.scanned_files, bucket_name, b_idx, num_buckets, "images");
                let m = bucket.len();
                for a in 0..m {
                    for b in (a + 1)..m {
                        let (i, j) = (bucket[a], bucket[b]);
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
            }
            compared_fine.store(cf, Ordering::Relaxed);
            pairs
        }
    } else if cfg.use_sorted_aspect && use_aspect_filter {
        // 2.2 : tri par ratio d'aspect + recherche binaire pour eliminer les paires incompatibles
        let mut sorted_indices: Vec<usize> = (0..n).collect();
        sorted_indices.sort_by(|&a, &b| {
            let ra = images[a].aspect.unwrap_or(f32::INFINITY);
            let rb = images[b].aspect.unwrap_or(f32::INFINITY);
            ra.partial_cmp(&rb).unwrap_or(std::cmp::Ordering::Equal)
        });
        let sorted_aspects: Vec<f32> = sorted_indices
            .iter()
            .map(|&i| images[i].aspect.unwrap_or(f32::INFINITY))
            .collect();
        // Les images sans aspect (None) sont a la fin (INFINITY) ; none_start est leur premier indice.
        let none_start = sorted_aspects.partition_point(|v| v.is_finite());
        let tol = cfg.aspect_ratio_tolerance;

        if use_parallel {
            let sc = Arc::clone(&skipped_coarse);
            let cf = Arc::clone(&compared_fine);
            let cc = Arc::clone(&compare_counter);
            (0..n)
                .into_par_iter()
                .flat_map_iter(|pos_a| {
                    if cancelled.load(Ordering::Relaxed) {
                        return vec![].into_iter();
                    }
                    let cnt = cc.fetch_add(1, Ordering::Relaxed);
                    let i = sorted_indices[pos_a];
                    on_progress(compare_base + cnt, ctx.total_work, ctx.scanned_files, &images[i].file.name, cnt, n, "images");
                    let sc = Arc::clone(&sc);
                    let cf = Arc::clone(&cf);
                    let ai = sorted_aspects[pos_a];
                    let mut local = Vec::new();

                    // Pour une image avec aspect connu, la borne haute compatible est ai/(1-tol).
                    // Pour une image sans aspect, on ne compare qu'avec les autres sans aspect.
                    let (real_end, incl_none) = if ai.is_finite() {
                        let end = sorted_aspects
                            .partition_point(|&v| v <= ai / (1.0 - tol))
                            .min(none_start);
                        (end, true)
                    } else {
                        (pos_a + 1, false)
                    };

                    for pos_b in (pos_a + 1)..real_end {
                        let j = sorted_indices[pos_b];
                        if use_two_pass
                            && hamming_distance(&images[i].coarse, &images[j].coarse)
                                > coarse_threshold
                        {
                            sc.fetch_add(1, Ordering::Relaxed);
                            continue;
                        }
                        cf.fetch_add(1, Ordering::Relaxed);
                        if hamming_distance(&images[i].fine, &images[j].fine) <= params.sim_threshold {
                            local.push((i, j));
                        }
                    }

                    // Images sans aspect : comparees avec toutes les images sans aspect,
                    // et depuis une image avec aspect connnu, avec toutes les images sans aspect.
                    let extra_start = if incl_none { none_start } else { pos_a + 1 };
                    for pos_b in extra_start.max(pos_a + 1)..n {
                        let j = sorted_indices[pos_b];
                        if use_two_pass
                            && hamming_distance(&images[i].coarse, &images[j].coarse)
                                > coarse_threshold
                        {
                            sc.fetch_add(1, Ordering::Relaxed);
                            continue;
                        }
                        cf.fetch_add(1, Ordering::Relaxed);
                        if hamming_distance(&images[i].fine, &images[j].fine) <= params.sim_threshold {
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
            for pos_a in 0..n {
                if cancelled.load(Ordering::Relaxed) {
                    return (vec![], true);
                }
                let cnt = compare_counter.fetch_add(1, Ordering::Relaxed);
                let i = sorted_indices[pos_a];
                on_progress(compare_base + cnt, ctx.total_work, ctx.scanned_files, &images[i].file.name, cnt, n, "images");
                let ai = sorted_aspects[pos_a];

                let (real_end, incl_none) = if ai.is_finite() {
                    let end = sorted_aspects
                        .partition_point(|&v| v <= ai / (1.0 - tol))
                        .min(none_start);
                    (end, true)
                } else {
                    (pos_a + 1, false)
                };

                for pos_b in (pos_a + 1)..real_end {
                    let j = sorted_indices[pos_b];
                    if use_two_pass
                        && hamming_distance(&images[i].coarse, &images[j].coarse)
                            > coarse_threshold
                    {
                        sc += 1;
                        continue;
                    }
                    cf += 1;
                    if hamming_distance(&images[i].fine, &images[j].fine) <= params.sim_threshold {
                        pairs.push((i, j));
                    }
                }

                let extra_start = if incl_none { none_start } else { pos_a + 1 };
                for pos_b in extra_start.max(pos_a + 1)..n {
                    let j = sorted_indices[pos_b];
                    if use_two_pass
                        && hamming_distance(&images[i].coarse, &images[j].coarse)
                            > coarse_threshold
                    {
                        sc += 1;
                        continue;
                    }
                    cf += 1;
                    if hamming_distance(&images[i].fine, &images[j].fine) <= params.sim_threshold {
                        pairs.push((i, j));
                    }
                }
            }
            skipped_coarse.store(sc, Ordering::Relaxed);
            compared_fine.store(cf, Ordering::Relaxed);
            pairs
        }
    } else {
        // Fallback O(n^2)
        if use_parallel {
            let sc = Arc::clone(&skipped_coarse);
            let cf = Arc::clone(&compared_fine);
            let cc = Arc::clone(&compare_counter);
            (0..n)
                .into_par_iter()
                .flat_map_iter(|i| {
                    if cancelled.load(Ordering::Relaxed) {
                        return vec![].into_iter();
                    }
                    let cnt = cc.fetch_add(1, Ordering::Relaxed);
                    on_progress(compare_base + cnt, ctx.total_work, ctx.scanned_files, &images[i].file.name, cnt, n, "images");
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
                let cnt = compare_counter.fetch_add(1, Ordering::Relaxed);
                on_progress(compare_base + cnt, ctx.total_work, ctx.scanned_files, &images[i].file.name, cnt, n, "images");
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
        }
    };

    let t_compare_ms = t_compare_start.elapsed().as_millis() as u64;
    let pairs_found = similar_pairs.len();
    super::timing_log(timing_enabled, params.data_dir.as_deref(), start, &format!(
        "phash_compare_done: pairs_found={} duration_ms={}", pairs_found, t_compare_ms
    ));

    let root_path = Path::new(&params.folder);

    // En mode by_folder : filtrer les paires dont les deux fichiers ne sont pas
    // dans le meme premier-niveau-de-sous-dossier. Le mode "par sous-dossier"
    // garantit que les fichiers de dossiers differents ne sont jamais compares
    // entre eux (cf. doc d'aide `filter-sort`). Sans ce filtre, deux images
    // similaires dans des sous-dossiers differents formeraient un groupe avec
    // folder_key="" (rattache au "dossier racine"), ce qui contredit la
    // semantique du mode.
    let similar_pairs = if params.by_folder {
        let subdirs: Vec<String> = images.iter()
            .map(|img| super::fs::first_level_subdir(root_path, Path::new(&img.file.path)))
            .collect();
        similar_pairs.into_iter()
            .filter(|(i, j)| subdirs[*i] == subdirs[*j])
            .collect()
    } else {
        similar_pairs
    };

    let new_groups = build_similar_groups(
        n, similar_pairs,
        |i| images[i].file.clone(),
        "phash", true, false, false,
        |files| group_folder_key(files, root_path, params.by_folder),
        ctx.compare_mode,
    );

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

    groups_counter.fetch_add(new_groups.len(), Ordering::Relaxed);
    (new_groups, false)
}
