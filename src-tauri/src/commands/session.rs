use tauri::Manager;

use crate::{GroupsPage, LoadedSession, ScanCache, ScanSummary, SessionFile};
use crate::{read_session_file, save_session, select_files_to_delete};
use crate::scanner::DuplicateGroup;

#[derive(serde::Serialize)]
pub struct FolderSummary {
    pub folder_key: String,
    pub group_count: usize,
    pub total_wasted_bytes: u64,
}

fn sessions_dir(app: &tauri::AppHandle) -> Option<std::path::PathBuf> {
    let dir = app.path().app_local_data_dir().ok()?.join("sessions");
    std::fs::create_dir_all(&dir).ok()?;
    Some(dir)
}

fn session_path(app: &tauri::AppHandle, id: &str) -> Option<std::path::PathBuf> {
    Some(sessions_dir(app)?.join(format!("{}.json", id)))
}

pub fn make_page(groups: &[DuplicateGroup], offset: usize, limit: usize) -> GroupsPage {
    let total = groups.len();
    let end = (offset + limit).min(total);
    GroupsPage {
        groups: if offset < total { groups[offset..end].to_vec() } else { vec![] },
        offset,
        total,
        has_more: end < total,
    }
}

/// Charge la liste d'ignores courante depuis le disque (a chaque appel) pour qu'une
/// modification (ignore_group / clear_ignore_entry) soit immediatement visible par
/// les commandes de lecture. Le cache `LoadedSession` reste agnostique des ignores :
/// il stocke la liste BRUTE des groupes, et chaque lecture re-applique le filtre.
/// Ainsi de-ignorer un groupe le fait reapparaitre naturellement au prochain appel
/// de get_groups_page / get_folder_groups_page / list_folder_keys / etc.
fn current_ignored_keys(app: &tauri::AppHandle) -> std::collections::HashSet<String> {
    crate::app_data_dir(app)
        .map(|d| crate::ignore_list::IgnoreList::load(&d).keys_set())
        .unwrap_or_default()
}

/// Filtre une vue lue depuis le cache contre la liste d'ignores et recalcule
/// total_groups + total_wasted_bytes + total_folders du summary si au moins
/// un groupe est retire. Variante de `apply_ignore_filter` qui clone seulement
/// les groupes filtres (au lieu de prendre ownership du Vec), adapte aux
/// lectures depuis le cache.
fn filtered_view(
    groups: &[DuplicateGroup],
    summary: &ScanSummary,
    ignored_keys: &std::collections::HashSet<String>,
) -> (Vec<DuplicateGroup>, ScanSummary) {
    if ignored_keys.is_empty() {
        return (groups.to_vec(), summary.clone());
    }
    let filtered: Vec<DuplicateGroup> = groups.iter()
        .filter(|g| {
            let paths: Vec<String> = g.files.iter().map(|f| f.path.clone()).collect();
            !ignored_keys.contains(&crate::ignore_list::group_ignore_key(&paths))
        })
        .cloned()
        .collect();
    let mut sum = summary.clone();
    if filtered.len() != groups.len() {
        sum.total_groups = filtered.len();
        sum.total_wasted_bytes = crate::recalc_wasted_bytes(&filtered);
        if sum.by_folder {
            sum.total_folders = filtered.iter()
                .filter_map(|g| g.folder_key.as_ref())
                .collect::<std::collections::HashSet<_>>()
                .len();
        }
    }
    (filtered, sum)
}

/// Helper de lecture du cache avec filtre ignore applique. Charge la liste
/// d'ignores courante (recharge le fichier a chaque appel - cf. regle "cache
/// brut, filtre dynamique" d'AGENTS.md), lock le cache, filtre, et appelle
/// le closure utilisateur avec la vue filtree. Si aucune session n'est en
/// cache, retourne `Err("Aucune session chargee")`.
///
/// Utilise par toutes les commandes de lecture (`get_groups_page`,
/// `get_folder_groups_page`, `list_folder_keys`, `select_all_duplicates`,
/// `smart_select`) pour eviter la duplication du pattern lock + filter.
fn with_filtered_cache<R>(
    app: &tauri::AppHandle,
    f: impl FnOnce(&[DuplicateGroup], &ScanSummary) -> R,
) -> Result<R, String> {
    let ignored_keys = current_ignored_keys(app);
    let cache = app.state::<ScanCache>();
    let guard = cache.0.lock().unwrap();
    match *guard {
        Some(ref loaded) => {
            let (filtered, filtered_summary) = filtered_view(&loaded.groups, &loaded.summary, &ignored_keys);
            Ok(f(&filtered, &filtered_summary))
        }
        None => Err("Aucune session chargee".to_string()),
    }
}

