import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

/**
 * Drag&drop d'un dossier sur la fenetre Tauri.
 * `onFolder` est appelee avec le chemin si le drop est un dossier.
 * Retourne `dragOver` pour afficher l'overlay visuel pendant le survol.
 */
export function useDragDrop(scanning: boolean, onFolder: (path: string) => void) {
  const [dragOver, setDragOver] = useState(false);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    import("@tauri-apps/api/webview").then(({ getCurrentWebview }) => {
      getCurrentWebview().onDragDropEvent(async (event) => {
        const type = event.payload.type;
        if (type === "over") {
          if (!scanning) setDragOver(true);
        } else if (type === "drop") {
          setDragOver(false);
          if (!scanning && "paths" in event.payload) {
            const paths = event.payload.paths as string[];
            if (paths.length > 0) {
              const isDir = await invoke<boolean>("check_path_is_dir", { path: paths[0] });
              if (isDir) onFolder(paths[0]);
            }
          }
        } else {
          setDragOver(false);
        }
      }).then((fn) => { unlisten = fn; });
    });
    return () => { unlisten?.(); };
  }, [scanning, onFolder]);

  return dragOver;
}
