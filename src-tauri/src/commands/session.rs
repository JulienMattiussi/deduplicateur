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

fn export_size(bytes: u64) -> String {
    if bytes >= 1_073_741_824 {
        format!("{:.2} Go", bytes as f64 / 1_073_741_824.0)
    } else if bytes >= 1_048_576 {
        format!("{:.1} Mo", bytes as f64 / 1_048_576.0)
    } else if bytes >= 1024 {
        format!("{:.1} Ko", bytes as f64 / 1024.0)
    } else {
        format!("{} o", bytes)
    }
}

fn csv_escape(s: &str) -> String {
    if s.contains(',') || s.contains('"') || s.contains('\n') {
        format!("\"{}\"", s.replace('"', "\"\""))
    } else {
        s.to_string()
    }
}

fn html_esc(s: &str) -> String {
    s.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;").replace('"', "&quot;")
}

fn generate_csv(groups: &[DuplicateGroup]) -> String {
    let mut out = String::from("Group ID,File Path,File Name,Size (bytes),Modified (Unix),Status\n");
    for group in groups {
        for (i, file) in group.files.iter().enumerate() {
            let status = if i == 0 { "kept" } else { "duplicate" };
            out.push_str(&format!(
                "{},{},{},{},{},{}\n",
                csv_escape(&group.id),
                csv_escape(&file.path),
                csv_escape(&file.name),
                file.size,
                file.modified,
                status
            ));
        }
    }
    out
}

