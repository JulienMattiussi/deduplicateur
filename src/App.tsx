import { useState, startTransition, useEffect, useMemo } from "react";
import { invoke } from "@tauri-apps/api/core";
import { save as dialogSave } from "@tauri-apps/plugin-dialog";
import "./App.css";
import { formatSize } from "./utils";
import { useLang } from "./LangContext";
import { interp, type Translations } from "./i18n";
import type { DuplicateGroup, FolderSummary, IgnoreEntry, ScanProfile, ScanSummary } from "./types";
import { useScanConfig } from "./hooks/useScanConfig";
import { useScanExecution } from "./hooks/useScanExecution";
import { useResults } from "./hooks/useResults";
import { useSelectionState, type SmartMode } from "./hooks/useSelectionState";
import { IgnoredPanel } from "./components/IgnoredPanel";
import { useProfiles } from "./hooks/useProfiles";
import { ImageComparator } from "./ImageComparator";
import { SessionCard } from "./components/SessionCard";
import { GroupCard } from "./components/GroupCard";
import { FolderSection } from "./components/FolderSection";
import { FiltersPanel } from "./components/FiltersPanel";
import { AdvancedPanel } from "./components/AdvancedPanel";
import { VideoAdvancedPanel } from "./components/VideoAdvancedPanel";
import { AudioAdvancedPanel } from "./components/AudioAdvancedPanel";
import { ProgressETA } from "./components/ProgressETA";
import { ProfilesPanel } from "./components/ProfilesPanel";
import { MissingToolBanner } from "./components/MissingToolBanner";

// Nombre de bits dans le hash Hamming (grille 8x8)
const HAMMING_BITS = 64;

