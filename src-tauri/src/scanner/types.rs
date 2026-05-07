use std::collections::{HashMap, HashSet};
use std::sync::{Arc, atomic::AtomicUsize};
use serde::{Deserialize, Serialize};
use crate::audio::AudioMetadata;
use crate::phash::PHashConfig;
use crate::video::VideoMetadata;

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq)]
pub enum FileSource {
    #[serde(rename = "primary")]
    Primary,
    #[serde(rename = "secondary")]
    Secondary,
}

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
    /// Provenance du fichier en mode "comparer avec un autre dossier".
    /// None si le mode n'est pas actif (scan normal).
    #[serde(default)]
    pub source: Option<FileSource>,
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

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ArchiveInGroup {
    pub path: String,
    pub size: u64,
    pub modified: u64,
    pub total_entries: usize,
    pub duplicated_entries: usize,
    pub can_delete: bool,
    pub wasted_bytes: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ArchiveGroupResult {
    pub id: String,
    pub archives: Vec<ArchiveInGroup>,
    pub shared_entry_count: usize,
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
    #[serde(default)]
    pub archive_groups: Vec<ArchiveGroupResult>,
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
    /// Cles canoniques des groupes a ignorer (chemins tries, joints par |).
    pub ignored_keys: HashSet<String>,
    /// Dossier secondaire (de reference) pour le mode "comparer avec un autre dossier".
    /// Quand renseigne, seuls les groupes contenant au moins un fichier de chaque dossier sont rapportes.
    pub secondary_folder: Option<String>,
    /// Timestamp Unix minimum de date de modification (0 = pas de minimum).
    pub min_modified_timestamp: u64,
    /// Timestamp Unix maximum de date de modification (0 = pas de maximum).
    pub max_modified_timestamp: u64,
    /// Compteur de groupes trouves, mis a jour en temps reel pendant le scan.
    /// None = pas de suivi externe (valeur par defaut dans les tests).
    pub groups_counter: Option<Arc<AtomicUsize>>,
    /// Analyser le contenu des archives (ZIP, tar.gz, 7z...) et comparer entre archives.
    pub scan_archives: bool,
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
            ignored_keys: HashSet::new(),
            secondary_folder: None,
            min_modified_timestamp: 0,
            max_modified_timestamp: 0,
            groups_counter: None,
            scan_archives: false,
        }
    }
}

pub struct UnionFind {
    parent: Vec<usize>,
    rank: Vec<usize>,
}

impl UnionFind {
    pub fn new(n: usize) -> Self {
        UnionFind {
            parent: (0..n).collect(),
            rank: vec![0; n],
        }
    }

    pub fn find(&mut self, x: usize) -> usize {
        if self.parent[x] != x {
            self.parent[x] = self.find(self.parent[x]);
        }
        self.parent[x]
    }

