mod scanner;

use scanner::{scan_folder as do_scan, ScanResult};
#[tauri::command]
fn scan_folder(path: String) -> Result<ScanResult, String> {
    do_scan(&path)
}

#[tauri::command]
fn delete_files(paths: Vec<String>) -> Result<(), String> {
    let mut errors: Vec<String> = Vec::new();
    for path in &paths {
        if let Err(e) = trash::delete(path) {
            errors.push(format!("{}: {}", path, e));
        }
    }
    if errors.is_empty() {
        Ok(())
    } else {
        Err(errors.join("\n"))
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_fs::init())
        .invoke_handler(tauri::generate_handler![scan_folder, delete_files])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
