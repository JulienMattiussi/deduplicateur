import { useState, startTransition, useEffect, useMemo } from "react";
import { invoke } from "@tauri-apps/api/core";
import "./App.css";
import { formatSize, dirname } from "./utils";
import { useLang } from "./LangContext";
import { interp, Translations } from "./i18n";
import type { DuplicateFile, DuplicateGroup, FolderSummary, ScanSummary, PHashConfig, VideoConfig } from "./types";
import { useScanConfig, DEFAULT_PHASH_CONFIG, DEFAULT_VIDEO_CONFIG } from "./hooks/useScanConfig";
import { useScanExecution } from "./hooks/useScanExecution";
import { useResults } from "./hooks/useResults";
import { useSelectionState } from "./hooks/useSelectionState";
import { ImageComparator } from "./ImageComparator";

// Nombre de bits dans le hash Hamming (grille 8x8)
const HAMMING_BITS = 64;

const VIDEO_EXTS = new Set(["mp4","avi","mkv","mov","wmv","webm","flv","m4v","mpg","mpeg","3gp","ts","mts","m2ts"]);
const IMAGE_EXTS = new Set(["jpg","jpeg","png","webp","bmp","gif","tiff","tif","avif"]);

function fileExt(path: string): string {
  return path.split(".").pop()?.toLowerCase() ?? "";
}

async function openFile(path: string) {
  try { await invoke("open_file", { path }); } catch { /* best-effort */ }
}

async function revealInFolder(path: string) {
  try { await invoke("reveal_in_folder", { path }); } catch { /* best-effort */ }
}

