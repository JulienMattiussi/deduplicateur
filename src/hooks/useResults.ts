import { useState, startTransition, useMemo } from "react";
import { invoke } from "@tauri-apps/api/core";
import { DuplicateGroup, FolderSummary, GroupsPage } from "../types";

export function useResults(setError: (e: string | null) => void) {
  const [groups, setGroups] = useState<DuplicateGroup[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [folderSummaries, setFolderSummaries] = useState<FolderSummary[]>([]);
  const [folderState, setFolderState] = useState<Record<string, { loading: boolean; hasMore: boolean; offset: number }>>({});
  const [folderSort, setFolderSort] = useState<"name" | "waste">("waste");

  const sortedFolderSummaries = useMemo(() => {
    const sorted = [...folderSummaries];
    if (folderSort === "name") {
      sorted.sort((a, b) => a.folder_key.localeCompare(b.folder_key));
    } else {
      sorted.sort((a, b) => b.total_wasted_bytes - a.total_wasted_bytes);
    }
    return sorted;
  }, [folderSummaries, folderSort]);

  const groupsByFolder = useMemo(() => {
    const map = new Map<string, DuplicateGroup[]>();
    for (const g of groups) {
      const key = g.folder_key ?? "";
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(g);
    }
    return map;
  }, [groups]);

  async function loadPage(offset: number, append: boolean) {
    setLoadingMore(true);
    try {
      const page = await invoke<GroupsPage>("get_groups_page", { offset, limit: 50 });
      if (append) {
        startTransition(() => {
          setGroups((prev) => [...prev, ...page.groups]);
          setHasMore(page.has_more);
        });
      } else {
        setGroups(page.groups);
        setHasMore(page.has_more);
      }
    } catch {
      // session pas encore chargee
    } finally {
      setLoadingMore(false);
    }
  }

  async function loadFolderPage(folderKey: string) {
    const state = folderState[folderKey];
    if (state?.loading) return;
    const offset = state?.offset ?? 0;
    setFolderState((prev) => ({
      ...prev,
      [folderKey]: { loading: true, hasMore: state?.hasMore ?? true, offset },
    }));
    try {
      const page = await invoke<GroupsPage>("get_folder_groups_page", { folderKey, offset, limit: 50 });
      startTransition(() => {
        setGroups((prev) => [...prev, ...page.groups]);
        setFolderState((prev) => ({
          ...prev,
          [folderKey]: { loading: false, hasMore: page.has_more, offset: offset + page.groups.length },
        }));
      });
    } catch (e) {
      setFolderState((prev) => ({
        ...prev,
        [folderKey]: { loading: false, hasMore: state?.hasMore ?? true, offset },
      }));
      setError(String(e));
    }
  }

  function reset() {
    setGroups([]);
    setHasMore(false);
    setFolderSummaries([]);
    setFolderState({});
  }

  return {
    groups, setGroups,
    hasMore,
    loadingMore,
    folderSummaries, setFolderSummaries,
    folderState,
    folderSort, setFolderSort,
    sortedFolderSummaries,
    groupsByFolder,
    loadPage,
    loadFolderPage,
    reset,
  };
}
