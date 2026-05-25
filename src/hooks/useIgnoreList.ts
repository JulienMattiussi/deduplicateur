import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { IgnoreEntry } from "../types";

/**
 * Liste des groupes ignores recuperee depuis le backend Rust.
 * Charge au montage. Expose un `reload` pour rafraichir apres une modification
 * (ignore_group / clear_ignore_entry / clear_all_ignored).
 *
 * Les actions de modification ne sont pas dans ce hook (elles sont couplees a
 * d'autres parties du state - summary, results - et restent dans App.tsx).
 */
export function useIgnoreList(): {
  ignoredEntries: IgnoreEntry[];
  reload: () => Promise<void>;
} {
  const [ignoredEntries, setIgnoredEntries] = useState<IgnoreEntry[]>([]);

  async function reload() {
    try {
      const entries = await invoke<IgnoreEntry[]>("get_ignore_list");
      setIgnoredEntries(entries);
    } catch {
      // non-fatal : on garde la liste actuelle plutot que de la vider
    }
  }

  useEffect(() => {
    reload();
  }, []);

  return { ignoredEntries, reload };
}
