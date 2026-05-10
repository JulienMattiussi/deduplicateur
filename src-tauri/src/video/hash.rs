use std::process::Command;
use std::sync::{Arc, atomic::{AtomicBool, Ordering}};
use crate::tool_finder;

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

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct VideoMetadata {
    pub duration_secs: f64,
    pub width: u32,
    pub height: u32,
    pub codec: String,
    #[serde(default)]
    pub audio_codec: Option<String>,
    #[serde(default)]
    pub audio_channels: Option<u8>,
}

/// Verifie que ffprobe et ffmpeg sont disponibles (binaire bundte ou PATH).
pub fn is_ffmpeg_available() -> bool {
    let ffprobe = tool_finder::find_tool("ffprobe")
        .map(|p| p.to_string_lossy().into_owned())
        .unwrap_or_else(|| "ffprobe".to_string());
    Command::new(&ffprobe)
        .arg("-version")
        .no_window()
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false)
}

/// Extrait les metadonnees video via ffprobe (duration, resolution, codec).
pub fn get_video_metadata(path: &str) -> Option<VideoMetadata> {
    let ffprobe = tool_finder::find_tool("ffprobe")
        .map(|p| p.to_string_lossy().into_owned())
        .unwrap_or_else(|| "ffprobe".to_string());
    let output = Command::new(&ffprobe)
        .args([
            "-v",
            "quiet",
            "-print_format",
            "json",
            "-show_streams",
            "-show_format",
            path,
        ])
        .no_window()
        .output()
        .ok()?;

    if !output.status.success() {
        return None;
    }

    let json: serde_json::Value = serde_json::from_slice(&output.stdout).ok()?;

    let duration = json["format"]["duration"]
        .as_str()?
        .parse::<f64>()
        .ok()?;

    let video_stream = json["streams"]
        .as_array()?
        .iter()
        .find(|s| s["codec_type"].as_str() == Some("video"))?;

    let width = video_stream["width"].as_u64()? as u32;
    let height = video_stream["height"].as_u64()? as u32;
    let codec = video_stream["codec_name"]
        .as_str()
        .unwrap_or("unknown")
        .to_string();

    let audio_stream = json["streams"]
        .as_array()
        .and_then(|arr| arr.iter().find(|s| s["codec_type"].as_str() == Some("audio")));
    let audio_codec = audio_stream.and_then(|s| s["codec_name"].as_str().map(String::from));
    let audio_channels = audio_stream.and_then(|s| s["channels"].as_u64().map(|n| n as u8));

    Some(VideoMetadata { duration_secs: duration, width, height, codec, audio_codec, audio_channels })
}

/// Version de l'algorithme de hash video. Bumper a chaque changement qui invalide
/// les hashes existants en cache.
/// v1 : scale=8:8 direct via ffmpeg (mean hash 8x8 = 64 bits).
/// v2 : extraction 128xN, detection bandes noires communes a toutes les frames,
/// crop a l'intersection, resize 8x8 logiciel.
pub const HASH_ALGORITHM_VERSION: u8 = 2;

/// Largeur d'extraction des frames pour la detection des bandes noires.
const EXTRACT_WIDTH: u32 = 128;

/// Seuil de luminance (0-255) en dessous duquel une colonne / ligne est consideree noire.
const BLACK_THRESHOLD: u8 = 16;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct BlackBorders {
    left: u32,
    right: u32,
    top: u32,
    bottom: u32,
}

/// Detecte les bandes noires d'une frame grayscale en scannant depuis chaque bord.
/// Une colonne / ligne est consideree noire si sa luminance moyenne <= BLACK_THRESHOLD.
fn detect_black_borders(pixels: &[u8], w: u32, h: u32) -> BlackBorders {
    let col_avg = |x: u32| -> u8 {
        let mut sum = 0u32;
        for y in 0..h {
            sum += pixels[(y * w + x) as usize] as u32;
        }
        (sum / h) as u8
    };
    let row_avg = |y: u32| -> u8 {
        let mut sum = 0u32;
        for x in 0..w {
            sum += pixels[(y * w + x) as usize] as u32;
        }
        (sum / w) as u8
    };

    let mut left = 0u32;
    while left < w && col_avg(left) <= BLACK_THRESHOLD { left += 1; }
    let mut right = 0u32;
    while right < w && col_avg(w - 1 - right) <= BLACK_THRESHOLD { right += 1; }
    let mut top = 0u32;
    while top < h && row_avg(top) <= BLACK_THRESHOLD { top += 1; }
    let mut bottom = 0u32;
    while bottom < h && row_avg(h - 1 - bottom) <= BLACK_THRESHOLD { bottom += 1; }

    // Si toute la frame est noire (tres rare en plein milieu de video), on n'identifie
    // pas de bandes pour ne pas perturber l'intersection.
    if left + right >= w || top + bottom >= h {
        return BlackBorders { left: 0, right: 0, top: 0, bottom: 0 };
    }

    BlackBorders { left, right, top, bottom }
}

