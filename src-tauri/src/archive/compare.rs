//! Comparaison entre archives + recompute des compteurs `duplicated_entries`.
//!
//! Trois entry points :
//! - `compute_comparison` : appariement entree par entree entre deux archives,
//!   utilise par la commande Tauri `get_archive_comparison` (lazy depuis l'UI).
//! - `ensure_cache_for_groups` : repuple le cache `entries_cache` pour les
//!   sessions creees avant son introduction.
//! - `recompute_group_duplicated_entries` : recalcule les compteurs affiches
//!   dans la GroupCard a partir du cache, pour les sessions creees avant que
//!   Phase 2 (similaires) ne compte les similaires.

use super::{hash_archive_entries, ArchiveComparison, ArchiveDetail, ArchiveEntry, ArchiveEntryHash, ArchiveEntryResult, EntryCallback};
use std::path::Path;

/// Calcule la comparaison detaillee entre deux archives (entree par entree).
/// Utilise par la commande Tauri get_archive_comparison, appelee en lazy depuis l'UI.
/// Si `find_similar=true`, calcule en plus le pHash sur les entrees image et marque les paires
/// proches (Hamming <= sim_threshold) avec status="similar" + similarity_score.
pub fn compute_comparison(
    path_a: &str,
    path_b: &str,
    find_similar: bool,
    sim_threshold: u32,
) -> Result<ArchiveComparison, String> {
    // Pour le comparateur, pas de progress ni d'annulation : action ponctuelle utilisateur
    let no_op: EntryCallback = &|| true;
    let entries_a = hash_archive_entries(Path::new(path_a), find_similar, no_op)
        .unwrap_or_default();
    let entries_b = hash_archive_entries(Path::new(path_b), find_similar, no_op)
        .unwrap_or_default();

    use std::collections::HashMap;
    let map_b: HashMap<u64, &ArchiveEntry> = entries_b.iter().map(|e| (e.hash, e)).collect();
    let map_a: HashMap<u64, &ArchiveEntry> = entries_a.iter().map(|e| (e.hash, e)).collect();

    // Phase 1 : appariement exact par xxhash
    let a_entries: Vec<ArchiveEntryResult> = entries_a.iter().map(|e| build_result(e, map_b.get(&e.hash).copied())).collect();
    let b_entries: Vec<ArchiveEntryResult> = entries_b.iter().map(|e| build_result(e, map_a.get(&e.hash).copied())).collect();

    // Phase 2 : appariement similaire par pHash sur les entrees encore "unique"
    let (a_entries, b_entries) = if find_similar {
        upgrade_with_similar(a_entries, &entries_a, b_entries, &entries_b, sim_threshold)
    } else {
        (a_entries, b_entries)
    };

    Ok(ArchiveComparison {
        a: ArchiveDetail { path: path_a.to_string(), entries: a_entries },
        b: ArchiveDetail { path: path_b.to_string(), entries: b_entries },
    })
}

fn build_result(e: &ArchiveEntry, other: Option<&ArchiveEntry>) -> ArchiveEntryResult {
    let hash_hex = format!("{:x}", e.hash);
    if let Some(o) = other {
        ArchiveEntryResult {
            internal_path: e.internal_path.clone(),
            size: e.size,
            status: "duplicate".to_string(),
            duplicate_in: Some(o.internal_path.clone()),
            hash: hash_hex,
            similarity_score: None,
            audio_duration_secs: None,
        }
    } else {
        ArchiveEntryResult {
            internal_path: e.internal_path.clone(),
            size: e.size,
            status: "unique".to_string(),
            duplicate_in: None,
            hash: hash_hex,
            similarity_score: None,
            audio_duration_secs: None,
        }
    }
}

/// Re-ouvre les archives manquantes du cache pour calculer leurs entrees + hashes.
/// Utilise pour les sessions creees avant l'introduction du cache d'entrees.
/// Modifie `entries_cache` en place pour y ajouter les archives nouvellement hashees.
pub fn ensure_cache_for_groups(
    groups: &[crate::scanner::ArchiveGroupResult],
    entries_cache: &mut std::collections::HashMap<String, Vec<ArchiveEntryHash>>,
) {
    let no_op: EntryCallback = &|| true;
    for group in groups {
        for arch in &group.archives {
            if entries_cache.contains_key(&arch.path) { continue; }
            if !std::path::Path::new(&arch.path).exists() { continue; }
            let entries = hash_archive_entries(std::path::Path::new(&arch.path), true, no_op)
                .unwrap_or_default();
            let entries_hash: Vec<ArchiveEntryHash> = entries.into_iter()
                .map(|e| ArchiveEntryHash {
                    internal_path: e.internal_path,
                    size: e.size,
                    xxh3_hex: format!("{:x}", e.hash),
                    phash_coarse: e.phash.as_ref().map(|p| p.0.clone()),
                    phash_fine: e.phash.map(|p| p.1),
                    audio_fingerprint: None,
                    audio_duration_secs: None,
                })
                .collect();
            entries_cache.insert(arch.path.clone(), entries_hash);
        }
    }
}

