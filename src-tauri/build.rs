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
        // libmpv-2.dll : reference comme resource dans tauri.conf.json. Sur Windows,
        // remplace par le vrai DLL via scripts/download-mpv.sh avant le build. Sur
        // Linux/macOS, le placeholder vide existe juste pour que Tauri ne refuse pas
        // de bundler (libmpv vient du systeme via apt/brew).
        if !std::path::Path::new("binaries/libmpv-2.dll").exists() {
            let _ = std::fs::write("binaries/libmpv-2.dll", b"");
        }
    }

    // libmpv2-sys emet `cargo:rustc-link-lib=mpv` mais pas le link-search. Sur Windows,
    // on l'ajoute nous-memes pour que le linker MSVC trouve mpv.lib dans binaries/.
    // Sur Linux/macOS, pkg-config trouve libmpv via le systeme (libmpv-dev / brew install mpv).
    if target_triple.contains("windows") {
        let manifest_dir = std::env::var("CARGO_MANIFEST_DIR").unwrap_or_default();
        if !manifest_dir.is_empty() {
            let binaries = std::path::Path::new(&manifest_dir).join("binaries");
            println!("cargo:rustc-link-search=native={}", binaries.display());
        }
    }

    tauri_build::build()
}
