//! Export d'une session vers CSV ou HTML.
//!
//! Lit la session **depuis le disque** (pas le cache : on veut un export
//! complet, pas filtré par les ignores en vigueur a l'instant t). Le format
//! HTML est self-contained : CSS inline + JS qui formate les timestamps cote
//! navigateur de l'utilisateur final.

use crate::read_session_file;
use crate::scanner::DuplicateGroup;
use crate::ScanSummary;

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

pub fn generate_csv(groups: &[DuplicateGroup]) -> String {
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

pub fn generate_html(summary: &ScanSummary, groups: &[DuplicateGroup]) -> String {
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
    use crate::scanner::{DuplicateFile, DuplicateGroup};

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

    #[test]
    fn csv_escape_simple() {
        assert_eq!(csv_escape("hello"), "hello");
        assert_eq!(csv_escape("a,b"), "\"a,b\"");
        assert_eq!(csv_escape("a\"b"), "\"a\"\"b\"");
        assert_eq!(csv_escape("line\nbreak"), "\"line\nbreak\"");
    }

    #[test]
    fn html_esc_caracteres_speciaux() {
        assert_eq!(html_esc("a<b>c&d\""), "a&lt;b&gt;c&amp;d&quot;");
    }

    #[test]
    fn generate_csv_premiere_ligne_kept_reste_duplicate() {
        let g = make_group("g1", 1024, &["/a/file1.txt", "/b/file2.txt"]);
        let csv = generate_csv(&[g]);
        assert!(csv.starts_with("Group ID,File Path,"));
        assert!(csv.contains(",kept\n"));
        assert!(csv.contains(",duplicate\n"));
    }
}
