use crate::ScanCache;
use crate::{purge_deleted_from_session, recalc_wasted_bytes, save_session};
use tauri::Manager;

#[derive(Debug, serde::Serialize)]
pub struct ImageMeta {
    pub width: u32,
    pub height: u32,
    pub format: String,
    pub exif_date: Option<String>,
}

fn try_read_exif_date(path: &str) -> Option<String> {
    let file = std::fs::File::open(path).ok()?;
    let mut buf = std::io::BufReader::new(file);
    let exif = exif::Reader::new().read_from_container(&mut buf).ok()?;
    let field = exif.get_field(exif::Tag::DateTimeOriginal, exif::In::PRIMARY)?;
    Some(field.display_value().to_string())
}

#[cfg(target_os = "windows")]
fn open_in_file_manager(path: &str) -> std::io::Result<()> {
    use std::os::windows::process::CommandExt;
    let win_path = path.replace('/', "\\");
    std::process::Command::new("explorer.exe")
        .raw_arg(format!("/select,\"{}\"", win_path))
        .creation_flags(0x08000000)
        .spawn()
        .map(|_| ())
}

#[cfg(target_os = "macos")]
fn open_in_file_manager(path: &str) -> std::io::Result<()> {
    std::process::Command::new("open")
        .args(["-R", path])
        .spawn()
        .map(|_| ())
}

#[cfg(not(any(target_os = "windows", target_os = "macos")))]
fn open_in_file_manager(path: &str) -> std::io::Result<()> {
    let dir = std::path::Path::new(path)
        .parent()
        .unwrap_or_else(|| std::path::Path::new(path));
    std::process::Command::new("xdg-open")
        .arg(dir)
        .spawn()
        .map(|_| ())
}

#[cfg(target_os = "windows")]
fn open_file_default(path: &str) -> std::io::Result<()> {
    std::process::Command::new("explorer.exe")
        .arg(path)
        .spawn()
        .map(|_| ())
}

#[cfg(target_os = "macos")]
fn open_file_default(path: &str) -> std::io::Result<()> {
    std::process::Command::new("open").arg(path).spawn().map(|_| ())
}

#[cfg(not(any(target_os = "windows", target_os = "macos")))]
fn open_file_default(path: &str) -> std::io::Result<()> {
    std::process::Command::new("xdg-open").arg(path).spawn().map(|_| ())
}

#[tauri::command]
pub fn delete_files(app: tauri::AppHandle, paths: Vec<String>) -> Result<(), String> {
    let mut errors: Vec<String> = Vec::new();
    for path in &paths {
        if !std::path::Path::new(path).exists() {
            continue;
        }
        if let Err(e) = trash::delete(path) {
            errors.push(format!("{}: {}", path, e));
        }
    }
    if !errors.is_empty() {
        return Err(errors.join("\n"));
    }

    let deleted: std::collections::HashSet<String> = paths.into_iter().collect();
    let session_to_save = {
        let cache = app.state::<ScanCache>();
        let mut guard = cache.0.lock().unwrap();
        guard.as_mut().map(|loaded| {
            purge_deleted_from_session(&mut loaded.groups, &deleted);
            for ag in loaded.archive_groups.iter_mut() {
                ag.archives.retain(|a| !deleted.contains(&a.path));
            }
            loaded.archive_groups.retain(|ag| ag.archives.len() >= 2);
            // Purger aussi le cache d'entrees pour les archives supprimees
            loaded.archive_entries_cache.retain(|path, _| !deleted.contains(path));
            loaded.summary.total_groups = loaded.groups.len();
            loaded.summary.total_wasted_bytes = recalc_wasted_bytes(&loaded.groups);
            loaded.summary.archive_groups_count = loaded.archive_groups.len();
            (loaded.summary.clone(), loaded.groups.clone(), loaded.archive_groups.clone(), loaded.archive_entries_cache.clone())
        })
    };
    if let Some((summary, groups, archive_groups, entries_cache)) = session_to_save {
        save_session(&app, &summary, &groups, &archive_groups, &entries_cache);
    }
    Ok(())
}