function formatDuration(ms: number, t: Translations): string {
  if (ms < 1000) return `${ms} ${t.durationMs}`;
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s} ${t.durationS}`;
  const m = Math.floor(s / 60);
  const rem = s % 60;
  if (m < 60) return rem > 0 ? `${m} ${t.durationMin} ${rem} ${t.durationS}` : `${m} ${t.durationMin}`;
  const h = Math.floor(m / 60);
  const remMin = m % 60;
  return remMin > 0 ? `${h} ${t.durationH} ${remMin} ${t.durationMin}` : `${h} ${t.durationH}`;
}

// ----- Composant principal -----

export default function App() {
  const { t, lang, setLang } = useLang();
  const [sessions, setSessions] = useState<ScanSummary[]>([]);
  const [summary, setSummary] = useState<ScanSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [theme, setTheme] = useState<"dark" | "light">(() =>
    (localStorage.getItem("theme") as "dark" | "light") ?? "dark"
  );
  const [dragOver, setDragOver] = useState(false);
  const [filterText, setFilterText] = useState("");
  const [comparatorIdx, setComparatorIdx] = useState<number | null>(null);
  const [resumingId, setResumingId] = useState<string | null>(null);
  const [smartRule, setSmartRule] = useState<SmartMode>("newest");
  const [priorityFolder, setPriorityFolder] = useState("");
  const [ignoredEntries, setIgnoredEntries] = useState<IgnoreEntry[]>([]);

  const config = useScanConfig();
  const results = useResults(setError);
  const scanExec = useScanExecution(handleScanComplete, setError);
  const selection = useSelectionState(results.groups, handleDeleteComplete, setError);
  const profilesHook = useProfiles();

  useEffect(() => {
    localStorage.setItem("theme", theme);
  }, [theme]);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    import("@tauri-apps/api/webview").then(({ getCurrentWebview }) => {
      getCurrentWebview().onDragDropEvent(async (event) => {
        const type = event.payload.type;
        if (type === "over") {
          if (!scanExec.scanning) setDragOver(true);
        } else if (type === "drop") {
          setDragOver(false);
          if (!scanExec.scanning && "paths" in event.payload) {
            const paths = event.payload.paths as string[];
            if (paths.length > 0) {
              const isDir = await invoke<boolean>("check_path_is_dir", { path: paths[0] });
              if (isDir) config.setFolder(paths[0]);
            }
          }
        } else {
          setDragOver(false);
        }
      }).then((fn) => { unlisten = fn; });
    });
    return () => { unlisten?.(); };
  }, [scanExec.scanning]);

  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (comparatorIdx !== null) return;
      const target = e.target as HTMLElement;
      const inInput = target.tagName === "INPUT" || target.tagName === "TEXTAREA";

      if (e.key === "Escape" && selection.confirmPending) {
        selection.setConfirmPending(false);
        return;
      }
      if (inInput) return;

      const showResults = summary !== null && summary.total_groups > 0;
      if (e.key === "Delete" && showResults && selection.selected.size > 0 && !selection.deleting && !selection.selecting) {
        selection.setConfirmPending(true);
      }
      if ((e.key === "a" || e.key === "A") && (e.ctrlKey || e.metaKey) && showResults && !scanExec.scanning) {
        e.preventDefault();
        selection.selectAllDuplicates();
      }
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [summary, selection, scanExec.scanning, comparatorIdx]);

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
  }

  async function handleScanComplete(s: ScanSummary) {
    setSummary(s);
    setFilterText("");
    startTransition(() => setSessions((prev) => [s, ...prev]));
    if (s.by_folder) {
      const summaries = await invoke<FolderSummary[]>("list_folder_keys");
      results.setFolderSummaries(summaries);
    } else {
      await results.loadPage(0, false);
    }
  }

  function handleDeleteComplete(deletedPaths: Set<string>) {
    const updatedGroups = results.groups
      .map((g) => ({ ...g, files: g.files.filter((f) => !deletedPaths.has(f.path)) }))
      .filter((g) => g.files.length > 1);
    const removedCount = results.groups.length - updatedGroups.length;
    startTransition(() => {
      results.setGroups(updatedGroups);
      setSummary((s) => s ? { ...s, total_groups: s.total_groups - removedCount } : null);
    });
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

  function handleScan() {
    resetResults();
    const effectiveRecursive = config.scanMode === "by_folder" ? true : config.recursive;
    return scanExec.scan({
      path: config.folder,
      recursive: effectiveRecursive,
      excluded: config.excluded,
      byFolder: config.scanMode === "by_folder",
      findSimilar: config.detectionMode === "images",
      simThreshold: Math.round((1 - config.simSimilarity / 100) * HAMMING_BITS),
      findSimilarVideos: config.detectionMode === "videos",
      videoSimThreshold: Math.round((1 - config.videoSimilarity / 100) * HAMMING_BITS),
      findSimilarAudio: config.detectionMode === "audio",
      audioSimThreshold: 100 - config.audioSimilarity,
      audioCacheEnabled: config.audioConfig.cache_enabled,
      audioDurationTolerance: config.audioConfig.duration_tolerance,
      exactCacheEnabled: config.exactCacheEnabled,
      excludeExtensions: config.excludeExtensions,
      includeExtensions: config.includeExtensions,
      minFileSizeKb: config.minFileSizeKb,
      maxFileSizeKb: config.maxFileSizeKb,
    });
  }

  async function handleIgnoreGroup(groupId: string) {
    const group = results.groups.find((g) => g.id === groupId);
    if (!group) return;
    const wasted = group.size * (group.files.length - 1);
    startTransition(() => {
      results.setGroups(results.groups.filter((g) => g.id !== groupId));
      setSummary((s) => s ? { ...s, total_groups: s.total_groups - 1, total_wasted_bytes: s.total_wasted_bytes - wasted } : null);
    });
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
    resetResults();
    const effectiveRecursive = profile.scan_mode === "by_folder" ? true : profile.recursive;
    scanExec.scan({
      path: profile.folder,
      recursive: effectiveRecursive,
      excluded: profile.excluded,
      byFolder: profile.scan_mode === "by_folder",
      findSimilar: profile.detection_mode === "images",
      simThreshold: Math.round((1 - profile.sim_similarity / 100) * HAMMING_BITS),
      findSimilarVideos: profile.detection_mode === "videos",
      videoSimThreshold: Math.round((1 - profile.video_similarity / 100) * HAMMING_BITS),
      findSimilarAudio: profile.detection_mode === "audio",
      audioSimThreshold: 100 - (profile.audio_similarity ?? 80),
      audioCacheEnabled: config.audioConfig.cache_enabled,
      audioDurationTolerance: config.audioConfig.duration_tolerance,
      exactCacheEnabled: profile.exact_cache_enabled,
      excludeExtensions: profile.exclude_extensions,
      includeExtensions: profile.include_extensions,
      minFileSizeKb: profile.min_file_size_kb,
      maxFileSizeKb: profile.max_file_size_kb,
    });
  }

  const showSessionPicker = !summary && !scanExec.scanning && sessions.length > 0;
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
    return filteredGroups.filter((g) => {
      const ext = g.files[0]?.path.split(".").pop()?.toLowerCase() ?? "";
      return g.similar || (!g.video_similar && IMAGE_EXTS_LOCAL.has(ext));
    });
  }, [filteredGroups]);

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
              profiles={profilesHook.profiles}
              currentFolder={config.folder}
              onSave={handleSaveProfile}
              onLoad={handleProfileLoad}
              onLaunch={handleProfileLaunch}
              onDelete={profilesHook.deleteProfile}
              disabled={scanExec.scanning}
            />
            {summary && (
              <button className="btn-ghost" onClick={resetResults}>{t.backToSessions}</button>
            )}
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
          <select className="select-mode" value={config.scanMode}
            onChange={(e) => config.setScanMode(e.target.value as "all" | "by_folder")} disabled={scanExec.scanning}>
            <option value="all">{t.scanAll}</option>
            <option value="by_folder">{t.scanByFolder}</option>
          </select>
          <label className="toggle-recursive" style={{ visibility: config.scanMode === "by_folder" ? "hidden" : "visible" }}>
            <input type="checkbox" checked={config.recursive}
              onChange={(e) => config.setRecursive(e.target.checked)}
              disabled={scanExec.scanning || config.scanMode === "by_folder"} />
            {t.recursive}
          </label>
          {scanExec.scanning ? (
            <button className="btn-cancel" onClick={scanExec.cancelScan} disabled={scanExec.cancelling}>
              {scanExec.cancelling ? <><span className="btn-spinner" /> {t.cancelling}</> : t.cancel}
            </button>
          ) : (
            <button className="btn-primary" onClick={handleScan} disabled={!config.folder}>{t.analyse}</button>
          )}
        </div>

        <div className="similar-options-row">
          <div className="detection-mode-selector">
            {(["files", "images", "videos", "audio"] as const).map((mode) => (
              <button key={mode}
                className={`detection-mode-btn${config.detectionMode === mode ? " detection-mode-btn--active" : ""}`}
                onClick={() => config.setDetectionMode(mode)} disabled={scanExec.scanning}>
                {mode === "files" ? t.modeFiles : mode === "images" ? t.modeImages : mode === "videos" ? t.modeVideos : t.modeAudio}
              </button>
            ))}
          </div>
          {config.detectionMode === "images" && (
            <label className="slider-threshold">
              {t.minSimilarity}&nbsp;: <strong>{config.simSimilarity}&nbsp;%</strong>
              <input type="range" min={60} max={100} step={1} value={config.simSimilarity}
                onChange={(e) => config.setSimSimilarity(Number(e.target.value))}
                disabled={scanExec.scanning} className="threshold-slider" />
            </label>
          )}
          {config.detectionMode === "videos" && (
            <label className="slider-threshold">
              {t.minSimilarity}&nbsp;: <strong>{config.videoSimilarity}&nbsp;%</strong>
              <input type="range" min={60} max={100} step={1} value={config.videoSimilarity}
                onChange={(e) => config.setVideoSimilarity(Number(e.target.value))}
                disabled={scanExec.scanning} className="threshold-slider" />
            </label>
          )}
          {config.detectionMode === "audio" && (
            <label className="slider-threshold">
              {t.minSimilarity}&nbsp;: <strong>{config.audioSimilarity}&nbsp;%</strong>
              <input type="range" min={60} max={100} step={1} value={config.audioSimilarity}
                onChange={(e) => config.setAudioSimilarity(Number(e.target.value))}
                disabled={scanExec.scanning} className="threshold-slider" />
            </label>
          )}
        </div>

        {config.detectionMode === "images" && (
          <AdvancedPanel config={config.phashConfig} onChange={config.updatePhashConfig} disabled={scanExec.scanning} />
        )}
        {config.detectionMode === "videos" && (
          <VideoAdvancedPanel config={config.videoConfig} onChange={config.updateVideoConfig} disabled={scanExec.scanning} />
        )}
        {config.detectionMode === "audio" && (
          <AudioAdvancedPanel config={config.audioConfig} onChange={config.updateAudioConfig} disabled={scanExec.scanning} />
        )}
        <FiltersPanel
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
          disabled={scanExec.scanning}
        />
        {summary && (
          <div className="stats-row" data-testid="stats-row">
            <span className="stat"><strong>{summary.scanned_files}</strong> {t.filesScanned}</span>
            {summary.by_folder && (
              <span className="stat"><strong>{summary.total_folders}</strong> {summary.total_folders > 1 ? t.folders : t.folder}</span>
            )}
            <span className="stat"><strong>{summary.total_groups}</strong> {t.groups}</span>
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
        <div className="session-list">
          <p className="session-list-title">{t.previousSessions}</p>
          {sessions.map((s) => (
            <SessionCard key={s.id} session={s} active={false} resuming={resumingId === s.id} onResume={resumeSession} onDelete={removeSession} />
          ))}
        </div>
      )}

      {showResults && (
        <>
          <div className="toolbar">
            <button className="btn-ghost" onClick={selection.selectAllDuplicates} disabled={selection.selecting}>{t.selectAll}</button>
            <span className="rule-selector">
              <span className="rule-label">{t.selectionRule}</span>
              <select
                data-testid="rule-select"
                className="rule-select"
                value={smartRule}
                onChange={(e) => setSmartRule(e.target.value as SmartMode)}
                disabled={selection.selecting}
              >
                <option value="newest">{t.keepNewest}</option>
                <option value="oldest">{t.keepOldest}</option>
                <option value="highest_resolution">{t.keepHighestResolution}</option>
                <option value="largest_size">{t.keepLargestFile}</option>
                <option value="priority_folder">{t.keepPriorityFolder}</option>
              </select>
              {smartRule === "priority_folder" && (
                <input
                  className="rule-folder-input"
                  value={priorityFolder}
                  onChange={(e) => setPriorityFolder(e.target.value)}
                  placeholder={t.priorityFolderPlaceholder}
                  disabled={selection.selecting}
                />
              )}
              <button
                className="btn-ghost"
                onClick={() => selection.selectSmart(smartRule, smartRule === "priority_folder" ? priorityFolder : undefined)}
                disabled={selection.selecting}
              >
                {t.applyRule}
              </button>
            </span>
            <button className="btn-ghost" onClick={selection.clearSelection} disabled={selection.selecting}>{t.deselect}</button>
            {selection.selected.size > 0 && !selection.selecting && (
              <button className="btn-danger" onClick={() => selection.setConfirmPending(true)} disabled={selection.deleting}>
                {selection.deleting
                  ? t.deleting
                  : interp(t.deleteN, { n: selection.selected.size, s: selection.selected.size > 1 ? "s" : "", size: formatSize(selection.selectedSize) })}
              </button>
            )}
            {selection.selecting && (
              <span className="toolbar-loader">
                <span className="toolbar-spinner" />
                {t.calculating}
              </span>
            )}
          </div>

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
              filteredFolderSummaries.length === 0 && filterText.trim() ? (
                <p className="filter-no-results">{t.filterNoResults}</p>
              ) : (
                filteredFolderSummaries.map((fs) => (
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
                  />
                ))
              )
            ) : (
              <>
                {filteredGroups.length === 0 && filterText.trim() ? (
                  <p className="filter-no-results">{t.filterNoResults}</p>
                ) : (
                  filteredGroups.map((group: DuplicateGroup) => {
                    const imgIdx = imageGroups.indexOf(group);
                    return (
                      <GroupCard
                        key={group.id}
                        group={group}
                        selected={selection.selected}
                        onToggle={selection.toggleFile}
                        onCompare={imgIdx >= 0 ? () => setComparatorIdx(imgIdx) : undefined}
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
          {scanExec.progress ? (
            <div className="progress-container">
              <p className="progress-label">
                {interp(t.scanProgress, {
                  n: scanExec.progress.current,
                  m: scanExec.progress.total_files ?? scanExec.progress.total,
                  type: config.detectionMode === "images" ? t.typeImages : config.detectionMode === "videos" ? t.typeVideos : config.detectionMode === "audio" ? t.typeAudio : t.typeFiles,
                })}
              </p>
              <div className="progress-track">
                <div className="progress-bar"
                  style={{ width: `${Math.round((scanExec.progress.current / scanExec.progress.total) * 100)}%` }} />
              </div>
              <p className="progress-pct">
                {Math.round((scanExec.progress.current / scanExec.progress.total) * 100)} %
                <ProgressETA progress={scanExec.progress} historyRef={scanExec.progressHistoryRef} t={t} />
              </p>
              {scanExec.progress.file && <p className="progress-filename">{scanExec.progress.file}</p>}
            </div>
          ) : (
            <>
              <div className="spinner" />
              <p>{t.collectingFiles}</p>
            </>
          )}
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

      {selection.confirmPending && (
        <div className="modal-overlay" onClick={() => selection.setConfirmPending(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2 className="modal-title">{t.confirmTitle}</h2>
            <p className="modal-body">
              {interp(t.confirmBody, { n: selection.selected.size, s: selection.selected.size > 1 ? "s" : "", size: formatSize(selection.selectedSize) })}
            </p>
            <div className="modal-actions">
              <button className="btn-ghost" onClick={() => selection.setConfirmPending(false)}>{t.confirmCancel}</button>
              <button className="btn-danger" onClick={selection.doDelete}>{t.confirmConfirm}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
