import { useState, startTransition, useEffect, useMemo } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { save as dialogSave } from "@tauri-apps/plugin-dialog";
import "./App.css";
import { formatSize, formatDuration, VIDEO_EXTS, AUDIO_EXTS } from "./utils";
import { useLang } from "./LangContext";
import type { DuplicateGroup, FolderSummary, IgnoreEntry, ScanProfile, ScanSummary, ArchiveGroupResult, ArchiveDiskCheck } from "./types";
import { interp } from "./i18n";
import { useScanConfig } from "./hooks/useScanConfig";
import { useScanExecution } from "./hooks/useScanExecution";
import { buildScanArgsFromConfig, buildScanArgsFromProfile, checkRequiredTools } from "./hooks/useScanLauncher";
import { useResults } from "./hooks/useResults";
import { useSelectionState, type SmartMode } from "./hooks/useSelectionState";
import { useDragDrop } from "./hooks/useDragDrop";
import { useKeyboardShortcuts } from "./hooks/useKeyboardShortcuts";
import { IgnoredPanel } from "./components/IgnoredPanel";
import { HelpPanel } from "./components/HelpPanel";
import { useProfiles } from "./hooks/useProfiles";
import { ImageComparator } from "./ImageComparator";
import { VideoComparator } from "./VideoComparator";
import { AudioComparator } from "./AudioComparator";
import { ArchiveComparator } from "./ArchiveComparator";
import { GroupCard } from "./components/GroupCard";
import { FolderSection } from "./components/FolderSection";
import { FiltersPanel } from "./components/FiltersPanel";
import { AdvancedPanel } from "./components/AdvancedPanel";
import { VideoAdvancedPanel } from "./components/VideoAdvancedPanel";
import { AudioAdvancedPanel } from "./components/AudioAdvancedPanel";
import { ProfilesPanel } from "./components/ProfilesPanel";
import { MissingToolBanner } from "./components/MissingToolBanner";
import { ScanProgressView } from "./components/ScanProgressView";
import { SessionPicker } from "./components/SessionPicker";
import { ConfirmDeleteModal } from "./components/ConfirmDeleteModal";
import { DiskSpaceWarningModal } from "./components/DiskSpaceWarningModal";
import { ArchiveGroupCard } from "./components/ArchiveGroupCard";
import { ScanResultsToolbar } from "./components/ScanResultsToolbar";
import { DetectionModeSelector } from "./components/DetectionModeSelector";

// ----- Composant principal -----

