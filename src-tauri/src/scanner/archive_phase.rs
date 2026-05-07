use std::collections::HashMap;
use std::path::Path;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};

use crate::archive::{detect_archive_format, hash_archive_entries, count_entries_fast};
use super::types::{DuplicateFile, ArchiveGroupResult, ArchiveInGroup};
use crate::scanner::types::UnionFind;

pub fn run(
    files: &[DuplicateFile],
    cancelled: &Arc<AtomicBool>,
    progress_base: usize,
    total_work: usize,
    on_progress: &impl Fn(usize, usize, usize, &str, usize, usize, &str),
) -> Vec<ArchiveGroupResult> {
    // Filtrer les archives
    let archives: Vec<&DuplicateFile> = files.iter()
        .filter(|f| detect_archive_format(Path::new(&f.path)).is_some())
        .collect();

    if archives.len() < 2 {
        return vec![];
    }

    // Estimer le total d'entrees pour la progression
    let estimated_total: usize = archives.iter()
        .map(|f| count_entries_fast(Path::new(&f.path)))
        .sum();
    let estimated_total = estimated_total.max(1);

    // (archive_idx, internal_path, size) par hash
    let mut hash_map: HashMap<u64, Vec<(usize, String, u64)>> = HashMap::new();
    // Compte total par archive : chemin -> nb d'entrees
    let mut archive_total_entries: Vec<usize> = vec![0; archives.len()];
    let mut processed = 0usize;

    for (arch_idx, archive_file) in archives.iter().enumerate() {
        if cancelled.load(Ordering::Relaxed) { break; }
        let path = &archive_file.path;
        let entries = hash_archive_entries(Path::new(path)).unwrap_or_default();
        archive_total_entries[arch_idx] = entries.len();
        for entry in entries {
            hash_map.entry(entry.hash)
                .or_default()
                .push((arch_idx, entry.internal_path, entry.size));
            processed += 1;
            on_progress(
                progress_base + processed,
                total_work,
                0,  // total_files (pas utilise ici)
                path,
                processed,
                estimated_total,
                "archives",
            );
        }
    }

    // Garder uniquement les hashes qui apparaissent dans 2+ archives differentes
    let cross_hashes: Vec<(u64, Vec<(usize, String, u64)>)> = hash_map.into_iter()
        .filter(|(_, refs)| {
            let distinct: std::collections::HashSet<usize> = refs.iter().map(|(idx, _, _)| *idx).collect();
            distinct.len() >= 2
        })
        .collect();

    if cross_hashes.is_empty() {
        return vec![];
    }

    // Union-Find pour regrouper les archives qui partagent des entrees
    let n = archives.len();
    let mut uf = UnionFind::new(n);
    let mut duplicated_entries: Vec<HashMap<String, u64>> = vec![HashMap::new(); n];
    let mut shared_count_per_pair: HashMap<(usize, usize), usize> = HashMap::new();

    for (_, refs) in &cross_hashes {
        // Indices d'archives distincts pour ce hash
        let arch_indices: Vec<usize> = {
            let mut seen = std::collections::HashSet::new();
            refs.iter().filter_map(|(idx, _, _)| {
                if seen.insert(*idx) { Some(*idx) } else { None }
            }).collect()
        };
        if arch_indices.len() < 2 { continue; }
        // Union toutes les archives qui partagent ce hash
        for i in 1..arch_indices.len() {
            uf.union(arch_indices[0], arch_indices[i]);
        }
        // Marquer les entrees comme dupliquees dans chaque archive
        for (idx, internal_path, size) in refs {
            duplicated_entries[*idx].entry(internal_path.clone()).or_insert(*size);
        }
        // Compter les paires
        let root0 = arch_indices[0];
        for &other in &arch_indices[1..] {
            let key = (root0.min(other), root0.max(other));
            *shared_count_per_pair.entry(key).or_insert(0) += 1;
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

    results
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
        let groups = run(&files, &no_cancel(), 0, 100, &no_progress);
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
        let groups = run(&files, &no_cancel(), 0, 100, &no_progress);
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
        let groups = run(&files, &no_cancel(), 0, 100, &no_progress);
        assert_eq!(groups.len(), 0);
    }

    #[test]
    fn archive_unique_pas_de_groupe() {
        let zip1 = make_zip_file(&[("a.txt", b"content")]);
        let files = vec![make_dup_file(zip1.path().to_str().unwrap())];
        let groups = run(&files, &no_cancel(), 0, 100, &no_progress);
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
        let groups = run(&files, &no_cancel(), 0, 100, &no_progress);
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
        let groups = run(&files, &no_cancel(), 0, 100, &no_progress);
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
        let groups = run(&[f1, f2], &no_cancel(), 0, 100, &no_progress);
        assert_eq!(groups.len(), 1);
        let archives = &groups[0].archives;
        assert_eq!(archives.len(), 2);
        // Tous les archives doivent avoir size > 0 et modified non nul
        assert!(archives.iter().all(|a| a.size > 0));
        assert!(archives.iter().any(|a| a.modified == 1700000000));
        assert!(archives.iter().any(|a| a.modified == 1700001000));
    }
}