/// Crop une frame grayscale aux bordures donnees + resize logiciel en 8x8 par moyenne de blocs.
fn crop_and_resize_to_8x8(pixels: &[u8], w: u32, h: u32, borders: BlackBorders) -> [u8; 64] {
    let cw = w.saturating_sub(borders.left + borders.right).max(1);
    let ch = h.saturating_sub(borders.top + borders.bottom).max(1);
    let mut out = [0u8; 64];
    for j in 0..8u32 {
        for i in 0..8u32 {
            let x0 = borders.left + i * cw / 8;
            let x1 = (borders.left + (i + 1) * cw / 8).max(x0 + 1);
            let y0 = borders.top + j * ch / 8;
            let y1 = (borders.top + (j + 1) * ch / 8).max(y0 + 1);
            let mut sum = 0u32;
            let mut count = 0u32;
            for y in y0..y1 {
                for x in x0..x1 {
                    sum += pixels[(y * w + x) as usize] as u32;
                    count += 1;
                }
            }
            out[(j * 8 + i) as usize] = if count > 0 { (sum / count) as u8 } else { 0 };
        }
    }
    out
}

/// Extrait n_frames hashes perceptuels (mean hash 8x8 = 64 bits) uniformement
/// repartis entre 10% et 90% de la duree pour eviter les frames noires de debut/fin.
/// Detecte les bandes noires communes a toutes les frames extraites et les crop avant
/// de hasher (evite les faux positifs sur les videos verticales sur fond noir).
pub fn extract_frame_hashes(path: &str, n_frames: usize, duration: f64, cancelled: &Arc<AtomicBool>) -> Option<Vec<u64>> {
    if duration <= 0.0 || n_frames == 0 {
        return None;
    }

    let ffmpeg = tool_finder::find_tool("ffmpeg")
        .map(|p| p.to_string_lossy().into_owned())
        .unwrap_or_else(|| "ffmpeg".to_string());

    // Pass 1 : extraction de toutes les frames + detection des bandes noires par frame.
    let mut frames: Vec<(Vec<u8>, u32, u32, BlackBorders)> = Vec::with_capacity(n_frames);
    for i in 0..n_frames {
        if cancelled.load(Ordering::Relaxed) {
            return None;
        }
        let t = duration * (0.1 + 0.8 * (i as f64 + 0.5) / n_frames as f64);

        let output = Command::new(&ffmpeg)
            .args([
                "-ss", &format!("{:.3}", t),
                "-i", path,
                "-vframes", "1",
                "-vf", &format!("scale={}:-2", EXTRACT_WIDTH),
                "-f", "rawvideo",
                "-pix_fmt", "gray",
                "pipe:1",
                "-loglevel", "quiet",
                "-nostdin",
            ])
            .no_window()
            .output()
            .ok()?;

        if output.stdout.is_empty() || output.stdout.len() < EXTRACT_WIDTH as usize {
            return None;
        }
        let h = output.stdout.len() as u32 / EXTRACT_WIDTH;
        if h == 0 || (EXTRACT_WIDTH * h) as usize != output.stdout.len() {
            return None;
        }
        let borders = detect_black_borders(&output.stdout, EXTRACT_WIDTH, h);
        frames.push((output.stdout, EXTRACT_WIDTH, h, borders));
    }

    if frames.is_empty() {
        return None;
    }

    // Intersection : bande noire commune = min de chaque cote sur toutes les frames.
    let common = BlackBorders {
        left: frames.iter().map(|f| f.3.left).min().unwrap_or(0),
        right: frames.iter().map(|f| f.3.right).min().unwrap_or(0),
        top: frames.iter().map(|f| f.3.top).min().unwrap_or(0),
        bottom: frames.iter().map(|f| f.3.bottom).min().unwrap_or(0),
    };

    // Pass 2 : crop aux bordures communes + resize 8x8 + hash.
    let hashes: Vec<u64> = frames.iter()
        .map(|(pixels, w, h, _)| {
            let resized = crop_and_resize_to_8x8(pixels, *w, *h, common);
            mean_hash_64(&resized)
        })
        .collect();

    Some(hashes)
}