// generate_csv / generate_html / export_results : extraits dans commands/export.rs

#[tauri::command]
pub fn list_sessions(app: tauri::AppHandle) -> Vec<ScanSummary> {
    let dir = match sessions_dir(&app) {
        Some(d) => d,
        None => return vec![],
    };
    let mut sessions: Vec<ScanSummary> = std::fs::read_dir(&dir)
        .into_iter()
        .flatten()
        .filter_map(|e| e.ok())
        .filter(|e| e.path().extension().and_then(|x| x.to_str()) == Some("json"))
        .filter_map(|e| {
            let data = std::fs::read_to_string(e.path()).ok()?;
            let file: SessionFile = serde_json::from_str(&data).ok()?;
            Some(file.summary)
        })
        .collect();
    sessions.sort_by(|a, b| b.id.cmp(&a.id));
    sessions
}

#[tauri::command]
pub async fn load_session(app: tauri::AppHandle, id: String) -> Result<ScanSummary, String> {
    // Fast path : la session est deja en cache. On lit la liste d'ignores
    // courante (fichier sur disque, lu a chaque appel) et on retourne un
    // summary filtre. Le cache lui-meme contient la liste brute, jamais
    // pre-filtree : ainsi un clear_ignore_entry intervenu entre temps fait
    // reapparaitre le groupe au prochain appel sans avoir a recharger.
    {
        let cache = app.state::<ScanCache>();
        let guard = cache.0.lock().unwrap();
        if let Some(ref loaded) = *guard {
            if loaded.summary.id == id {
                let ignored_keys = current_ignored_keys(&app);
                let (_filtered_groups, filtered_summary) = filtered_view(&loaded.groups, &loaded.summary, &ignored_keys);
                return Ok(filtered_summary);
            }
        }
    }

    let file = read_session_file(&app, &id)
        .ok_or_else(|| "Session introuvable".to_string())?;

    let ignored_keys = current_ignored_keys(&app);

    // Le re-hashing potentiel des archives (ensure_cache_for_groups) peut prendre plusieurs
    // secondes ; on libere le thread Tauri pendant pour ne pas geler l'UI.
    let (groups, summary, archive_groups, archive_entries_cache, dirty) = tauri::async_runtime::spawn_blocking(move || {
        let mut groups = file.groups;
        let mut summary = file.summary;
        let mut archive_groups = file.archive_groups;
        let mut archive_entries_cache = file.archive_entries_cache;

        let before = groups.len();
        for group in groups.iter_mut() {
            group.files.retain(|f| std::path::Path::new(&f.path).exists());
        }
        groups.retain(|g| g.files.len() >= 2);

        let archives_before = archive_groups.len();
        for ag in archive_groups.iter_mut() {
            ag.archives.retain(|a| std::path::Path::new(&a.path).exists());
        }
        archive_groups.retain(|ag| ag.archives.len() >= 2);
        archive_entries_cache.retain(|path, _| std::path::Path::new(path).exists());

        // Recalcule duplicated_entries / can_delete a partir du cache : les sessions sauvees
        // avant la prise en compte des similaires dans le compteur affichaient 61/90.
        // Pour les sessions encore plus anciennes ou archive_entries_cache n'existait pas,
        // ensure_cache_for_groups re-ouvre les archives pour repeupler le cache.
        let cache_was_empty = archive_entries_cache.is_empty() && !archive_groups.is_empty();
        crate::archive::ensure_cache_for_groups(&archive_groups, &mut archive_entries_cache);

        let counts_before: Vec<Vec<usize>> = archive_groups.iter()
            .map(|ag| ag.archives.iter().map(|a| a.duplicated_entries).collect())
            .collect();
        let sim_threshold = summary.sim_threshold.unwrap_or(10);
        let audio_sim_threshold = summary.audio_sim_threshold.unwrap_or(20);
        // Tolerance de duree par defaut, alignee sur ScanParams (cf. scanner/types.rs).
        // Pas stockee dans ScanSummary ; on prend le default raisonnable.
        let audio_duration_tolerance = 0.20;
        crate::archive::recompute_group_duplicated_entries(
            &mut archive_groups,
            &archive_entries_cache,
            sim_threshold,
            audio_sim_threshold,
            audio_duration_tolerance,
        );
        let counts_changed = archive_groups.iter().zip(counts_before.iter())
            .any(|(ag, prev)| ag.archives.iter().zip(prev.iter())
                .any(|(a, b)| a.duplicated_entries != *b));

        let dirty = groups.len() != before || archive_groups.len() != archives_before
            || counts_changed || cache_was_empty;
        if dirty {
            summary.total_groups = groups.len();
            summary.total_wasted_bytes = crate::recalc_wasted_bytes(&groups);
            summary.archive_groups_count = archive_groups.len();
        }
        (groups, summary, archive_groups, archive_entries_cache, dirty)
    })
    .await
    .map_err(|e| e.to_string())?;

    if dirty {
        save_session(&app, &summary, &groups, &archive_groups, &archive_entries_cache);
    }

    // Le cache stocke la liste BRUTE (non filtree). Le filtre d'ignores est applique
    // a chaque lecture (cf. filtered_view + current_ignored_keys). Garantit qu'une
    // modification de la liste d'ignores (ajout / suppression) est immediatement
    // visible par toutes les commandes de pagination, sans recharger la session.
    let (_displayed_groups, displayed_summary) = filtered_view(&groups, &summary, &ignored_keys);

    let result = displayed_summary;
    *app.state::<ScanCache>().0.lock().unwrap() = Some(LoadedSession {
        summary,
        groups,
        archive_groups,
        archive_entries_cache,
    });
    Ok(result)
}

