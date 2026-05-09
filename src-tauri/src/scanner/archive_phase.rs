use std::collections::HashMap;
use std::path::Path;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};

use rayon::prelude::*;

use crate::archive::{detect_archive_format, hash_archive_entries, count_entries_fast, ArchiveEntryHash};
use crate::archive::extractor::{extract_image_entries, extract_audio_entries, ExtractedImage};
use crate::audio::{compute_fingerprint, fingerprint_distance};
use super::hash::{hamming_distance, compute_two_pass_hashes};
use super::types::{DuplicateFile, ArchiveGroupResult, ArchiveInGroup};
use crate::scanner::types::UnionFind;

/// Resultat de la phase archives : groupes + cache d'entrees indexe par chemin d'archive.
/// Le cache permet au comparateur (lazy, lance au clic utilisateur) d'eviter le recalcul
/// complet de hash_archive_entries(compute_phash=true), qui peut prendre plusieurs minutes
/// sur une archive contenant beaucoup d'images.
pub struct ArchivePhaseResult {
    pub groups: Vec<ArchiveGroupResult>,
    pub entries_cache: HashMap<String, Vec<ArchiveEntryHash>>,
}

/// Entree d'archive enrichie avec son indice d'archive parente.
/// `phash` est rempli en Phase 2 (mode Image) pour les entrees image, `audio_fp` en
/// Phase 3 (mode Audio) pour les entrees audio. Les deux sont mutuellement exclusifs
/// (mode Image et Audio incompatibles dans le meme scan). Persistes dans le cache
/// pour eviter le recalcul lors du clic Comparer.
struct EnrichedEntry {
    arch_idx: usize,
    internal_path: String,
    size: u64,
    hash: u64,
    phash: Option<(Vec<u8>, Vec<u8>)>,
    audio_fp: Option<(Vec<i32>, f64)>,
}

