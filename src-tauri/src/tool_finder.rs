use std::path::PathBuf;

/// Cherche un outil dans cet ordre :
/// 1. A cote de l'executable (binaire bundte - cas externalBin Tauri)
/// 2. Dans le sous-dossier binaries/ a cote de l'executable (cas resources Tauri)
/// 3. Chemins systeme courants selon l'OS
/// 4. Retourne None (l'appelant peut fallback sur Command::new(name))
pub fn find_tool(name: &str) -> Option<PathBuf> {
    if let Ok(exe) = std::env::current_exe() {
        if let Some(exe_dir) = exe.parent() {
            // 1. Directement a cote de l'executable (externalBin Tauri)
            #[cfg(target_os = "windows")]
            let candidate = exe_dir.join(format!("{}.exe", name));
            #[cfg(not(target_os = "windows"))]
            let candidate = exe_dir.join(name);
            if candidate.is_file() {
                return Some(candidate);
            }

            // 2. Dans binaries/ a cote de l'executable (resources Tauri)
            #[cfg(target_os = "windows")]
            let candidate2 = exe_dir.join("binaries").join(format!("{}.exe", name));
            #[cfg(not(target_os = "windows"))]
            let candidate2 = exe_dir.join("binaries").join(name);
            if candidate2.is_file() {
                return Some(candidate2);
            }
        }
    }

    // 3. Chemins systeme courants selon l'OS
    for dir in system_dirs() {
        #[cfg(target_os = "windows")]
        let candidate = PathBuf::from(&dir).join(format!("{}.exe", name));
        #[cfg(not(target_os = "windows"))]
        let candidate = PathBuf::from(&dir).join(name);
        if candidate.is_file() {
            return Some(candidate);
        }
    }

    // 3. Introuvable - l'appelant peut utiliser Command::new(name) comme fallback
    None
}

#[cfg(target_os = "windows")]
fn system_dirs() -> Vec<String> {
    let mut dirs = vec![
        r"C:\ffmpeg\bin".to_string(),
        r"C:\Program Files\ffmpeg\bin".to_string(),
        r"C:\ProgramData\chocolatey\bin".to_string(),
        r"C:\Program Files\chromaprint".to_string(),
    ];
    // Dossier scoop dans %USERPROFILE%
    if let Ok(user_profile) = std::env::var("USERPROFILE") {
        dirs.push(format!(r"{}\scoop\shims", user_profile));
        dirs.push(format!(r"{}\scoop\apps\ffmpeg\current\bin", user_profile));
        dirs.push(format!(r"{}\scoop\apps\chromaprint\current", user_profile));
    }
    dirs
}

#[cfg(target_os = "macos")]
fn system_dirs() -> Vec<String> {
    vec![
        "/usr/local/bin".to_string(),
        "/opt/homebrew/bin".to_string(),
        "/usr/bin".to_string(),
    ]
}

#[cfg(target_os = "linux")]
fn system_dirs() -> Vec<String> {
    vec![
        "/usr/bin".to_string(),
        "/usr/local/bin".to_string(),
    ]
}

#[cfg(not(any(target_os = "windows", target_os = "macos", target_os = "linux")))]
fn system_dirs() -> Vec<String> {
    vec![]
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    #[test]
    fn find_tool_falls_back_gracefully() {
        // Un outil inexistant ne doit pas paniquer et retourner None
        let result = find_tool("__outil_inexistant_xyz_42__");
        assert!(result.is_none());
    }

    #[test]
    fn find_tool_cherche_dans_binaries_sous_dossier() {
        let exe = std::env::current_exe().expect("current_exe ok");
        let exe_dir = exe.parent().expect("exe parent ok");
        let binaries_dir = exe_dir.join("binaries");
        std::fs::create_dir_all(&binaries_dir).expect("mkdir binaries ok");

        #[cfg(target_os = "windows")]
        let fake_name = "__test_tool_binaries__.exe";
        #[cfg(not(target_os = "windows"))]
        let fake_name = "__test_tool_binaries__";

        let fake_path = binaries_dir.join(fake_name);
        {
            let mut f = std::fs::File::create(&fake_path).expect("create ok");
            f.write_all(b"fake binary").expect("write ok");
        }

        let result = find_tool("__test_tool_binaries__");
        let _ = std::fs::remove_file(&fake_path);

        assert!(result.is_some(), "doit trouver le binaire dans binaries/");
        assert_eq!(result.unwrap(), fake_path);
    }

    #[test]
    fn find_tool_returns_bundled_if_present() {
        // Simuler un binaire bundte en creant un fichier temporaire
        // a cote de l'executable courant
        let exe = std::env::current_exe().expect("current_exe ok");
        let exe_dir = exe.parent().expect("exe parent ok");

        #[cfg(target_os = "windows")]
        let fake_name = "__test_tool_bundled__.exe";
        #[cfg(not(target_os = "windows"))]
        let fake_name = "__test_tool_bundled__";

        let fake_path = exe_dir.join(fake_name);

        // Creer le fichier temporaire
        {
            let mut f = std::fs::File::create(&fake_path).expect("create ok");
            f.write_all(b"fake binary").expect("write ok");
        }

        // S'assurer qu'on nettoie meme en cas d'echec
        let result = find_tool("__test_tool_bundled__");
        let _ = std::fs::remove_file(&fake_path);

        assert!(result.is_some(), "doit trouver le binaire bundte");
        assert_eq!(result.unwrap(), fake_path);
    }
}