#[tauri::command]
pub fn delete_session(app: tauri::AppHandle, id: String) {
    {
        let cache = app.state::<ScanCache>();
        let mut guard = cache.0.lock().unwrap();
        if let Some(ref loaded) = *guard {
            if loaded.summary.id == id {
                *guard = None;
            }
        }
    }
    if let Some(path) = session_path(&app, &id) {
        let _ = std::fs::remove_file(&path);
    }
}

#[tauri::command]
pub fn get_groups_page(app: tauri::AppHandle, offset: usize, limit: usize) -> Result<GroupsPage, String> {
    with_filtered_cache(&app, |filtered, _| make_page(filtered, offset, limit))
}

#[tauri::command]
pub fn list_folder_keys(app: tauri::AppHandle) -> Result<Vec<FolderSummary>, String> {
    with_filtered_cache(&app, |filtered, _| {
        let mut summaries: Vec<FolderSummary> = Vec::new();
        for group in filtered {
            let key = group.folder_key.clone().unwrap_or_default();
            let wasted = group.size * (group.files.len() as u64 - 1);
            match summaries.last_mut() {
                Some(last) if last.folder_key == key => {
                    last.group_count += 1;
                    last.total_wasted_bytes += wasted;
                }
                _ => summaries.push(FolderSummary {
                    folder_key: key,
                    group_count: 1,
                    total_wasted_bytes: wasted,
                }),
            }
        }
        summaries
    })
}

#[tauri::command]
pub fn get_folder_groups_page(
    app: tauri::AppHandle,
    folder_key: String,
    offset: usize,
    limit: usize,
) -> Result<GroupsPage, String> {
    with_filtered_cache(&app, |filtered, _| {
        let folder_groups: Vec<DuplicateGroup> = filtered.iter()
            .filter(|g| g.folder_key.as_deref().unwrap_or("") == folder_key.as_str())
            .cloned()
            .collect();
        make_page(&folder_groups, offset, limit)
    })
}

