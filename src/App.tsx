import { useState, startTransition, useEffect, useMemo } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import "./App.css";
import { formatSize, dirname } from "./utils";

interface DuplicateFile {
  path: string;
  size: number;
  name: string;
  modified: number;
}

interface DuplicateGroup {
  id: string;
  hash: string;
  size: number;
  files: DuplicateFile[];
  folder_key?: string;
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
}

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

function GroupCard({
  group,
  selected,
  onToggle,
}: {
  group: DuplicateGroup;
  selected: Set<string>;
  onToggle: (path: string) => void;
}) {
  const [expanded, setExpanded] = useState(true);

  return (
    <div className="group-card">
      <button className="group-header" onClick={() => setExpanded((v) => !v)}>
        <span className="group-chevron">{expanded ? "▾" : "▸"}</span>
        <span className="group-count">{group.files.length} fichiers identiques</span>
        <span className="group-size">{formatSize(group.size)} chacun</span>
        <span className="group-waste">
          {formatSize(group.size * (group.files.length - 1))} en double
        </span>
      </button>

      {expanded && (
        <div className="group-files">
          <div className="file-row-header">
            <span className="file-col-cb" />
            <span className="file-col-name">Nom</span>
            <span className="file-col-date">Modifié</span>
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
              <span className="file-col-dir file-meta">{dirname(file.path)}</span>
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
  const [picking, setPicking] = useState(false);
  const [progress, setProgress] = useState<{ current: number; total: number } | null>(null);
  const [folder, setFolder] = useState("");
  const [recursive, setRecursive] = useState(false);
  const [excluded, setExcluded] = useState<string[]>([
    "node_modules", ".git", "target", "dist", ".next",
    "__pycache__", ".cache", "vendor", "build", ".npm",
  ]);
  const [confirmPending, setConfirmPending] = useState(false);
  const [selecting, setSelecting] = useState(false);
  const [scanMode, setScanMode] = useState<"all" | "by_folder">("all");
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
  }, []);

  async function loadPage(offset: number, append: boolean) {
    setLoadingMore(true);
    try {
      const page = await invoke<GroupsPage>("get_groups_page", { offset, limit: 50 });
      startTransition(() => {
        setGroups((prev) => (append ? [...prev, ...page.groups] : page.groups));
        setHasMore(page.has_more);
      });
    } catch {
      // session pas encore chargée
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
      setFolderState((prev) => ({ ...prev, [folderKey]: { loading: false, hasMore: state?.hasMore ?? true, offset } }));
      setError(String(e));
    }
  }

  async function resumeSession(id: string) {
    try {
      const s = await invoke<ScanSummary>("load_session", { id });
      startTransition(() => {
        setSummary(s);
        setFolder(s.folder);
        setGroups([]);
        setSelected(new Set());
        setError(null);
        setFolderSummaries([]);
        setFolderState({});
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
        setSummary(null);
        setGroups([]);
        setSelected(new Set());
        setFolderSummaries([]);
        setFolderState({});
      }
    });
  }

  async function cancelScan() {
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
    setSummary(null);
    setGroups([]);
    setHasMore(false);
    setSelected(new Set());
    setError(null);
    setProgress(null);
    setFolderSummaries([]);
    setFolderState({});

    const unlisten = await listen<{ current: number; total: number }>(
      "scan:progress",
      (event) => setProgress(event.payload)
    );

    try {
      const effectiveRecursive = scanMode === "by_folder" ? true : recursive;
      const s = await invoke<ScanSummary>("scan_folder", {
        path: folder,
        recursive: effectiveRecursive,
        excluded,
        byFolder: scanMode === "by_folder",
      });
      startTransition(() => {
        setSummary(s);
        setSessions((prev) => [s, ...prev]);
      });
      if (s.by_folder) {
        const summaries = await invoke<FolderSummary[]>("list_folder_keys");
        startTransition(() => setFolderSummaries(summaries));
      } else {
        await loadPage(0, false);
      }
    } catch (e) {
      if (String(e) !== "cancelled") setError(String(e));
    } finally {
      unlisten();
      setScanning(false);
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

  async function selectAllDuplicates() {
    if (selecting) return;
    setSelecting(true);
    try {
      const paths = await invoke<string[]>("select_all_duplicates");
      startTransition(() => setSelected(new Set(paths)));
    } catch (e) {
      setError(String(e));
    } finally {
      setSelecting(false);
    }
  }

  async function selectSmart(mode: "newest" | "oldest") {
    if (selecting) return;
    setSelecting(true);
    try {
      const paths = await invoke<string[]>("smart_select", { mode });
      startTransition(() => setSelected(new Set(paths)));
    } catch (e) {
      setError(String(e));
    } finally {
      setSelecting(false);
    }
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
              onClick={() => { setSummary(null); setGroups([]); setSelected(new Set()); setFolderSummaries([]); setFolderState({}); }}
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
            <button className="btn-cancel" onClick={cancelScan}>Annuler</button>
          ) : (
            <button className="btn-primary" onClick={scan} disabled={!folder}>Analyser</button>
          )}
        </div>

        <ExclusionsPanel excluded={excluded} onChange={setExcluded} disabled={scanning} />

        {summary && (
          <div className="stats-row">
            <span className="stat"><strong>{summary.scanned_files}</strong> fichiers analysés</span>
            {summary.by_folder && (
              <span className="stat"><strong>{summary.total_folders}</strong> dossier{summary.total_folders > 1 ? "s" : ""}</span>
            )}
            <span className="stat"><strong>{summary.total_groups}</strong> groupes</span>
            <span className="stat waste"><strong>{formatSize(summary.total_wasted_bytes)}</strong> récupérables</span>
            <span className="stat duration">en {summary.duration_ms} ms</span>
          </div>
        )}
      </header>

      {error && <div className="error-banner">{error}</div>}

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
                Analyse en cours… {progress.current} / {progress.total} fichiers
              </p>
              <div className="progress-track">
                <div
                  className="progress-bar"
                  style={{ width: `${Math.round((progress.current / progress.total) * 100)}%` }}
                />
              </div>
              <p className="progress-pct">{Math.round((progress.current / progress.total) * 100)} %</p>
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
