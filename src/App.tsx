import { useState, startTransition, useEffect, useMemo, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import "./App.css";
import { formatSize, dirname } from "./utils";

interface VideoMetadata {
  duration_secs: number;
  width: number;
  height: number;
  codec: string;
}

interface DuplicateFile {
  path: string;
  size: number;
  name: string;
  modified: number;
  video_metadata?: VideoMetadata;
}

interface DuplicateGroup {
  id: string;
  hash: string;
  size: number;
  files: DuplicateFile[];
  folder_key?: string;
  similar?: boolean;
  video_similar?: boolean;
}

interface ScanSummary {
  id: string;
  folder: string;
  total_wasted_bytes: number;
  total_groups: number;
  scanned_files: number;
  duration_ms: number;
  by_folder: boolean;
  total_folders: number;
  partial?: boolean;
  recursive?: boolean;
  find_similar?: boolean;
  find_similar_videos?: boolean;
}

interface PHashConfig {
  min_file_size_bytes: number;
  min_images_size_filter: number;
  aspect_ratio_tolerance: number;
  min_images_aspect_filter: number;
  two_pass_enabled: boolean;
  coarse_hash_size: number;
  fine_hash_size: number;
  coarse_threshold_multiplier: number;
  min_images_two_pass: number;
  cache_enabled: boolean;
  parallel_compare_enabled: boolean;
  min_images_parallel_compare: number;
  perf_log_enabled: boolean;
}

interface VideoConfig {
  n_frames: number;
  duration_tolerance: number;
  cache_enabled: boolean;
  use_dtw: boolean;
}

const DEFAULT_VIDEO_CONFIG: VideoConfig = {
  n_frames: 8,
  duration_tolerance: 0.20,
  cache_enabled: true,
  use_dtw: false,
};

const DEFAULT_PHASH_CONFIG: PHashConfig = {
  min_file_size_bytes: 10240,
  min_images_size_filter: 50,
  aspect_ratio_tolerance: 0.20,
  min_images_aspect_filter: 10,
  two_pass_enabled: true,
  coarse_hash_size: 4,
  fine_hash_size: 8,
  coarse_threshold_multiplier: 2.0,
  min_images_two_pass: 20,
  cache_enabled: true,
  parallel_compare_enabled: true,
  min_images_parallel_compare: 200,
  perf_log_enabled: false,
};

interface FolderSummary {
  folder_key: string;
  group_count: number;
  total_wasted_bytes: number;
}

interface GroupsPage {
  groups: DuplicateGroup[];
  offset: number;
  total: number;
  has_more: boolean;
}

const VIDEO_EXTS = new Set(["mp4","avi","mkv","mov","wmv","webm","flv","m4v","mpg","mpeg","3gp","ts","mts","m2ts"]);
const IMAGE_EXTS = new Set(["jpg","jpeg","png","webp","bmp","gif","tiff","tif","avif"]);

function fileExt(path: string): string {
  return path.split(".").pop()?.toLowerCase() ?? "";
}

async function revealInFolder(path: string) {
  try {
    await invoke("reveal_in_folder", { path });
  } catch {
    // best-effort, pas d'erreur visible
  }
}

function formatDurationSecs(secs: number): string {
  const total = Math.round(secs);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms} ms`;
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  const rem = s % 60;
  if (m < 60) return rem > 0 ? `${m} min ${rem} s` : `${m} min`;
  const h = Math.floor(m / 60);
  const remMin = m % 60;
  return remMin > 0 ? `${h} h ${remMin} min` : `${h} h`;
}

function sessionTags(session: ScanSummary): string[] {
  const tags: string[] = [];
  if (session.by_folder) tags.push("par dossier");
  else if (session.recursive) tags.push("récursif");
  else tags.push("dossier plat");
  if (session.find_similar) tags.push("similarité images");
  if (session.find_similar_videos) tags.push("similarité vidéos");
  if (!session.find_similar && !session.find_similar_videos) tags.push("doublons exacts");
  return tags;
}

function relativeDate(id: string): string {
  const diff = Date.now() - parseInt(id);
  const minutes = Math.floor(diff / 60_000);
  const hours = Math.floor(diff / 3_600_000);
  const days = Math.floor(diff / 86_400_000);
  if (minutes < 1) return "à l'instant";
  if (minutes < 60) return `il y a ${minutes} min`;
  if (hours < 24) return `il y a ${hours} h`;
  return `il y a ${days} j`;
}

function formatDate(ts: number): string {
  if (!ts) return "-";
  return new Date(ts * 1000).toLocaleDateString("fr-FR", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function SessionCard({
  session,
  active,
  onResume,
  onDelete,
}: {
  session: ScanSummary;
  active: boolean;
  onResume: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  return (
    <div className={`session-card ${active ? "session-card--active" : ""}`}>
      <div className="session-meta">
        <span className="session-folder">📁 {session.folder}</span>
        <span className="session-date">{relativeDate(session.id)}</span>
      </div>
      <div className="session-tags">
        {sessionTags(session).map((t) => <span key={t} className="session-tag">{t}</span>)}
      </div>
      <div className="session-stats">
        <span>{session.total_groups} groupes</span>
        <span className="session-waste">{formatSize(session.total_wasted_bytes)} récupérables</span>
        <span>{session.scanned_files} fichiers analysés</span>
      </div>
      <div className="session-actions">
        <button className="btn-primary" onClick={() => onResume(session.id)} disabled={active}>
          {active ? "En cours" : "Reprendre"}
        </button>
        <button className="btn-session-delete" onClick={() => onDelete(session.id)}>
          Supprimer
        </button>
      </div>
    </div>
  );
}

function VideoThumbnailStrip({ files }: { files: DuplicateFile[] }) {
  const [thumbs, setThumbs] = useState<Record<string, string>>({});

  useEffect(() => {
    for (const file of files) {
      invoke<string>("get_video_thumbnail", {
        path: file.path,
        maxSize: 150,
        duration: file.video_metadata?.duration_secs ?? null,
      })
        .then((dataUrl) => setThumbs((prev) => ({ ...prev, [file.path]: dataUrl })))
        .catch(() => {});
    }
  }, [files]);

  async function openFile(path: string) {
    try { await invoke("open_file", { path }); } catch { /* best-effort */ }
  }

  return (
    <div className="similar-thumbnails">
      {files.map((file) => (
        <div key={file.path} className="similar-thumb" title={file.name}>
          {thumbs[file.path] ? (
            <img
              src={thumbs[file.path]}
              alt={file.name}
              className="similar-thumb-img similar-thumb-img--clickable"
              onClick={() => openFile(file.path)}
            />
          ) : (
            <div className="similar-thumb-placeholder">
              <div className="similar-thumb-spinner" />
            </div>
          )}
          {file.video_metadata && (
            <span className="video-thumb-meta">
              {file.video_metadata.width}x{file.video_metadata.height} · {file.video_metadata.codec}
            </span>
          )}
          <span className="video-thumb-meta">{formatSize(file.size)}</span>
          <span className="similar-thumb-name">{file.name}</span>
        </div>
      ))}
    </div>
  );
}

function ThumbnailStrip({ files }: { files: DuplicateFile[] }) {
  const [thumbs, setThumbs] = useState<Record<string, string>>({});

  useEffect(() => {
    for (const file of files) {
      invoke<string>("get_image_thumbnail", { path: file.path, maxSize: 150 })
        .then((dataUrl) => setThumbs((prev) => ({ ...prev, [file.path]: dataUrl })))
        .catch(() => {});
    }
  }, [files]);

  async function openFile(path: string) {
    try { await invoke("open_file", { path }); } catch { /* best-effort */ }
  }

  return (
    <div className="similar-thumbnails">
      {files.map((file) => (
        <div key={file.path} className="similar-thumb" title={file.name}>
          {thumbs[file.path] ? (
            <img
              src={thumbs[file.path]}
              alt={file.name}
              className="similar-thumb-img similar-thumb-img--clickable"
              onClick={() => openFile(file.path)}
            />
          ) : (
            <div className="similar-thumb-placeholder">
              <div className="similar-thumb-spinner" />
            </div>
          )}
          <span className="similar-thumb-name">{file.name}</span>
        </div>
      ))}
    </div>
  );
}

export function GroupCard({
  group,
  selected,
  onToggle,
}: {
  group: DuplicateGroup;
  selected: Set<string>;
  onToggle: (path: string) => void;
}) {
  const [expanded, setExpanded] = useState(true);
  const isSimilar = group.similar === true;
  const isVideoSimilar = group.video_similar === true;
  const firstExt = group.files.length > 0 ? fileExt(group.files[0].path) : "";
  const isVideoGroup = isVideoSimilar || VIDEO_EXTS.has(firstExt);
  const isImageGroup = isSimilar || (!isVideoGroup && IMAGE_EXTS.has(firstExt));

  return (
    <div className="group-card">
      <button className="group-header" onClick={() => setExpanded((v) => !v)}>
        <span className="group-chevron">{expanded ? "▾" : "▸"}</span>
        <span className="group-count">
          {isVideoGroup ? "🎬 " : isImageGroup ? "🖼 " : ""}
          {group.files.length} {isVideoGroup ? "vidéos" : isImageGroup ? "images" : "fichiers"} {(isSimilar || isVideoSimilar) ? "similaires" : "identiques"}
        </span>
        {!isImageGroup && !isVideoGroup && <span className="group-size">{formatSize(group.size)} chacun</span>}
        <span className="group-waste">
          {formatSize(group.size * (group.files.length - 1))} en double
        </span>
      </button>

      {expanded && isImageGroup && <ThumbnailStrip files={group.files} />}
      {expanded && isVideoGroup && <VideoThumbnailStrip files={group.files} />}

      {expanded && (
        <div className="group-files">
          <div className="file-row-header">
            <span className="file-col-cb" />
            <span className="file-col-name">Nom</span>
            <span className="file-col-date">Modifié</span>
            {(isImageGroup || isVideoGroup) && <span className="file-col-size">Taille</span>}
            {isVideoGroup && <span className="file-col-video-meta">Durée</span>}
            <span className="file-col-dir">Dossier</span>
            <span className="file-col-badge" />
          </div>
          {group.files.map((file, idx) => (
            <div
              key={file.path}
              className={`file-row ${selected.has(file.path) ? "file-row--checked" : ""}`}
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
              <span className="file-col-name file-name">{file.name}</span>
              <span className="file-col-date file-meta">{formatDate(file.modified)}</span>
              {(isImageGroup || isVideoGroup) && <span className="file-col-size file-meta">{formatSize(file.size)}</span>}
              {isVideoGroup && (
                <span className="file-col-video-meta file-meta">
                  {file.video_metadata ? formatDurationSecs(file.video_metadata.duration_secs) : "="}
                </span>
              )}
              <span className="file-col-dir">
                <span className="file-col-dir-text file-meta">{dirname(file.path)}</span>
                <button
                  className="btn-reveal"
                  onClick={(e) => { e.stopPropagation(); revealInFolder(file.path); }}
                  title="Ouvrir dans le gestionnaire de fichiers"
                >
                  ↗
                </button>
              </span>
              <span className="file-col-badge">
                {idx === 0 && <span className="badge-original">original</span>}
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
  const [expanded, setExpanded] = useState(false);

  function toggle() {
    const next = !expanded;
    setExpanded(next);
    if (next && groups.length === 0 && !loading) {
      onExpand();
    }
  }

  return (
    <div className="folder-section">
      <button className="folder-section-header" onClick={toggle}>
        <span className="folder-section-chevron">{expanded ? "▾" : "▸"}</span>
        <span className="folder-section-name">
          📁 {summary.folder_key === "" ? "Dossier racine" : summary.folder_key}
        </span>
        <span className="folder-section-stats">
          {summary.group_count} groupe{summary.group_count > 1 ? "s" : ""} · {formatSize(summary.total_wasted_bytes)} en double
        </span>
      </button>
      {expanded && (
        <>
          {loading && groups.length === 0 && (
            <div className="folder-section-loading">
              <span className="toolbar-spinner" style={{ display: "inline-block" }} />
              Chargement…
            </div>
          )}
          {groups.map((group) => (
            <GroupCard key={group.id} group={group} selected={selected} onToggle={onToggle} />
          ))}
          {hasMore && !loading && groups.length > 0 && (
            <button className="btn-load-more" onClick={onLoadMore}>
              Afficher 50 de plus ({summary.group_count - groups.length} restants)
            </button>
          )}
          {loading && groups.length > 0 && (
            <div className="folder-section-loading">Chargement…</div>
          )}
        </>
      )}
    </div>
  );
}

function ExclusionsPanel({
  excluded,
  onChange,
  disabled,
}: {
  excluded: string[];
  onChange: (v: string[]) => void;
  disabled: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");

  function remove(name: string) {
    onChange(excluded.filter((e) => e !== name));
  }

  function add() {
    const name = input.trim();
    if (name && !excluded.includes(name)) onChange([...excluded, name]);
    setInput("");
  }

  return (
    <div className="exclusions">
      <button className="exclusions-toggle" onClick={() => setOpen((v) => !v)} disabled={disabled}>
        <span>{open ? "▾" : "▸"}</span>
        Dossiers exclus
        <span className="exclusions-count">{excluded.length}</span>
      </button>

      {open && (
        <div className="exclusions-body">
          <div className="exclusions-chips">
            {excluded.map((name) => (
              <span key={name} className="chip">
                {name}
                <button className="chip-remove" onClick={() => remove(name)} disabled={disabled}>
                  ×
                </button>
              </span>
            ))}
          </div>
          <div className="exclusions-add">
            <input
              className="exclusions-input"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && add()}
              placeholder="Ajouter un dossier…"
              disabled={disabled}
            />
            <button className="btn-ghost" onClick={add} disabled={disabled || !input.trim()}>
              Ajouter
            </button>
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
  const [open, setOpen] = useState(false);

  function set<K extends keyof VideoConfig>(key: K, value: VideoConfig[K]) {
    onChange({ ...config, [key]: value });
  }

  return (
    <div className="advanced-panel">
      <button className="advanced-panel-toggle" onClick={() => setOpen((v) => !v)} disabled={disabled}>
        <span>{open ? "▾" : "▸"}</span>
        Paramètres avancés de détection
      </button>
      {open && (
        <button
          className="adv-reset"
          onClick={() => onChange(DEFAULT_VIDEO_CONFIG)}
          disabled={disabled}
          title="Remettre tous les paramètres aux valeurs par défaut"
        >
          Réinitialiser
        </button>
      )}
      {open && (
        <div key={JSON.stringify(config)} className="advanced-panel-body">
          <div className="adv-section">
            <span className="adv-section-title">Extraction</span>
            <label className="adv-row">
              <span>Frames par vidéo</span>
              <input
                type="number"
                min={2}
                max={30}
                className="adv-input"
                defaultValue={config.n_frames}
                onBlur={(e) => set("n_frames", Math.max(2, Math.min(30, Number(e.target.value))))}
                disabled={disabled}
              />
            </label>
          </div>
          <div className="adv-section">
            <span className="adv-section-title">Filtre de durée</span>
            <label className="adv-row">
              <span>Tolérance (%)</span>
              <input
                type="number"
                min={0}
                max={100}
                className="adv-input"
                defaultValue={Math.round(config.duration_tolerance * 100)}
                onBlur={(e) => set("duration_tolerance", Number(e.target.value) / 100)}
                disabled={disabled}
              />
            </label>
          </div>
          <div className="adv-section">
            <span className="adv-section-title">Cache entre scans</span>
            <label className="adv-row">
              <span>Activer</span>
              <input
                type="checkbox"
                checked={config.cache_enabled}
                onChange={(e) => set("cache_enabled", e.target.checked)}
                disabled={disabled}
              />
            </label>
          </div>
          <div className="adv-section">
            <span className="adv-section-title">Alignement temporel</span>
            <label className="adv-row">
              <span>DTW <span className="adv-hint">(intro/génériques courts)</span></span>
              <input
                type="checkbox"
                checked={config.use_dtw}
                onChange={(e) => set("use_dtw", e.target.checked)}
                disabled={disabled}
              />
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
  const [open, setOpen] = useState(false);

  function set<K extends keyof PHashConfig>(key: K, value: PHashConfig[K]) {
    onChange({ ...config, [key]: value });
  }

  return (
    <div className="advanced-panel">
      <button className="advanced-panel-toggle" onClick={() => setOpen((v) => !v)} disabled={disabled}>
        <span>{open ? "▾" : "▸"}</span>
        Paramètres avancés de détection
      </button>
      {open && (
        <button
          className="adv-reset"
          onClick={() => onChange(DEFAULT_PHASH_CONFIG)}
          disabled={disabled}
          title="Remettre tous les paramètres aux valeurs par défaut"
        >
          Réinitialiser
        </button>
      )}
      {open && (
        <div className="advanced-panel-body">
          <div className="adv-section">
            <span className="adv-section-title">Filtre de taille</span>
            <label className="adv-row">
              <span>Taille minimale (Ko)</span>
              <input
                type="number"
                min={0}
                className="adv-input"
                defaultValue={Math.round(config.min_file_size_bytes / 1024)}
                onBlur={(e) => set("min_file_size_bytes", Number(e.target.value) * 1024)}
                disabled={disabled}
              />
            </label>
            <label className="adv-row">
              <span>Activer si au moins N images</span>
              <input
                type="number"
                min={1}
                className="adv-input"
                defaultValue={config.min_images_size_filter}
                onBlur={(e) => set("min_images_size_filter", Number(e.target.value))}
                disabled={disabled}
              />
            </label>
          </div>
          <div className="adv-section">
            <span className="adv-section-title">Filtre de ratio d'aspect</span>
            <label className="adv-row">
              <span>Tolérance (%)</span>
              <input
                type="number"
                min={0}
                max={100}
                className="adv-input"
                defaultValue={Math.round(config.aspect_ratio_tolerance * 100)}
                onBlur={(e) => set("aspect_ratio_tolerance", Number(e.target.value) / 100)}
                disabled={disabled}
              />
            </label>
            <label className="adv-row">
              <span>Activer si au moins N images</span>
              <input
                type="number"
                min={1}
                className="adv-input"
                defaultValue={config.min_images_aspect_filter}
                onBlur={(e) => set("min_images_aspect_filter", Number(e.target.value))}
                disabled={disabled}
              />
            </label>
          </div>
          <div className="adv-section">
            <span className="adv-section-title">Hash en 2 passes</span>
            <label className="adv-row">
              <span>Activer</span>
              <input
                type="checkbox"
                checked={config.two_pass_enabled}
                onChange={(e) => set("two_pass_enabled", e.target.checked)}
                disabled={disabled}
              />
            </label>
            <label className="adv-row">
              <span>Activer si au moins N images</span>
              <input
                type="number"
                min={1}
                className="adv-input"
                defaultValue={config.min_images_two_pass}
                onBlur={(e) => set("min_images_two_pass", Number(e.target.value))}
                disabled={disabled}
              />
            </label>
            <label className="adv-row">
              <span>Multiplicateur de seuil grossier</span>
              <input
                type="number"
                min={1}
                step={0.1}
                className="adv-input"
                defaultValue={config.coarse_threshold_multiplier}
                onBlur={(e) => set("coarse_threshold_multiplier", Number(e.target.value))}
                disabled={disabled}
              />
            </label>
          </div>
          <div className="adv-section">
            <span className="adv-section-title">Cache entre scans</span>
            <label className="adv-row">
              <span>Activer</span>
              <input
                type="checkbox"
                checked={config.cache_enabled}
                onChange={(e) => set("cache_enabled", e.target.checked)}
                disabled={disabled}
              />
            </label>
          </div>
          <div className="adv-section">
            <span className="adv-section-title">Comparaison parallèle</span>
            <label className="adv-row">
              <span>Activer</span>
              <input
                type="checkbox"
                checked={config.parallel_compare_enabled}
                onChange={(e) => set("parallel_compare_enabled", e.target.checked)}
                disabled={disabled}
              />
            </label>
            <label className="adv-row">
              <span>Activer si au moins N images</span>
              <input
                type="number"
                min={1}
                className="adv-input"
                defaultValue={config.min_images_parallel_compare}
                onBlur={(e) => set("min_images_parallel_compare", Number(e.target.value))}
                disabled={disabled}
              />
            </label>
          </div>
          <div className="adv-section">
            <span className="adv-section-title">Mode développeur</span>
            <label className="adv-row">
              <span>Enregistrer les métriques (phash_perf.jsonl)</span>
              <input
                type="checkbox"
                checked={config.perf_log_enabled}
                onChange={(e) => set("perf_log_enabled", e.target.checked)}
                disabled={disabled}
              />
            </label>
          </div>
        </div>
      )}
    </div>
  );
}

export default function App() {
  const [sessions, setSessions] = useState<ScanSummary[]>([]);
  const [summary, setSummary] = useState<ScanSummary | null>(null);
  const [groups, setGroups] = useState<DuplicateGroup[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [picking, setPicking] = useState(false);
  const [progress, setProgress] = useState<{ current: number; total: number; file?: string } | null>(null);
  const progressHistoryRef = useRef<{ time: number; current: number }[]>([]);
  const [folder, setFolder] = useState("");
  const [recursive, setRecursive] = useState(false);
  const [excluded, setExcluded] = useState<string[]>([
    "node_modules", ".git", "target", "dist", ".next",
    "__pycache__", ".cache", "vendor", "build", ".npm",
  ]);
  const [confirmPending, setConfirmPending] = useState(false);
  const [selecting, setSelecting] = useState(false);
  const [scanMode, setScanMode] = useState<"all" | "by_folder">("all");
  const [detectionMode, setDetectionMode] = useState<"files" | "images" | "videos">("files");
  const [simSimilarity, setSimSimilarity] = useState(100);
  const [videoSimilarity, setVideoSimilarity] = useState(100);
  const [phashConfig, setPhashConfig] = useState<PHashConfig>(DEFAULT_PHASH_CONFIG);
  const [videoConfig, setVideoConfig] = useState<VideoConfig>(DEFAULT_VIDEO_CONFIG);
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

  useEffect(() => {
    invoke<ScanSummary[]>("list_sessions")
      .then((s) => startTransition(() => setSessions(s)))
      .catch(() => {});
    invoke<PHashConfig>("get_phash_config")
      .then((cfg) => setPhashConfig(cfg))
      .catch(() => {});
    invoke<VideoConfig>("get_video_config")
      .then((cfg) => setVideoConfig(cfg))
      .catch(() => {});
  }, []);

  async function updatePhashConfig(cfg: PHashConfig) {
    setPhashConfig(cfg);
    try {
      await invoke("set_phash_config", { config: cfg });
    } catch {
      // best-effort
    }
  }

  async function updateVideoConfig(cfg: VideoConfig) {
    setVideoConfig(cfg);
    try {
      await invoke("set_video_config", { config: cfg });
    } catch {
      // best-effort
    }
  }

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
      // session pas encore chargée
    } finally {
      setLoadingMore(false);
    }
  }

  function resetResults() {
    setSummary(null);
    setGroups([]);
    setSelected(new Set());
    setFolderSummaries([]);
    setFolderState({});
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
      setFolderState((prev) => ({ ...prev, [folderKey]: { loading: false, hasMore: state?.hasMore ?? true, offset } }));
      setError(String(e));
    }
  }

  async function resumeSession(id: string) {
    try {
      const s = await invoke<ScanSummary>("load_session", { id });
      startTransition(() => {
        resetResults();
        setSummary(s);
        setFolder(s.folder);
        setError(null);
      });
      if (s.by_folder) {
        const summaries = await invoke<FolderSummary[]>("list_folder_keys");
        startTransition(() => setFolderSummaries(summaries));
      } else {
        await loadPage(0, false);
      }
    } catch (e) {
      setError(String(e));
    }
  }

  async function removeSession(id: string) {
    await invoke("delete_session", { id });
    startTransition(() => {
      setSessions((prev) => prev.filter((s) => s.id !== id));
      if (summary?.id === id) {
        resetResults();
      }
    });
  }

  async function cancelScan() {
    setCancelling(true);
    await invoke("cancel_scan");
  }

  async function pickFolder() {
    if (picking) return;
    setPicking(true);
    try {
      const dir = await open({ directory: true, multiple: false });
      if (typeof dir === "string") setFolder(dir);
    } finally {
      setPicking(false);
    }
  }

  async function scan() {
    if (!folder) return;
    setScanning(true);
    resetResults();
    setHasMore(false);
    setError(null);
    setProgress(null);
    progressHistoryRef.current = [];

    const unlisten = await listen<{ current: number; total: number; file?: string }>(
      "scan:progress",
      (event) => {
        const p = event.payload;
        progressHistoryRef.current.push({ time: Date.now(), current: p.current });
        setProgress(p);
      }
    );

    try {
      const effectiveRecursive = scanMode === "by_folder" ? true : recursive;
      const s = await invoke<ScanSummary>("scan_folder", {
        path: folder,
        recursive: effectiveRecursive,
        excluded,
        byFolder: scanMode === "by_folder",
        findSimilar: detectionMode === "images",
        simThreshold: Math.round((1 - simSimilarity / 100) * 64),
        findSimilarVideos: detectionMode === "videos",
        videoSimThreshold: Math.round((1 - videoSimilarity / 100) * 64),
      });
      setSummary(s);
      startTransition(() => setSessions((prev) => [s, ...prev]));
      if (s.by_folder) {
        const summaries = await invoke<FolderSummary[]>("list_folder_keys");
        setFolderSummaries(summaries);
      } else {
        await loadPage(0, false);
      }
    } catch (e) {
      setError(String(e));
    } finally {
      unlisten();
      setScanning(false);
      setCancelling(false);
      setProgress(null);
    }
  }

  function toggleFile(path: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }

  async function runSelection(cmd: string, params?: object) {
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

  function selectAllDuplicates() {
    return runSelection("select_all_duplicates");
  }

  function selectSmart(mode: "newest" | "oldest") {
    return runSelection("smart_select", { mode });
  }

  function clearSelection() {
    setSelected(new Set());
  }

  async function doDelete() {
    setConfirmPending(false);
    if (selected.size === 0) return;
    setDeleting(true);
    setError(null);
    try {
      await invoke("delete_files", { paths: Array.from(selected) });
      const deletedPaths = new Set(selected);
      const updatedGroups = groups
        .map((g) => ({ ...g, files: g.files.filter((f) => !deletedPaths.has(f.path)) }))
        .filter((g) => g.files.length > 1);
      const removedCount = groups.length - updatedGroups.length;
      startTransition(() => {
        setGroups(updatedGroups);
        setSummary((s) => s ? { ...s, total_groups: s.total_groups - removedCount } : null);
        setSelected(new Set());
      });
    } catch (e) {
      setError(String(e));
    } finally {
      setDeleting(false);
    }
  }

  const selectedSize = groups
    .flatMap((g) => g.files)
    .filter((f) => selected.has(f.path))
    .reduce((acc, f) => acc + f.size, 0);

  const showSessionPicker = !summary && !scanning && sessions.length > 0;
  const showResults = summary !== null && summary.total_groups > 0;

  return (
    <div className="app">
      <header className="header">
        <div className="header-top">
          <h1 className="title">Déduplicateur</h1>
          {summary && (
            <button
              className="btn-ghost"
              onClick={resetResults}
            >
              ← Mes analyses
            </button>
          )}
        </div>

        <div className="folder-row">
          <div
            className="folder-input"
            onClick={pickFolder}
            style={{ opacity: picking ? 0.5 : 1, pointerEvents: picking ? "none" : "auto" }}
          >
            <span className="folder-icon">📁</span>
            <span className="folder-path">{folder || "Cliquer pour choisir un dossier…"}</span>
          </div>
          <select
            className="select-mode"
            value={scanMode}
            onChange={(e) => setScanMode(e.target.value as "all" | "by_folder")}
            disabled={scanning}
          >
            <option value="all">Tout le dossier</option>
            <option value="by_folder">Par sous-dossier</option>
          </select>
          <label className="toggle-recursive" style={{ visibility: scanMode === "by_folder" ? "hidden" : "visible" }}>
            <input
              type="checkbox"
              checked={recursive}
              onChange={(e) => setRecursive(e.target.checked)}
              disabled={scanning || scanMode === "by_folder"}
            />
            Sous-dossiers
          </label>
          {scanning ? (
            <button className="btn-cancel" onClick={cancelScan} disabled={cancelling}>
              {cancelling
                ? <><span className="btn-spinner" /> Annulation…</>
                : "Annuler"}
            </button>
          ) : (
            <button className="btn-primary" onClick={scan} disabled={!folder}>Analyser</button>
          )}
        </div>

        <div className="similar-options-row">
          <div className="detection-mode-selector">
            {(["files", "images", "videos"] as const).map((mode) => (
              <button
                key={mode}
                className={`detection-mode-btn${detectionMode === mode ? " detection-mode-btn--active" : ""}`}
                onClick={() => setDetectionMode(mode)}
                disabled={scanning}
              >
                {mode === "files" ? "Fichiers" : mode === "images" ? "🖼 Images" : "🎬 Vidéos"}
              </button>
            ))}
          </div>
          {detectionMode === "images" && (
            <label className="slider-threshold">
              Similarité min&nbsp;: <strong>{simSimilarity}&nbsp;%</strong>
              <input
                type="range"
                min={60}
                max={100}
                step={1}
                value={simSimilarity}
                onChange={(e) => setSimSimilarity(Number(e.target.value))}
                disabled={scanning}
                className="threshold-slider"
              />
            </label>
          )}
          {detectionMode === "videos" && (
            <label className="slider-threshold">
              Similarité min&nbsp;: <strong>{videoSimilarity}&nbsp;%</strong>
              <input
                type="range"
                min={60}
                max={100}
                step={1}
                value={videoSimilarity}
                onChange={(e) => setVideoSimilarity(Number(e.target.value))}
                disabled={scanning}
                className="threshold-slider"
              />
            </label>
          )}
        </div>

        {detectionMode === "images" && (
          <AdvancedPanel config={phashConfig} onChange={updatePhashConfig} disabled={scanning} />
        )}
        {detectionMode === "videos" && (
          <VideoAdvancedPanel config={videoConfig} onChange={updateVideoConfig} disabled={scanning} />
        )}
        <ExclusionsPanel excluded={excluded} onChange={setExcluded} disabled={scanning} />

        {summary && (
          <div className="stats-row">
            <span className="stat"><strong>{summary.scanned_files}</strong> fichiers analysés</span>
            {summary.by_folder && (
              <span className="stat"><strong>{summary.total_folders}</strong> dossier{summary.total_folders > 1 ? "s" : ""}</span>
            )}
            <span className="stat"><strong>{summary.total_groups}</strong> groupes</span>
            <span className="stat waste"><strong>{formatSize(summary.total_wasted_bytes)}</strong> récupérables</span>
            <span className="stat duration">en {formatDuration(summary.duration_ms)}</span>
          </div>
        )}
      </header>

      {error && <div className="error-banner">{error}</div>}
      {summary?.partial && (
        <div className="partial-banner">
          Analyse annulée - résultats partiels affichés
        </div>
      )}

      {showSessionPicker && (
        <div className="session-list">
          <p className="session-list-title">Analyses précédentes</p>
          {sessions.map((s) => (
            <SessionCard
              key={s.id}
              session={s}
              active={false}
              onResume={resumeSession}
              onDelete={removeSession}
            />
          ))}
        </div>
      )}

      {showResults && (
        <>
          <div className="toolbar">
            <button className="btn-ghost" onClick={selectAllDuplicates} disabled={selecting}>Tout cocher</button>
            <button className="btn-ghost" onClick={() => selectSmart("newest")} disabled={selecting}>Garder le plus récent</button>
            <button className="btn-ghost" onClick={() => selectSmart("oldest")} disabled={selecting}>Garder le plus ancien</button>
            <button className="btn-ghost" onClick={clearSelection} disabled={selecting}>Désélectionner</button>
            {selected.size > 0 && !selecting && (
              <button className="btn-danger" onClick={() => setConfirmPending(true)} disabled={deleting}>
                {deleting
                  ? "Suppression…"
                  : `Supprimer ${selected.size} fichier${selected.size > 1 ? "s" : ""} (${formatSize(selectedSize)})`}
              </button>
            )}
            {selecting && (
              <span className="toolbar-loader">
                <span className="toolbar-spinner" />
                Calcul de la sélection…
              </span>
            )}
          </div>

          {summary?.by_folder && (
            <div className="folder-sort-bar">
              <span className="folder-sort-label">Trier par</span>
              <button
                className={`btn-sort${folderSort === "waste" ? " btn-sort--active" : ""}`}
                onClick={() => setFolderSort("waste")}
              >
                Taille récupérable
              </button>
              <button
                className={`btn-sort${folderSort === "name" ? " btn-sort--active" : ""}`}
                onClick={() => setFolderSort("name")}
              >
                Nom
              </button>
            </div>
          )}

          <div className="groups-list">
            {summary?.by_folder ? (
              sortedFolderSummaries.map((fs) => (
                <FolderSection
                  key={fs.folder_key}
                  summary={fs}
                  groups={groupsByFolder.get(fs.folder_key) ?? []}
                  loading={folderState[fs.folder_key]?.loading ?? false}
                  hasMore={folderState[fs.folder_key]?.hasMore ?? true}
                  selected={selected}
                  onToggle={toggleFile}
                  onExpand={() => loadFolderPage(fs.folder_key)}
                  onLoadMore={() => loadFolderPage(fs.folder_key)}
                />
              ))
            ) : (
              <>
                {groups.map((group) => (
                  <GroupCard key={group.id} group={group} selected={selected} onToggle={toggleFile} />
                ))}
                {hasMore && (
                  <button
                    className="btn-load-more"
                    onClick={() => loadPage(groups.length, true)}
                    disabled={loadingMore}
                  >
                    {loadingMore
                      ? "Chargement…"
                      : `Afficher 50 de plus (${summary!.total_groups - groups.length} restants)`}
                  </button>
                )}
              </>
            )}
          </div>
        </>
      )}

      {summary && summary.total_groups === 0 && (
        <div className="empty-state">
          <span className="empty-icon">✓</span>
          <p>Aucun doublon trouvé dans ce dossier.</p>
        </div>
      )}

      {!summary && !scanning && sessions.length === 0 && (
        <div className="empty-state">
          <span className="empty-icon">🔍</span>
          <p>Choisissez un dossier et lancez l'analyse.</p>
        </div>
      )}

      {scanning && (
        <div className="empty-state">
          {progress ? (
            <div className="progress-container">
              <p className="progress-label">
                Analyse en cours… {progress.current} / {progress.total} {detectionMode === "images" ? "images" : detectionMode === "videos" ? "vidéos" : "fichiers"}
              </p>
              <div className="progress-track">
                <div
                  className="progress-bar"
                  style={{ width: `${Math.round((progress.current / progress.total) * 100)}%` }}
                />
              </div>
              <p className="progress-pct">
                {Math.round((progress.current / progress.total) * 100)} %
                {(() => {
                  const pct = progress.current / progress.total;
                  const hist = progressHistoryRef.current;
                  const now = Date.now();
                  const elapsed = hist.length >= 2 ? now - hist[0].time : 0;

                  // "presque fini" uses recent rate (last ~20 samples)
                  const recentRef = hist.length >= 2 ? hist[Math.max(0, hist.length - 20)] : null;
                  const recentRate = recentRef ? (progress.current - recentRef.current) / (now - recentRef.time) : 0;
                  if (pct >= 0.95 || (recentRate > 0 && (progress.total - progress.current) / recentRate < 15_000)) {
                    return <span className="progress-eta"> - c'est presque fini</span>;
                  }

                  // warmup: before 2 min, show pessimistic estimate (x1.5) once we have 15s of data
                  if (elapsed < 120_000) {
                    if (elapsed < 15_000 || hist.length < 2) {
                      return <span className="progress-eta"> - estimation en cours…</span>;
                    }
                    const earlyRate = (progress.current - hist[0].current) / elapsed;
                    if (earlyRate <= 0) return <span className="progress-eta"> - estimation en cours…</span>;
                    const earlyRemainS = Math.round((progress.total - progress.current) / earlyRate / 1000 * 1.5);
                    if (earlyRemainS < 15) return null;
                    const earlyLabel = earlyRemainS < 60
                      ? `${earlyRemainS} s`
                      : `${Math.round(earlyRemainS / 60)} min`;
                    return <span className="progress-eta"> - environ {earlyLabel}</span>;
                  }

                  // rate from ~3 min ago to skip initial burst phase
                  const target = now - 180_000;
                  const refIdx = hist.findIndex(s => s.time >= target);
                  const ref = refIdx > 0 ? hist[refIdx] : hist[0];
                  const rate = (progress.current - ref.current) / (now - ref.time);
                  if (rate <= 0) return null;
                  const remainMs = (progress.total - progress.current) / rate;
                  const remainS = Math.round(remainMs / 1000);
                  if (remainS < 15) return null;
                  const label = remainS < 60
                    ? `${remainS} s`
                    : `${Math.round(remainS / 60)} min`;
                  return <span className="progress-eta"> - environ {label}</span>;
                })()}
              </p>
              {progress.file && (
                <p className="progress-filename">{progress.file}</p>
              )}
            </div>
          ) : (
            <>
              <div className="spinner" />
              <p>Collecte des fichiers…</p>
            </>
          )}
        </div>
      )}

      {confirmPending && (
        <div className="modal-overlay" onClick={() => setConfirmPending(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2 className="modal-title">Confirmer la suppression</h2>
            <p className="modal-body">
              {selected.size} fichier{selected.size > 1 ? "s" : ""} ({formatSize(selectedSize)}) seront
              envoyés dans la corbeille.
            </p>
            <div className="modal-actions">
              <button className="btn-ghost" onClick={() => setConfirmPending(false)}>Annuler</button>
              <button className="btn-danger" onClick={doDelete}>Supprimer</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
