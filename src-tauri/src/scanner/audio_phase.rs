use std::collections::HashMap;
use std::path::Path;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;
use std::time::Instant;

use rayon::prelude::*;

use crate::audio::{AudioCache, AudioMetadata, compute_fingerprint, fingerprint_distance};
use super::fs::group_folder_key;
use super::types::{DuplicateFile, DuplicateGroup, ScanParams, UnionFind};
use super::Ctx;

struct AudioData {
    file: DuplicateFile,
    fingerprint: Vec<i32>,
    duration_secs: f64,
}

pub(super) fn run<F>(
    params: &ScanParams,
    ctx: &Ctx,
    audio_candidates_all: Vec<DuplicateFile>,
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

    let candidates: Vec<DuplicateFile> = audio_candidates_all
        .into_iter()
        .filter(|f| !exact_paths.contains(&f.path))
        .collect();

    let offset = ctx.total_to_hash + ctx.phash_estimate + ctx.video_estimate;

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
                on_progress(offset + n, ctx.total_work, ctx.scanned_files, &f.name, n, ctx.analysis_total, "audio");
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
            on_progress(offset + n, ctx.total_work, ctx.scanned_files, &candidates[i].name, n, ctx.analysis_total, "audio");
            (i, result)
        })
        .collect();

    if cancelled.load(Ordering::Relaxed) {
        return (vec![], true);
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
        return (vec![], true);
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

    let root_path = Path::new(&params.folder);
    let mut new_groups: Vec<DuplicateGroup> = Vec::new();
    for (_, indices) in group_map {
        if indices.len() < 2 { continue; }
        let files: Vec<DuplicateFile> = indices.iter().map(|&i| audio_data[i].file.clone()).collect();
        let folder_key = group_folder_key(&files, root_path, params.by_folder);
        let g = DuplicateGroup {
            id: uuid::Uuid::new_v4().to_string(),
            hash: "audio".to_string(),
            size: files[0].size,
            folder_key,
            similar: false,
            video_similar: false,
            audio_similar: true,
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