/// Recalcule `duplicated_entries` et `can_delete` pour chaque archive d'un groupe
/// en utilisant le cache (xxh3 + pHash). Une entree est consideree dupliquee si elle
/// matche au moins une entree dans une autre archive du meme groupe (xxh3 identique
/// ou pHash dans le seuil de Hamming).
///
/// Necessaire pour deux raisons :
/// 1. Sessions creees avant que Phase 2 (similaires) compte les similaires dans
///    `duplicated_entries` : la GroupCard affichait 61/90 au lieu de 90/90.
/// 2. Coherence : le comparateur (lazy) refait son propre matching, on s'assure que
///    le compteur affiche est exactement ce que verra l'utilisateur dans le comparateur.
pub fn recompute_group_duplicated_entries(
    groups: &mut [crate::scanner::ArchiveGroupResult],
    entries_cache: &std::collections::HashMap<String, Vec<ArchiveEntryHash>>,
    sim_threshold: u32,
    audio_sim_threshold: u32,
    audio_duration_tolerance: f64,
) {
    use crate::scanner::hash::hamming_distance;
    use crate::audio::fingerprint_distance;
    let audio_threshold_ratio = audio_sim_threshold as f64 / 32.0;
    for group in groups.iter_mut() {
        for arch_idx in 0..group.archives.len() {
            let my_path = group.archives[arch_idx].path.clone();
            let my_entries = match entries_cache.get(&my_path) {
                Some(e) => e,
                None => continue,  // pas de cache : laisse le compteur tel quel
            };
            let mut matched: std::collections::HashSet<usize> = std::collections::HashSet::new();
            for other_idx in 0..group.archives.len() {
                if other_idx == arch_idx { continue; }
                let other_entries = match entries_cache.get(&group.archives[other_idx].path) {
                    Some(e) => e,
                    None => continue,
                };
                for (my_idx, my_e) in my_entries.iter().enumerate() {
                    if matched.contains(&my_idx) { continue; }
                    // Match xxh3 exact
                    if other_entries.iter().any(|o| o.xxh3_hex == my_e.xxh3_hex) {
                        matched.insert(my_idx);
                        continue;
                    }
                    // Match pHash similar (mode Image)
                    if let (Some(mc), Some(mf)) = (&my_e.phash_coarse, &my_e.phash_fine) {
                        let mut found = false;
                        for o in other_entries {
                            if let (Some(oc), Some(of)) = (&o.phash_coarse, &o.phash_fine) {
                                if hamming_distance(mc, oc) <= sim_threshold
                                    && hamming_distance(mf, of) <= sim_threshold
                                {
                                    matched.insert(my_idx);
                                    found = true;
                                    break;
                                }
                            }
                        }
                        if found { continue; }
                    }
                    // Match audio similar (mode Audio) : fingerprint chromaprint + tolerance de duree.
                    if let (Some(my_fp), Some(my_dur)) = (&my_e.audio_fingerprint, my_e.audio_duration_secs) {
                        for o in other_entries {
                            if let (Some(o_fp), Some(o_dur)) = (&o.audio_fingerprint, o.audio_duration_secs) {
                                let max_dur = my_dur.max(o_dur);
                                if max_dur > 0.0 && (my_dur - o_dur).abs() / max_dur > audio_duration_tolerance {
                                    continue;
                                }
                                if fingerprint_distance(my_fp, o_fp) <= audio_threshold_ratio {
                                    matched.insert(my_idx);
                                    break;
                                }
                            }
                        }
                    }
                }
            }
            let dup_count = matched.len();
            let total = group.archives[arch_idx].total_entries;
            group.archives[arch_idx].duplicated_entries = dup_count;
            group.archives[arch_idx].can_delete = total > 0 && dup_count == total;
        }
    }
}

/// Promeut les entrees "unique" (cote A et B) en "similar" si elles ont un pHash proche.
/// Pairing greedy : chaque entrée unique côté A est appariée à au plus 1 entrée unique côté B
/// (la plus proche dans la limite du seuil). Score = (1 - hamming_fine/64) * 100.
fn upgrade_with_similar(
    mut a_results: Vec<ArchiveEntryResult>,
    a_entries: &[ArchiveEntry],
    mut b_results: Vec<ArchiveEntryResult>,
    b_entries: &[ArchiveEntry],
    sim_threshold: u32,
) -> (Vec<ArchiveEntryResult>, Vec<ArchiveEntryResult>) {
    use crate::scanner::hash::hamming_distance;

    let mut used_b: std::collections::HashSet<usize> = std::collections::HashSet::new();
    for ai in 0..a_results.len() {
        if a_results[ai].status != "unique" { continue; }
        let Some((ac, af)) = a_entries[ai].phash.as_ref() else { continue; };
        let mut best: Option<(usize, u32)> = None;
        for bi in 0..b_results.len() {
            if used_b.contains(&bi) { continue; }
            if b_results[bi].status != "unique" { continue; }
            let Some((bc, bf)) = b_entries[bi].phash.as_ref() else { continue; };
            if hamming_distance(ac, bc) > sim_threshold { continue; }
            let dfine = hamming_distance(af, bf);
            if dfine > sim_threshold { continue; }
            if best.is_none_or(|(_, d)| dfine < d) {
                best = Some((bi, dfine));
            }
        }
        if let Some((bi, dfine)) = best {
            // 64 bits dans le hash fin (hash_size 16x16 / 4 nibbles -> en realite 8x8=64 pour gradient).
            // Le hasher image_hasher::Gradient produit `coarse_size * coarse_size` bits.
            // Pour fine_size=16 → 256 bits ; pour coarse_size=8 → 64 bits. On normalise sur la longueur reelle.
            let total_bits = (b_entries[bi].phash.as_ref().map(|p| p.1.len() * 8).unwrap_or(64)) as f32;
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
    (a_results, b_results)
}
