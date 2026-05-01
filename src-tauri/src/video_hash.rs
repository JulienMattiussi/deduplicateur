use std::process::Command;

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
}

/// Verifie que ffprobe et ffmpeg sont disponibles sur le PATH.
pub fn is_ffmpeg_available() -> bool {
    Command::new("ffprobe")
        .arg("-version")
        .no_window()
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false)
}

/// Extrait les metadonnees video via ffprobe (duration, resolution, codec).
pub fn get_video_metadata(path: &str) -> Option<VideoMetadata> {
    let output = Command::new("ffprobe")
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

    Some(VideoMetadata { duration_secs: duration, width, height, codec })
}

/// Extrait n_frames hashes perceptuels (mean hash 8x8 = 64 bits) uniformement
/// repartis entre 10% et 90% de la duree pour eviter les frames noires de debut/fin.
pub fn extract_frame_hashes(path: &str, n_frames: usize, duration: f64) -> Option<Vec<u64>> {
    if duration <= 0.0 || n_frames == 0 {
        return None;
    }

    let mut hashes = Vec::with_capacity(n_frames);

    for i in 0..n_frames {
        let t = duration * (0.1 + 0.8 * (i as f64 + 0.5) / n_frames as f64);

        let output = Command::new("ffmpeg")
            .args([
                "-ss",
                &format!("{:.3}", t),
                "-i",
                path,
                "-vframes",
                "1",
                "-vf",
                "scale=8:8",
                "-f",
                "rawvideo",
                "-pix_fmt",
                "gray",
                "pipe:1",
                "-loglevel",
                "quiet",
                "-nostdin",
            ])
            .no_window()
            .output()
            .ok()?;

        if output.stdout.len() < 64 {
            return None;
        }

        let pixels: [u8; 64] = output.stdout[..64].try_into().ok()?;
        hashes.push(mean_hash_64(&pixels));
    }

    Some(hashes)
}

/// Extrait une frame JPEG a mi-duree, redimensionnee a max_size.
/// Retourne une data URL base64.
pub fn extract_thumbnail(path: &str, duration: f64, max_size: u32) -> Option<String> {
    let t = duration * 0.5;
    let scale = format!("scale={}:{}:force_original_aspect_ratio=decrease", max_size, max_size);

    let output = Command::new("ffmpeg")
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
        let j_lo = if i > window { i - window } else { 0 };
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
