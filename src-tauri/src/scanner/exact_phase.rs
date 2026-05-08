use std::collections::HashMap;
use std::path::Path;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;
use std::time::Instant;

use rayon::prelude::*;

use crate::exact_cache::ExactCache;
use super::hash::{hash_partial, hash_full};
use super::types::{DuplicateFile, DuplicateGroup, FileSource, ScanParams};
use super::Ctx;

// Phase de hash exact : signature stable pour matcher l'orchestration scanner/mod.rs.
#[allow(clippy::too_many_arguments, clippy::type_complexity)]
pub(super) fn run<F>(
    params: &ScanParams,
    ctx: &Ctx,
    partition_candidates: Vec<(Option<String>, Vec<Vec<DuplicateFile>>)>,
    timing_enabled: bool,
    start: &Instant,
    cancelled: &Arc<std::sync::atomic::AtomicBool>,
    on_progress: &F,
    groups_counter: &Arc<AtomicUsize>,
) -> (Vec<DuplicateGroup>, bool)
where
    F: Fn(usize, usize, usize, &str, usize, usize, &str) + Send + Sync,
{
    let mut groups: Vec<DuplicateGroup> = Vec::new();
    let mut was_cancelled = false;

    let hashed = Arc::new(AtomicUsize::new(0));
    let full_hashed = Arc::new(AtomicUsize::new(0));

    super::timing_log(timing_enabled, params.data_dir.as_deref(), start, &format!(
        "exact_loop_start: folders={}", partition_candidates.len()
    ));

    let mut exact_cache = if params.exact_cache_enabled {
        let cache = params.data_dir.as_deref()
            .map(|d| ExactCache::load(Path::new(d)))
            .unwrap_or_else(ExactCache::empty);
        super::timing_log(timing_enabled, params.data_dir.as_deref(), start, &format!(
            "exact_cache_loaded: entries={} enabled=true", cache.len()
        ));
        cache
    } else {
        super::timing_log(timing_enabled, params.data_dir.as_deref(), start, "exact_cache_loaded: enabled=false");
        ExactCache::empty()
    };

    for (folder_key, size_candidates) in partition_candidates {
        if cancelled.load(Ordering::Relaxed) {
            was_cancelled = true;
            break;
        }

        let folder_candidates_count: usize = size_candidates.iter().map(|v| v.len()).sum();
        super::timing_log(timing_enabled, params.data_dir.as_deref(), start, &format!(
            "folder_partial_hash_start: key={:?} candidates={}",
            folder_key, folder_candidates_count
        ));

        let partial_raw: Vec<(String, DuplicateFile, Option<(String, u64, u64, String)>)> =
            size_candidates
                .into_par_iter()
                .flat_map(|group| group.into_par_iter())
                .filter_map(|file| {
                    if cancelled.load(Ordering::Relaxed) {
                        return None;
                    }
                    if let Some(entry) = exact_cache.get(&file.path, file.modified, file.size) {
                        if let Some(ph) = &entry.partial_hash {
                            let n = hashed.fetch_add(1, Ordering::Relaxed) + 1;
                            on_progress(n, ctx.total_work, ctx.scanned_files, &file.name, n, ctx.analysis_total, "exact");
                            return Some((ph.clone(), file, None));
                        }
                    }
                    let h = hash_partial(&file.path).ok()?;
                    let n = hashed.fetch_add(1, Ordering::Relaxed) + 1;
                    on_progress(n, ctx.total_work, ctx.scanned_files, &file.name, n, ctx.analysis_total, "exact");
                    let ins = (file.path.clone(), file.modified, file.size, h.clone());
                    Some((h, file, Some(ins)))
                })
                .collect();

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

        let full_hash_count: usize = partial_candidates.iter().map(|v| v.len()).sum();
        super::timing_log(timing_enabled, params.data_dir.as_deref(), start, &format!(
            "folder_full_hash_start: key={:?} candidates={}",
            folder_key, full_hash_count
        ));

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
                            let n = full_hashed.fetch_add(1, Ordering::Relaxed) + 1;
                            on_progress(ctx.total_to_hash, ctx.total_work, ctx.scanned_files, &file.name, n, ctx.analysis_total, "exact");
                            return Some((fh.clone(), file, None));
                        }
                    }
                    let h = hash_full(&file.path).ok()?;
                    let n = full_hashed.fetch_add(1, Ordering::Relaxed) + 1;
                    on_progress(ctx.total_to_hash, ctx.total_work, ctx.scanned_files, &file.name, n, ctx.analysis_total, "exact");
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

        let filtered_groups: Vec<DuplicateGroup> = if ctx.compare_mode {
            partition_groups.into_iter().filter(is_cross_source_group_ref).collect()
        } else {
            partition_groups
        };
        let n = filtered_groups.len();
        groups.extend(filtered_groups);
        groups_counter.fetch_add(n, Ordering::Relaxed);
        super::timing_log(timing_enabled, params.data_dir.as_deref(), start, &format!(
            "folder_done: key={:?}", folder_key
        ));
    }

    super::timing_log(timing_enabled, params.data_dir.as_deref(), start, "exact_loop_done");

    if params.exact_cache_enabled {
        if let Some(data_dir) = params.data_dir.as_deref() {
            let _ = exact_cache.save(Path::new(data_dir));
        }
    }

    super::timing_log(timing_enabled, params.data_dir.as_deref(), start, "exact_cache_save_done");

    (groups, was_cancelled)
}

fn is_cross_source_group_ref(g: &DuplicateGroup) -> bool {
    let has_primary = g.files.iter().any(|f| f.source == Some(FileSource::Primary));
    let has_secondary = g.files.iter().any(|f| f.source == Some(FileSource::Secondary));
    has_primary && has_secondary
}