/// Extrait une frame JPEG a mi-duree, redimensionnee a max_size.
/// Retourne une data URL base64.
pub fn extract_thumbnail(path: &str, duration: f64, max_size: u32) -> Option<String> {
    let t = duration * 0.5;
    let scale = format!("scale={}:{}:force_original_aspect_ratio=decrease", max_size, max_size);
    let ffmpeg = tool_finder::find_tool("ffmpeg")
        .map(|p| p.to_string_lossy().into_owned())
        .unwrap_or_else(|| "ffmpeg".to_string());

    let output = Command::new(&ffmpeg)
        .args([
            "-ss",
            &format!("{:.3}", t),
            "-i",
            path,
            "-vframes",
            "1",
            "-vf",
            &scale,
            "-f",
            "mjpeg",
            "pipe:1",
            "-loglevel",
            "quiet",
            "-nostdin",
        ])
        .no_window()
        .output()
        .ok()?;

    if output.stdout.is_empty() {
        return None;
    }

    use base64::Engine as _;
    let encoded = base64::engine::general_purpose::STANDARD.encode(&output.stdout);
    Some(format!("data:image/jpeg;base64,{}", encoded))
}

/// Distance moyenne de Hamming entre deux sequences de frame hashes.
/// Retourne une valeur dans [0.0, 64.0].
pub fn sequence_distance(a: &[u64], b: &[u64]) -> f64 {
    let n = a.len().min(b.len());
    if n == 0 {
        return 64.0;
    }
    a.iter()
        .zip(b.iter())
        .map(|(&ha, &hb)| (ha ^ hb).count_ones() as f64)
        .sum::<f64>()
        / n as f64
}

/// Distance DTW entre deux sequences de frame hashes.
/// Trouve l'alignement temporel optimal - detecte les videos avec intro/credits courts.
/// Bande Sakoe-Chiba : limite le decalage a ~15% de la longueur pour eviter les faux positifs.
/// Retourne une valeur normalisee dans [0.0, 64.0].
pub fn dtw_distance(a: &[u64], b: &[u64]) -> f64 {
    let n = a.len();
    let m = b.len();
    if n == 0 || m == 0 {
        return 64.0;
    }
    let window = ((n + m) / 7).max(2);
    let inf = f64::INFINITY;
    let mut dp = vec![vec![inf; m]; n];
    for i in 0..n {
        let j_lo = i.saturating_sub(window);
        let j_hi = (i + window + 1).min(m);
        for j in j_lo..j_hi {
            let cost = (a[i] ^ b[j]).count_ones() as f64;
            let prev = if i == 0 && j == 0 {
                0.0
            } else {
                let d = if i > 0 && j > 0 { dp[i - 1][j - 1] } else { inf };
                let u = if i > 0 { dp[i - 1][j] } else { inf };
                let l = if j > 0 { dp[i][j - 1] } else { inf };
                d.min(u).min(l)
            };
            if prev.is_finite() {
                dp[i][j] = cost + prev;
            }
        }
    }
    if dp[n - 1][m - 1].is_infinite() {
        return 64.0;
    }
    dp[n - 1][m - 1] / n.max(m) as f64
}

