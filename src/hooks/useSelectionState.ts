import { useState, startTransition } from "react";
import { invoke } from "@tauri-apps/api/core";
import { DuplicateGroup } from "../types";

export function useSelectionState(
  groups: DuplicateGroup[],
  onDeleteComplete: (deletedPaths: Set<string>) => void,
  setError: (e: string | null) => void,
) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [selecting, setSelecting] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmPending, setConfirmPending] = useState(false);

  const selectedSize = groups
    .flatMap((g) => g.files)
    .filter((f) => selected.has(f.path))
    .reduce((acc, f) => acc + f.size, 0);

  function toggleFile(path: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }

  async function runSelection(cmd: string, params?: Record<string, unknown>) {
    if (selecting) return;
    setSelecting(true);
    try {
      const paths = await invoke<string[]>(cmd, params);
      startTransition(() => setSelected(new Set(paths)));
    } catch (e) {
      setError(String(e));
    } finally {
      setSelecting(false);
    }
  }

  function selectAllDuplicates() { return runSelection("select_all_duplicates"); }
  function selectSmart(mode: "newest" | "oldest") { return runSelection("smart_select", { mode }); }
  function clearSelection() { setSelected(new Set()); }

  async function doDelete() {
    setConfirmPending(false);
    if (selected.size === 0) return;
    setDeleting(true);
    setError(null);
    try {
      await invoke("delete_files", { paths: Array.from(selected) });
      onDeleteComplete(new Set(selected));
      setSelected(new Set());
    } catch (e) {
      setError(String(e));
    } finally {
      setDeleting(false);
    }
  }

  return {
    selected, setSelected,
    selecting,
    deleting,
    confirmPending, setConfirmPending,
    selectedSize,
    toggleFile,
    selectAllDuplicates, selectSmart, clearSelection,
    doDelete,
  };
}
