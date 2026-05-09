use std::path::{Path, PathBuf};

/// True si le fichier existe et a une taille > 0. Skip les placeholders vides crees
/// par `build.rs` quand le binaire n'a pas ete telecharge (ex. dev en mode light sans
/// `download-fpcalc.sh`). Sans ce check, `find_tool` retournerait le chemin du placeholder
/// vide et `Command::new(placeholder)` echouerait silencieusement, faisant croire que
/// l'outil est "introuvable" alors qu'il est dans `/usr/bin`.
fn is_real_binary(path: &Path) -> bool {
    std::fs::metadata(path).map(|m| m.is_file() && m.len() > 0).unwrap_or(false)
}

/// Cherche un outil dans cet ordre :
/// 1. A cote de l'executable (binaire bundte - cas externalBin Tauri)
/// 2. Dans le sous-dossier binaries/ a cote de l'executable (cas resources Tauri)
/// 3. Chemins systeme courants selon l'OS
/// 4. Retourne None (l'appelant peut fallback sur Command::new(name))
///
/// Tous les candidats sont valides via `is_real_binary` (size > 0) pour ne pas retourner
/// un placeholder cree par `build.rs`.
pub fn find_tool(name: &str) -> Option<PathBuf> {
    if let Ok(exe) = std::env::current_exe() {
        if let Some(exe_dir) = exe.parent() {
            // 1. Directement a cote de l'executable (externalBin Tauri)
            #[cfg(target_os = "windows")]
            let candidate = exe_dir.join(format!("{}.exe", name));
            #[cfg(not(target_os = "windows"))]
            let candidate = exe_dir.join(name);
            if is_real_binary(&candidate) {
                return Some(candidate);
            }

            // 2. Dans binaries/ a cote de l'executable (resources Tauri)
            #[cfg(target_os = "windows")]
            let candidate2 = exe_dir.join("binaries").join(format!("{}.exe", name));
            #[cfg(not(target_os = "windows"))]
            let candidate2 = exe_dir.join("binaries").join(name);
            if is_real_binary(&candidate2) {
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
        if is_real_binary(&candidate) {
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
    fn find_tool_skip_placeholder_vide() {
        // Le build.rs cree un placeholder vide (size 0) si le binaire reel n'a pas
        // ete telecharge. find_tool ne doit pas le retourner sinon Command::new(empty)
        // echoue silencieusement et l'app croit l'outil "introuvable".
        let exe = std::env::current_exe().expect("current_exe ok");
        let exe_dir = exe.parent().expect("exe parent ok");

        #[cfg(target_os = "windows")]
        let fake_name = "__test_tool_placeholder__.exe";
        #[cfg(not(target_os = "windows"))]
        let fake_name = "__test_tool_placeholder__";

        let fake_path = exe_dir.join(fake_name);
        // Cree un fichier VIDE (placeholder)
        std::fs::File::create(&fake_path).expect("create ok");

        let result = find_tool("__test_tool_placeholder__");
        let _ = std::fs::remove_file(&fake_path);

        assert!(result.is_none(), "un placeholder vide doit etre ignore");
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
