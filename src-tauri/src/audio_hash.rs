use std::process::Command;
use serde::{Deserialize, Serialize};
use crate::tool_finder;

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
pub struct AudioMetadata {
    pub duration_secs: f64,
}

pub const AUDIO_EXTS: &[&str] = &[
    "mp3", "flac", "ogg", "m4a", "aac", "wav", "wma", "opus", "aiff", "aif", "ape",
];

pub fn is_audio(path: &str) -> bool {
    let ext = std::path::Path::new(path)
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_lowercase())
        .unwrap_or_default();
    AUDIO_EXTS.contains(&ext.as_str())
}

pub fn fpcalc_available() -> bool {
    run_fpcalc(&["--version"]).is_some()
}

pub fn compute_fingerprint(path: &str) -> Option<(Vec<i32>, f64)> {
    let output = run_fpcalc(&["-raw", path])?;
    parse_fpcalc_output(&output)
}

fn run_fpcalc(args: &[&str]) -> Option<String> {
    // Essayer le binaire bundte en premier, puis fallback sur le PATH
    let fpcalc_path = tool_finder::find_tool("fpcalc")
        .map(|p| p.to_string_lossy().into_owned())
        .unwrap_or_else(|| "fpcalc".to_string());

    let mut cmd = Command::new(&fpcalc_path);
    cmd.args(args);
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x08000000);
    }
    let output = cmd.output().ok()?;
    if output.status.success() || args.contains(&"--version") {
        Some(String::from_utf8_lossy(&output.stdout).into_owned())
    } else {
        None
    }
}

pub fn parse_fpcalc_output(s: &str) -> Option<(Vec<i32>, f64)> {
    let mut duration = 0.0f64;
    let mut fingerprint: Vec<i32> = Vec::new();
    for line in s.lines() {
        if let Some(rest) = line.strip_prefix("DURATION=") {
            duration = rest.trim().parse().unwrap_or(0.0);
        } else if let Some(rest) = line.strip_prefix("FINGERPRINT=") {
            fingerprint = rest.trim()
                .split(',')
                .filter_map(|s| s.parse::<i32>().ok())
                .collect();
        }
    }
    if fingerprint.is_empty() { return None; }
    Some((fingerprint, duration))
}

pub fn fingerprint_distance(a: &[i32], b: &[i32]) -> f64 {
    let len = a.len().min(b.len());
    if len == 0 { return 1.0; }
    let total_bits: u32 = a.iter().zip(b.iter())
        .map(|(x, y)| (x ^ y).count_ones())
        .sum();
    total_bits as f64 / (len as f64 * 32.0)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn distance_identical() {
        let fp = vec![1234567890i32, -987654321, 42];
        assert_eq!(fingerprint_distance(&fp, &fp), 0.0);
    }

    #[test]
    fn distance_all_different() {
        let a = vec![0i32];
        let b = vec![-1i32]; // all 32 bits differ
        assert_eq!(fingerprint_distance(&a, &b), 1.0);
    }

    #[test]
    fn distance_half() {
        let a = vec![0x0000FFFFi32];
        let b = vec![0i32];
        assert_eq!(fingerprint_distance(&a, &b), 0.5);
    }

    #[test]
    fn distance_empty() {
        assert_eq!(fingerprint_distance(&[], &[]), 1.0);
    }

    #[test]
    fn distance_truncates_to_shorter() {
        let a = vec![0i32, 0, 0, 0];
        let b = vec![0i32];
        assert_eq!(fingerprint_distance(&a, &b), 0.0);
    }

    #[test]
    fn parse_valid() {
        let s = "DURATION=183\nFINGERPRINT=1885693234,-2113929216,42\n";
        let (fp, dur) = parse_fpcalc_output(s).unwrap();
        assert_eq!(dur, 183.0);
        assert_eq!(fp, vec![1885693234i32, -2113929216, 42]);
    }

    #[test]
    fn parse_empty_fingerprint() {
        let s = "DURATION=0\nFINGERPRINT=\n";
        assert!(parse_fpcalc_output(s).is_none());
    }

    #[test]
    fn is_audio_detects_formats() {
        assert!(is_audio("/path/song.mp3"));
        assert!(is_audio("track.FLAC"));
        assert!(is_audio("audio.ogg"));
        assert!(!is_audio("video.mp4"));
        assert!(!is_audio("image.jpg"));
    }
}
