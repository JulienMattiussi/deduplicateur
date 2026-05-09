use std::path::{Path, PathBuf};
use std::process::Command;
use crate::tool_finder;
use super::hash::get_video_metadata;

trait NoWindowExt {
    fn no_window(&mut self) -> &mut Self;
}

impl NoWindowExt for Command {
    fn no_window(&mut self) -> &mut Self {
        #[cfg(target_os = "windows")]
        {
            use std::os::windows::process::CommandExt;
            self.creation_flags(0x08000000);
        }
        self
    }
}

/// Resultat de la preparation d'une video pour la lecture dans le comparateur.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(tag = "kind", content = "path")]
pub enum PreparedVideo {
    /// Le fichier original est lisible directement par le WebView.
    Direct(String),
    /// Le fichier original a ete remuxe vers un mp4 temporaire (codec compatible mais conteneur non lu).
    Remuxed(String),
    /// Format ou codec non lisible par le WebView et non remuxable. L'UI doit proposer
    /// l'ouverture dans le lecteur systeme.
    Unsupported,
}

/// Extensions que WebView2 / WebKitGTK lisent directement (sans transcodage).
fn is_direct_extension(ext: &str) -> bool {
    matches!(ext, "mp4" | "m4v" | "webm" | "ogg" | "ogv" | "oga")
}

/// Extensions que ffmpeg peut remuxer (changer de conteneur sans reencoder le flux).
fn is_remux_candidate_extension(ext: &str) -> bool {
    matches!(ext, "flv" | "mkv" | "ts" | "m2ts" | "mts" | "mov" | "3gp" | "3g2")
}

/// Codecs que le WebView lit dans un conteneur mp4 (apres remux).
fn is_remux_compatible_codec(codec: &str) -> bool {
    matches!(codec, "h264" | "hevc" | "h265" | "vp8" | "vp9" | "av1")
}

fn extension_lower(path: &Path) -> Option<String> {
    path.extension().and_then(|e| e.to_str()).map(|s| s.to_ascii_lowercase())
}

