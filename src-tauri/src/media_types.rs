//! Source de verite unique pour les extensions de fichiers media supportes.
//!
//! Avant ce module, les listes etaient dispersees :
//! - `scanner/fs.rs::is_image` et `scanner/hash.rs::is_image_path` dupliquaient la meme liste
//! - `scanner/fs.rs::is_video` avait sa propre liste
//! - `audio/hash.rs::AUDIO_EXTS` etait correctement externalise
//! - `commands/files.rs::is_browser_native_image` avait une liste plus large (formats que le
//!   `<img>` HTML5 sait decoder), distincte de celle utilisee pour la dedup
//! - `video/media_server.rs::video_mime` mappait encore d'autres extensions a des MIME types
//!
//! Toute modification d'une liste ici se propage automatiquement a tous les sites d'usage.
//! Ne pas ajouter de nouvelle fonction `is_xxx` ailleurs - les exposer ici.

use std::path::Path;

/// Extensions reconnues comme images pour la deduplication (decodees par `image` crate
/// et hashables via pHash). Inclut TIFF/HEIC/AVIF qui ne sont pas tous decodables
/// nativement par le browser.
pub const IMAGE_EXTS: &[&str] = &[
    "jpg", "jpeg", "png", "webp", "bmp", "gif", "tiff", "tif", "avif",
];

/// Extensions reconnues comme videos pour la deduplication. Couvre les principaux conteneurs ;
/// les codecs sont detectes au cas par cas via ffprobe pour decider remux/Direct/Unsupported.
pub const VIDEO_EXTS: &[&str] = &[
    "mp4", "avi", "mkv", "mov", "wmv", "webm", "flv", "m4v", "mpg", "mpeg",
    "3gp", "ts", "mts", "m2ts",
];

/// Extensions reconnues comme audio pour la deduplication.
pub const AUDIO_EXTS: &[&str] = &[
    "mp3", "flac", "ogg", "m4a", "aac", "wav", "wma", "opus", "aiff", "aif", "ape",
];

/// Extensions que le `<img>` HTML5 (WebView2 / WebKitGTK) decode nativement. Sur-ensemble
/// de `IMAGE_EXTS` cote browser : ajoute SVG, ICO, et les variantes JPEG (jfif/pjpeg/pjp),
/// mais exclut TIFF/HEIC que les browsers ne savent pas afficher (passent par le pipeline
/// thumbnail JPEG en data URL pour ces formats).
///
/// Pour les `.gif`, l'extension seule ne suffit pas : la verification du magic byte
/// (`GIF87a` / `GIF89a`) est obligatoire, donc le `.gif` n'est pas dans cette liste
/// (gere a part dans `is_animated_gif`).
pub const BROWSER_NATIVE_IMAGE_EXTS: &[&str] = &[
    "png", "jpg", "jpeg", "jfif", "pjpeg", "pjp", "webp", "avif", "bmp", "svg", "ico",
];

fn ext_lower(path: &Path) -> Option<String> {
    path.extension()
        .and_then(|e| e.to_str())
        .map(|s| s.to_ascii_lowercase())
}

/// Retourne true si l'extension du chemin est dans `IMAGE_EXTS`.
pub fn is_image(path: &Path) -> bool {
    ext_lower(path).map(|e| IMAGE_EXTS.contains(&e.as_str())).unwrap_or(false)
}

/// Variante par `&str` pour compatibilite avec les call sites historiques.
pub fn is_image_str(path: &str) -> bool {
    is_image(Path::new(path))
}

/// Retourne true si l'extension du chemin est dans `VIDEO_EXTS`.
pub fn is_video(path: &Path) -> bool {
    ext_lower(path).map(|e| VIDEO_EXTS.contains(&e.as_str())).unwrap_or(false)
}

/// Variante par `&str`.
pub fn is_video_str(path: &str) -> bool {
    is_video(Path::new(path))
}