#[tauri::command]
pub fn reveal_in_folder(path: String) -> Result<(), String> {
    open_in_file_manager(&path).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn open_file(path: String) -> Result<(), String> {
    open_file_default(&path).map_err(|e| e.to_string())
}

/// Sous-dossier de previsualisation des entrees d'archive : chaque clic sur une miniature
/// y ecrit l'entree extraite, qui est ensuite ouverte avec le viewer par defaut. Le dossier
/// est purge au demarrage de l'app (voir `lib.rs::run` setup) pour eviter l'accumulation.
fn archive_preview_dir(app: &tauri::AppHandle) -> Option<std::path::PathBuf> {
    let dir = app.path().app_local_data_dir().ok()?.join("archive_preview");
    std::fs::create_dir_all(&dir).ok()?;
    Some(dir)
}

/// Extrait une entree d'archive vers un fichier temporaire et retourne son chemin.
/// Helper interne mutualise par `open_archive_entry` (ouvre avec viewer par defaut)
/// et `get_archive_entry_url` (sert via le media server HTTP local).
async fn extract_archive_entry_to_preview(
    app: &tauri::AppHandle,
    archive_path: String,
    internal_path: String,
) -> Result<std::path::PathBuf, String> {
    let dir = archive_preview_dir(app).ok_or_else(|| "data_dir indisponible".to_string())?;
    tauri::async_runtime::spawn_blocking(move || {
        let bytes = crate::archive::read_archive_entry_bytes(
            std::path::Path::new(&archive_path),
            &internal_path,
        )?;
        let leaf = std::path::Path::new(&internal_path)
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_else(|| "entry".to_string());
        let id = uuid::Uuid::new_v4().simple().to_string();
        let safe = format!("{}_{}", &id[..8], leaf);
        let out_path = dir.join(safe);
        std::fs::write(&out_path, &bytes).map_err(|e| e.to_string())?;
        Ok::<std::path::PathBuf, String>(out_path)
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Extrait une entree d'archive vers un fichier temporaire et l'ouvre avec le viewer
/// par defaut. Utilise pour permettre le clic sur les miniatures du comparateur d'archives.
/// Le fichier temporaire reste sur disque jusqu'au prochain demarrage de l'app
/// (purge de `archive_preview/` au boot) ; on ne peut pas le supprimer immediatement
/// apres `open_file_default` puisque le viewer externe le lit en asynchrone.
#[tauri::command]
pub async fn open_archive_entry(
    app: tauri::AppHandle,
    archive_path: String,
    internal_path: String,
) -> Result<(), String> {
    let out_path = extract_archive_entry_to_preview(&app, archive_path, internal_path).await?;
    open_file_default(&out_path.to_string_lossy()).map_err(|e| e.to_string())
}

/// Extrait une entree audio d'archive vers un fichier temporaire et retourne son URL
/// servie par le media server HTTP local. Permet la lecture via `<audio src>` dans le
/// comparateur sans avoir a charger les bytes en base64 (lourd) ni a ouvrir un viewer
/// externe. Le fichier temporaire est purge au prochain demarrage de l'app comme pour
/// `open_archive_entry`.
#[tauri::command]
pub async fn get_archive_entry_url(
    app: tauri::AppHandle,
    archive_path: String,
    internal_path: String,
) -> Result<String, String> {
    use tauri::Manager;
    let port = app.state::<crate::MediaServerPort>().0;
    let out_path = extract_archive_entry_to_preview(&app, archive_path, internal_path).await?;
    // Le media server (axum) sert tous les fichiers par chemin absolu URL-encode.
    // Cf. video/media_server.rs : handle() fait percent_decode_str sur l'uri.
    let path_str = out_path.to_string_lossy();
    let encoded = percent_encoding::utf8_percent_encode(&path_str, percent_encoding::NON_ALPHANUMERIC).to_string();
    Ok(format!("http://127.0.0.1:{}/{}", port, encoded))
}

#[tauri::command]
pub async fn get_image_thumbnail(path: String, max_size: u32) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let img = image::open(&path).map_err(|e| e.to_string())?;
        let thumb = img.thumbnail(max_size, max_size);
        let mut buf = Vec::new();
        thumb
            .write_to(&mut std::io::Cursor::new(&mut buf), image::ImageOutputFormat::Jpeg(75))
            .map_err(|e| e.to_string())?;
        use base64::Engine;
        let encoded = base64::engine::general_purpose::STANDARD.encode(&buf);
        Ok(format!("data:image/jpeg;base64,{}", encoded))
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Variante de `get_image_thumbnail` adaptee au comparateur d'images : pour les GIF
/// (animes ou non), retourne une URL du media server local qui sert le fichier
/// d'origine - le `<img>` HTML5 anime alors le GIF nativement. Pour les autres
/// formats, retombe sur le pipeline JPEG data URL classique (resize via le crate
/// `image`, encode base64). La detection GIF combine extension + magic bytes
/// (`GIF87a` / `GIF89a`) pour eviter qu'un fichier renomme menteur ne soit servi
/// brut au lieu d'etre redimensionne.
#[tauri::command]
pub async fn get_image_url(
    app: tauri::AppHandle,
    path: String,
    max_size: u32,
) -> Result<String, String> {
    use tauri::Manager;
    let port = app.state::<crate::MediaServerPort>().0;
    tauri::async_runtime::spawn_blocking(move || {
        // Pour les formats decodes nativement par le `<img>` HTML5, on sert le
        // fichier d'origine via le media server local. Cela preserve la
        // resolution native (essentielle pour un comparateur ou l'utilisateur
        // peut zoomer pour comparer les details au pixel pres). Si on retombait
        // sur le pipeline thumbnail JPEG, la miniature 800px serait pixelisee
        // des qu'on zoome au-dela d'environ 1x sur des images plus grandes.
        // Pour les formats que le navigateur ne sait pas decoder (TIFF, HEIC,
        // RAW...), on conserve le pipeline data URL JPEG comme fallback.
        if is_browser_native_image(std::path::Path::new(&path)) {
            let encoded = percent_encoding::utf8_percent_encode(&path, percent_encoding::NON_ALPHANUMERIC).to_string();
            return Ok(format!("http://127.0.0.1:{}/{}", port, encoded));
        }
        let img = image::open(&path).map_err(|e| e.to_string())?;
        let thumb = img.thumbnail(max_size, max_size);
        let mut buf = Vec::new();
        thumb
            .write_to(&mut std::io::Cursor::new(&mut buf), image::ImageOutputFormat::Jpeg(75))
            .map_err(|e| e.to_string())?;
        use base64::Engine;
        let encoded = base64::engine::general_purpose::STANDARD.encode(&buf);
        Ok(format!("data:image/jpeg;base64,{}", encoded))
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Retourne true si l'extension du fichier correspond a un format que le
/// `<img>` HTML5 sait decoder nativement. Pour ces formats, on peut servir le
/// fichier original via le media server au lieu de passer par un thumbnail
/// JPEG redimensionne. Pour les `.gif`, la verification additionnelle des
/// magic bytes evite de servir un fichier qui ment sur son contenu (cf.
/// `is_animated_gif` ci-dessous).
///
/// La liste vit dans `crate::media_types::BROWSER_NATIVE_IMAGE_EXTS` ; le `.gif`
/// est gere a part car necessite la verification magic-byte en plus de l'extension.
fn is_browser_native_image(path: &std::path::Path) -> bool {
    if crate::media_types::is_browser_native_image_ext(path) {
        return true;
    }
    // GIF : extension seule insuffisante, on exige aussi le magic byte.
    let is_gif_ext = path.extension()
        .and_then(|e| e.to_str())
        .map(|s| s.eq_ignore_ascii_case("gif"))
        .unwrap_or(false);
    is_gif_ext && is_animated_gif(path)
}

/// Detecte un fichier GIF par extension + magic bytes `GIF87a` ou `GIF89a` (6 octets).
/// La verification magic protege contre les `.gif` menteurs (par ex. PNG renomme) qui
/// seraient sinon servis bruts au navigateur avec un MIME image/gif -> image cassee.
fn is_animated_gif(path: &std::path::Path) -> bool {
    let ext_ok = path
        .extension()
        .and_then(|e| e.to_str())
        .map(|s| s.eq_ignore_ascii_case("gif"))
        .unwrap_or(false);
    if !ext_ok {
        return false;
    }
    let Ok(mut file) = std::fs::File::open(path) else { return false; };
    use std::io::Read;
    let mut head = [0u8; 6];
    match file.read(&mut head) {
        Ok(6) => &head == b"GIF87a" || &head == b"GIF89a",
        _ => false,
    }
}

/// Genere a la volee une miniature pour une entree image situee dans une archive.
/// On extrait les bytes de l'entree en memoire, on decode via le crate `image`,
/// puis on encode en JPEG base64 (data URL). Pas de cache disque ; le frontend
/// utilise un IntersectionObserver pour ne charger que les vignettes visibles.
#[tauri::command]
pub async fn get_archive_entry_thumbnail(
    archive_path: String,
    internal_path: String,
    max_size: u32,
) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let bytes = crate::archive::read_archive_entry_bytes(
            std::path::Path::new(&archive_path),
            &internal_path,
        )?;
        let img = image::load_from_memory(&bytes).map_err(|e| e.to_string())?;
        let thumb = img.thumbnail(max_size, max_size);
        let mut buf = Vec::new();
        thumb
            .write_to(&mut std::io::Cursor::new(&mut buf), image::ImageOutputFormat::Jpeg(75))
            .map_err(|e| e.to_string())?;
        use base64::Engine;
        let encoded = base64::engine::general_purpose::STANDARD.encode(&buf);
        Ok(format!("data:image/jpeg;base64,{}", encoded))
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn get_video_thumbnail(path: String, max_size: u32, duration: Option<f64>) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let dur = match duration.filter(|&d| d > 0.0) {
            Some(d) => d,
            None => crate::video::get_video_metadata(&path)
                .ok_or_else(|| "impossible de lire les metadonnees video".to_string())?
                .duration_secs,
        };
        crate::video::extract_thumbnail(&path, dur, max_size)
            .ok_or_else(|| "impossible d'extraire la frame".to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub fn check_path_is_dir(path: String) -> bool {
    std::path::Path::new(&path).is_dir()
}

#[tauri::command]
pub async fn get_video_metadata(path: String) -> Result<crate::video::VideoMetadata, String> {
    tauri::async_runtime::spawn_blocking(move || {
        crate::video::get_video_metadata(&path)
            .ok_or_else(|| "impossible de lire les metadonnees video".to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn prepare_video_for_playback(
    app: tauri::AppHandle,
    path: String,
) -> Result<crate::video::PreparedVideo, String> {
    use tauri::Manager;
    let data_dir = app.path().app_local_data_dir().map_err(|e| e.to_string())?;
    tauri::async_runtime::spawn_blocking(move || {
        Ok(crate::video::prepare_for_playback(&path, &data_dir))
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn get_image_meta(path: String) -> Result<ImageMeta, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let (width, height) = image::image_dimensions(&path).map_err(|e| e.to_string())?;
        let format = image::io::Reader::open(&path)
            .map_err(|e| e.to_string())?
            .with_guessed_format()
            .map_err(|e| e.to_string())?
            .format()
            .map(|f| format!("{:?}", f))
            .unwrap_or_else(|| {
                std::path::Path::new(&path)
                    .extension()
                    .and_then(|e| e.to_str())
                    .map(|e| e.to_uppercase())
                    .unwrap_or_else(|| "?".to_string())
            });
        let exif_date = try_read_exif_date(&path);
        Ok(ImageMeta { width, height, format, exif_date })
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::{is_animated_gif, is_browser_native_image};
    use std::io::Write;
    use std::path::PathBuf;
    use tempfile::NamedTempFile;

    fn write_temp(suffix: &str, bytes: &[u8]) -> NamedTempFile {
        let mut f = NamedTempFile::with_suffix(suffix).unwrap();
        f.write_all(bytes).unwrap();
        f.flush().unwrap();
        f
    }

    #[test]
    fn is_animated_gif_accepte_gif89a() {
        let f = write_temp(".gif", b"GIF89a\x01\x00\x01\x00");
        assert!(is_animated_gif(f.path()));
    }

    #[test]
    fn is_animated_gif_accepte_gif87a() {
        let f = write_temp(".gif", b"GIF87a\x01\x00\x01\x00");
        assert!(is_animated_gif(f.path()));
    }

    #[test]
    fn is_animated_gif_rejette_extension_gif_avec_contenu_png() {
        // PNG magic : 89 50 4E 47 0D 0A 1A 0A
        let f = write_temp(".gif", b"\x89PNG\r\n\x1A\n");
        assert!(!is_animated_gif(f.path()));
    }

    #[test]
    fn is_animated_gif_rejette_png_avec_extension_png() {
        let f = write_temp(".png", b"\x89PNG\r\n\x1A\n");
        assert!(!is_animated_gif(f.path()));
    }

    #[test]
    fn is_animated_gif_rejette_jpeg() {
        // JPEG magic SOI : FF D8 FF
        let f = write_temp(".jpg", b"\xFF\xD8\xFF\xE0\x00\x10");
        assert!(!is_animated_gif(f.path()));
    }

    #[test]
    fn is_animated_gif_rejette_fichier_trop_court() {
        let f = write_temp(".gif", b"GIF"); // 3 octets seulement
        assert!(!is_animated_gif(f.path()));
    }

    #[test]
    fn is_animated_gif_rejette_extension_inconnue_meme_avec_magic_gif() {
        // Refus strict : l'extension doit etre .gif pour eviter de servir des fichiers
        // dont le magic ressemble fortuitement a un GIF mais qui sont autre chose.
        let f = write_temp(".jpg", b"GIF89a\x01\x00\x01\x00");
        assert!(!is_animated_gif(f.path()));
    }

    #[test]
    fn is_browser_native_image_accepte_formats_courants() {
        // Pour les formats decodes nativement par WebView2 / WebKitGTK, on se base
        // uniquement sur l'extension (l'existence du fichier importe peu pour ce test).
        for ext in ["png", "jpg", "jpeg", "jfif", "pjpeg", "pjp", "webp", "avif", "bmp", "svg", "ico"] {
            assert!(
                is_browser_native_image(&PathBuf::from(format!("/tmp/foo.{}", ext))),
                "{} doit etre considere natif",
                ext
            );
        }
    }

    #[test]
    fn is_browser_native_image_accepte_majuscules() {
        assert!(is_browser_native_image(&PathBuf::from("/tmp/IMG.JPG")));
        assert!(is_browser_native_image(&PathBuf::from("/tmp/photo.PNG")));
    }

    #[test]
    fn is_browser_native_image_rejette_formats_non_decodes() {
        for ext in ["tiff", "tif", "heic", "heif", "cr2", "nef", "arw", "psd", "raw"] {
            assert!(
                !is_browser_native_image(&PathBuf::from(format!("/tmp/foo.{}", ext))),
                "{} ne doit PAS etre considere natif",
                ext
            );
        }
    }

    #[test]
    fn is_browser_native_image_gif_passe_par_magic_check() {
        // Pour les .gif, l'extension seule ne suffit pas : on doit aussi avoir
        // le magic byte. Un .gif menteur (contenu PNG par exemple) doit etre rejete
        // et passer par le pipeline thumbnail JPEG (qui flatten).
        let valid = write_temp(".gif", b"GIF89a\x01\x00");
        assert!(is_browser_native_image(valid.path()));

        let liar = write_temp(".gif", b"\x89PNG\r\n\x1A\n");
        assert!(!is_browser_native_image(liar.path()));
    }
}
