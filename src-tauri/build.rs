fn main() {
    // Si le binaire fpcalc bundte n'existe pas encore (developpement local sans download-fpcalc.sh),
    // creer un placeholder vide pour que tauri_build::build() ne rejette pas le build.
    // En production, le vrai binaire est place par scripts/download-fpcalc.sh avant le build.
    let target_triple = std::env::var("TAURI_ENV_TARGET_TRIPLE")
        .or_else(|_| std::env::var("TARGET"))
        .unwrap_or_default();
    if !target_triple.is_empty() {
        #[cfg(target_os = "windows")]
        let bin_name = format!("binaries/fpcalc-{}.exe", target_triple);
        #[cfg(not(target_os = "windows"))]
        let bin_name = format!("binaries/fpcalc-{}", target_triple);
        let bin_path = std::path::Path::new(&bin_name);
        if !bin_path.exists() {
            let _ = std::fs::create_dir_all("binaries");
            let _ = std::fs::write(bin_path, b"");
        }
    }

    tauri_build::build()
}