export default function App() {
  const { t, lang, setLang } = useLang();
  const [sessions, setSessions] = useState<ScanSummary[]>([]);
  const [summary, setSummary] = useState<ScanSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [theme, setTheme] = useState<"dark" | "light">(() =>
    (localStorage.getItem("theme") as "dark" | "light") ?? "dark"
  );
  const [filterText, setFilterText] = useState("");
  const [comparatorIdx, setComparatorIdx] = useState<number | null>(null);
  const [videoComparatorIdx, setVideoComparatorIdx] = useState<number | null>(null);
  const [audioComparatorIdx, setAudioComparatorIdx] = useState<number | null>(null);
  const [archiveGroups, setArchiveGroups] = useState<ArchiveGroupResult[]>([]);
  const [archiveComparatorOpen, setArchiveComparatorOpen] = useState<{ group: ArchiveGroupResult; leftIdx: number; rightIdx: number } | null>(null);
  const [resumingId, setResumingId] = useState<string | null>(null);
  const [smartRule, setSmartRule] = useState<SmartMode>("newest");
  const [priorityFolder, setPriorityFolder] = useState("");
  const [ignoredEntries, setIgnoredEntries] = useState<IgnoreEntry[]>([]);
  const [helpOpen, setHelpOpen] = useState(false);
  const [cacheBytes, setCacheBytes] = useState<number | null>(null);
  const [panelResetKey, setPanelResetKey] = useState(0);
  const [preScanToolMissing, setPreScanToolMissing] = useState<"ffmpeg" | "fpcalc" | null>(null);
  const [diskWarning, setDiskWarning] = useState<ArchiveDiskCheck | null>(null);
  const [purgeConfirm, setPurgeConfirm] = useState(false);

  const config = useScanConfig();
  const results = useResults(setError);
  const scanExec = useScanExecution(handleScanComplete, setError);
  const selection = useSelectionState(results.groups, handleDeleteComplete, setError);
  const profilesHook = useProfiles();

  useEffect(() => {
    localStorage.setItem("theme", theme);
  }, [theme]);

  // Listener global pour l'event `scan:disk_warning` emis par le backend pendant
  // counting_archives quand l'estimation d'extraction depasse l'espace disque libre.
  // Affiche la modale ; les boutons appellent `respond_disk_warning` qui reveille
  // le scan en attente cote Rust.
  useEffect(() => {
    let unlistenFn: (() => void) | undefined;
    (async () => {
      unlistenFn = await listen<{ needed_bytes: number; available_bytes: number; deficit_bytes: number; mode: "image" | "audio" }>(
        "scan:disk_warning",
        (event) => setDiskWarning({ ...event.payload, needs_warning: true }),
      );
    })();
    return () => { unlistenFn?.(); };
  }, []);

  const dragOver = useDragDrop(scanExec.scanning, config.setFolder);

  const showResultsForKb = summary !== null && summary.total_groups > 0;
  useKeyboardShortcuts({
    onToggleHelp: () => setHelpOpen((v) => !v),
    onEscapeArchive: () => {
      if (archiveComparatorOpen) { setArchiveComparatorOpen(null); return true; }
      return false;
    },
    onEscapeConfirm: () => {
      if (selection.confirmPending) { selection.setConfirmPending(false); return true; }
      return false;
    },
    onDelete: () => selection.setConfirmPending(true),
    onSelectAll: () => selection.selectAllDuplicates(),
    anyComparatorOpen: comparatorIdx !== null || videoComparatorIdx !== null || audioComparatorIdx !== null,
    showResults: showResultsForKb,
    selecting: selection.selecting,
    deleting: selection.deleting,
    scanning: scanExec.scanning,
    selectedCount: selection.selected.size,
  });

  async function loadIgnoredEntries() {
    try {
      const entries = await invoke<IgnoreEntry[]>("get_ignore_list");
      setIgnoredEntries(entries);
    } catch {
      // non-fatal
    }
  }

  useEffect(() => {
    invoke<ScanSummary[]>("list_sessions")
      .then((s) => startTransition(() => setSessions(s)))
      .catch(() => {});
    loadIgnoredEntries();
  }, []);

  function resetResults() {
    setSummary(null);
    results.reset();
    selection.setSelected(new Set());
    setFilterText("");
    setArchiveGroups([]);
    setArchiveComparatorOpen(null);
  }

  async function handlePurgeCache() {
    try {
      await invoke("purge_cache");
      const newSize = await invoke<number>("get_cache_size");
      setCacheBytes(newSize);
    } catch {
      // non-fatal
    }
    setPurgeConfirm(false);
  }

  async function handleScanComplete(s: ScanSummary) {
    setSummary(s);
    setFilterText("");
    startTransition(() => setSessions((prev) => [s, ...prev]));
    invoke<number>("get_cache_size").then(setCacheBytes).catch(() => {});
    if (s.by_folder) {
      const summaries = await invoke<FolderSummary[]>("list_folder_keys");
      results.setFolderSummaries(summaries);
    } else {
      await results.loadPage(0, false);
    }
    if (s.archive_groups_count && s.archive_groups_count > 0) {
      const ag = await invoke<ArchiveGroupResult[]>("get_archive_groups");
      setArchiveGroups(ag);
    }
  }

  function handleDeleteComplete(deletedPaths: Set<string>) {
    const oldLoadedWasted = results.groups.reduce((acc, g) => acc + g.size * (g.files.length - 1), 0);
    const updatedGroups = results.groups
      .map((g) => ({ ...g, files: g.files.filter((f) => !deletedPaths.has(f.path)) }))
      .filter((g) => g.files.length > 1);
    const removedCount = results.groups.length - updatedGroups.length;
    const newLoadedWasted = updatedGroups.reduce((acc, g) => acc + g.size * (g.files.length - 1), 0);
    const folderRemoved = new Map<string, number>();

    startTransition(() => {
      results.setGroups(updatedGroups);
      if (summary?.by_folder && removedCount > 0) {
        const updatedById = new Map(updatedGroups.map((g) => [g.id, g]));
        const folderDelta = new Map<string, { groups: number; wasted: number }>();
        for (const g of results.groups) {
          const updated = updatedById.get(g.id);
          const key = g.folder_key ?? "";
          const oldW = g.size * (g.files.length - 1);
          const newW = updated ? updated.size * (updated.files.length - 1) : 0;
          if (!updated || oldW !== newW) {
            const d = folderDelta.get(key) ?? { groups: 0, wasted: 0 };
            if (!updated) d.groups += 1;
            d.wasted += oldW - newW;
            folderDelta.set(key, d);
          }
        }
        for (const [key, d] of folderDelta) {
          if (d.groups > 0) folderRemoved.set(key, d.groups);
        }
        results.setFolderSummaries((prev) =>
          prev
            .map((fs) => {
              const d = folderDelta.get(fs.folder_key);
              if (!d) return fs;
              return { ...fs, group_count: fs.group_count - d.groups, total_wasted_bytes: fs.total_wasted_bytes - d.wasted };
            })
            .filter((fs) => fs.group_count > 0)
        );
      }
      setSummary((s) => s ? {
        ...s,
        total_groups: s.total_groups - removedCount,
        total_wasted_bytes: s.total_wasted_bytes - (oldLoadedWasted - newLoadedWasted),
      } : null);
      setArchiveGroups((prev) =>
        prev
          .map((ag) => ({ ...ag, archives: ag.archives.filter((a) => !deletedPaths.has(a.path)) }))
          .filter((ag) => ag.archives.length > 1)
      );
    });

    // Recharger ce qui manque depuis le backend pour rester a 50 affiches.
    if (removedCount > 0) {
      if (summary?.by_folder) {
        for (const [key, n] of folderRemoved) {
          if (results.folderState[key]?.hasMore !== false) {
            results.loadFolderPage(key, n);
          }
        }
      } else if (results.hasMore) {
        results.loadPage(updatedGroups.length, true, removedCount);
      }
    }
  }

  async function resumeSession(id: string) {
    setResumingId(id);
    try {
      const s = await invoke<ScanSummary>("load_session", { id });
      startTransition(() => {
        resetResults();
        setSummary(s);
        config.setFolder(s.folder);
        setError(null);
      });
      if (s.by_folder) {
        const summaries = await invoke<FolderSummary[]>("list_folder_keys");
        startTransition(() => results.setFolderSummaries(summaries));
      } else {
        await results.loadPage(0, false);
      }
      if (s.archive_groups_count && s.archive_groups_count > 0) {
        const ag = await invoke<ArchiveGroupResult[]>("get_archive_groups");
        setArchiveGroups(ag);
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setResumingId(null);
    }
  }

  async function removeSession(id: string) {
    await invoke("delete_session", { id });
    startTransition(() => {
      setSessions((prev) => prev.filter((s) => s.id !== id));
      if (summary?.id === id) resetResults();
    });
  }

  // scanArchives effectif : la checkbox est cachee en mode video mais son etat persiste
  // dans React. On gate ici pour que la barre de progression et le precheck ne montrent
  // / ne declenchent rien en mode video, meme si l'utilisateur avait coche en mode image.
  const effectiveScanArchives = config.scanArchives && config.detectionMode !== "videos";

  async function handleScan() {
    const missingTool = await checkRequiredTools(config.detectionMode);
    if (missingTool) {
      setPreScanToolMissing(missingTool);
      return;
    }
    setPreScanToolMissing(null);
    // Le precheck disque a ete integre comme phase du scan (event `scan:disk_warning`
    // emis par le backend pendant counting_archives). La modale apparait au-dessus de
    // la barre de progression, le scan se met en pause cote backend jusqu'a la decision
    // utilisateur. Plus aucune logique de precheck cote frontend.
    setPanelResetKey(k => k + 1);
    resetResults();
    return scanExec.scan(buildScanArgsFromConfig(config, lang));
  }

  // Reponses utilisateur a la modale d'alerte disque emise par le backend pendant
  // counting_archives. Reveillent le scan en attente via `respond_disk_warning`.
  function respondDiskWarning(decision: "skip" | "cancel") {
    setDiskWarning(null);
    invoke("respond_disk_warning", { decision }).catch(() => {});
  }

  async function handleIgnoreGroup(groupId: string) {
    const group = results.groups.find((g) => g.id === groupId);
    if (!group) return;
    const wasted = group.size * (group.files.length - 1);
    const remainingGroups = results.groups.filter((g) => g.id !== groupId);
    const folderKey = group.folder_key ?? "";
    startTransition(() => {
      results.setGroups(remainingGroups);
      setSummary((s) => s ? { ...s, total_groups: s.total_groups - 1, total_wasted_bytes: s.total_wasted_bytes - wasted } : null);
      if (summary?.by_folder) {
        results.setFolderSummaries((prev) =>
          prev
            .map((fs) => fs.folder_key === folderKey
              ? { ...fs, group_count: fs.group_count - 1, total_wasted_bytes: fs.total_wasted_bytes - wasted }
              : fs)
            .filter((fs) => fs.group_count > 0)
        );
      }
    });

    if (summary?.by_folder) {
      if (results.folderState[folderKey]?.hasMore !== false) {
        results.loadFolderPage(folderKey, 1);
      }
    } else if (results.hasMore) {
      results.loadPage(remainingGroups.length, true, 1);
    }

    try {
      await invoke("ignore_group", { groupId });
      await loadIgnoredEntries();
    } catch (e) {
      setError(String(e));
    }
  }

  async function handleExport(format: "csv" | "html") {
    if (!summary) return;
    const ext = format === "csv" ? "csv" : "html";
    const outputPath = await dialogSave({
      defaultPath: `rapport.${ext}`,
      filters: [{ name: format.toUpperCase(), extensions: [ext] }],
    });
    if (!outputPath) return;
    try {
      await invoke("export_results", { sessionId: summary.id, format, outputPath });
    } catch (e) {
      setError(String(e));
    }
  }

  function handleSaveProfile(name: string) {
    profilesHook.saveProfile({
      name,
      folder: config.folder,
      recursive: config.recursive,
      scan_mode: config.scanMode,
      detection_mode: config.detectionMode,
      sim_similarity: config.simSimilarity,
      video_similarity: config.videoSimilarity,
      audio_similarity: config.audioSimilarity,
      excluded: config.excluded,
      exclude_extensions: config.excludeExtensions,
      include_extensions: config.includeExtensions,
      min_file_size_kb: config.minFileSizeKb,
      max_file_size_kb: config.maxFileSizeKb,
      exact_cache_enabled: config.exactCacheEnabled,
    }).catch((e) => setError(String(e)));
  }

  function handleProfileLoad(profile: ScanProfile) {
    config.setFolder(profile.folder);
    config.setRecursive(profile.recursive);
    config.setScanMode(profile.scan_mode as "all" | "by_folder");
    config.setDetectionMode(profile.detection_mode as "files" | "images" | "videos" | "audio");
    config.setSimSimilarity(profile.sim_similarity);
    config.setVideoSimilarity(profile.video_similarity);
    config.setAudioSimilarity(profile.audio_similarity ?? 80);
    config.setExcluded(profile.excluded);
    config.setExcludeExtensions(profile.exclude_extensions);
    config.setIncludeExtensions(profile.include_extensions);
    config.setMinFileSizeKb(profile.min_file_size_kb);
    config.setMaxFileSizeKb(profile.max_file_size_kb);
    config.setExactCacheEnabled(profile.exact_cache_enabled);
  }

  function handleProfileLaunch(profile: ScanProfile) {
    handleProfileLoad(profile);
    setPanelResetKey(k => k + 1);
    resetResults();
    scanExec.scan(buildScanArgsFromProfile(profile, config.audioConfig));
  }

  const showSessionPicker = !summary && !scanExec.scanning;

  useEffect(() => {
    if (showSessionPicker) {
      invoke<number>("get_cache_size").then(setCacheBytes).catch(() => {});
    }
  }, [showSessionPicker]);
  const showResults = summary !== null && summary.total_groups > 0;

  const filteredGroups = useMemo(() => {
    if (!filterText.trim()) return results.groups;
    const q = filterText.toLowerCase();
    return results.groups.filter((g) =>
      g.files.some((f) => f.name.toLowerCase().includes(q) || f.path.toLowerCase().includes(q))
    );
  }, [results.groups, filterText]);

  const imageGroups = useMemo(() => {
    const IMAGE_EXTS_LOCAL = new Set(["jpg","jpeg","png","webp","bmp","gif","tiff","tif","avif"]);
    const base = summary?.by_folder ? results.groups : filteredGroups;
    return base.filter((g) => {
      const ext = g.files[0]?.path.split(".").pop()?.toLowerCase() ?? "";
      return g.similar || (!g.video_similar && IMAGE_EXTS_LOCAL.has(ext));
    });
  }, [filteredGroups, results.groups, summary?.by_folder]);

  const videoGroups = useMemo(() => {
    const base = summary?.by_folder ? results.groups : filteredGroups;
    return base.filter((g) => {
      const ext = g.files[0]?.path.split(".").pop()?.toLowerCase() ?? "";
      return g.video_similar || VIDEO_EXTS.has(ext);
    });
  }, [filteredGroups, results.groups, summary?.by_folder]);

  const audioGroups = useMemo(() => {
    const base = summary?.by_folder ? results.groups : filteredGroups;
    return base.filter((g) => {
      const ext = g.files[0]?.path.split(".").pop()?.toLowerCase() ?? "";
      return g.audio_similar || AUDIO_EXTS.has(ext);
    });
  }, [filteredGroups, results.groups, summary?.by_folder]);

  function handleSelectPaths(toAdd: string[], toRemove: string[]) {
    const next = new Set(selection.selected);
    for (const p of toRemove) next.delete(p);
    for (const p of toAdd) next.add(p);
    selection.setSelected(next);
  }

  const filteredFolderSummaries = useMemo(() => {
    if (!filterText.trim()) return results.sortedFolderSummaries;
    const q = filterText.toLowerCase();
    return results.sortedFolderSummaries.filter((fs) =>
      fs.folder_key.toLowerCase().includes(q)
    );
  }, [results.sortedFolderSummaries, filterText]);

  type ListItem =
    | { kind: "file"; group: DuplicateGroup; waste: number }
    | { kind: "archive"; group: ArchiveGroupResult; waste: number };

  const filteredArchiveGroups = useMemo(() => {
    if (!filterText.trim()) return archiveGroups;
    const q = filterText.toLowerCase();
    return archiveGroups.filter((ag) =>
      ag.archives.some((a) => a.path.toLowerCase().includes(q))
    );
  }, [archiveGroups, filterText]);

  const mergedItems: ListItem[] = useMemo(() => {
    const fileItems: ListItem[] = filteredGroups.map((g) => ({
      kind: "file",
      group: g,
      waste: g.size * (g.files.length - 1),
    }));
    if (filteredArchiveGroups.length === 0) return fileItems;
    const archItems: ListItem[] = filteredArchiveGroups.map((g) => ({
      kind: "archive",
      group: g,
      waste: g.archives.reduce((s, a) => s + a.wasted_bytes, 0),
    }));
    return [...fileItems, ...archItems].sort((a, b) => b.waste - a.waste);
  }, [filteredGroups, filteredArchiveGroups]);

  return (
    <div className="app" data-theme={theme}>
      {dragOver && (
        <div className="drag-overlay">
          <span className="drag-overlay-label">📁 {t.dropHere}</span>
        </div>
      )}

      <header className="header">
        <div className="header-top">
          <h1 className="title">{t.appTitle}</h1>
          <div className="header-top-right">
            <button
              className="theme-btn"
              onClick={() => setTheme((v) => v === "dark" ? "light" : "dark")}
              title={theme === "dark" ? "Mode clair" : "Mode sombre"}
            >
              {theme === "dark" ? "☀" : "☽"}
            </button>
            <div className="lang-toggle">
              <button className={`lang-btn${lang === "fr" ? " lang-btn--active" : ""}`} onClick={() => setLang("fr")}>FR</button>
              <button className={`lang-btn${lang === "en" ? " lang-btn--active" : ""}`} onClick={() => setLang("en")}>EN</button>
            </div>
            <IgnoredPanel
              entries={ignoredEntries}
              onRemove={async (key) => { await invoke("clear_ignore_entry", { key }); await loadIgnoredEntries(); }}
              onClearAll={async () => { await invoke("clear_all_ignored"); await loadIgnoredEntries(); }}
            />
            <ProfilesPanel
              key={panelResetKey}
              profiles={profilesHook.profiles}
              currentFolder={config.folder}
              onSave={handleSaveProfile}
              onLoad={handleProfileLoad}
              onLaunch={handleProfileLaunch}
              onDelete={profilesHook.deleteProfile}
              disabled={scanExec.scanning}
            />
            <button className="btn-ghost" onClick={resetResults}>{t.backToSessions}</button>
            <button
              className="btn-ghost help-btn"
              onClick={() => setHelpOpen(true)}
              title={t.helpOpen}
              data-testid="help-open-btn"
            >
              ?
            </button>
          </div>
        </div>

        <div className="folder-row">
          <div
            className="folder-input"
            onClick={config.pickFolder}
            style={{ opacity: config.picking ? 0.5 : 1, pointerEvents: config.picking ? "none" : "auto" }}
          >
            <span className="folder-icon">📁</span>
            <span className="folder-path">{config.folder || t.pickFolder}</span>
          </div>
          <select className="select-mode"
            title={config.scanMode === "all" ? t.tipScanModeAll : config.scanMode === "by_folder" ? t.tipScanModeByFolder : t.tipScanModeCompare}
            value={config.scanMode}
            onChange={(e) => config.setScanMode(e.target.value as "all" | "by_folder" | "compare_folder")} disabled={scanExec.scanning}>
            <option value="all">{t.scanAll}</option>
            <option value="by_folder">{t.scanByFolder}</option>
            <option value="compare_folder">{t.scanCompareFolder}</option>
          </select>
          <label className="toggle-recursive" title={t.tipRecursive} style={{ visibility: (config.scanMode === "by_folder" || config.scanMode === "compare_folder") ? "hidden" : "visible" }}>
            <input type="checkbox" checked={config.recursive}
              onChange={(e) => config.setRecursive(e.target.checked)}
              disabled={scanExec.scanning || config.scanMode === "by_folder" || config.scanMode === "compare_folder"} />
            {t.recursive}
          </label>
          {(config.detectionMode === "files" || config.detectionMode === "images" || config.detectionMode === "audio") && (
            <label className="toggle-recursive" title={t.tipScanArchives} data-testid="scan-archives-label">
              <input
                type="checkbox"
                checked={config.scanArchives}
                onChange={(e) => config.setScanArchives(e.target.checked)}
                disabled={scanExec.scanning}
                data-testid="scan-archives-checkbox"
              />
              {t.scanArchives}
            </label>
          )}
          {scanExec.scanning ? (
            <button className="btn-cancel" onClick={scanExec.cancelScan} disabled={scanExec.cancelling} title={t.tipCancelScan}>
              {scanExec.cancelling ? <><span className="btn-spinner" /> {t.cancelling}</> : t.cancel}
            </button>
          ) : (
            <button className="btn-primary" onClick={handleScan} disabled={!config.folder}>
              {t.analyse}
            </button>
          )}
        </div>

        {config.scanMode === "compare_folder" && (
          <div className="folder-row folder-row--secondary" data-testid="secondary-folder-row">
            <span className="secondary-folder-label">{t.secondaryFolderLabel}</span>
            <div
              className="folder-input"
              data-testid="secondary-folder-input"
              onClick={config.pickSecondaryFolder}
              style={{ opacity: config.pickingSecondary ? 0.5 : 1, pointerEvents: config.pickingSecondary ? "none" : "auto" }}
            >
              <span className="folder-icon">📁</span>
              <span className="folder-path">{config.secondaryFolder || t.secondaryFolderPick}</span>
            </div>
          </div>
        )}

        <DetectionModeSelector
          detectionMode={config.detectionMode}
          onSetDetectionMode={(m) => { config.setDetectionMode(m); setPreScanToolMissing(null); }}
          simSimilarity={config.simSimilarity}
          onSetSimSimilarity={config.setSimSimilarity}
          videoSimilarity={config.videoSimilarity}
          onSetVideoSimilarity={config.setVideoSimilarity}
          audioSimilarity={config.audioSimilarity}
          onSetAudioSimilarity={config.setAudioSimilarity}
          disabled={scanExec.scanning}
        />

        {config.detectionMode === "images" && (
          <AdvancedPanel key={`adv-images-${panelResetKey}`} config={config.phashConfig} onChange={config.updatePhashConfig} disabled={scanExec.scanning} />
        )}
        {config.detectionMode === "videos" && (
          <VideoAdvancedPanel key={`adv-videos-${panelResetKey}`} config={config.videoConfig} onChange={config.updateVideoConfig} disabled={scanExec.scanning} />
        )}
        {config.detectionMode === "audio" && (
          <AudioAdvancedPanel key={`adv-audio-${panelResetKey}`} config={config.audioConfig} onChange={config.updateAudioConfig} disabled={scanExec.scanning} />
        )}
        <FiltersPanel
          key={`filters-${panelResetKey}`}
          excluded={config.excluded}
          onChangeExcluded={config.setExcluded}
          excludeExtensions={config.excludeExtensions}
          onChangeExclude={config.setExcludeExtensions}
          includeExtensions={config.includeExtensions}
          onChangeInclude={config.setIncludeExtensions}
          minFileSizeKb={config.minFileSizeKb}
          onChangeMin={config.setMinFileSizeKb}
          maxFileSizeKb={config.maxFileSizeKb}
          onChangeMax={config.setMaxFileSizeKb}
          exactCacheEnabled={config.exactCacheEnabled}
          onChangeCache={config.setExactCacheEnabled}
          minModifiedDate={config.minModifiedDate}
          onChangeMinDate={config.setMinModifiedDate}
          maxModifiedDate={config.maxModifiedDate}
          onChangeMaxDate={config.setMaxModifiedDate}
          disabled={scanExec.scanning}
        />
        {summary && (
          <div className="stats-row" data-testid="stats-row">
            <span className="stat"><strong>{summary.scanned_files}</strong> {t.filesScanned}</span>
            {summary.by_folder && (
              <span className="stat"><strong>{summary.total_folders}</strong> {summary.total_folders > 1 ? t.folders : t.folder}</span>
            )}
            <span className="stat"><strong>{summary.total_groups}</strong> {summary.total_groups > 1 ? t.groups : t.group}</span>
            <span className="stat waste"><strong>{formatSize(summary.total_wasted_bytes)}</strong> {t.recoverable}</span>
            <span className="stat duration">en {formatDuration(summary.duration_ms, t)}</span>
            <span className="stat-export">
              <button className="btn-ghost btn-sm" onClick={() => handleExport("csv")}>{t.exportCsv}</button>
              <button className="btn-ghost btn-sm" onClick={() => handleExport("html")}>{t.exportHtml}</button>
            </span>
          </div>
        )}
      </header>

      {error && <div className="error-banner">{error}</div>}
      {preScanToolMissing && (
        <MissingToolBanner
          tool={preScanToolMissing}
          onAvailable={() => setPreScanToolMissing(null)}
        />
      )}
      {summary?.partial && <div className="partial-banner">{t.partialResults}</div>}
      {summary?.ffmpeg_missing && (
        <MissingToolBanner
          tool="ffmpeg"
          onAvailable={() => setSummary((s) => s ? { ...s, ffmpeg_missing: false } : s)}
        />
      )}
      {summary?.fpcalc_missing && (
        <MissingToolBanner
          tool="fpcalc"
          onAvailable={() => setSummary((s) => s ? { ...s, fpcalc_missing: false } : s)}
        />
      )}

      {showSessionPicker && (
        <SessionPicker
          sessions={sessions}
          resumingId={resumingId}
          cacheBytes={cacheBytes}
          purgeConfirm={purgeConfirm}
          onResume={resumeSession}
          onDelete={removeSession}
          onPurge={handlePurgeCache}
          onPurgeConfirm={setPurgeConfirm}
        />
      )}

      {showResults && (
        <>
          <ScanResultsToolbar
            selecting={selection.selecting}
            deleting={selection.deleting}
            selectedCount={selection.selected.size}
            selectedSize={selection.selectedSize}
            smartRule={smartRule}
            priorityFolder={priorityFolder}
            onSetSmartRule={setSmartRule}
            onSetPriorityFolder={setPriorityFolder}
            onSelectAll={selection.selectAllDuplicates}
            onApplyRule={() => selection.selectSmart(smartRule, smartRule === "priority_folder" ? priorityFolder : undefined)}
            onClearSelection={selection.clearSelection}
            onAskDelete={() => selection.setConfirmPending(true)}
          />

          <div className="filter-bar">
            <input
              className="filter-input"
              placeholder={t.filterPlaceholder}
              value={filterText}
              onChange={(e) => setFilterText(e.target.value)}
            />
          </div>

          {summary?.by_folder && (
            <div className="folder-sort-bar">
              <span className="folder-sort-label">{t.sortBy}</span>
              <button className={`btn-sort${results.folderSort === "waste" ? " btn-sort--active" : ""}`}
                onClick={() => results.setFolderSort("waste")}>{t.sortWaste}</button>
              <button className={`btn-sort${results.folderSort === "name" ? " btn-sort--active" : ""}`}
                onClick={() => results.setFolderSort("name")}>{t.sortName}</button>
            </div>
          )}

          <div className="groups-list">
            {summary?.by_folder ? (
              filteredFolderSummaries.length === 0 && filteredArchiveGroups.length === 0 && filterText.trim() ? (
                <p className="filter-no-results">{t.filterNoResults}</p>
              ) : (
                <>
                  {filteredArchiveGroups.map((ag) => (
                    <ArchiveGroupCard
                      key={ag.id}
                      group={ag}
                      selected={selection.selected}
                      onToggle={selection.toggleFile}
                      onCompare={(group, leftIdx, rightIdx) => setArchiveComparatorOpen({ group, leftIdx, rightIdx })}
                    />
                  ))}
                  {filteredFolderSummaries.map((fs) => (
                    <FolderSection
                      key={fs.folder_key}
                      summary={fs}
                      groups={results.groupsByFolder.get(fs.folder_key) ?? []}
                      loading={results.folderState[fs.folder_key]?.loading ?? false}
                      hasMore={results.folderState[fs.folder_key]?.hasMore ?? true}
                      selected={selection.selected}
                      onToggle={selection.toggleFile}
                      onExpand={() => results.loadFolderPage(fs.folder_key)}
                      onLoadMore={() => results.loadFolderPage(fs.folder_key)}
                      onIgnore={handleIgnoreGroup}
                      onCompare={(group) => { const idx = imageGroups.indexOf(group); if (idx >= 0) setComparatorIdx(idx); }}
                      onCompareVideo={(group) => { const idx = videoGroups.indexOf(group); if (idx >= 0) setVideoComparatorIdx(idx); }}
                      onCompareAudio={(group) => { const idx = audioGroups.indexOf(group); if (idx >= 0) setAudioComparatorIdx(idx); }}
                    />
                  ))}
                </>
              )
            ) : (
              <>
                {mergedItems.length === 0 && filterText.trim() ? (
                  <p className="filter-no-results">{t.filterNoResults}</p>
                ) : (
                  mergedItems.map((item) => {
                    if (item.kind === "archive") {
                      return (
                        <ArchiveGroupCard
                          key={item.group.id}
                          group={item.group}
                          selected={selection.selected}
                          onToggle={selection.toggleFile}
                          onCompare={(group, leftIdx, rightIdx) => setArchiveComparatorOpen({ group, leftIdx, rightIdx })}
                        />
                      );
                    }
                    const group = item.group;
                    const imgIdx = imageGroups.indexOf(group);
                    const vidIdx = videoGroups.indexOf(group);
                    const audIdx = audioGroups.indexOf(group);
                    return (
                      <GroupCard
                        key={group.id}
                        group={group}
                        selected={selection.selected}
                        onToggle={selection.toggleFile}
                        onCompare={imgIdx >= 0 ? () => setComparatorIdx(imgIdx) : undefined}
                        onCompareVideo={vidIdx >= 0 ? () => setVideoComparatorIdx(vidIdx) : undefined}
                        onCompareAudio={audIdx >= 0 ? () => setAudioComparatorIdx(audIdx) : undefined}
                        onIgnore={() => handleIgnoreGroup(group.id)}
                      />
                    );
                  })
                )}
                {!filterText.trim() && results.hasMore && (
                  <button className="btn-load-more" onClick={() => results.loadPage(results.groups.length, true)}
                    disabled={results.loadingMore}>
                    {results.loadingMore
                      ? t.loading
                      : interp(t.loadMore, { n: summary!.total_groups - results.groups.length })}
                  </button>
                )}
              </>
            )}
          </div>
        </>
      )}

      {summary && summary.total_groups === 0 && !scanExec.scanning && (
        <div className="empty-state">
          <span className="empty-icon">✓</span>
          <p>{t.noDuplicates}</p>
        </div>
      )}

      {!summary && !scanExec.scanning && sessions.length === 0 && (
        <div className="empty-state">
          <span className="empty-icon">🔍</span>
          <p>{t.pickFolderHint}</p>
        </div>
      )}

      {scanExec.scanning && (
        <div className="empty-state">
          <ScanProgressView
            progress={scanExec.progress}
            detectionMode={config.detectionMode}
            scanArchives={effectiveScanArchives}
            historyRef={scanExec.progressHistoryRef}
            scanStartRef={scanExec.scanStartRef}
            t={t}
          />
        </div>
      )}

      {comparatorIdx !== null && (
        <ImageComparator
          groups={imageGroups}
          startIdx={comparatorIdx}
          selected={selection.selected}
          onSelectPaths={handleSelectPaths}
          onClose={() => setComparatorIdx(null)}
        />
      )}

      {videoComparatorIdx !== null && (
        <VideoComparator
          groups={videoGroups}
          startIdx={videoComparatorIdx}
          selected={selection.selected}
          onSelectPaths={handleSelectPaths}
          onClose={() => setVideoComparatorIdx(null)}
        />
      )}

      {audioComparatorIdx !== null && (
        <AudioComparator
          groups={audioGroups}
          startIdx={audioComparatorIdx}
          selected={selection.selected}
          onSelectPaths={handleSelectPaths}
          onClose={() => setAudioComparatorIdx(null)}
        />
      )}

      {archiveComparatorOpen && (
        <ArchiveComparator
          archives={archiveComparatorOpen.group.archives}
          startLeftIdx={archiveComparatorOpen.leftIdx}
          startRightIdx={archiveComparatorOpen.rightIdx}
          findSimilar={summary?.find_similar ?? false}
          simThreshold={summary?.sim_threshold ?? 10}
          findSimilarAudio={summary?.find_similar_audio ?? false}
          audioSimThreshold={summary?.audio_sim_threshold ?? 20}
          onClose={() => setArchiveComparatorOpen(null)}
        />
      )}

      {selection.confirmPending && (
        <ConfirmDeleteModal
          count={selection.selected.size}
          totalSize={selection.selectedSize}
          onCancel={() => selection.setConfirmPending(false)}
          onConfirm={selection.doDelete}
        />
      )}

      {diskWarning && (
        <DiskSpaceWarningModal
          neededBytes={diskWarning.needed_bytes}
          availableBytes={diskWarning.available_bytes}
          deficitBytes={diskWarning.deficit_bytes}
          mode={diskWarning.mode ?? "image"}
          onCancel={() => respondDiskWarning("cancel")}
          onContinueSkipping={() => respondDiskWarning("skip")}
        />
      )}

      {helpOpen && <HelpPanel onClose={() => setHelpOpen(false)} />}
    </div>
  );
}