/// Retourne true si l'extension du chemin est dans `AUDIO_EXTS`.
pub fn is_audio(path: &Path) -> bool {
    ext_lower(path).map(|e| AUDIO_EXTS.contains(&e.as_str())).unwrap_or(false)
}

/// Variante par `&str`.
pub fn is_audio_str(path: &str) -> bool {
    is_audio(Path::new(path))
}

/// Retourne true si l'extension correspond a un format que le `<img>` HTML5 sait decoder
/// nativement (hors `.gif` qui necessite une verification magic-byte additionnelle).
pub fn is_browser_native_image_ext(path: &Path) -> bool {
    ext_lower(path)
        .map(|e| BROWSER_NATIVE_IMAGE_EXTS.contains(&e.as_str()))
        .unwrap_or(false)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    #[test]
    fn image_exts_couvre_les_formats_courants() {
        for ext in ["jpg", "jpeg", "png", "webp", "bmp", "gif", "tiff", "tif", "avif"] {
            assert!(is_image(&PathBuf::from(format!("/x/y.{}", ext))), "{} doit etre image", ext);
        }
    }

    #[test]
    fn image_exts_insensible_a_la_casse() {
        assert!(is_image(&PathBuf::from("/x/Y.JPG")));
        assert!(is_image(&PathBuf::from("/x/y.PNG")));
        assert!(is_image_str("/x/y.WeBp"));
    }

    #[test]
    fn image_rejette_non_image() {
        assert!(!is_image(&PathBuf::from("/x/y.mp4")));
        assert!(!is_image(&PathBuf::from("/x/y.txt")));
        assert!(!is_image(&PathBuf::from("/x/y")));
    }

    #[test]
    fn video_exts_couvre_les_formats_courants() {
        for ext in ["mp4", "avi", "mkv", "mov", "wmv", "webm", "flv", "m4v", "mpg", "mpeg", "3gp", "ts", "mts", "m2ts"] {
            assert!(is_video(&PathBuf::from(format!("/x/y.{}", ext))), "{} doit etre video", ext);
        }
    }

    #[test]
    fn audio_exts_couvre_les_formats_courants() {
        for ext in ["mp3", "flac", "ogg", "m4a", "aac", "wav", "wma", "opus", "aiff", "aif", "ape"] {
            assert!(is_audio(&PathBuf::from(format!("/x/y.{}", ext))), "{} doit etre audio", ext);
        }
    }

    #[test]
    fn browser_native_inclut_svg_ico_variantes_jpeg() {
        assert!(is_browser_native_image_ext(&PathBuf::from("/x/y.svg")));
        assert!(is_browser_native_image_ext(&PathBuf::from("/x/y.ico")));
        assert!(is_browser_native_image_ext(&PathBuf::from("/x/y.jfif")));
        assert!(is_browser_native_image_ext(&PathBuf::from("/x/y.pjpeg")));
    }

    #[test]
    fn browser_native_exclut_tiff_heic_gif() {
        // TIFF/HEIC : le browser ne sait pas decoder
        assert!(!is_browser_native_image_ext(&PathBuf::from("/x/y.tiff")));
        assert!(!is_browser_native_image_ext(&PathBuf::from("/x/y.heic")));
        // GIF : extension seule insuffisante, magic-byte check obligatoire
        assert!(!is_browser_native_image_ext(&PathBuf::from("/x/y.gif")));
    }

    #[test]
    fn ensembles_dedup_et_browser_non_disjoints() {
        // PNG/JPEG/WEBP/BMP/AVIF sont dans les DEUX (dedup et browser-native).
        for ext in ["png", "jpg", "jpeg", "webp", "bmp", "avif"] {
            assert!(is_image(&PathBuf::from(format!("/x/y.{}", ext))));
            assert!(is_browser_native_image_ext(&PathBuf::from(format!("/x/y.{}", ext))));
        }
    }
}