/// Filtre les groupes selon le texte de recherche affiche cote frontend. Aligne
/// la portee des commandes de selection (`select_all_duplicates`, `smart_select`)
/// sur ce que l'utilisateur voit a l'ecran : en mode `by_folder` on filtre par
/// `folder_key`, sinon par nom ou chemin de fichier. Retourne tous les groupes
/// quand `filter_text` est `None` ou vide apres trim.
fn apply_text_filter<'a>(
    groups: &'a [DuplicateGroup],
    by_folder: bool,
    filter_text: Option<&str>,
) -> Vec<&'a DuplicateGroup> {
    let q = filter_text.map(|s| s.trim().to_lowercase()).unwrap_or_default();
    if q.is_empty() {
        return groups.iter().collect();
    }
    groups
        .iter()
        .filter(|g| {
            if by_folder {
                g.folder_key
                    .as_deref()
                    .map(|k| k.to_lowercase().contains(&q))
                    .unwrap_or(false)
            } else {
                g.files.iter().any(|f| {
                    f.name.to_lowercase().contains(&q) || f.path.to_lowercase().contains(&q)
                })
            }
        })
        .collect()
}

#[tauri::command]
pub fn select_all_duplicates(
    app: tauri::AppHandle,
    filter_text: Option<String>,
) -> Result<Vec<String>, String> {
    with_filtered_cache(&app, |filtered, summary| {
        apply_text_filter(filtered, summary.by_folder, filter_text.as_deref())
            .into_iter()
            .flat_map(|group| group.files.iter().skip(1).map(|f| f.path.clone()))
            .collect::<Vec<String>>()
    })
}

#[tauri::command]
pub async fn smart_select(
    app: tauri::AppHandle,
    mode: String,
    folder_prefix: Option<String>,
    filter_text: Option<String>,
) -> Result<Vec<String>, String> {
    let groups = with_filtered_cache(&app, |filtered, summary| {
        apply_text_filter(filtered, summary.by_folder, filter_text.as_deref())
            .into_iter()
            .cloned()
            .collect::<Vec<DuplicateGroup>>()
    })?;
    tauri::async_runtime::spawn_blocking(move || {
        Ok(select_files_to_delete(&groups, &mode, folder_prefix.as_deref()))
    })
    .await
    .map_err(|e| e.to_string())?
}

// export_results : cf. commands/export.rs

#[cfg(test)]
mod tests {
    use super::*;
    use crate::scanner::DuplicateFile;
    use std::collections::HashSet;

    fn make_group(id: &str, size: u64, paths: &[&str]) -> DuplicateGroup {
        DuplicateGroup {
            id: id.to_string(),
            hash: format!("hash-{}", id),
            size,
            files: paths
                .iter()
                .map(|p| DuplicateFile {
                    path: (*p).to_string(),
                    name: std::path::Path::new(p)
                        .file_name()
                        .map(|f| f.to_string_lossy().into_owned())
                        .unwrap_or_default(),
                    size,
                    modified: 0,
                    video_metadata: None,
                    audio_metadata: None,
                    source: None,
                })
                .collect(),
            folder_key: None,
            similar: false,
            video_similar: false,
            audio_similar: false,
        }
    }

    fn make_summary(total_groups: usize, total_wasted: u64) -> ScanSummary {
        ScanSummary {
            id: "test".into(),
            folder: "/test".into(),
            total_wasted_bytes: total_wasted,
            total_groups,
            scanned_files: 0,
            duration_ms: 0,
            by_folder: false,
            total_folders: 0,
            partial: false,
            recursive: false,
            find_similar: false,
            find_similar_videos: false,
            ffmpeg_missing: false,
            find_similar_audio: false,
            fpcalc_missing: false,
            archive_groups_count: 0,
            scan_archives: false,
            sim_threshold: None,
            video_sim_threshold: None,
            audio_sim_threshold: None,
        }
    }

    #[test]
    fn filtered_view_retire_les_groupes_dans_la_liste() {
        let g1 = make_group("g1", 1000, &["/a/1.txt", "/a/1bis.txt"]);
        let g2 = make_group("g2", 2000, &["/b/2.txt", "/b/2bis.txt"]);
        let g3 = make_group("g3", 3000, &["/c/3.txt", "/c/3bis.txt"]);

        let g2_paths: Vec<String> = g2.files.iter().map(|f| f.path.clone()).collect();
        let mut ignored = HashSet::new();
        ignored.insert(crate::ignore_list::group_ignore_key(&g2_paths));

        let summary = make_summary(3, 1000 + 2000 + 3000);
        let (displayed, displayed_summary) = filtered_view(&[g1, g2, g3], &summary, &ignored);

        assert_eq!(displayed.len(), 2);
        assert!(displayed.iter().all(|g| g.id != "g2"));
        assert_eq!(displayed_summary.total_groups, 2);
        assert_eq!(displayed_summary.total_wasted_bytes, 1000 + 3000);
    }

