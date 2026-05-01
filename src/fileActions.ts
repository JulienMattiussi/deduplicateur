import { invoke } from "@tauri-apps/api/core";

export async function openFile(path: string): Promise<void> {
  try { await invoke("open_file", { path }); } catch { /* best-effort */ }
}

export async function revealInFolder(path: string): Promise<void> {
  try { await invoke("reveal_in_folder", { path }); } catch { /* best-effort */ }
}