function formatDurationSecs(secs: number): string {
  const total = Math.round(secs);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${m}:${String(s).padStart(2, "0")}`;
}

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

function sessionTags(session: ScanSummary, t: Translations): string[] {
  const tags: string[] = [];
  if (session.by_folder) tags.push(t.tagByFolder);
  else if (session.recursive) tags.push(t.tagRecursive);
  else tags.push(t.tagFlat);
  if (session.find_similar) tags.push(t.tagSimilarImages);
  if (session.find_similar_videos) tags.push(t.tagSimilarVideos);
  if (!session.find_similar && !session.find_similar_videos) tags.push(t.tagExact);
  return tags;
}

function relativeDate(id: string, t: Translations): string {
  const diff = Date.now() - parseInt(id);
  const minutes = Math.floor(diff / 60_000);
  const hours = Math.floor(diff / 3_600_000);
  const days = Math.floor(diff / 86_400_000);
  if (minutes < 1) return t.justNow;
  if (minutes < 60) return interp(t.minutesAgo, { n: minutes });
  if (hours < 24) return interp(t.hoursAgo, { n: hours });
  return interp(t.daysAgo, { n: days });
}

function formatDate(ts: number, dateLocale: string): string {
  if (!ts) return "-";
  return new Date(ts * 1000).toLocaleDateString(dateLocale, {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

// ----- Composants -----

function SessionCard({
  session,
  active,
  resuming,
  onResume,
  onDelete,
}: {
  session: ScanSummary;
  active: boolean;
  resuming: boolean;
  onResume: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  const { t } = useLang();
  return (
    <div className={`session-card ${active ? "session-card--active" : ""}`}>
      <div className="session-meta">
        <span className="session-folder">📁 {session.folder}</span>
        <span className="session-date">{relativeDate(session.id, t)}</span>
      </div>
      <div className="session-tags">
        {sessionTags(session, t).map((tag) => <span key={tag} className="session-tag">{tag}</span>)}
      </div>
      <div className="session-stats">
        <span>{session.total_groups} {t.groups}</span>
        <span className="session-waste">{formatSize(session.total_wasted_bytes)} {t.recoverable}</span>
        <span>{session.scanned_files} {t.filesScanned}</span>
      </div>
      <div className="session-actions">
        <button className="btn-primary" onClick={() => onResume(session.id)} disabled={active || resuming}>
          {resuming ? <><span className="btn-spinner" /> {t.loading}</> : active ? t.sessionActive : t.sessionResume}
        </button>
        <button className="btn-session-delete" onClick={() => onDelete(session.id)} disabled={resuming}>
          {t.sessionDelete}
        </button>
      </div>
    </div>
  );
}

function FileThumbnail({ file, mode }: { file: DuplicateFile; mode: "image" | "video" }) {
  const [thumb, setThumb] = useState<string | null>(null);

  useEffect(() => {
    const cmd = mode === "video" ? "get_video_thumbnail" : "get_image_thumbnail";
    const args = mode === "video"
      ? { path: file.path, maxSize: 64, duration: file.video_metadata?.duration_secs ?? null }
      : { path: file.path, maxSize: 64 };
    invoke<string>(cmd, args)
      .then(setThumb)
      .catch(() => setThumb("error"));
  }, [file.path, mode]);

  if (thumb && thumb !== "error") {
    return (
      <img
        src={thumb}
        alt=""
        className="file-thumb-img"
        onClick={(e) => { e.stopPropagation(); openFile(file.path); }}
      />
    );
  }
  if (thumb === "error") {
    return <span className="file-thumb-error">{mode === "video" ? "🎬" : "🖼"}</span>;
  }
  return <span className="file-thumb-spinner" />;
}

type SortKey = "name" | "modified" | "size";

export function GroupCard({
  group,
  selected,
  onToggle,
  onCompare,
}: {
  group: DuplicateGroup;
  selected: Set<string>;
  onToggle: (path: string) => void;
  onCompare?: () => void;
}) {
  const { t } = useLang();
  const [expanded, setExpanded] = useState(true);
  const [sortKey, setSortKey] = useState<SortKey | null>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");

  const isSimilar = group.similar === true;
  const isVideoSimilar = group.video_similar === true;
  const firstExt = group.files.length > 0 ? fileExt(group.files[0].path) : "";
  const isVideoGroup = isVideoSimilar || VIDEO_EXTS.has(firstExt);
  const isImageGroup = isSimilar || (!isVideoGroup && IMAGE_EXTS.has(firstExt));

  function handleSortClick(key: SortKey) {
    if (sortKey === key) {
      if (sortDir === "asc") setSortDir("desc");
      else { setSortKey(null); setSortDir("asc"); }
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
  }

  const sortedFiles = useMemo(() => {
    if (!sortKey) return group.files;
    return [...group.files].sort((a, b) => {
      let diff = 0;
      if (sortKey === "name") diff = a.name.localeCompare(b.name);
      else if (sortKey === "modified") diff = a.modified - b.modified;
      else if (sortKey === "size") diff = a.size - b.size;
      return sortDir === "asc" ? diff : -diff;
    });
  }, [group.files, sortKey, sortDir]);

  function SortableHeader({ col, label, className }: { col: SortKey; label: string; className: string }) {
    const active = sortKey === col;
    return (
      <span
        className={`${className} file-col-sortable`}
        onClick={() => handleSortClick(col)}
      >
        {label}
        {active && <span className="sort-indicator">{sortDir === "asc" ? "↑" : "↓"}</span>}
      </span>
    );
  }

  return (
    <div className="group-card">
      <button className="group-header" onClick={() => setExpanded((v) => !v)}>
        <span className="group-chevron">{expanded ? "▾" : "▸"}</span>
        <span className="group-count">
          {isVideoGroup ? "🎬 " : isImageGroup ? "🖼 " : ""}
          {group.files.length} {isVideoGroup ? t.typeVideos : isImageGroup ? t.typeImages : t.typeFiles} {(isSimilar || isVideoSimilar) ? t.similar : t.identical}
        </span>
        {!isImageGroup && !isVideoGroup && <span className="group-size">{formatSize(group.size)} {t.each}</span>}
        {isImageGroup && onCompare && (
          <button
            className="btn-compare"
            onClick={(e) => { e.stopPropagation(); onCompare(); }}
          >
            {t.compare}
          </button>
        )}
        <span className="group-waste">
          {formatSize(group.size * (group.files.length - 1))} {t.duplicate}
        </span>
      </button>

      {expanded && (
        <div className="group-files">
          <div className="file-row-header">
            <span className="file-col-cb" />
            {(isImageGroup || isVideoGroup) && <span className="file-col-thumb" />}
            <SortableHeader col="name" label={t.colName} className="file-col-name" />
            <SortableHeader col="modified" label={t.colModified} className="file-col-date" />
            {(isImageGroup || isVideoGroup) && (
              <SortableHeader col="size" label={t.colSize} className="file-col-size" />
            )}
            {isVideoGroup && <span className="file-col-video-meta">{t.colDuration}</span>}
            <span className="file-col-dir">{t.colFolder}</span>
            <span className="file-col-badge" />
          </div>
          {sortedFiles.map((file, idx) => (
            <div
              key={file.path}
              className={`file-row ${(isImageGroup || isVideoGroup) ? "file-row--media" : ""} ${selected.has(file.path) ? "file-row--checked" : ""}`}
              onClick={() => onToggle(file.path)}
            >
              <span className="file-col-cb">
                <input
                  type="checkbox"
                  checked={selected.has(file.path)}
                  onChange={() => onToggle(file.path)}
                  onClick={(e) => e.stopPropagation()}
                />
              </span>
              {(isImageGroup || isVideoGroup) && (
                <span className="file-col-thumb">
                  <FileThumbnail file={file} mode={isVideoGroup ? "video" : "image"} />
                </span>
              )}
              <span className="file-col-name file-name">{file.name}</span>
              <span className="file-col-date file-meta">{formatDate(file.modified, t.dateLocale)}</span>
              {(isImageGroup || isVideoGroup) && <span className="file-col-size file-meta">{formatSize(file.size)}</span>}
              {isVideoGroup && (
                <span className="file-col-video-meta file-meta">
                  {file.video_metadata ? formatDurationSecs(file.video_metadata.duration_secs) : "-"}
                </span>
              )}
              <span className="file-col-dir">
                <span className="file-col-dir-text file-meta">{dirname(file.path)}</span>
                <button
                  className="btn-reveal"
                  onClick={(e) => { e.stopPropagation(); revealInFolder(file.path); }}
                  title={t.openInExplorer}
                >
                  ↗
                </button>
              </span>
              <span className="file-col-badge">
                {idx === 0 && <span className="badge-original">{t.original}</span>}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function FolderSection({
  summary,
  groups,
  loading,
  hasMore,
  selected,
  onToggle,
  onExpand,
  onLoadMore,
}: {
  summary: FolderSummary;
  groups: DuplicateGroup[];
  loading: boolean;
  hasMore: boolean;
  selected: Set<string>;
  onToggle: (path: string) => void;
  onExpand: () => void;
  onLoadMore: () => void;
}) {
  const { t } = useLang();
  const [expanded, setExpanded] = useState(false);

  function toggle() {
    const next = !expanded;
    setExpanded(next);
    if (next && groups.length === 0 && !loading) onExpand();
  }

  return (
    <div className="folder-section">
      <button className="folder-section-header" onClick={toggle}>
        <span className="folder-section-chevron">{expanded ? "▾" : "▸"}</span>
        <span className="folder-section-name">
          📁 {summary.folder_key === "" ? t.rootFolder : summary.folder_key}
        </span>
        <span className="folder-section-stats">
          {summary.group_count} {t.groups} · {formatSize(summary.total_wasted_bytes)} {t.duplicate}
        </span>
      </button>
      {expanded && (
        <>
          {loading && groups.length === 0 && (
            <div className="folder-section-loading">
              <span className="toolbar-spinner" style={{ display: "inline-block" }} />
              {t.loading}
            </div>
          )}
          {groups.map((group) => (
            <GroupCard key={group.id} group={group} selected={selected} onToggle={onToggle} />
          ))}
          {hasMore && !loading && groups.length > 0 && (
            <button className="btn-load-more" onClick={onLoadMore}>
              {interp(t.loadMore, { n: summary.group_count - groups.length })}
            </button>
          )}
          {loading && groups.length > 0 && (
            <div className="folder-section-loading">{t.loading}</div>
          )}
        </>
      )}
    </div>
  );
}

export function FiltersPanel({
  excluded,
  onChangeExcluded,
  excludeExtensions,
  onChangeExclude,
  includeExtensions,
  onChangeInclude,
  minFileSizeKb,
  onChangeMin,
  maxFileSizeKb,
  onChangeMax,
  exactCacheEnabled,
  onChangeCache,
  disabled,
}: {
  excluded: string[];
  onChangeExcluded: (v: string[]) => void;
  excludeExtensions: string[];
  onChangeExclude: (v: string[]) => void;
  includeExtensions: string[];
  onChangeInclude: (v: string[]) => void;
  minFileSizeKb: number;
  onChangeMin: (v: number) => void;
  maxFileSizeKb: number;
  onChangeMax: (v: number) => void;
  exactCacheEnabled: boolean;
  onChangeCache: (v: boolean) => void;
  disabled: boolean;
}) {
  const { t } = useLang();
  const [open, setOpen] = useState(false);
  const [folderInput, setFolderInput] = useState("");
  const [excludeInput, setExcludeInput] = useState("");
  const [includeInput, setIncludeInput] = useState("");

  const activeCount = excluded.length + excludeExtensions.length + includeExtensions.length
    + (minFileSizeKb > 0 ? 1 : 0) + (maxFileSizeKb > 0 ? 1 : 0);

  function addFolder() {
    const name = folderInput.trim();
    if (name && !excluded.includes(name)) onChangeExcluded([...excluded, name]);
    setFolderInput("");
  }

  function addExt(list: string[], input: string, onChange: (v: string[]) => void, setInput: (v: string) => void) {
    const ext = input.trim().replace(/^\./, "").toLowerCase();
    if (ext && !list.includes(ext)) onChange([...list, ext]);
    setInput("");
  }

  return (
    <div className="exclusions">
      <button className="exclusions-toggle" onClick={() => setOpen((v) => !v)} disabled={disabled}>
        <span>{open ? "▾" : "▸"}</span>
        {t.filtersPanel}
        <span className="exclusions-count">{activeCount}</span>
      </button>
      {open && (
        <div className="exclusions-body">
          <div className="adv-section">
            <span className="adv-section-title">{t.excludedFolders}</span>
            <div className="exclusions-chips">
              {excluded.map((name) => (
                <span key={name} className="chip">
                  {name}
                  <button className="chip-remove" onClick={() => onChangeExcluded(excluded.filter((e) => e !== name))} disabled={disabled}>×</button>
                </span>
              ))}
            </div>
            <div className="exclusions-add">
              <input className="exclusions-input" value={folderInput}
                onChange={(e) => setFolderInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && addFolder()}
                placeholder={t.addFolderPlaceholder} disabled={disabled} />
              <button className="btn-ghost" onClick={addFolder} disabled={disabled || !folderInput.trim()}>{t.add}</button>
            </div>
          </div>
          <div className="adv-section">
            <span className="adv-section-title">{t.excludeExtensions}</span>
            <div className="exclusions-chips">
              {excludeExtensions.map((ext) => (
                <span key={ext} className="chip">
                  .{ext}
                  <button className="chip-remove" onClick={() => onChangeExclude(excludeExtensions.filter((e) => e !== ext))} disabled={disabled}>×</button>
                </span>
              ))}
            </div>
            <div className="exclusions-add">
              <input className="exclusions-input" value={excludeInput}
                onChange={(e) => setExcludeInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && addExt(excludeExtensions, excludeInput, onChangeExclude, setExcludeInput)}
                placeholder={t.addExtPlaceholder} disabled={disabled} />
              <button className="btn-ghost" onClick={() => addExt(excludeExtensions, excludeInput, onChangeExclude, setExcludeInput)}
                disabled={disabled || !excludeInput.trim()}>{t.add}</button>
            </div>
          </div>
          <div className="adv-section">
            <span className="adv-section-title">{t.includeExtensions}</span>
            <div className="exclusions-chips">
              {includeExtensions.map((ext) => (
                <span key={ext} className="chip">
                  .{ext}
                  <button className="chip-remove" onClick={() => onChangeInclude(includeExtensions.filter((e) => e !== ext))} disabled={disabled}>×</button>
                </span>
              ))}
            </div>
            <div className="exclusions-add">
              <input className="exclusions-input" value={includeInput}
                onChange={(e) => setIncludeInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && addExt(includeExtensions, includeInput, onChangeInclude, setIncludeInput)}
                placeholder={t.addExtPlaceholder} disabled={disabled} />
              <button className="btn-ghost" onClick={() => addExt(includeExtensions, includeInput, onChangeInclude, setIncludeInput)}
                disabled={disabled || !includeInput.trim()}>{t.add}</button>
            </div>
          </div>
          <div className="adv-section">
            <div className="filters-size-row">
              <label className="filters-size-pair">
                <span>{t.minFileSizeKb}</span>
                <input type="number" min={0} className="adv-input filters-size-input" value={minFileSizeKb}
                  onChange={(e) => onChangeMin(Math.max(0, Number(e.target.value)))}
                  disabled={disabled} />
              </label>
              <label className="filters-size-pair">
                <span>{t.maxFileSizeKb}</span>
                <input type="number" min={0} className="adv-input filters-size-input" value={maxFileSizeKb}
                  onChange={(e) => onChangeMax(Math.max(0, Number(e.target.value)))}
                  disabled={disabled} />
              </label>
              <span className="adv-hint">{t.noSizeLimit}</span>
            </div>
          </div>
          <div className="adv-section">
            <label className="adv-row">
              <span>{t.exactCacheLabel}</span>
              <input type="checkbox" checked={exactCacheEnabled}
                onChange={(e) => onChangeCache(e.target.checked)} disabled={disabled} />
            </label>
          </div>
        </div>
      )}
    </div>
  );
}

function VideoAdvancedPanel({
  config,
  onChange,
  disabled,
}: {
  config: VideoConfig;
  onChange: (cfg: VideoConfig) => void;
  disabled: boolean;
}) {
  const { t } = useLang();
  const [open, setOpen] = useState(false);

  function set<K extends keyof VideoConfig>(key: K, value: VideoConfig[K]) {
    onChange({ ...config, [key]: value });
  }

  return (
    <div className="advanced-panel">
      <button className="advanced-panel-toggle" onClick={() => setOpen((v) => !v)} disabled={disabled}>
        <span>{open ? "▾" : "▸"}</span>
        {t.advancedSettings}
      </button>
      {open && (
        <button className="adv-reset" onClick={() => onChange(DEFAULT_VIDEO_CONFIG)} disabled={disabled} title={t.resetTitle}>
          {t.reset}
        </button>
      )}
      {open && (
        <div key={JSON.stringify(config)} className="advanced-panel-body">
          <div className="adv-section">
            <span className="adv-section-title">{t.extractionLabel}</span>
            <label className="adv-row">
              <span>{t.framesPerVideo}</span>
              <input type="number" min={2} max={30} className="adv-input" defaultValue={config.n_frames}
                onBlur={(e) => set("n_frames", Math.max(2, Math.min(30, Number(e.target.value))))} disabled={disabled} />
            </label>
          </div>
          <div className="adv-section">
            <span className="adv-section-title">{t.durationFilter}</span>
            <label className="adv-row">
              <span>{t.tolerance}</span>
              <input type="number" min={0} max={100} className="adv-input"
                defaultValue={Math.round(config.duration_tolerance * 100)}
                onBlur={(e) => set("duration_tolerance", Number(e.target.value) / 100)} disabled={disabled} />
            </label>
          </div>
          <div className="adv-section">
            <span className="adv-section-title">{t.cacheLabel}</span>
            <label className="adv-row">
              <span>{t.enable}</span>
              <input type="checkbox" checked={config.cache_enabled}
                onChange={(e) => set("cache_enabled", e.target.checked)} disabled={disabled} />
            </label>
          </div>
          <div className="adv-section">
            <span className="adv-section-title">{t.temporalAlign}</span>
            <label className="adv-row">
              <span>DTW <span className="adv-hint">{t.dtwHint}</span></span>
              <input type="checkbox" checked={config.use_dtw}
                onChange={(e) => set("use_dtw", e.target.checked)} disabled={disabled} />
            </label>
          </div>
        </div>
      )}
    </div>
  );
}

function AdvancedPanel({
  config,
  onChange,
  disabled,
}: {
  config: PHashConfig;
  onChange: (cfg: PHashConfig) => void;
  disabled: boolean;
}) {
  const { t } = useLang();
  const [open, setOpen] = useState(false);

  function set<K extends keyof PHashConfig>(key: K, value: PHashConfig[K]) {
    onChange({ ...config, [key]: value });
  }

  return (
    <div className="advanced-panel">
      <button className="advanced-panel-toggle" onClick={() => setOpen((v) => !v)} disabled={disabled}>
        <span>{open ? "▾" : "▸"}</span>
        {t.advancedSettings}
      </button>
      {open && (
        <button className="adv-reset" onClick={() => onChange(DEFAULT_PHASH_CONFIG)} disabled={disabled} title={t.resetTitle}>
          {t.reset}
        </button>
      )}
      {open && (
        <div className="advanced-panel-body">
          <div className="adv-section">
            <span className="adv-section-title">{t.sizeFilter}</span>
            <label className="adv-row">
              <span>{t.minSizeKb}</span>
              <input type="number" min={0} className="adv-input"
                defaultValue={Math.round(config.min_file_size_bytes / 1024)}
                onBlur={(e) => set("min_file_size_bytes", Number(e.target.value) * 1024)} disabled={disabled} />
            </label>
            <label className="adv-row">
              <span>{t.enableIfN}</span>
              <input type="number" min={1} className="adv-input" defaultValue={config.min_images_size_filter}
                onBlur={(e) => set("min_images_size_filter", Number(e.target.value))} disabled={disabled} />
            </label>
          </div>
          <div className="adv-section">
            <span className="adv-section-title">{t.aspectFilter}</span>
            <label className="adv-row">
              <span>{t.tolerance}</span>
              <input type="number" min={0} max={100} className="adv-input"
                defaultValue={Math.round(config.aspect_ratio_tolerance * 100)}
                onBlur={(e) => set("aspect_ratio_tolerance", Number(e.target.value) / 100)} disabled={disabled} />
            </label>
            <label className="adv-row">
              <span>{t.enableIfN}</span>
              <input type="number" min={1} className="adv-input" defaultValue={config.min_images_aspect_filter}
                onBlur={(e) => set("min_images_aspect_filter", Number(e.target.value))} disabled={disabled} />
            </label>
          </div>
          <div className="adv-section">
            <span className="adv-section-title">{t.twoPassHash}</span>
            <label className="adv-row">
              <span>{t.enable}</span>
              <input type="checkbox" checked={config.two_pass_enabled}
                onChange={(e) => set("two_pass_enabled", e.target.checked)} disabled={disabled} />
            </label>
            <label className="adv-row">
              <span>{t.enableIfN}</span>
              <input type="number" min={1} className="adv-input" defaultValue={config.min_images_two_pass}
                onBlur={(e) => set("min_images_two_pass", Number(e.target.value))} disabled={disabled} />
            </label>
            <label className="adv-row">
              <span>{t.coarseMultiplier}</span>
              <input type="number" min={1} step={0.1} className="adv-input"
                defaultValue={config.coarse_threshold_multiplier}
                onBlur={(e) => set("coarse_threshold_multiplier", Number(e.target.value))} disabled={disabled} />
            </label>
          </div>
          <div className="adv-section">
            <span className="adv-section-title">{t.cacheLabel}</span>
            <label className="adv-row">
              <span>{t.enable}</span>
              <input type="checkbox" checked={config.cache_enabled}
                onChange={(e) => set("cache_enabled", e.target.checked)} disabled={disabled} />
            </label>
          </div>
          <div className="adv-section">
            <span className="adv-section-title">{t.parallelCompare}</span>
            <label className="adv-row">
              <span>{t.enable}</span>
              <input type="checkbox" checked={config.parallel_compare_enabled}
                onChange={(e) => set("parallel_compare_enabled", e.target.checked)} disabled={disabled} />
            </label>
            <label className="adv-row">
              <span>{t.enableIfN}</span>
              <input type="number" min={1} className="adv-input" defaultValue={config.min_images_parallel_compare}
                onBlur={(e) => set("min_images_parallel_compare", Number(e.target.value))} disabled={disabled} />
            </label>
          </div>
          <div className="adv-section">
            <span className="adv-section-title">{t.devMode}</span>
            <label className="adv-row">
              <span>{t.savePerfMetrics}</span>
              <input type="checkbox" checked={config.perf_log_enabled}
                onChange={(e) => set("perf_log_enabled", e.target.checked)} disabled={disabled} />
            </label>
          </div>
        </div>
      )}
    </div>
  );
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

  const config = useScanConfig();
  const results = useResults(setError);
  const scanExec = useScanExecution(handleScanComplete, setError);
  const selection = useSelectionState(results.groups, handleDeleteComplete, setError);

  // Theme persistence
  useEffect(() => {
    localStorage.setItem("theme", theme);
  }, [theme]);

  // Drag & drop
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

  // Keyboard shortcuts
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

  useEffect(() => {
    invoke<ScanSummary[]>("list_sessions")
      .then((s) => startTransition(() => setSessions(s)))
      .catch(() => {});
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
      exactCacheEnabled: config.exactCacheEnabled,
      excludeExtensions: config.excludeExtensions,
      includeExtensions: config.includeExtensions,
      minFileSizeKb: config.minFileSizeKb,
      maxFileSizeKb: config.maxFileSizeKb,
    });
  }

  const showSessionPicker = !summary && !scanExec.scanning && sessions.length > 0;
  const showResults = summary !== null && summary.total_groups > 0;

  // Filtre sur les résultats
  const filteredGroups = useMemo(() => {
    if (!filterText.trim()) return results.groups;
    const q = filterText.toLowerCase();
    return results.groups.filter((g) =>
      g.files.some((f) => f.name.toLowerCase().includes(q) || f.path.toLowerCase().includes(q))
    );
  }, [results.groups, filterText]);

  const imageGroups = useMemo(() =>
    filteredGroups.filter((g) =>
      g.similar || (!g.video_similar && IMAGE_EXTS.has(fileExt(g.files[0]?.path ?? "")))
    ),
    [filteredGroups]
  );

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
            {(["files", "images", "videos"] as const).map((mode) => (
              <button key={mode}
                className={`detection-mode-btn${config.detectionMode === mode ? " detection-mode-btn--active" : ""}`}
                onClick={() => config.setDetectionMode(mode)} disabled={scanExec.scanning}>
                {mode === "files" ? t.modeFiles : mode === "images" ? t.modeImages : t.modeVideos}
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
        </div>

        {config.detectionMode === "images" && (
          <AdvancedPanel config={config.phashConfig} onChange={config.updatePhashConfig} disabled={scanExec.scanning} />
        )}
        {config.detectionMode === "videos" && (
          <VideoAdvancedPanel config={config.videoConfig} onChange={config.updateVideoConfig} disabled={scanExec.scanning} />
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
          <div className="stats-row">
            <span className="stat"><strong>{summary.scanned_files}</strong> {t.filesScanned}</span>
            {summary.by_folder && (
              <span className="stat"><strong>{summary.total_folders}</strong> {summary.total_folders > 1 ? t.folders : t.folder}</span>
            )}
            <span className="stat"><strong>{summary.total_groups}</strong> {t.groups}</span>
            <span className="stat waste"><strong>{formatSize(summary.total_wasted_bytes)}</strong> {t.recoverable}</span>
            <span className="stat duration">en {formatDuration(summary.duration_ms, t)}</span>
          </div>
        )}
      </header>

      {error && <div className="error-banner">{error}</div>}
      {summary?.partial && <div className="partial-banner">{t.partialResults}</div>}
      {summary?.ffmpeg_missing && <div className="partial-banner">{t.ffmpegMissing}</div>}

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
            <button className="btn-ghost" onClick={() => selection.selectSmart("newest")} disabled={selection.selecting}>{t.keepNewest}</button>
            <button className="btn-ghost" onClick={() => selection.selectSmart("oldest")} disabled={selection.selecting}>{t.keepOldest}</button>
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
                  />
                ))
              )
            ) : (
              <>
                {filteredGroups.length === 0 && filterText.trim() ? (
                  <p className="filter-no-results">{t.filterNoResults}</p>
                ) : (
                  filteredGroups.map((group) => {
                    const imgIdx = imageGroups.indexOf(group);
                    return (
                      <GroupCard
                        key={group.id}
                        group={group}
                        selected={selection.selected}
                        onToggle={selection.toggleFile}
                        onCompare={imgIdx >= 0 ? () => setComparatorIdx(imgIdx) : undefined}
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
                  type: config.detectionMode === "images" ? t.typeImages : config.detectionMode === "videos" ? t.typeVideos : t.typeFiles,
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

// Composant extrait pour la logique ETA (non-évidente : 3 régimes selon l'avancement et le temps écoulé)
function ProgressETA({
  progress,
  historyRef,
  t,
}: {
  progress: { current: number; total: number; total_files?: number };
  historyRef: React.MutableRefObject<{ time: number; current: number }[]>;
  t: Translations;
}) {
  const pct = progress.current / progress.total;
  const hist = historyRef.current;
  const now = Date.now();
  const elapsed = hist.length >= 2 ? now - hist[0].time : 0;

  // Régime 1 : presque terminé (95%+ ou <15s restants au rythme récent)
  const recentRef = hist.length >= 2 ? hist[Math.max(0, hist.length - 20)] : null;
  const recentRate = recentRef ? (progress.current - recentRef.current) / (now - recentRef.time) : 0;
  if (pct >= 0.95 || (recentRate > 0 && (progress.total - progress.current) / recentRate < 15_000)) {
    return <span className="progress-eta">{t.almostDone}</span>;
  }

  // Régime 2 : chauffe (<2 min) - estimation pessimiste x1.5 après 15s de données
  if (elapsed < 120_000) {
    if (elapsed < 15_000 || hist.length < 2) {
      return <span className="progress-eta">{t.estimating}</span>;
    }
    const earlyRate = (progress.current - hist[0].current) / elapsed;
    if (earlyRate <= 0) return <span className="progress-eta">{t.estimating}</span>;
    const earlyRemainS = Math.round((progress.total - progress.current) / earlyRate / 1000 * 1.5);
    if (earlyRemainS < 15) return null;
    const earlyLabel = earlyRemainS < 60
      ? `${earlyRemainS} ${t.durationS}`
      : `${Math.round(earlyRemainS / 60)} ${t.durationMin}`;
    return <span className="progress-eta">{interp(t.aboutTime, { t: earlyLabel })}</span>;
  }

  // Régime 3 : stable (>2 min) - taux calculé sur les 3 dernières minutes
  const target = now - 180_000;
  const refIdx = hist.findIndex((s) => s.time >= target);
  const ref = refIdx > 0 ? hist[refIdx] : hist[0];
  const rate = (progress.current - ref.current) / (now - ref.time);
  if (rate <= 0) return null;
  const remainS = Math.round((progress.total - progress.current) / rate / 1000);
  if (remainS < 15) return null;
  const etaLabel = remainS < 60
    ? `${remainS} ${t.durationS}`
    : `${Math.round(remainS / 60)} ${t.durationMin}`;
  return <span className="progress-eta">{interp(t.aboutTime, { t: etaLabel })}</span>;
}