/// Determine la categorie de preparation requise pour une video, sans rien lancer.
/// Pure : utile pour les tests.
pub fn classify(extension: Option<&str>, codec: Option<&str>) -> PrepareKind {
    let ext = match extension { Some(e) => e, None => return PrepareKind::Unsupported };
    if is_direct_extension(ext) {
        return PrepareKind::Direct;
    }
    if is_remux_candidate_extension(ext) {
        if let Some(c) = codec {
            if is_remux_compatible_codec(c) {
                return PrepareKind::Remux;
            }
        }
    }
    PrepareKind::Unsupported
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PrepareKind {
    Direct,
    Remux,
    Unsupported,
}

fn remux_dir(data_dir: &Path) -> PathBuf {
    data_dir.join("video_remux")
}

/// Construit un nom de fichier deterministe base sur le chemin source + mtime + size,
/// permettant la reutilisation entre sessions sans re-remuxer.
fn target_filename(path: &Path, mtime: u64, size: u64) -> String {
    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    use std::hash::{Hash, Hasher};
    path.to_string_lossy().hash(&mut hasher);
    mtime.hash(&mut hasher);
    size.hash(&mut hasher);
    format!("{:016x}.mp4", hasher.finish())
}

/// Prepare une video pour la lecture : direct, remux, ou unsupported.
/// `data_dir` est le repertoire de stockage temporaire (typiquement `app_local_data_dir`).
pub fn prepare_for_playback(path: &str, data_dir: &Path) -> PreparedVideo {
    let p = Path::new(path);
    let ext = extension_lower(p);
    let meta = get_video_metadata(path);
    let codec = meta.as_ref().map(|m| m.codec.as_str());

    match classify(ext.as_deref(), codec) {
        PrepareKind::Direct => PreparedVideo::Direct(path.to_string()),
        PrepareKind::Unsupported => PreparedVideo::Unsupported,
        PrepareKind::Remux => {
            let fs_meta = match std::fs::metadata(p) {
                Ok(m) => m,
                Err(_) => return PreparedVideo::Unsupported,
            };
            let mtime = fs_meta.modified().ok()
                .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                .map(|d| d.as_secs())
                .unwrap_or(0);
            let size = fs_meta.len();

            let dir = remux_dir(data_dir);
            if std::fs::create_dir_all(&dir).is_err() {
                return PreparedVideo::Unsupported;
            }
            let target = dir.join(target_filename(p, mtime, size));

            // Cache : reutilise si deja remuxe et toujours valide.
            if target.exists() {
                if let Ok(t_meta) = std::fs::metadata(&target) {
                    if t_meta.len() > 0 {
                        return PreparedVideo::Remuxed(target.to_string_lossy().into_owned());
                    }
                }
            }

            let ffmpeg = tool_finder::find_tool("ffmpeg")
                .map(|p| p.to_string_lossy().into_owned())
                .unwrap_or_else(|| "ffmpeg".to_string());

            // -c copy : pas de reencodage. -movflags +faststart : metadata en debut de fichier (streaming).
            // Audio remux : les conteneurs non-mp4 contiennent souvent de l'aac/ac3 lisible direct ;
            // si le codec audio n'est pas compatible mp4 (ex. flv contenant speex), -c:a copy echoue.
            // On retombe alors sur reencodage audio en aac, video toujours en copy.
            let ok_full_copy = Command::new(&ffmpeg)
                .args(["-y", "-i", path, "-c", "copy", "-movflags", "+faststart"])
                .arg(&target)
                .no_window()
                .output()
                .map(|o| o.status.success() && target.exists() && std::fs::metadata(&target).map(|m| m.len() > 0).unwrap_or(false))
                .unwrap_or(false);

            if ok_full_copy {
                return PreparedVideo::Remuxed(target.to_string_lossy().into_owned());
            }

            // Retry : reencode audio uniquement.
            let _ = std::fs::remove_file(&target);
            let ok_audio_reencode = Command::new(&ffmpeg)
                .args(["-y", "-i", path, "-c:v", "copy", "-c:a", "aac", "-movflags", "+faststart"])
                .arg(&target)
                .no_window()
                .output()
                .map(|o| o.status.success() && target.exists() && std::fs::metadata(&target).map(|m| m.len() > 0).unwrap_or(false))
                .unwrap_or(false);

            if ok_audio_reencode {
                PreparedVideo::Remuxed(target.to_string_lossy().into_owned())
            } else {
                let _ = std::fs::remove_file(&target);
                PreparedVideo::Unsupported
            }
        }
    }
}

/// Purge le cache de remux. A appeler au demarrage de l'app.
pub fn purge_remux_cache(data_dir: &Path) {
    let dir = remux_dir(data_dir);
    if dir.exists() {
        let _ = std::fs::remove_dir_all(&dir);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn classify_direct_pour_mp4_webm() {
        assert_eq!(classify(Some("mp4"), Some("h264")), PrepareKind::Direct);
        assert_eq!(classify(Some("webm"), Some("vp9")), PrepareKind::Direct);
        assert_eq!(classify(Some("m4v"), None), PrepareKind::Direct);
    }

    #[test]
    fn classify_remux_pour_flv_h264() {
        assert_eq!(classify(Some("flv"), Some("h264")), PrepareKind::Remux);
        assert_eq!(classify(Some("mkv"), Some("hevc")), PrepareKind::Remux);
        assert_eq!(classify(Some("ts"), Some("h264")), PrepareKind::Remux);
    }

    #[test]
    fn classify_unsupported_pour_avi_mpeg4() {
        assert_eq!(classify(Some("avi"), Some("mpeg4")), PrepareKind::Unsupported);
        assert_eq!(classify(Some("wmv"), Some("wmv2")), PrepareKind::Unsupported);
        assert_eq!(classify(Some("flv"), Some("flv1")), PrepareKind::Unsupported);
    }

    #[test]
    fn classify_unsupported_si_codec_inconnu() {
        // Conteneur potentiellement remuxable mais codec absent ou non compatible.
        assert_eq!(classify(Some("mkv"), None), PrepareKind::Unsupported);
        assert_eq!(classify(Some("flv"), Some("vp6f")), PrepareKind::Unsupported);
    }

    #[test]
    fn classify_unsupported_si_extension_absente() {
        assert_eq!(classify(None, Some("h264")), PrepareKind::Unsupported);
    }

    #[test]
    fn target_filename_deterministe_meme_input() {
        let p = Path::new("/foo/bar.flv");
        let a = target_filename(p, 100, 200);
        let b = target_filename(p, 100, 200);
        assert_eq!(a, b);
        assert!(a.ends_with(".mp4"));
    }

    #[test]
    fn target_filename_change_quand_mtime_change() {
        let p = Path::new("/foo/bar.flv");
        assert_ne!(target_filename(p, 100, 200), target_filename(p, 101, 200));
        assert_ne!(target_filename(p, 100, 200), target_filename(p, 100, 201));
    }
}