    #[test]
    fn filtered_view_passthrough_si_aucun_match() {
        let g1 = make_group("g1", 1000, &["/a/1.txt", "/a/1bis.txt"]);
        let g2 = make_group("g2", 2000, &["/b/2.txt", "/b/2bis.txt"]);
        let summary = make_summary(2, 3000);

        let mut ignored = HashSet::new();
        ignored.insert("clef-qui-ne-matche-aucun-groupe".to_string());

        let (displayed, displayed_summary) =
            filtered_view(&[g1, g2], &summary, &ignored);

        assert_eq!(displayed.len(), 2);
        assert_eq!(displayed_summary.total_groups, 2);
        assert_eq!(displayed_summary.total_wasted_bytes, 3000);
    }

    #[test]
    fn filtered_view_no_op_si_liste_vide() {
        let g1 = make_group("g1", 1000, &["/a/1.txt", "/a/1bis.txt"]);
        let summary = make_summary(1, 1000);
        let ignored = HashSet::new();

        let (displayed, displayed_summary) = filtered_view(&[g1], &summary, &ignored);

        assert_eq!(displayed.len(), 1);
        assert_eq!(displayed_summary.total_groups, 1);
        assert_eq!(displayed_summary.total_wasted_bytes, 1000);
    }

    #[test]
    fn filtered_view_recalcule_total_folders_en_mode_by_folder() {
        // Trois groupes repartis dans trois dossiers distincts. Ignorer le seul
        // groupe du dossier "b" doit faire passer total_folders de 3 a 2.
        let mut g1 = make_group("g1", 1000, &["/a/1.txt", "/a/1bis.txt"]);
        g1.folder_key = Some("a".into());
        let mut g2 = make_group("g2", 2000, &["/b/2.txt", "/b/2bis.txt"]);
        g2.folder_key = Some("b".into());
        let mut g3 = make_group("g3", 3000, &["/c/3.txt", "/c/3bis.txt"]);
        g3.folder_key = Some("c".into());

        let mut summary = make_summary(3, 1000 + 2000 + 3000);
        summary.by_folder = true;
        summary.total_folders = 3;

        let g2_paths: Vec<String> = g2.files.iter().map(|f| f.path.clone()).collect();
        let mut ignored = HashSet::new();
        ignored.insert(crate::ignore_list::group_ignore_key(&g2_paths));

        let (_displayed, displayed_summary) =
            filtered_view(&[g1, g2, g3], &summary, &ignored);

        assert_eq!(displayed_summary.total_groups, 2);
        assert_eq!(displayed_summary.total_folders, 2);
    }

    #[test]
    fn filtered_view_ne_touche_pas_total_folders_hors_mode_by_folder() {
        // Hors mode by_folder, total_folders reste a sa valeur initiale (typiquement 0).
        let mut g1 = make_group("g1", 1000, &["/a/1.txt", "/a/1bis.txt"]);
        g1.folder_key = Some("a".into());
        let mut g2 = make_group("g2", 2000, &["/b/2.txt", "/b/2bis.txt"]);
        g2.folder_key = Some("b".into());

        let summary = make_summary(2, 3000); // by_folder = false, total_folders = 0

        let g2_paths: Vec<String> = g2.files.iter().map(|f| f.path.clone()).collect();
        let mut ignored = HashSet::new();
        ignored.insert(crate::ignore_list::group_ignore_key(&g2_paths));

        let (_displayed, displayed_summary) =
            filtered_view(&[g1, g2], &summary, &ignored);

        assert_eq!(displayed_summary.total_groups, 1);
        assert_eq!(displayed_summary.total_folders, 0);
    }

    #[test]
    fn apply_text_filter_vide_renvoie_tous_les_groupes() {
        let g1 = make_group("g1", 1000, &["/a/vacances.jpg", "/a/vacances_copy.jpg"]);
        let g2 = make_group("g2", 2000, &["/b/travail.txt", "/b/travail_copy.txt"]);
        let groups = vec![g1, g2];

        let res = apply_text_filter(&groups, false, None);
        assert_eq!(res.len(), 2);

        let res = apply_text_filter(&groups, false, Some(""));
        assert_eq!(res.len(), 2);

        let res = apply_text_filter(&groups, false, Some("   "));
        assert_eq!(res.len(), 2);
    }