fn generate_html(summary: &ScanSummary, groups: &[DuplicateGroup]) -> String {
    let wasted = export_size(summary.total_wasted_bytes);
    let mut rows = String::new();
    for group in groups {
        let kind = if group.similar {
            "similar images"
        } else if group.video_similar {
            "similar videos"
        } else {
            "identical"
        };
        let wasted_group = group.size * (group.files.len() as u64).saturating_sub(1);
        rows.push_str(&format!(
            "<tr class=\"gr\"><td colspan=\"4\">{} &bull; {} files &bull; {} wasted</td></tr>\n",
            kind,
            group.files.len(),
            html_esc(&export_size(wasted_group))
        ));
        for (i, file) in group.files.iter().enumerate() {
            let cls = if i % 2 == 0 { "" } else { " odd" };
            let status_cls = if i == 0 { "kept" } else { "dup" };
            let status = if i == 0 { "kept" } else { "duplicate" };
            let uri = format!("file://{}", file.path);
            rows.push_str(&format!(
                "<tr class=\"fr{}\"><td><a href=\"{}\">{}</a></td><td>{}</td><td><span class=\"ts\" data-ts=\"{}\">{}</span></td><td class=\"{}\">{}</td></tr>\n",
                cls,
                html_esc(&uri), html_esc(&file.name),
                html_esc(&export_size(file.size)),
                file.modified, file.modified,
                status_cls, status
            ));
        }
    }
    format!(
        r#"<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><title>Deduplicator Report</title><style>
body{{font-family:system-ui,sans-serif;margin:0;padding:32px;background:#f8fafc;color:#1e293b}}
h1{{margin:0 0 24px;font-size:22px;color:#1e40af}}
.stats{{background:#fff;border:1px solid #e2e8f0;border-radius:10px;padding:20px;display:flex;gap:32px;flex-wrap:wrap;margin-bottom:24px}}
.sv{{font-size:26px;font-weight:700;color:#1e40af}}.sl{{font-size:12px;color:#64748b}}
table{{width:100%;border-collapse:collapse;background:#fff;border:1px solid #e2e8f0;border-radius:10px;overflow:hidden;font-size:13px}}
thead tr{{background:#1e3a5f;color:#fff}}th{{padding:10px 14px;text-align:left}}
.gr{{background:#dbeafe;font-weight:600}}.gr td{{padding:6px 14px;color:#1e40af;font-size:12px}}
.fr td{{padding:7px 14px;border-bottom:1px solid #f1f5f9}}.fr.odd{{background:#f8fafc}}
a{{color:#2563eb;text-decoration:none}}a:hover{{text-decoration:underline}}
.kept{{color:#16a34a;font-weight:600}}.dup{{color:#dc2626}}
</style></head><body>
<h1>Deduplicator Report</h1>
<div class="stats">
<div><div class="sv">{}</div><div class="sl">files scanned</div></div>
<div><div class="sv">{}</div><div class="sl">duplicate groups</div></div>
<div><div class="sv">{}</div><div class="sl">recoverable</div></div>
<div><div class="sv" style="font-size:13px;padding-top:8px">{}</div><div class="sl">folder</div></div>
</div>
<table><thead><tr><th>File</th><th>Size</th><th>Modified</th><th>Status</th></tr></thead>
<tbody>{}</tbody></table>
<script>document.querySelectorAll('.ts').forEach(function(e){{var t=+e.dataset.ts;if(t)e.textContent=new Date(t*1000).toLocaleDateString();}});</script>
</body></html>"#,
        summary.scanned_files,
        summary.total_groups,
        html_esc(&wasted),
        html_esc(&summary.folder),
        rows
    )
}

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
    {
        let cache = app.state::<ScanCache>();
        let guard = cache.0.lock().unwrap();
        if let Some(ref loaded) = *guard {
            if loaded.summary.id == id {
                return Ok(loaded.summary.clone());
            }
        }
    }

    let file = read_session_file(&app, &id)
        .ok_or_else(|| "Session introuvable".to_string())?;

    // Liste d'ignores : appliquee a la vue affichee uniquement, JAMAIS persistee dans
    // le fichier de session. Permet a clear_ignore_entry de restaurer le groupe au
    // prochain reload (sinon "retirer de la liste d'ignores" deviendrait sans effet
    // pour les sessions deja chargees).
    let ignored_keys = crate::app_data_dir(&app)
        .map(|d| crate::ignore_list::IgnoreList::load(&d).keys_set())
        .unwrap_or_default();

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

    // Filtre d'affichage applique APRES save : la session sur disque garde tous les
    // groupes originaux, le frontend ne voit que ceux absents de la liste d'ignores.
    let (displayed_groups, displayed_summary) = apply_ignore_filter(groups, summary, &ignored_keys);

    let result = displayed_summary.clone();
    *app.state::<ScanCache>().0.lock().unwrap() = Some(LoadedSession {
        summary: displayed_summary,
        groups: displayed_groups,
        archive_groups,
        archive_entries_cache,
    });
    Ok(result)
}

/// Filtre les groupes contre la liste d'ignores et recalcule total_groups +
/// total_wasted_bytes du summary si au moins un groupe a ete retire. Pure : sans I/O.
fn apply_ignore_filter(
    groups: Vec<DuplicateGroup>,
    mut summary: ScanSummary,
    ignored_keys: &std::collections::HashSet<String>,
) -> (Vec<DuplicateGroup>, ScanSummary) {
    if ignored_keys.is_empty() {
        return (groups, summary);
    }
    let original_count = groups.len();
    let displayed: Vec<DuplicateGroup> = groups
        .into_iter()
        .filter(|g| {
            let paths: Vec<String> = g.files.iter().map(|f| f.path.clone()).collect();
            !ignored_keys.contains(&crate::ignore_list::group_ignore_key(&paths))
        })
        .collect();
    if displayed.len() != original_count {
        summary.total_groups = displayed.len();
        summary.total_wasted_bytes = crate::recalc_wasted_bytes(&displayed);
    }
    (displayed, summary)
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
    let cache = app.state::<ScanCache>();
    let guard = cache.0.lock().unwrap();
    match *guard {
        Some(ref loaded) => Ok(make_page(&loaded.groups, offset, limit)),
        None => Err("Aucune session chargee".to_string()),
    }
}

#[tauri::command]
pub fn list_folder_keys(app: tauri::AppHandle) -> Result<Vec<FolderSummary>, String> {
    let cache = app.state::<ScanCache>();
    let guard = cache.0.lock().unwrap();
    match *guard {
        None => Err("Aucune session chargee".to_string()),
        Some(ref loaded) => {
            let mut summaries: Vec<FolderSummary> = Vec::new();
            for group in &loaded.groups {
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
            Ok(summaries)
        }
    }
}

#[tauri::command]
pub fn get_folder_groups_page(
    app: tauri::AppHandle,
    folder_key: String,
    offset: usize,
    limit: usize,
) -> Result<GroupsPage, String> {
    let cache = app.state::<ScanCache>();
    let guard = cache.0.lock().unwrap();
    match *guard {
        None => Err("Aucune session chargee".to_string()),
        Some(ref loaded) => {
            let folder_groups: Vec<DuplicateGroup> = loaded.groups.iter()
                .filter(|g| g.folder_key.as_deref().unwrap_or("") == folder_key.as_str())
                .cloned()
                .collect();
            Ok(make_page(&folder_groups, offset, limit))
        }
    }
}

#[tauri::command]
pub fn select_all_duplicates(app: tauri::AppHandle) -> Result<Vec<String>, String> {
    let cache = app.state::<ScanCache>();
    let guard = cache.0.lock().unwrap();
    match *guard {
        None => Err("Aucune session chargee".to_string()),
        Some(ref loaded) => {
            let paths: Vec<String> = loaded
                .groups
                .iter()
                .flat_map(|group| group.files.iter().skip(1).map(|f| f.path.clone()))
                .collect();
            Ok(paths)
        }
    }
}

#[tauri::command]
pub async fn smart_select(
    app: tauri::AppHandle,
    mode: String,
    folder_prefix: Option<String>,
) -> Result<Vec<String>, String> {
    let cache = app.state::<ScanCache>();
    let groups = {
        let guard = cache.0.lock().unwrap();
        match *guard {
            None => return Err("Aucune session chargee".to_string()),
            Some(ref loaded) => loaded.groups.clone(),
        }
    };
    tauri::async_runtime::spawn_blocking(move || {
        Ok(select_files_to_delete(&groups, &mode, folder_prefix.as_deref()))
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn export_results(
    app: tauri::AppHandle,
    session_id: String,
    format: String,
    output_path: String,
) -> Result<(), String> {
    let file = read_session_file(&app, &session_id)
        .ok_or_else(|| "Session introuvable".to_string())?;
    let content = match format.as_str() {
        "csv" => generate_csv(&file.groups),
        "html" => generate_html(&file.summary, &file.groups),
        _ => return Err(format!("Format inconnu: {}", format)),
    };
    std::fs::write(&output_path, content).map_err(|e| e.to_string())
}

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
    fn apply_ignore_filter_retire_les_groupes_dans_la_liste() {
        let g1 = make_group("g1", 1000, &["/a/1.txt", "/a/1bis.txt"]);
        let g2 = make_group("g2", 2000, &["/b/2.txt", "/b/2bis.txt"]);
        let g3 = make_group("g3", 3000, &["/c/3.txt", "/c/3bis.txt"]);

        let g2_paths: Vec<String> = g2.files.iter().map(|f| f.path.clone()).collect();
        let mut ignored = HashSet::new();
        ignored.insert(crate::ignore_list::group_ignore_key(&g2_paths));

        let summary = make_summary(3, 1000 + 2000 + 3000);
        let (displayed, displayed_summary) = apply_ignore_filter(vec![g1, g2, g3], summary, &ignored);

        assert_eq!(displayed.len(), 2);
        assert!(displayed.iter().all(|g| g.id != "g2"));
        assert_eq!(displayed_summary.total_groups, 2);
        assert_eq!(displayed_summary.total_wasted_bytes, 1000 + 3000);
    }

    #[test]
    fn apply_ignore_filter_passthrough_si_aucun_match() {
        let g1 = make_group("g1", 1000, &["/a/1.txt", "/a/1bis.txt"]);
        let g2 = make_group("g2", 2000, &["/b/2.txt", "/b/2bis.txt"]);
        let summary = make_summary(2, 3000);

        let mut ignored = HashSet::new();
        ignored.insert("clef-qui-ne-matche-aucun-groupe".to_string());

        let (displayed, displayed_summary) =
            apply_ignore_filter(vec![g1, g2], summary, &ignored);

        assert_eq!(displayed.len(), 2);
        assert_eq!(displayed_summary.total_groups, 2);
        assert_eq!(displayed_summary.total_wasted_bytes, 3000);
    }

    #[test]
    fn apply_ignore_filter_no_op_si_liste_vide() {
        let g1 = make_group("g1", 1000, &["/a/1.txt", "/a/1bis.txt"]);
        let summary = make_summary(1, 1000);
        let ignored = HashSet::new();

        let (displayed, displayed_summary) = apply_ignore_filter(vec![g1], summary, &ignored);

        assert_eq!(displayed.len(), 1);
        assert_eq!(displayed_summary.total_groups, 1);
        assert_eq!(displayed_summary.total_wasted_bytes, 1000);
    }
}