    pub fn union(&mut self, x: usize, y: usize) {
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

pub struct ImageData {
    pub file: DuplicateFile,
    pub coarse: Vec<u8>,
    pub fine: Vec<u8>,
    /// Ratio largeur/hauteur. None si les dimensions n'ont pas ete lues.
    pub aspect: Option<f32>,
}

/// Retourne true si le groupe contient au moins un fichier primaire ET au moins un fichier secondaire.
pub fn is_cross_source_group(group: &DuplicateGroup) -> bool {
    let has_primary = group.files.iter().any(|f| f.source == Some(FileSource::Primary));
    let has_secondary = group.files.iter().any(|f| f.source == Some(FileSource::Secondary));
    has_primary && has_secondary
}

/// Retire de `candidates` tout fichier dont le chemin apparait deja dans `existing_groups`.
pub fn filter_exact_candidates(
    candidates: Vec<DuplicateFile>,
    existing_groups: &[DuplicateGroup],
) -> Vec<DuplicateFile> {
    let exact_paths: HashSet<String> = existing_groups
        .iter()
        .flat_map(|g| g.files.iter().map(|f| f.path.clone()))
        .collect();
    candidates.into_iter().filter(|f| !exact_paths.contains(&f.path)).collect()
}

/// Construit des groupes de similarite depuis une liste de paires `(i, j)` via Union-Find.
/// `get_file` recupere le DuplicateFile a l'indice i.
/// `folder_key` calcule la cle de dossier pour un groupe (None = mode "tout le dossier").
pub fn build_similar_groups(
    n: usize,
    pairs: Vec<(usize, usize)>,
    get_file: impl Fn(usize) -> DuplicateFile,
    hash: &str,
    similar: bool,
    video_similar: bool,
    audio_similar: bool,
    folder_key: impl Fn(&[DuplicateFile]) -> Option<String>,
    compare_mode: bool,
) -> Vec<DuplicateGroup> {
    let mut uf = UnionFind::new(n);
    for &(i, j) in &pairs {
        uf.union(i, j);
    }
    let mut group_map: HashMap<usize, Vec<usize>> = HashMap::new();
    for i in 0..n {
        let root = uf.find(i);
        group_map.entry(root).or_default().push(i);
    }
    let mut groups = Vec::new();
    for (_, indices) in group_map {
        if indices.len() < 2 { continue; }
        let files: Vec<DuplicateFile> = indices.iter().map(|&i| get_file(i)).collect();
        let fk = folder_key(&files);
        let g = DuplicateGroup {
            id: uuid::Uuid::new_v4().to_string(),
            hash: hash.to_string(),
            size: files[0].size,
            folder_key: fk,
            similar,
            video_similar,
            audio_similar,
            files,
        };
        if compare_mode && !is_cross_source_group(&g) { continue; }
        groups.push(g);
    }
    groups
}

#[cfg(test)]
mod tests {
    use super::*;

    fn make_file(path: &str) -> DuplicateFile {
        DuplicateFile {
            path: path.to_string(),
            name: path.to_string(),
            size: 100,
            modified: 0,
            video_metadata: None,
            audio_metadata: None,
            source: None,
        }
    }

    fn make_file_src(path: &str, source: FileSource) -> DuplicateFile {
        DuplicateFile { source: Some(source), ..make_file(path) }
    }

    fn make_exact_group(paths: &[&str]) -> DuplicateGroup {
        DuplicateGroup {
            id: "g".to_string(), hash: "exact".to_string(), size: 100,
            files: paths.iter().map(|p| make_file(p)).collect(),
            folder_key: None, similar: false, video_similar: false, audio_similar: false,
        }
    }

    #[test]
    fn filter_exact_exclut_les_chemins_deja_groupes() {
        let candidates = vec![make_file("a"), make_file("b"), make_file("c")];
        let result = filter_exact_candidates(candidates, &[make_exact_group(&["a"])]);
        assert_eq!(result.len(), 2);
        assert!(result.iter().all(|f| f.path != "a"));
    }

    #[test]
    fn filter_exact_sans_existing_retourne_tout() {
        let candidates = vec![make_file("a"), make_file("b")];
        let result = filter_exact_candidates(candidates, &[]);
        assert_eq!(result.len(), 2);
    }

    #[test]
    fn build_groups_paire_simple() {
        let files = vec![make_file("a"), make_file("b"), make_file("c")];
        let groups = build_similar_groups(3, vec![(0, 1)], |i| files[i].clone(),
            "test", true, false, false, |_| None, false);
        assert_eq!(groups.len(), 1);
        assert_eq!(groups[0].files.len(), 2);
        assert!(groups[0].similar);
    }

    #[test]
    fn build_groups_pas_de_paire_pas_de_groupe() {
        let files = vec![make_file("a"), make_file("b")];
        let groups = build_similar_groups(2, vec![], |i| files[i].clone(),
            "test", false, false, true, |_| None, false);
        assert_eq!(groups.len(), 0);
    }

    #[test]
    fn build_groups_by_folder_assigne_folder_key() {
        let files = vec![make_file("a"), make_file("b")];
        let groups = build_similar_groups(2, vec![(0, 1)], |i| files[i].clone(),
            "audio", false, false, true,
            |_| Some("Photos".to_string()), false);
        assert_eq!(groups[0].folder_key, Some("Photos".to_string()));
        assert!(groups[0].audio_similar);
    }

    #[test]
    fn build_groups_compare_mode_garde_groupes_croises() {
        let files = vec![
            make_file_src("a", FileSource::Primary),
            make_file_src("b", FileSource::Secondary),
        ];
        let groups = build_similar_groups(2, vec![(0, 1)], |i| files[i].clone(),
            "video", false, true, false, |_| None, true);
        assert_eq!(groups.len(), 1);
    }

    #[test]
    fn build_groups_compare_mode_filtre_groupes_internes() {
        let files = vec![
            make_file_src("a", FileSource::Primary),
            make_file_src("b", FileSource::Primary),
        ];
        let groups = build_similar_groups(2, vec![(0, 1)], |i| files[i].clone(),
            "video", false, true, false, |_| None, true);
        assert_eq!(groups.len(), 0);
    }

    #[test]
    fn build_groups_transitif_trois_fichiers() {
        let files = vec![make_file("a"), make_file("b"), make_file("c")];
        // a~b et b~c -> {a,b,c} dans un seul groupe
        let groups = build_similar_groups(3, vec![(0, 1), (1, 2)], |i| files[i].clone(),
            "phash", true, false, false, |_| None, false);
        assert_eq!(groups.len(), 1);
        assert_eq!(groups[0].files.len(), 3);
    }
}