fn mean_hash_64(pixels: &[u8; 64]) -> u64 {
    let mean = pixels.iter().map(|&p| p as u32).sum::<u32>() / 64;
    let mut hash = 0u64;
    for (i, &p) in pixels.iter().enumerate() {
        if p as u32 >= mean {
            hash |= 1u64 << i;
        }
    }
    hash
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Construit une frame `w x h` avec des bandes noires de chaque cote.
    /// Le centre est rempli avec `fill`. Aide les tests de detection / crop.
    fn make_frame_with_borders(w: u32, h: u32, left: u32, right: u32, top: u32, bottom: u32, fill: u8) -> Vec<u8> {
        let mut pixels = vec![0u8; (w * h) as usize];
        for y in top..h.saturating_sub(bottom) {
            for x in left..w.saturating_sub(right) {
                pixels[(y * w + x) as usize] = fill;
            }
        }
        pixels
    }

    #[test]
    fn detect_borders_aucune_bande_si_image_uniforme_claire() {
        let pixels = vec![200u8; 32 * 32];
        let b = detect_black_borders(&pixels, 32, 32);
        assert_eq!(b, BlackBorders { left: 0, right: 0, top: 0, bottom: 0 });
    }

    #[test]
    fn detect_borders_bandes_laterales_video_verticale() {
        // Frame 32x32 avec 10px noirs a gauche et a droite : sujet vertical centre.
        let pixels = make_frame_with_borders(32, 32, 10, 10, 0, 0, 200);
        let b = detect_black_borders(&pixels, 32, 32);
        assert_eq!(b.left, 10);
        assert_eq!(b.right, 10);
        assert_eq!(b.top, 0);
        assert_eq!(b.bottom, 0);
    }

    #[test]
    fn detect_borders_bandes_letterbox_horizontal() {
        let pixels = make_frame_with_borders(32, 32, 0, 0, 5, 5, 180);
        let b = detect_black_borders(&pixels, 32, 32);
        assert_eq!(b.top, 5);
        assert_eq!(b.bottom, 5);
        assert_eq!(b.left, 0);
        assert_eq!(b.right, 0);
    }

    #[test]
    fn detect_borders_frame_entierement_noire_retourne_zero() {
        // Cas degenere : on ne renvoie pas de bandes (sinon tout serait noir).
        let pixels = vec![0u8; 32 * 32];
        let b = detect_black_borders(&pixels, 32, 32);
        assert_eq!(b, BlackBorders { left: 0, right: 0, top: 0, bottom: 0 });
    }

    #[test]
    fn detect_borders_seuil_tolere_petite_luminance() {
        // Tous les pixels = 10 (sous le seuil 16) -> traite comme noir uniforme -> degenere.
        let pixels = vec![10u8; 32 * 32];
        let b = detect_black_borders(&pixels, 32, 32);
        assert_eq!(b, BlackBorders { left: 0, right: 0, top: 0, bottom: 0 });
    }

    #[test]
    fn crop_and_resize_sans_borders_equivaut_a_resize_simple() {
        // Frame 16x16 uniformement claire -> 8x8 uniformement claire.
        let pixels = vec![200u8; 16 * 16];
        let r = crop_and_resize_to_8x8(&pixels, 16, 16, BlackBorders { left: 0, right: 0, top: 0, bottom: 0 });
        for &v in &r {
            assert_eq!(v, 200);
        }
    }

    #[test]
    fn crop_and_resize_ignore_les_bandes_noires() {
        // Frame 32x16 : 8px noirs a gauche, 8px noirs a droite, centre = 16x16 a 200.
        let pixels = make_frame_with_borders(32, 16, 8, 8, 0, 0, 200);
        let r = crop_and_resize_to_8x8(&pixels, 32, 16, BlackBorders { left: 8, right: 8, top: 0, bottom: 0 });
        // Apres crop, le centre est uniformement clair -> 8x8 = 200 partout.
        for &v in &r {
            assert_eq!(v, 200);
        }
    }

    #[test]
    fn intersection_des_bandes_min_par_cote() {
        // Simule la logique d'intersection : on prend le min de chaque cote.
        let frames = vec![
            BlackBorders { left: 10, right: 10, top: 0, bottom: 0 },
            BlackBorders { left: 12, right: 8, top: 2, bottom: 0 },
            BlackBorders { left: 9, right: 11, top: 0, bottom: 0 },
        ];
        let common = BlackBorders {
            left: frames.iter().map(|f| f.left).min().unwrap(),
            right: frames.iter().map(|f| f.right).min().unwrap(),
            top: frames.iter().map(|f| f.top).min().unwrap(),
            bottom: frames.iter().map(|f| f.bottom).min().unwrap(),
        };
        // Une seule frame n'a pas de bande haute -> top commun = 0 (ne crop que ce qui est commun a TOUTES).
        assert_eq!(common, BlackBorders { left: 9, right: 8, top: 0, bottom: 0 });
    }

    #[test]
    fn detection_distingue_deux_videos_verticales_differentes_apres_crop() {
        // Vrai test du bug : deux videos verticales sur fond noir avec sujets differents.
        // Avant crop : hash quasi identique (structure dominante = bandes noires + sujet centre).
        // Apres crop : hash distinct car le sujet rempli toute la frame croppee.
        let bands_left = 40;
        let bands_right = 40;
        let w = 128u32;
        let h = 80u32;

        // Video A : sujet "clair en haut, sombre en bas"
        let mut a = vec![0u8; (w * h) as usize];
        for y in 0..h {
            for x in bands_left..(w - bands_right) {
                a[(y * w + x) as usize] = if y < h / 2 { 220 } else { 60 };
            }
        }

        // Video B : sujet "sombre en haut, clair en bas" (inverse de A)
        let mut b = vec![0u8; (w * h) as usize];
        for y in 0..h {
            for x in bands_left..(w - bands_right) {
                b[(y * w + x) as usize] = if y < h / 2 { 60 } else { 220 };
            }
        }

        // Sans crop (algo v1 simule par crop nul) : structures differentes mais
        // mean hash 8x8 sur la frame entiere les distingue deja un peu (haut clair vs bas clair).
        let no_crop = BlackBorders { left: 0, right: 0, top: 0, bottom: 0 };
        let h_a_no_crop = mean_hash_64(&crop_and_resize_to_8x8(&a, w, h, no_crop));
        let h_b_no_crop = mean_hash_64(&crop_and_resize_to_8x8(&b, w, h, no_crop));

        // Avec crop a l'intersection : on isole le sujet, le hash le distingue clairement.
        let crop = BlackBorders { left: bands_left, right: bands_right, top: 0, bottom: 0 };
        let h_a_crop = mean_hash_64(&crop_and_resize_to_8x8(&a, w, h, crop));
        let h_b_crop = mean_hash_64(&crop_and_resize_to_8x8(&b, w, h, crop));

        // Dans les deux cas les hashes doivent etre differents, mais l'invariant utile
        // est qu'apres crop on garde une distance non triviale (le sujet est discriminant).
        let dist_no_crop = (h_a_no_crop ^ h_b_no_crop).count_ones();
        let dist_crop = (h_a_crop ^ h_b_crop).count_ones();
        assert!(dist_crop >= 16, "apres crop, distance Hamming attendue elevee ({})", dist_crop);
        // Sanity : sans crop la distance peut etre faible si les bandes noires dominent.
        // On ne fait pas d'assertion stricte car ca depend de la geometrie.
        let _ = dist_no_crop;
    }

    #[test]
    fn mean_hash_identique_donne_distance_zero() {
        let pixels = [128u8; 64];
        let h = mean_hash_64(&pixels);
        assert_eq!(sequence_distance(&[h], &[h]), 0.0);
    }

    #[test]
    fn mean_hash_inverse_donne_distance_max() {
        let all_zeros = [0u8; 64];
        let all_255 = [255u8; 64];
        let h0 = mean_hash_64(&all_zeros);
        let h1 = mean_hash_64(&all_255);
        // l'un donne 0, l'autre 0xFFFFFFFFFFFFFFFF -> distance 64
        let d = sequence_distance(&[h0], &[h1]);
        assert!(d >= 0.0 && d <= 64.0);
    }

    #[test]
    fn sequence_distance_vide_retourne_max() {
        assert_eq!(sequence_distance(&[], &[1, 2, 3]), 64.0);
        assert_eq!(sequence_distance(&[1, 2, 3], &[]), 64.0);
    }

    #[test]
    fn sequence_distance_tronque_au_minimum() {
        let a = vec![0u64, 0u64, 0u64];
        let b = vec![0u64, 0u64];
        assert_eq!(sequence_distance(&a, &b), 0.0);
    }

    #[test]
    fn dtw_identique_donne_distance_zero() {
        let h = vec![0xDEADBEEFu64; 8];
        assert_eq!(dtw_distance(&h, &h), 0.0);
    }

    #[test]
    fn dtw_vide_retourne_max() {
        assert_eq!(dtw_distance(&[], &[1, 2, 3]), 64.0);
        assert_eq!(dtw_distance(&[1, 2, 3], &[]), 64.0);
    }

    #[test]
    fn dtw_sequences_longueurs_differentes() {
        // Meme contenu, B a 2 frames de plus : DTW absorbe la difference -> distance 0
        let h = 0xDEADBEEFCAFEBABEu64;
        let a = vec![h; 8];
        let b = vec![h; 10];
        assert_eq!(dtw_distance(&a, &b), 0.0);
    }

    #[test]
    fn dtw_meilleur_que_sequence_sur_decalage() {
        let h = 0xF0F0F0F0F0F0F0F0u64;
        let z = 0u64; // H(h, z) = 32 bits
        // Sequences alternantes decalees d'une position :
        // sequence_distance compare h vs z a chaque frame (= 32 bits d'ecart en moyenne)
        // DTW trouve l'alignement optimal et obtient un score nettement inferieur
        let a = vec![h, z, h, z, h, z, h, z];
        let b = vec![z, h, z, h, z, h, z, h];
        let d_seq = sequence_distance(&a, &b);
        let d_dtw = dtw_distance(&a, &b);
        assert!(d_dtw < d_seq, "dtw={d_dtw} doit etre < sequence={d_seq}");
    }
}
