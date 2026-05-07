use tauri::Manager;

use crate::{GroupsPage, LoadedSession, ScanCache, ScanSummary, SessionFile};
use crate::{read_session_file, recalc_wasted_bytes, save_session, select_files_to_delete};
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
pub fn load_session(app: tauri::AppHandle, id: String) -> Result<ScanSummary, String> {
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

    let mut groups = file.groups;
    let mut summary = file.summary;

    let before = groups.len();
    for group in groups.iter_mut() {
        group.files.retain(|f| std::path::Path::new(&f.path).exists());
    }
    groups.retain(|g| g.files.len() >= 2);

    if groups.len() != before {
        summary.total_groups = groups.len();
        summary.total_wasted_bytes = recalc_wasted_bytes(&groups);
        save_session(&app, &summary, &groups);
    }

    let result = summary.clone();
    *app.state::<ScanCache>().0.lock().unwrap() = Some(LoadedSession { summary, groups, archive_groups: vec![] });
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
