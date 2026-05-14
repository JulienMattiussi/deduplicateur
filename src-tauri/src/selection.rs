//! Selection intelligente des fichiers a supprimer dans un groupe.
//! Pure : prend une liste de groupes + un mode, retourne les chemins a cocher.
//! Utilise par `commands::session::smart_select`. Pas de Tauri ici, testable seul.

use crate::scanner::{DuplicateFile, DuplicateGroup};

fn pixel_count_for_file(file: &DuplicateFile) -> Option<u64> {
    if let Some(ref vm) = file.video_metadata {
        return Some(vm.width as u64 * vm.height as u64);
    }
    image::image_dimensions(&file.path)
        .ok()
        .map(|(w, h)| w as u64 * h as u64)
}

pub fn select_files_to_delete(
    groups: &[DuplicateGroup],
    mode: &str,
    folder_prefix: Option<&str>,
) -> Vec<String> {
    groups
        .iter()
        .flat_map(|group| {
            if group.files.is_empty() {
                return vec![];
            }
            let keep: Option<&DuplicateFile> = match mode {
                "newest" => group.files.iter().max_by_key(|f| f.modified),
                "oldest" => group.files.iter().min_by_key(|f| f.modified),
                "largest_size" => group.files.iter().max_by(|a, b| {
                    a.size.cmp(&b.size).then(a.modified.cmp(&b.modified))
                }),
                "highest_resolution" => {
                    let any_has_resolution =
                        group.files.iter().any(|f| pixel_count_for_file(f).is_some());
                    if !any_has_resolution {
                        return vec![];
                    }
                    group.files.iter().max_by(|a, b| {
                        let pa = pixel_count_for_file(a).unwrap_or(0);
                        let pb = pixel_count_for_file(b).unwrap_or(0);
                        pa.cmp(&pb)
                            .then(a.size.cmp(&b.size))
                            .then(a.modified.cmp(&b.modified))
                    })
                }
                "priority_folder" => {
                    let prefix = folder_prefix.unwrap_or("");
                    let in_priority: Vec<&DuplicateFile> = group
                        .files
                        .iter()
                        .filter(|f| f.path.starts_with(prefix))
                        .collect();
                    if in_priority.is_empty() {
                        return vec![];
                    }
                    in_priority.into_iter().max_by_key(|f| f.modified)
                }
                _ => group.files.first(),
            };
            group
                .files
                .iter()
                .filter(|f| keep.is_none_or(|k| k.path != f.path))
                .map(|f| f.path.clone())
                .collect::<Vec<_>>()
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::scanner::DuplicateGroup;
    use crate::video::VideoMetadata;

    fn make_file(path: &str, size: u64, modified: u64) -> DuplicateFile {
        DuplicateFile {
            path: path.to_string(),
            name: path.split('/').next_back().unwrap_or(path).to_string(),
            size,
            modified,
            video_metadata: None,
            audio_metadata: None,
            source: None,
        }
    }

    fn make_group(files: Vec<DuplicateFile>) -> DuplicateGroup {
        DuplicateGroup {
            id: "test".to_string(),
            hash: "abc".to_string(),
            size: files.first().map_or(0, |f| f.size),
            files,
            folder_key: None,
            similar: false,
            video_similar: false,
            audio_similar: false,
        }
    }

    #[test]
    fn largest_size_keeps_biggest() {
        let groups = vec![make_group(vec![
            make_file("/a/small.jpg", 100, 100),
            make_file("/a/large.jpg", 300, 50),
            make_file("/a/medium.jpg", 200, 200),
        ])];
        let result = select_files_to_delete(&groups, "largest_size", None);
        assert_eq!(result.len(), 2);
        assert!(!result.contains(&"/a/large.jpg".to_string()));
        assert!(result.contains(&"/a/small.jpg".to_string()));
        assert!(result.contains(&"/a/medium.jpg".to_string()));
    }

    #[test]
    fn largest_size_tiebreak_newest() {
        let groups = vec![make_group(vec![
            make_file("/a/old.jpg", 100, 50),
            make_file("/a/new.jpg", 100, 200),
        ])];
        let result = select_files_to_delete(&groups, "largest_size", None);
        assert_eq!(result.len(), 1);
        assert!(result.contains(&"/a/old.jpg".to_string()));
    }

    #[test]
    fn priority_folder_keeps_matching() {
        let groups = vec![make_group(vec![
            make_file("/other/file.jpg", 100, 50),
            make_file("/priority/file.jpg", 100, 50),
        ])];
        let result = select_files_to_delete(&groups, "priority_folder", Some("/priority"));
        assert_eq!(result.len(), 1);
        assert!(result.contains(&"/other/file.jpg".to_string()));
    }

    #[test]
    fn priority_folder_no_match_skips_group() {
        let groups = vec![make_group(vec![
            make_file("/a/old.jpg", 100, 50),
            make_file("/a/new.jpg", 100, 200),
        ])];
        let result =
            select_files_to_delete(&groups, "priority_folder", Some("/not-matching"));
        assert!(result.is_empty(), "aucun fichier coche si aucun ne correspond au prefixe");
    }

    #[test]
    fn priority_folder_multiple_matches_keeps_newest() {
        let groups = vec![make_group(vec![
            make_file("/priority/old.jpg", 100, 50),
            make_file("/priority/new.jpg", 100, 200),
            make_file("/other/file.jpg", 100, 300),
        ])];
        let result = select_files_to_delete(&groups, "priority_folder", Some("/priority"));
        assert_eq!(result.len(), 2);
        assert!(!result.contains(&"/priority/new.jpg".to_string()));
        assert!(result.contains(&"/priority/old.jpg".to_string()));
        assert!(result.contains(&"/other/file.jpg".to_string()));
    }

    #[test]
    fn highest_resolution_video_keeps_hd() {
        let mut hd = make_file("/a/hd.mp4", 1000, 100);
        hd.video_metadata = Some(VideoMetadata {
            duration_secs: 60.0,
            width: 1920,
            height: 1080,
            codec: "h264".to_string(),
            audio_codec: None,
            audio_channels: None,
            audio_tracks: Vec::new(),
        });
        let mut sd = make_file("/a/sd.mp4", 500, 200);
        sd.video_metadata = Some(VideoMetadata {
            duration_secs: 60.0,
            width: 1280,
            height: 720,
            codec: "h264".to_string(),
            audio_codec: None,
            audio_channels: None,
            audio_tracks: Vec::new(),
        });
        let groups = vec![make_group(vec![sd, hd])];
        let result = select_files_to_delete(&groups, "highest_resolution", None);
        assert_eq!(result.len(), 1);
        assert!(result.contains(&"/a/sd.mp4".to_string()));
    }

    #[test]
    fn highest_resolution_tiebreak_largest_then_newest() {
        let mut a = make_file("/a/a.mp4", 100, 100);
        a.video_metadata = Some(VideoMetadata {
            duration_secs: 60.0,
            width: 1920,
            height: 1080,
            codec: "h264".to_string(),
            audio_codec: None,
            audio_channels: None,
            audio_tracks: Vec::new(),
        });
        let mut b = make_file("/a/b.mp4", 200, 50);
        b.video_metadata = Some(VideoMetadata {
            duration_secs: 60.0,
            width: 1920,
            height: 1080,
            codec: "h264".to_string(),
            audio_codec: None,
            audio_channels: None,
            audio_tracks: Vec::new(),
        });
        let groups = vec![make_group(vec![a, b])];
        let result = select_files_to_delete(&groups, "highest_resolution", None);
        assert_eq!(result.len(), 1);
        assert!(result.contains(&"/a/a.mp4".to_string()));
    }

    #[test]
    fn select_empty_group_returns_empty() {
        let groups = vec![make_group(vec![])];
        let result = select_files_to_delete(&groups, "largest_size", None);
        assert!(result.is_empty());
    }

    #[test]
    fn highest_resolution_no_metadata_skips_group() {
        let groups = vec![make_group(vec![
            make_file("/a/doc1.pdf", 100, 100),
            make_file("/a/doc2.pdf", 200, 200),
        ])];
        let result = select_files_to_delete(&groups, "highest_resolution", None);
        assert!(result.is_empty(), "aucun fichier coche si aucune resolution detectable");
    }

    #[test]
    fn highest_resolution_mixed_keeps_image_over_no_metadata() {
        let mut img = make_file("/a/photo.jpg", 50, 100);
        img.video_metadata = Some(VideoMetadata {
            duration_secs: 0.0,
            width: 1920,
            height: 1080,
            codec: "jpeg".to_string(),
            audio_codec: None,
            audio_channels: None,
            audio_tracks: Vec::new(),
        });
        let other = make_file("/a/doc.pdf", 200, 200);
        let groups = vec![make_group(vec![other, img])];
        let result = select_files_to_delete(&groups, "highest_resolution", None);
        assert_eq!(result.len(), 1);
        assert!(result.contains(&"/a/doc.pdf".to_string()));
    }
}