    #[test]
    fn apply_text_filter_mode_normal_filtre_par_nom_et_path() {
        let g1 = make_group("g1", 1000, &["/a/vacances.jpg", "/a/vacances_copy.jpg"]);
        let g2 = make_group("g2", 2000, &["/b/travail.txt", "/b/travail_copy.txt"]);
        let g3 = make_group("g3", 3000, &["/photos/VACANCES_2024/img.jpg", "/photos/dup/img.jpg"]);
        let groups = vec![g1, g2, g3];

        // Match par nom (insensible a la casse)
        let res = apply_text_filter(&groups, false, Some("vacances"));
        assert_eq!(res.len(), 2);
        assert!(res.iter().any(|g| g.id == "g1"));
        assert!(res.iter().any(|g| g.id == "g3")); // match via path "/VACANCES_2024/"
        assert!(!res.iter().any(|g| g.id == "g2"));
    }

    #[test]
    fn apply_text_filter_mode_by_folder_filtre_par_folder_key() {
        let mut g1 = make_group("g1", 1000, &["/root/Vacances/1.jpg", "/root/Vacances/2.jpg"]);
        g1.folder_key = Some("Vacances".into());
        let mut g2 = make_group("g2", 2000, &["/root/Travail/1.txt", "/root/Travail/2.txt"]);
        g2.folder_key = Some("Travail".into());
        let mut g3 = make_group("g3", 3000, &["/root/Vacances2024/1.jpg", "/root/Vacances2024/2.jpg"]);
        g3.folder_key = Some("Vacances2024".into());
        let groups = vec![g1, g2, g3];

        let res = apply_text_filter(&groups, true, Some("vacances"));
        assert_eq!(res.len(), 2);
        assert!(res.iter().any(|g| g.id == "g1"));
        assert!(res.iter().any(|g| g.id == "g3"));

        // En mode by_folder le nom de fichier ne doit PAS matcher : seul folder_key compte
        let mut g_path_only = make_group("g4", 4000, &["/root/Autre/vacances.jpg", "/root/Autre/copy.jpg"]);
        g_path_only.folder_key = Some("Autre".into());
        let only_path = vec![g_path_only];
        let res = apply_text_filter(&only_path, true, Some("vacances"));
        assert_eq!(res.len(), 0);
    }

    #[test]
    fn filtered_view_invariant_cache_brut_apres_retrait_ignore() {
        // Simule le scenario clef : un cache "brut" (3 groupes) est filtre une fois
        // avec g2 ignore, puis le filtre est retire et la meme vue brute redonne 3
        // groupes. Le cache n'a pas ete touche entre les deux appels - c'est le
        // contrat 'cache et liste d'ignores independants'.
        let g1 = make_group("g1", 1000, &["/a/1.txt", "/a/1bis.txt"]);
        let g2 = make_group("g2", 2000, &["/b/2.txt", "/b/2bis.txt"]);
        let g3 = make_group("g3", 3000, &["/c/3.txt", "/c/3bis.txt"]);
        let cache_groups = vec![g1, g2.clone(), g3];
        let cache_summary = make_summary(3, 6000);

        // Etape 1 : g2 ignore -> vue filtree a 2 groupes
        let g2_paths: Vec<String> = g2.files.iter().map(|f| f.path.clone()).collect();
        let mut ignored = HashSet::new();
        ignored.insert(crate::ignore_list::group_ignore_key(&g2_paths));
        let (view1, sum1) = filtered_view(&cache_groups, &cache_summary, &ignored);
        assert_eq!(view1.len(), 2);
        assert_eq!(sum1.total_groups, 2);

        // Etape 2 : l'utilisateur supprime g2 de la liste d'ignores. Le cache n'a
        // PAS change. La nouvelle vue doit re-inclure g2.
        ignored.clear();
        let (view2, sum2) = filtered_view(&cache_groups, &cache_summary, &ignored);
        assert_eq!(view2.len(), 3);
        assert_eq!(sum2.total_groups, 3);
        assert!(view2.iter().any(|g| g.id == "g2"));
    }
}
