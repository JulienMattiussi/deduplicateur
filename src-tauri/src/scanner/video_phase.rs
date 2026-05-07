use std::collections::HashMap;
use std::path::Path;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;
use std::time::Instant;

use rayon::prelude::*;

use crate::video::{VideoCache, VideoCacheEntry, VideoMetadata, dtw_distance, extract_frame_hashes, get_video_metadata, sequence_distance};
use super::fs::group_folder_key;
use super::types::{DuplicateFile, DuplicateGroup, ScanParams, UnionFind};
use super::Ctx;

struct VideoData {
    file: DuplicateFile,
    hashes: Vec<u64>,
    metadata: VideoMetadata,
}

pub(super) fn run<F>(
    params: &ScanParams,
    ctx: &Ctx,
    video_candidates_all: Vec<DuplicateFile>,
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
    let _ = (timing_enabled, start);

    let exact_paths: std::collections::HashSet<String> = existing_groups
        .iter()
        .flat_map(|g| g.files.iter().map(|f| f.path.clone()))
        .collect();

    let candidates: Vec<DuplicateFile> = video_candidates_all
        .into_iter()
        .filter(|f| !exact_paths.contains(&f.path))
        .collect();

    let offset = ctx.total_to_hash + ctx.phash_estimate + ctx.phash_compare_estimate;

    let mut vcache = if params.video_cache_enabled {
        params.data_dir.as_deref()
            .map_or_else(VideoCache::empty, |d| VideoCache::load(Path::new(d)))
    } else {
        VideoCache::empty()
    };

    // Verification du cache (sequentielle pour acces &mut).
    // On clone les donnees utiles pour liberer l'emprunt avant les insertions futures.
    let cache_results: Vec<Option<(Vec<u64>, VideoMetadata)>> = candidates.iter()
        .map(|f| {
            vcache.get(&f.path, f.modified, f.size, params.video_frames)
                .map(|e| (e.hashes.clone(), VideoMetadata {
                    duration_secs: e.duration_secs,
                    width: e.width,
                    height: e.height,
                    codec: e.codec.clone(),
                }))
        })
        .collect();

    let video_done = Arc::new(AtomicUsize::new(0));

    // Progress pour les cache hits (immediat).
    for (i, cr) in cache_results.iter().enumerate() {
        if cr.is_some() {
            let n = video_done.fetch_add(1, Ordering::Relaxed) + 1;
            on_progress(offset + n, ctx.total_work, ctx.scanned_files, &candidates[i].name, n, ctx.analysis_total, "videos");
        }
    }

    // ffprobe uniquement pour les cache misses.
    let miss_indices: Vec<usize> = cache_results.iter().enumerate()
        .filter_map(|(i, r)| if r.is_none() { Some(i) } else { None })
        .collect();

    let meta_results: Vec<(usize, Option<VideoMetadata>)> = miss_indices
        .into_par_iter()
        .map(|i| {
            if cancelled.load(Ordering::Relaxed) { return (i, None); }
            (i, get_video_metadata(&candidates[i].path))
        })
        .collect();

    if cancelled.load(Ordering::Relaxed) {
        return (vec![], true);
    }

    let mut all_metas: Vec<Option<VideoMetadata>> = vec![None; candidates.len()];
    for (i, meta) in meta_results {
        if meta.is_none() {
            // ffprobe a echoue : on emet quand meme la progression
            let n = video_done.fetch_add(1, Ordering::Relaxed) + 1;
            on_progress(offset + n, ctx.total_work, ctx.scanned_files, &candidates[i].name, n, ctx.analysis_total, "videos");
        }
        all_metas[i] = meta;
    }

    // Extraction des frame hashes pour les misses avec metadata valide.
    let video_done_for_extract = Arc::clone(&video_done);
    let hash_miss_indices: Vec<usize> = (0..candidates.len())
        .filter(|&i| cache_results[i].is_none() && all_metas[i].is_some())
        .collect();

    let miss_hashes: Vec<(usize, Option<Vec<u64>>)> = hash_miss_indices
        .into_par_iter()
        .map(|i| {
            if cancelled.load(Ordering::Relaxed) { return (i, None); }
            let meta = all_metas[i].as_ref().unwrap();
            let hashes = extract_frame_hashes(
                &candidates[i].path,
                params.video_frames,
                meta.duration_secs,
                cancelled,
            );
            let n = video_done_for_extract.fetch_add(1, Ordering::Relaxed) + 1;
            on_progress(offset + n, ctx.total_work, ctx.scanned_files, &candidates[i].name, n, ctx.analysis_total, "videos");
            (i, hashes)
        })
        .collect();

    if cancelled.load(Ordering::Relaxed) {
        return (vec![], true);
    }

    // Fusion des resultats et mise a jour du cache.
    let mut all_hashes: Vec<Option<Vec<u64>>> = cache_results.iter()
        .map(|cr| cr.as_ref().map(|(h, _)| h.clone()))
        .collect();

    for (i, hashes) in miss_hashes {
        if let (Some(ref h), Some(ref meta)) = (&hashes, &all_metas[i]) {
            vcache.insert(candidates[i].path.clone(), VideoCacheEntry {
                mtime: candidates[i].modified,
                size: candidates[i].size,
                n_frames: params.video_frames,
                hashes: h.clone(),
                duration_secs: meta.duration_secs,
                width: meta.width,
                height: meta.height,
                codec: meta.codec.clone(),
            });
        }
        all_hashes[i] = hashes;
    }

    if params.video_cache_enabled {
        if let Some(dir) = params.data_dir.as_deref() {
            let _ = vcache.save(Path::new(dir));
        }
    }

    let video_data: Vec<VideoData> = candidates.iter()
        .zip(all_hashes.iter())
        .enumerate()
        .filter_map(|(i, (file, hash_opt))| {
            let hashes = hash_opt.as_ref()?.clone();
            let metadata = cache_results[i].as_ref()
                .map(|(_, m)| m.clone())
                .or_else(|| all_metas[i].clone())?;
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
        return (vec![], true);
    }

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

    let mut uf = UnionFind::new(n);
    for &(i, j) in &similar_pairs {
        uf.union(i, j);
    }

    let mut group_map: HashMap<usize, Vec<usize>> = HashMap::new();
    for i in 0..n {
        let root = uf.find(i);
        group_map.entry(root).or_default().push(i);
    }

    let root_path = Path::new(&params.folder);
    let mut new_groups: Vec<DuplicateGroup> = Vec::new();
    for (_, indices) in group_map {
        if indices.len() < 2 {
            continue;
        }
        let files: Vec<DuplicateFile> =
            indices.iter().map(|&i| video_data[i].file.clone()).collect();
        let folder_key = group_folder_key(&files, root_path, params.by_folder);
        let g = DuplicateGroup {
            id: uuid::Uuid::new_v4().to_string(),
            hash: "video".to_string(),
            size: files[0].size,
            folder_key,
            similar: false,
            video_similar: true,
            audio_similar: false,
            files,
        };
        if ctx.compare_mode && !super::types::is_cross_source_group(&g) {
            continue;
        }
        new_groups.push(g);
    }

    groups_counter.fetch_add(new_groups.len(), Ordering::Relaxed);
    (new_groups, false)
}
