use tauri::State;
use crate::{ScanCache, scanner::ArchiveGroupResult};
use crate::archive::{ArchiveComparison, ArchiveDetail, ArchiveEntryHash, ArchiveEntryResult, compute_comparison};
use crate::scanner::hash::hamming_distance;

#[tauri::command]
pub fn get_archive_groups(state: State<ScanCache>) -> Vec<ArchiveGroupResult> {
    state.0.lock().unwrap()
        .as_ref()
        .map(|s| s.archive_groups.clone())
        .unwrap_or_default()
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn get_archive_comparison(
    state: State<'_, ScanCache>,
    path_a: String,
    path_b: String,
    find_similar: Option<bool>,
    sim_threshold: Option<u32>,
    find_similar_audio: Option<bool>,
    audio_sim_threshold: Option<u32>,
    audio_duration_tolerance: Option<f64>,
) -> Result<ArchiveComparison, String> {
    let find_similar = find_similar.unwrap_or(false);
    let sim_threshold = sim_threshold.unwrap_or(10);
    let find_similar_audio = find_similar_audio.unwrap_or(false);
    let audio_sim_threshold = audio_sim_threshold.unwrap_or(20);
    let audio_duration_tolerance = audio_duration_tolerance.unwrap_or(0.20);

    // Lecture cache : si le scan a deja calcule les hashes (xxh3 + pHash + audio_fp) des
    // entrees, on construit la comparaison sans rouvrir / redecoder les archives.
    let cached = {
        let guard = state.0.lock().unwrap();
        guard.as_ref().and_then(|s| {
            let a = s.archive_entries_cache.get(&path_a)?.clone();
            let b = s.archive_entries_cache.get(&path_b)?.clone();
            Some((a, b))
        })
    };
    if let Some((entries_a, entries_b)) = cached {
        return Ok(build_comparison_from_cache(
            &path_a, &path_b, &entries_a, &entries_b,
            find_similar, sim_threshold,
            find_similar_audio, audio_sim_threshold, audio_duration_tolerance,
        ));
    }

    // Fallback : pas de cache (ex. session pre-cache loadee depuis une vieille version).
    // On re-calcule via le chemin lent. Le fallback ne supporte que pHash (mode Image),
    // pas l'audio : pour matcher les audios, il faudrait extraire et fpcalc, ce qui est
    // hors scope du fallback (les sessions audio recentes ont toujours le cache).
    tauri::async_runtime::spawn_blocking(move || {
        compute_comparison(&path_a, &path_b, find_similar, sim_threshold)
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Construit la comparaison detaillee A <-> B a partir des hashes deja calcules pendant
/// le scan. Pas de relecture ni redecodage des archives. Logique strictement equivalente
/// a `compute_comparison` mais en operant sur le cache.
#[allow(clippy::too_many_arguments)]
fn build_comparison_from_cache(
    path_a: &str,
    path_b: &str,
    entries_a: &[ArchiveEntryHash],
    entries_b: &[ArchiveEntryHash],
    find_similar: bool,
    sim_threshold: u32,
    find_similar_audio: bool,
    audio_sim_threshold: u32,
    audio_duration_tolerance: f64,
) -> ArchiveComparison {
    use std::collections::HashMap;
    // Index xxh3 -> entry pour matching exact rapide
    let map_b: HashMap<&str, &ArchiveEntryHash> = entries_b.iter()
        .map(|e| (e.xxh3_hex.as_str(), e))
        .collect();
    let map_a: HashMap<&str, &ArchiveEntryHash> = entries_a.iter()
        .map(|e| (e.xxh3_hex.as_str(), e))
        .collect();

    let mut a_results: Vec<ArchiveEntryResult> = entries_a.iter().map(|e| build_result(e, map_b.get(e.xxh3_hex.as_str()).copied())).collect();
    let mut b_results: Vec<ArchiveEntryResult> = entries_b.iter().map(|e| build_result(e, map_a.get(e.xxh3_hex.as_str()).copied())).collect();

    if find_similar {
        upgrade_with_similar_cached(&mut a_results, entries_a, &mut b_results, entries_b, sim_threshold);
    }
    if find_similar_audio {
        upgrade_with_audio_similar_cached(
            &mut a_results, entries_a, &mut b_results, entries_b,
            audio_sim_threshold, audio_duration_tolerance,
        );
    }

    ArchiveComparison {
        a: ArchiveDetail { path: path_a.to_string(), entries: a_results },
        b: ArchiveDetail { path: path_b.to_string(), entries: b_results },
    }
}

fn build_result(e: &ArchiveEntryHash, other: Option<&ArchiveEntryHash>) -> ArchiveEntryResult {
    if let Some(o) = other {
        ArchiveEntryResult {
            internal_path: e.internal_path.clone(),
            size: e.size,
            status: "duplicate".to_string(),
            duplicate_in: Some(o.internal_path.clone()),
            hash: e.xxh3_hex.clone(),
            similarity_score: None,
            audio_duration_secs: e.audio_duration_secs,
        }
    } else {
        ArchiveEntryResult {
            internal_path: e.internal_path.clone(),
            size: e.size,
            status: "unique".to_string(),
            duplicate_in: None,
            hash: e.xxh3_hex.clone(),
            similarity_score: None,
            audio_duration_secs: e.audio_duration_secs,
        }
    }
}

/// Promeut les entrees "unique" cote A et B en "similar" si leurs fingerprints audio
/// (chromaprint via fpcalc) sont proches ET leur duree est dans la tolerance. Pairing
/// greedy comme `upgrade_with_similar_cached` mais sur le matching audio.
/// Score de similarite = `(1 - distance) * 100` (distance dans [0, 1]).
fn upgrade_with_audio_similar_cached(
    a_results: &mut [ArchiveEntryResult],
    a_entries: &[ArchiveEntryHash],
    b_results: &mut [ArchiveEntryResult],
    b_entries: &[ArchiveEntryHash],
    audio_sim_threshold: u32,
    audio_duration_tolerance: f64,
) {
    use crate::audio::fingerprint_distance;
    let threshold_ratio = audio_sim_threshold as f64 / 32.0;
    let mut used_b: std::collections::HashSet<usize> = std::collections::HashSet::new();
    for ai in 0..a_results.len() {
        if a_results[ai].status != "unique" { continue; }
        let (Some(a_fp), Some(a_dur)) = (&a_entries[ai].audio_fingerprint, a_entries[ai].audio_duration_secs) else { continue; };
        let mut best: Option<(usize, f64)> = None;
        for bi in 0..b_results.len() {
            if used_b.contains(&bi) { continue; }
            if b_results[bi].status != "unique" { continue; }
            let (Some(b_fp), Some(b_dur)) = (&b_entries[bi].audio_fingerprint, b_entries[bi].audio_duration_secs) else { continue; };
            let max_dur = a_dur.max(b_dur);
            if max_dur > 0.0 && (a_dur - b_dur).abs() / max_dur > audio_duration_tolerance {
                continue;
            }
            let dist = fingerprint_distance(a_fp, b_fp);
            if dist > threshold_ratio { continue; }
            if best.is_none_or(|(_, d)| dist < d) {
                best = Some((bi, dist));
            }
        }
        if let Some((bi, dist)) = best {
            let score = ((1.0 - dist) * 100.0) as f32;
            a_results[ai].status = "similar".to_string();
            a_results[ai].duplicate_in = Some(b_results[bi].internal_path.clone());
            a_results[ai].similarity_score = Some(score);
            b_results[bi].status = "similar".to_string();
            b_results[bi].duplicate_in = Some(a_results[ai].internal_path.clone());
            b_results[bi].similarity_score = Some(score);
            used_b.insert(bi);
        }
    }
}

/// Promeut les entrees "unique" cote A et B en "similar" si leurs pHash sont proches.
/// Identique a la fonction de `archive::mod.rs::upgrade_with_similar` mais opere sur ArchiveEntryHash.
fn upgrade_with_similar_cached(
    a_results: &mut [ArchiveEntryResult],
    a_entries: &[ArchiveEntryHash],
    b_results: &mut [ArchiveEntryResult],
    b_entries: &[ArchiveEntryHash],
    sim_threshold: u32,
) {
    let mut used_b: std::collections::HashSet<usize> = std::collections::HashSet::new();
    for ai in 0..a_results.len() {
        if a_results[ai].status != "unique" { continue; }
        let (Some(ac), Some(af)) = (&a_entries[ai].phash_coarse, &a_entries[ai].phash_fine) else { continue; };
        let mut best: Option<(usize, u32)> = None;
        for bi in 0..b_results.len() {
            if used_b.contains(&bi) { continue; }
            if b_results[bi].status != "unique" { continue; }
            let (Some(bc), Some(bf)) = (&b_entries[bi].phash_coarse, &b_entries[bi].phash_fine) else { continue; };
            if hamming_distance(ac, bc) > sim_threshold { continue; }
            let dfine = hamming_distance(af, bf);
            if dfine > sim_threshold { continue; }
            if best.is_none_or(|(_, d)| dfine < d) {
                best = Some((bi, dfine));
            }
        }
        if let Some((bi, dfine)) = best {
            let total_bits = (b_entries[bi].phash_fine.as_ref().map(|p| p.len() * 8).unwrap_or(64)) as f32;
            let score = (1.0 - dfine as f32 / total_bits) * 100.0;
            a_results[ai].status = "similar".to_string();
            a_results[ai].duplicate_in = Some(b_results[bi].internal_path.clone());
            a_results[ai].similarity_score = Some(score);
            b_results[bi].status = "similar".to_string();
            b_results[bi].duplicate_in = Some(a_results[ai].internal_path.clone());
            b_results[bi].similarity_score = Some(score);
            used_b.insert(bi);
        }
    }
}
