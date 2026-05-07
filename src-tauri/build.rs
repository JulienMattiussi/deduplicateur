fn main() {
    let target_triple = std::env::var("TAURI_ENV_TARGET_TRIPLE")
        .or_else(|_| std::env::var("TARGET"))
        .unwrap_or_default();

    if !target_triple.is_empty() {
        let _ = std::fs::create_dir_all("binaries");
        for bin in &["fpcalc", "ffmpeg", "ffprobe"] {
            #[cfg(target_os = "windows")]
            let name = format!("binaries/{}-{}.exe", bin, target_triple);
            #[cfg(not(target_os = "windows"))]
            let name = format!("binaries/{}-{}", bin, target_triple);
            if !std::path::Path::new(&name).exists() {
                let _ = std::fs::write(&name, b"");
            }
        }
    }

    tauri_build::build()
}
