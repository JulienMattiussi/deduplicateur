import { useEffect } from "react";

interface Shortcuts {
  /** Touche F1 : ouvrir/fermer le panneau d'aide. */
  onToggleHelp: () => void;
  /** Echap : fermer le comparateur d'archives s'il est ouvert (retourne true si gere). */
  onEscapeArchive: () => boolean;
  /** Echap : fermer la modale de confirmation (retourne true si gere). */
  onEscapeConfirm: () => boolean;
  /** Suppr : ouvrir la confirmation de suppression. */
  onDelete: () => void;
  /** Ctrl/Cmd+A : selectionner tous les doublons. */
  onSelectAll: () => void;
  /** Active si un autre comparateur (image/video/audio) est ouvert : court-circuit complet. */
  anyComparatorOpen: boolean;
  /** Active si l'UI affiche les resultats. */
  showResults: boolean;
  /** Active si une selection est en cours. */
  selecting: boolean;
  /** Active si une suppression est en cours. */
  deleting: boolean;
  /** Active si un scan est en cours. */
  scanning: boolean;
  /** Nombre d'elements selectionnes (pour decider si Suppr s'applique). */
  selectedCount: number;
}

export function useKeyboardShortcuts(s: Shortcuts) {
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === "F1") {
        e.preventDefault();
        s.onToggleHelp();
        return;
      }
      if (s.anyComparatorOpen) return;
      const target = e.target as HTMLElement;
      const inInput = target.tagName === "INPUT" || target.tagName === "TEXTAREA";

      if (e.key === "Escape" && s.onEscapeArchive()) return;
      if (e.key === "Escape" && s.onEscapeConfirm()) return;
      if (inInput) return;

      if (e.key === "Delete" && s.showResults && s.selectedCount > 0 && !s.deleting && !s.selecting) {
        s.onDelete();
      }
      if ((e.key === "a" || e.key === "A") && (e.ctrlKey || e.metaKey) && s.showResults && !s.scanning) {
        e.preventDefault();
        s.onSelectAll();
      }
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [s]);
}