#[allow(clippy::too_many_arguments)]
pub fn run(
    files: &[DuplicateFile],
    cancelled: &Arc<AtomicBool>,
    progress_base: usize,
    total_work: usize,
    find_similar: bool,
    sim_threshold: u32,
    find_similar_audio: bool,
    audio_sim_threshold: u32,
    audio_duration_tolerance: f64,
    data_dir: Option<&str>,
    skip_extraction: bool,
    on_progress: &(impl Fn(usize, usize, usize, &str, usize, usize, &str) + Send + Sync),
) -> ArchivePhaseResult {
    // Filtrer les archives
    let archives: Vec<&DuplicateFile> = files.iter()
        .filter(|f| detect_archive_format(Path::new(&f.path)).is_some())
        .collect();

    if archives.len() < 2 {
        return ArchivePhaseResult { groups: vec![], entries_cache: HashMap::new() };
    }

    // Estimer le total d'entrees pour la progression
    let estimated_total: usize = archives.iter()
        .map(|f| count_entries_fast(Path::new(&f.path)))
        .sum();
    let estimated_total = estimated_total.max(1);

    let mut all_entries: Vec<EnrichedEntry> = Vec::new();
    let mut hash_map: HashMap<u64, Vec<usize>> = HashMap::new();  // hash -> indices dans all_entries
    let mut archive_total_entries: Vec<usize> = vec![0; archives.len()];
    let processed = std::sync::atomic::AtomicUsize::new(0);

    for (arch_idx, archive_file) in archives.iter().enumerate() {
        if cancelled.load(Ordering::Relaxed) { break; }
        let path = &archive_file.path;
        // Callback per-entry : remonte le progress en temps reel et permet d'interrompre
        // mid-archive sur Cancel (sinon on attend la fin de l'archive).
        let on_entry = || -> bool {
            if cancelled.load(Ordering::Relaxed) { return false; }
            let n = processed.fetch_add(1, Ordering::Relaxed) + 1;
            on_progress(
                progress_base + n,
                total_work,
                0,
                path,
                n,
                estimated_total.max(n),  // si on depasse l'estime, decaler la cible
                "archives",
            );
            true
        };
        // Phase 1 fait juste du xxh3 streaming (pas de pHash in-memory). Le pHash est
        // calcule plus tard via extraction temp dir + pipeline standard parallele.
        let entries = hash_archive_entries(Path::new(path), false, &on_entry).unwrap_or_default();
        archive_total_entries[arch_idx] = entries.len();
        for entry in entries {
            let idx = all_entries.len();
            all_entries.push(EnrichedEntry {
                arch_idx,
                internal_path: entry.internal_path,
                size: entry.size,
                hash: entry.hash,
                phash: None,    // rempli en Phase 2 (mode Image)
                audio_fp: None, // rempli en Phase 3 (mode Audio)
            });
            hash_map.entry(all_entries[idx].hash).or_default().push(idx);
        }
    }

    let n = archives.len();
    let mut uf = UnionFind::new(n);
    let mut duplicated_entries: Vec<HashMap<String, u64>> = vec![HashMap::new(); n];
    let mut shared_count_per_pair: HashMap<(usize, usize), usize> = HashMap::new();

    // ── PASSE 1 : appariement EXACT (hash xxh3 identique entre 2+ archives) ──
    for refs in hash_map.values() {
        let arch_indices: Vec<usize> = {
            let mut seen = std::collections::HashSet::new();
            refs.iter().filter_map(|&i| {
                let a = all_entries[i].arch_idx;
                if seen.insert(a) { Some(a) } else { None }
            }).collect()
        };
        if arch_indices.len() < 2 { continue; }
        for i in 1..arch_indices.len() {
            uf.union(arch_indices[0], arch_indices[i]);
        }
        for &i in refs {
            let e = &all_entries[i];
            duplicated_entries[e.arch_idx].entry(e.internal_path.clone()).or_insert(e.size);
        }
        let root0 = arch_indices[0];
        for &other in &arch_indices[1..] {
            let key = (root0.min(other), root0.max(other));
            *shared_count_per_pair.entry(key).or_insert(0) += 1;
        }
    }

    // ── PASSE 2 : extraction + pHash parallele + appariement SIMILAIRE ──
    // Strategie : extraire toutes les entrees image vers un temp dir, puis utiliser
    // le pipeline pHash standard (parallele rayon + EXIF thumbnail pour les JPEG)
    // pour calculer les hashes. Enfin, matching O(n²) inter-archives sur les images
    // pas encore dans un groupe exact.
    if find_similar && !skip_extraction && !cancelled.load(Ordering::Relaxed) {
        if let Some(dir) = data_dir {
            let archive_paths: Vec<String> = archives.iter().map(|f| f.path.clone()).collect();
            let extract_cancelled = cancelled.clone();
            // Estimation phase 2 : count d'images deja calcule en amont (scanner/mod.rs) et
            // ajoute a total_work. Ici on estime localement avec la meme regle pour avoir
            // un denominateur de phase coherent. Le pHash parallele emet ensuite chaque etape.
            let p2_done = std::sync::atomic::AtomicUsize::new(0);

            let extract_cb = || -> bool {
                if extract_cancelled.load(Ordering::Relaxed) { return false; }
                let n2 = p2_done.fetch_add(1, Ordering::Relaxed) + 1;
                let n_overall = processed.fetch_add(1, Ordering::Relaxed) + 1;
                on_progress(
                    progress_base + n_overall,
                    total_work,
                    0,
                    "",  // extraction : pas de fichier specifique a remonter (rapide)
                    n2,
                    estimated_total.max(n_overall),  // cap defensif si on depasse l'estimate
                    "archives_phash",
                );
                true
            };
            if let Ok(extraction) = extract_image_entries(&archive_paths, Path::new(dir), &extract_cb) {
                let images_count = extraction.items.len();
                // p2_real_total = extraction (deja faite) + pHash (a faire) = images_count * 2
                let p2_real_total = (images_count * 2).max(p2_done.load(Ordering::Relaxed));
                let phash_done = std::sync::atomic::AtomicUsize::new(images_count);

                // pHash parallele via rayon. compute_two_pass_hashes utilise EXIF thumbnail
                // pour les JPEG (decodage thumbnail 160x120 au lieu de l'image complete).
                let phashes: Vec<Option<(Vec<u8>, Vec<u8>)>> = extraction.items
                    .par_iter()
                    .map(|img: &ExtractedImage| {
                        if extract_cancelled.load(Ordering::Relaxed) { return None; }
                        let path_str = img.temp_path.to_str().unwrap_or("");
                        let hash = compute_two_pass_hashes(path_str, 8, 16, true);
                        let n2 = phash_done.fetch_add(1, Ordering::Relaxed) + 1;
                        let n_overall = processed.fetch_add(1, Ordering::Relaxed) + 1;
                        on_progress(
                            progress_base + n_overall,
                            total_work,
                            0,
                            &img.internal_path,  // chemin interne de l'image en cours de hash
                            n2,
                            p2_real_total,
                            "archives_phash",
                        );
                        hash
                    })
                    .collect();

                // Persister les pHash dans all_entries via index (arch_idx, internal_path).
                // Permet de remplir le cache `entries_cache` en fin de phase pour le comparateur.
                let mut entry_index_by_key: HashMap<(usize, String), usize> = HashMap::new();
                for (i, e) in all_entries.iter().enumerate() {
                    entry_index_by_key.insert((e.arch_idx, e.internal_path.clone()), i);
                }
                for (i, img) in extraction.items.iter().enumerate() {
                    if let Some(ph) = &phashes[i] {
                        if let Some(&entry_i) = entry_index_by_key.get(&(img.archive_idx, img.internal_path.clone())) {
                            all_entries[entry_i].phash = Some(ph.clone());
                        }
                    }
                }

                if !cancelled.load(Ordering::Relaxed) {
                    // Indices des images extraites avec pHash valide ET dont l'entree source
                    // n'est pas encore dans un groupe exact.
                    let candidates: Vec<usize> = extraction.items.iter().enumerate()
                        .filter(|(i, img)| {
                            phashes[*i].is_some()
                                && !duplicated_entries[img.archive_idx].contains_key(&img.internal_path)
                        })
                        .map(|(i, _)| i)
                        .collect();

                    // O(n²) inter-archive uniquement
                    for w in 0..candidates.len() {
                        if cancelled.load(Ordering::Relaxed) { break; }
                        for v in (w + 1)..candidates.len() {
                            let i = candidates[w];
                            let j = candidates[v];
                            let img_i = &extraction.items[i];
                            let img_j = &extraction.items[j];
                            if img_i.archive_idx == img_j.archive_idx { continue; }
                            let (ci, fi) = phashes[i].as_ref().unwrap();
                            let (cj, fj) = phashes[j].as_ref().unwrap();
                            if hamming_distance(ci, cj) > sim_threshold { continue; }
                            if hamming_distance(fi, fj) > sim_threshold { continue; }
                            uf.union(img_i.archive_idx, img_j.archive_idx);
                            // Recuperer la taille depuis all_entries (par archive + internal_path)
                            let size_i = all_entries.iter().find(|e|
                                e.arch_idx == img_i.archive_idx && e.internal_path == img_i.internal_path
                            ).map(|e| e.size).unwrap_or(0);
                            let size_j = all_entries.iter().find(|e|
                                e.arch_idx == img_j.archive_idx && e.internal_path == img_j.internal_path
                            ).map(|e| e.size).unwrap_or(0);
                            duplicated_entries[img_i.archive_idx].entry(img_i.internal_path.clone()).or_insert(size_i);
                            duplicated_entries[img_j.archive_idx].entry(img_j.internal_path.clone()).or_insert(size_j);
                            let key = (img_i.archive_idx.min(img_j.archive_idx), img_i.archive_idx.max(img_j.archive_idx));
                            *shared_count_per_pair.entry(key).or_insert(0) += 1;
                        }
                    }
                }
                // extraction (et son TempDir) est drop ici -> cleanup automatique
            }
        }
    }

    // ── PASSE 3 : extraction + fpcalc parallele + appariement AUDIO SIMILAIRE ──
    // Strategie symetrique a la PASSE 2 (images) : extraction des entrees audio vers
    // un temp dir, fpcalc parallele rayon, matching O(n²) inter-archives sur les audio
    // pas encore dans un groupe exact. Mode Audio et mode Image sont mutuellement
    // exclusifs cote ScanParams, donc une seule des deux passes tourne par scan.
    if find_similar_audio && !skip_extraction && !cancelled.load(Ordering::Relaxed) {
        if let Some(dir) = data_dir {
            let archive_paths: Vec<String> = archives.iter().map(|f| f.path.clone()).collect();
            let extract_cancelled = cancelled.clone();
            let p3_done = std::sync::atomic::AtomicUsize::new(0);

            let extract_cb = || -> bool {
                if extract_cancelled.load(Ordering::Relaxed) { return false; }
                let n3 = p3_done.fetch_add(1, Ordering::Relaxed) + 1;
                let n_overall = processed.fetch_add(1, Ordering::Relaxed) + 1;
                on_progress(
                    progress_base + n_overall,
                    total_work,
                    0,
                    "",
                    n3,
                    estimated_total.max(n_overall),
                    "archives_audio",
                );
                true
            };
            if let Ok(extraction) = extract_audio_entries(&archive_paths, Path::new(dir), &extract_cb) {
                let audio_count = extraction.items.len();
                let p3_real_total = (audio_count * 2).max(p3_done.load(Ordering::Relaxed));
                let fp_done = std::sync::atomic::AtomicUsize::new(audio_count);

                // fpcalc parallele via rayon : un subprocess par item, en parallele.
                // Note : fpcalc n'utilise pas EXIF thumbnail comme pHash, c'est juste
                // un fingerprint chromaprint sur le contenu audio decompresse.
                let fingerprints: Vec<Option<(Vec<i32>, f64)>> = extraction.items
                    .par_iter()
                    .map(|item: &ExtractedImage| {
                        if extract_cancelled.load(Ordering::Relaxed) { return None; }
                        let path_str = item.temp_path.to_str().unwrap_or("");
                        let result = compute_fingerprint(path_str);
                        let n3 = fp_done.fetch_add(1, Ordering::Relaxed) + 1;
                        let n_overall = processed.fetch_add(1, Ordering::Relaxed) + 1;
                        on_progress(
                            progress_base + n_overall,
                            total_work,
                            0,
                            &item.internal_path,
                            n3,
                            p3_real_total,
                            "archives_audio",
                        );
                        result
                    })
                    .collect();

                // Persister fingerprints + duree dans all_entries (cache pour comparateur).
                let mut entry_index_by_key: HashMap<(usize, String), usize> = HashMap::new();
                for (i, e) in all_entries.iter().enumerate() {
                    entry_index_by_key.insert((e.arch_idx, e.internal_path.clone()), i);
                }
                for (i, item) in extraction.items.iter().enumerate() {
                    if let Some(fp) = &fingerprints[i] {
                        if let Some(&entry_i) = entry_index_by_key.get(&(item.archive_idx, item.internal_path.clone())) {
                            all_entries[entry_i].audio_fp = Some(fp.clone());
                        }
                    }
                }

                if !cancelled.load(Ordering::Relaxed) {
                    // Matching inter-archive sur les audios pas encore dans un groupe exact.
                    // sim_threshold est un nb de bits (0..32) ramene a un ratio par division par 32
                    // pour rester coherent avec audio_phase standard (threshold = pct/100, ratio).
                    let audio_threshold_ratio = audio_sim_threshold as f64 / 32.0;

                    let candidates: Vec<usize> = extraction.items.iter().enumerate()
                        .filter(|(i, item)| {
                            fingerprints[*i].is_some()
                                && !duplicated_entries[item.archive_idx].contains_key(&item.internal_path)
                        })
                        .map(|(i, _)| i)
                        .collect();

                    for w in 0..candidates.len() {
                        if cancelled.load(Ordering::Relaxed) { break; }
                        for v in (w + 1)..candidates.len() {
                            let i = candidates[w];
                            let j = candidates[v];
                            let item_i = &extraction.items[i];
                            let item_j = &extraction.items[j];
                            if item_i.archive_idx == item_j.archive_idx { continue; }
                            let (fp_i, dur_i) = fingerprints[i].as_ref().unwrap();
                            let (fp_j, dur_j) = fingerprints[j].as_ref().unwrap();
                            // Tolerance de duree : si les deux durees different de plus que la
                            // tolerance, on skip (meme regle qu'audio_phase standard).
                            let max_dur = dur_i.max(*dur_j);
                            if max_dur > 0.0 && (dur_i - dur_j).abs() / max_dur > audio_duration_tolerance {
                                continue;
                            }
                            let dist = fingerprint_distance(fp_i, fp_j);
                            if dist > audio_threshold_ratio { continue; }
                            uf.union(item_i.archive_idx, item_j.archive_idx);
                            let size_i = all_entries.iter().find(|e|
                                e.arch_idx == item_i.archive_idx && e.internal_path == item_i.internal_path
                            ).map(|e| e.size).unwrap_or(0);
                            let size_j = all_entries.iter().find(|e|
                                e.arch_idx == item_j.archive_idx && e.internal_path == item_j.internal_path
                            ).map(|e| e.size).unwrap_or(0);
                            duplicated_entries[item_i.archive_idx].entry(item_i.internal_path.clone()).or_insert(size_i);
                            duplicated_entries[item_j.archive_idx].entry(item_j.internal_path.clone()).or_insert(size_j);
                            let key = (item_i.archive_idx.min(item_j.archive_idx), item_i.archive_idx.max(item_j.archive_idx));
                            *shared_count_per_pair.entry(key).or_insert(0) += 1;
                        }
                    }
                }
                // extraction (et son TempDir) est drop ici -> cleanup automatique
            }
        }
    }

    // Construire les groupes via Union-Find
    let mut group_map: HashMap<usize, Vec<usize>> = HashMap::new();
    for i in 0..n {
        let root = uf.find(i);
        group_map.entry(root).or_default().push(i);
    }

    let mut results = Vec::new();
    for (_, indices) in group_map {
        if indices.len() < 2 { continue; }
        let shared_count = {
            let mut total = 0usize;
            for w in 0..indices.len() {
                for v in (w + 1)..indices.len() {
                    let key = (indices[w].min(indices[v]), indices[w].max(indices[v]));
                    total += shared_count_per_pair.get(&key).copied().unwrap_or(0);
                }
            }
            total.max(1)
        };

        let archive_list: Vec<ArchiveInGroup> = indices.iter().map(|&idx| {
            let dup_count = duplicated_entries[idx].len();
            let total = archive_total_entries[idx];
            let wasted = duplicated_entries[idx].values().sum();
            ArchiveInGroup {
                path: archives[idx].path.clone(),
                size: archives[idx].size,
                modified: archives[idx].modified,
                total_entries: total,
                duplicated_entries: dup_count,
                can_delete: total > 0 && dup_count == total,
                wasted_bytes: wasted,
            }
        }).collect();

        results.push(ArchiveGroupResult {
            id: uuid::Uuid::new_v4().to_string(),
            archives: archive_list,
            shared_entry_count: shared_count,
        });
    }

    // Construire le cache : pour chaque archive, la liste de ses entrees avec hashes.
    // Le comparateur (clic Comparer) utilisera ce cache au lieu de relire/redecoder.
    let mut entries_cache: HashMap<String, Vec<ArchiveEntryHash>> = HashMap::new();
    for entry in &all_entries {
        let arch_path = archives[entry.arch_idx].path.clone();
        let (phash_coarse, phash_fine) = match &entry.phash {
            Some((c, f)) => (Some(c.clone()), Some(f.clone())),
            None => (None, None),
        };
        let (audio_fingerprint, audio_duration_secs) = match &entry.audio_fp {
            Some((fp, dur)) => (Some(fp.clone()), Some(*dur)),
            None => (None, None),
        };
        entries_cache.entry(arch_path).or_default().push(ArchiveEntryHash {
            internal_path: entry.internal_path.clone(),
            size: entry.size,
            xxh3_hex: format!("{:x}", entry.hash),
            phash_coarse,
            phash_fine,
            audio_fingerprint,
            audio_duration_secs,
        });
    }

    ArchivePhaseResult { groups: results, entries_cache }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    use tempfile::{NamedTempFile, TempDir};
    use crate::scanner::types::DuplicateFile;

    fn no_progress(_: usize, _: usize, _: usize, _: &str, _: usize, _: usize, _: &str) {}
    fn no_cancel() -> Arc<AtomicBool> { Arc::new(AtomicBool::new(false)) }

    fn make_zip_file(entries: &[(&str, &[u8])]) -> NamedTempFile {
        let mut f = NamedTempFile::with_suffix(".zip").unwrap();
        {
            let mut w = zip::ZipWriter::new(std::io::BufWriter::new(f.as_file_mut()));
            let opts = zip::write::SimpleFileOptions::default();
            for (name, data) in entries {
                w.start_file(*name, opts).unwrap();
                w.write_all(data).unwrap();
            }
            w.finish().unwrap();
        }
        f
    }

    fn make_dup_file(path: &str) -> DuplicateFile {
        let metadata = std::fs::metadata(path).ok();
        let size = metadata.as_ref().map(|m| m.len()).unwrap_or(0);
        DuplicateFile {
            path: path.to_string(),
            name: std::path::Path::new(path).file_name()
                .map(|n| n.to_string_lossy().to_string())
                .unwrap_or_default(),
            size,
            modified: 0,
            video_metadata: None,
            audio_metadata: None,
            source: None,
        }
    }

    #[test]
    fn deux_zips_contenu_identique_groupe_can_delete() {
        let zip1 = make_zip_file(&[("a.txt", b"same"), ("b.txt", b"content")]);
        let zip2 = make_zip_file(&[("a.txt", b"same"), ("b.txt", b"content")]);
        let files = vec![
            make_dup_file(zip1.path().to_str().unwrap()),
            make_dup_file(zip2.path().to_str().unwrap()),
        ];
        let groups = run(&files, &no_cancel(), 0, 100, false, 10, false, 20, 0.20, None, false, &no_progress).groups;
        assert_eq!(groups.len(), 1);
        assert_eq!(groups[0].archives.len(), 2);
        assert!(groups[0].archives.iter().all(|a| a.can_delete));
    }

    #[test]
    fn deux_zips_partiellement_identiques_can_delete_false() {
        let zip1 = make_zip_file(&[("common.txt", b"shared"), ("unique1.txt", b"only1")]);
        let zip2 = make_zip_file(&[("common.txt", b"shared"), ("unique2.txt", b"only2")]);
        let files = vec![
            make_dup_file(zip1.path().to_str().unwrap()),
            make_dup_file(zip2.path().to_str().unwrap()),
        ];
        let groups = run(&files, &no_cancel(), 0, 100, false, 10, false, 20, 0.20, None, false, &no_progress).groups;
        assert_eq!(groups.len(), 1);
        assert!(groups[0].archives.iter().all(|a| !a.can_delete));
    }

    #[test]
    fn deux_zips_aucun_contenu_commun_pas_de_groupe() {
        let zip1 = make_zip_file(&[("a.txt", b"content1")]);
        let zip2 = make_zip_file(&[("b.txt", b"content2")]);
        let files = vec![
            make_dup_file(zip1.path().to_str().unwrap()),
            make_dup_file(zip2.path().to_str().unwrap()),
        ];
        let groups = run(&files, &no_cancel(), 0, 100, false, 10, false, 20, 0.20, None, false, &no_progress).groups;
        assert_eq!(groups.len(), 0);
    }

    #[test]
    fn archive_unique_pas_de_groupe() {
        let zip1 = make_zip_file(&[("a.txt", b"content")]);
        let files = vec![make_dup_file(zip1.path().to_str().unwrap())];
        let groups = run(&files, &no_cancel(), 0, 100, false, 10, false, 20, 0.20, None, false, &no_progress).groups;
        assert_eq!(groups.len(), 0);
    }

    #[test]
    fn fichiers_non_archive_ignores() {
        let dir = TempDir::new().unwrap();
        let txt = dir.path().join("regular.txt");
        std::fs::write(&txt, b"hello").unwrap();
        let zip1 = make_zip_file(&[("a.txt", b"content")]);
        let zip2 = make_zip_file(&[("a.txt", b"content")]);
        let files = vec![
            make_dup_file(txt.to_str().unwrap()),
            make_dup_file(zip1.path().to_str().unwrap()),
            make_dup_file(zip2.path().to_str().unwrap()),
        ];
        let groups = run(&files, &no_cancel(), 0, 100, false, 10, false, 20, 0.20, None, false, &no_progress).groups;
        assert_eq!(groups.len(), 1);
        // Seules les archives sont dans le groupe, pas le fichier texte
        for g in &groups {
            for a in &g.archives {
                assert!(a.path.ends_with(".zip"));
            }
        }
    }

    #[test]
    fn entrees_internes_a_une_archive_ignorees() {
        // Une archive avec 2 entrees identiques ne forme pas de groupe (comparaison inter-archive seulement)
        let zip1 = make_zip_file(&[("a.txt", b"same"), ("b.txt", b"same")]);
        let files = vec![make_dup_file(zip1.path().to_str().unwrap())];
        let groups = run(&files, &no_cancel(), 0, 100, false, 10, false, 20, 0.20, None, false, &no_progress).groups;
        assert_eq!(groups.len(), 0);
    }

    #[test]
    fn size_et_modified_propages_dans_archive_in_group() {
        let zip1 = make_zip_file(&[("a.txt", b"shared")]);
        let zip2 = make_zip_file(&[("a.txt", b"shared")]);
        let mut f1 = make_dup_file(zip1.path().to_str().unwrap());
        let mut f2 = make_dup_file(zip2.path().to_str().unwrap());
        f1.modified = 1700000000;
        f2.modified = 1700001000;
        let groups = run(&[f1, f2], &no_cancel(), 0, 100, false, 10, false, 20, 0.20, None, false, &no_progress).groups;
        assert_eq!(groups.len(), 1);
        let archives = &groups[0].archives;
        assert_eq!(archives.len(), 2);
        // Tous les archives doivent avoir size > 0 et modified non nul
        assert!(archives.iter().all(|a| a.size > 0));
        assert!(archives.iter().any(|a| a.modified == 1700000000));
        assert!(archives.iter().any(|a| a.modified == 1700001000));
    }

    /// Crée un PNG 16x16 monochrome de couleur donnée, réencodé pour avoir un xxh3 différent
    /// mais un pHash très proche entre versions (différence visuelle minime).
    fn make_png_bytes(color: image::Rgb<u8>, noise: u8) -> Vec<u8> {
        use image::{ImageBuffer, ImageFormat};
        use std::io::Cursor;
        let mut img: ImageBuffer<image::Rgb<u8>, Vec<u8>> = ImageBuffer::new(16, 16);
        for (x, y, p) in img.enumerate_pixels_mut() {
            // Petit bruit pour casser xxh3 entre versions, mais structure preservee
            let n = ((x as u8).wrapping_add(y as u8).wrapping_add(noise)) % 4;
            *p = image::Rgb([color[0].saturating_add(n), color[1], color[2]]);
        }
        let mut buf = Vec::new();
        img.write_to(&mut Cursor::new(&mut buf), ImageFormat::Png).unwrap();
        buf
    }

    #[test]
    fn deux_zips_avec_image_similaire_donnent_groupe_quand_find_similar_true() {
        let img_a = make_png_bytes(image::Rgb([100, 50, 30]), 0);
        let img_b = make_png_bytes(image::Rgb([100, 50, 30]), 1);  // bruit different => xxh3 different
        // xxh3 different mais pHash quasi identique
        assert_ne!(img_a, img_b);

        let zip1 = {
            let mut f = NamedTempFile::with_suffix(".zip").unwrap();
            {
                let mut w = zip::ZipWriter::new(std::io::BufWriter::new(f.as_file_mut()));
                let opts = zip::write::SimpleFileOptions::default();
                w.start_file("photo.png", opts).unwrap();
                w.write_all(&img_a).unwrap();
                w.finish().unwrap();
            }
            f
        };
        let zip2 = {
            let mut f = NamedTempFile::with_suffix(".zip").unwrap();
            {
                let mut w = zip::ZipWriter::new(std::io::BufWriter::new(f.as_file_mut()));
                let opts = zip::write::SimpleFileOptions::default();
                w.start_file("photo.png", opts).unwrap();
                w.write_all(&img_b).unwrap();
                w.finish().unwrap();
            }
            f
        };
        let files = vec![
            make_dup_file(zip1.path().to_str().unwrap()),
            make_dup_file(zip2.path().to_str().unwrap()),
        ];
        // Sans find_similar : pas de match (xxh3 differents)
        let g_exact = run(&files, &no_cancel(), 0, 100, false, 10, false, 20, 0.20, None, false, &no_progress).groups;
        assert_eq!(g_exact.len(), 0, "sans find_similar, les images avec bruit ne matchent pas");
        // Avec find_similar : match par pHash via extraction temp + compute_two_pass_hashes
        let data_tmp = TempDir::new().unwrap();
        let g_sim = run(&files, &no_cancel(), 0, 100, true, 10, false, 20, 0.20, data_tmp.path().to_str(), false, &no_progress).groups;
        assert_eq!(g_sim.len(), 1, "avec find_similar + data_dir, les images proches forment un groupe");
        assert_eq!(g_sim[0].archives.len(), 2);
        // Avec skip_extraction=true : pas de groupe meme avec find_similar
        let g_skip = run(&files, &no_cancel(), 0, 100, true, 10, false, 20, 0.20, data_tmp.path().to_str(), true, &no_progress).groups;
        assert_eq!(g_skip.len(), 0, "skip_extraction=true desactive la phase pHash archives");
    }

    #[test]
    fn similaires_comptes_dans_duplicated_entries() {
        // Bug: l'utilisateur voit 61/90 dans la GroupCard alors que toutes les entrees
        // sont matchees (61 exactes + 29 similaires). Phase 2 doit incrementer
        // duplicated_entries pour les similaires aussi, sinon la GroupCard sous-estime.
        let img_a = make_png_bytes(image::Rgb([100, 50, 30]), 0);
        let img_b = make_png_bytes(image::Rgb([100, 50, 30]), 1);
        let zip1 = {
            let mut f = NamedTempFile::with_suffix(".zip").unwrap();
            {
                let mut w = zip::ZipWriter::new(std::io::BufWriter::new(f.as_file_mut()));
                let opts = zip::write::SimpleFileOptions::default();
                w.start_file("photo.png", opts).unwrap();
                w.write_all(&img_a).unwrap();
                w.finish().unwrap();
            }
            f
        };
        let zip2 = {
            let mut f = NamedTempFile::with_suffix(".zip").unwrap();
            {
                let mut w = zip::ZipWriter::new(std::io::BufWriter::new(f.as_file_mut()));
                let opts = zip::write::SimpleFileOptions::default();
                w.start_file("photo.png", opts).unwrap();
                w.write_all(&img_b).unwrap();
                w.finish().unwrap();
            }
            f
        };
        let files = vec![
            make_dup_file(zip1.path().to_str().unwrap()),
            make_dup_file(zip2.path().to_str().unwrap()),
        ];
        let data_tmp = TempDir::new().unwrap();
        let groups = run(&files, &no_cancel(), 0, 100, true, 10, false, 20, 0.20, data_tmp.path().to_str(), false, &no_progress).groups;
        assert_eq!(groups.len(), 1);
        let g = &groups[0];
        // Chaque archive a 1 entree au total, et son seul fichier est match (similaire) avec l'autre
        // -> duplicated_entries doit etre 1 sur chacune, can_delete=true.
        for a in &g.archives {
            assert_eq!(a.total_entries, 1);
            assert_eq!(
                a.duplicated_entries, 1,
                "duplicated_entries doit compter les similaires aussi (path={})", a.path
            );
            assert!(a.can_delete, "archive entierement matchee doit etre supprimable (path={})", a.path);
        }
    }

    #[test]
    fn entrees_non_image_pas_phash_meme_avec_find_similar() {
        // 2 archives avec un .txt different (xxh3 different) -> pas de groupe meme avec find_similar
        let zip1 = make_zip_file(&[("doc.txt", b"version 1 of the document")]);
        let zip2 = make_zip_file(&[("doc.txt", b"version 2 of the document, slightly longer")]);
        let files = vec![
            make_dup_file(zip1.path().to_str().unwrap()),
            make_dup_file(zip2.path().to_str().unwrap()),
        ];
        let data_tmp = TempDir::new().unwrap();
        let groups = run(&files, &no_cancel(), 0, 100, true, 10, false, 20, 0.20, data_tmp.path().to_str(), false, &no_progress).groups;
        assert_eq!(groups.len(), 0, "le pHash ne s'applique pas aux fichiers non-image");
    }
}
