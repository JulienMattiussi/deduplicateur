import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import "./App.css";

interface DuplicateFile {
  path: string;
  size: number;
  name: string;
}

interface DuplicateGroup {
  id: string;
  hash: string;
  size: number;
  files: DuplicateFile[];
}

interface ScanResult {
  groups: DuplicateGroup[];
  total_wasted_bytes: number;
  scanned_files: number;
  duration_ms: number;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} o`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} Ko`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} Mo`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} Go`;
}

function dirname(path: string): string {
  const sep = path.includes("/") ? "/" : "\\";
  const parts = path.split(sep);
  parts.pop();
  return parts.join(sep) || sep;
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
        <span className="group-count">
          {group.files.length} fichiers identiques
        </span>
        <span className="group-size">{formatSize(group.size)} chacun</span>
        <span className="group-waste">
          {formatSize(group.size * (group.files.length - 1))} en double
        </span>
      </button>

      {expanded && (
        <div className="group-files">
          {group.files.map((file, idx) => (
            <div
              key={file.path}
              className={`file-row ${selected.has(file.path) ? "file-row--checked" : ""}`}
              onClick={() => onToggle(file.path)}
              style={{ display: "flex", alignItems: "center", gap: "12px", padding: "10px 16px", cursor: "pointer", borderBottom: "1px solid #1a1a1a" }}
            >
              <input
                type="checkbox"
                checked={selected.has(file.path)}
                onChange={() => onToggle(file.path)}
                onClick={(e) => e.stopPropagation()}
                style={{ width: "15px", height: "15px", flexShrink: 0 }}
              />
              <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: "2px" }}>
                <div style={{ color: "#e0e0e0", fontSize: "13px", fontWeight: 500, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{file.name}</div>
                <div style={{ color: "#888", fontSize: "11px", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{dirname(file.path)}</div>
              </div>
              {idx === 0 && (
                <span className="badge-original">original</span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function App() {
  const [folder, setFolder] = useState<string>("");
  const [scanning, setScanning] = useState(false);
  const [result, setResult] = useState<ScanResult | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [picking, setPicking] = useState(false);

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
    setResult(null);
    setSelected(new Set());
    setError(null);
    try {
      const res = await invoke<ScanResult>("scan_folder", { path: folder });
      setResult(res);
    } catch (e) {
      setError(String(e));
    } finally {
      setScanning(false);
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

  function selectAllDuplicates() {
    if (!result) return;
    const paths = new Set<string>();
    for (const group of result.groups) {
      group.files.slice(1).forEach((f) => paths.add(f.path));
    }
    setSelected(paths);
  }

  function clearSelection() {
    setSelected(new Set());
  }

  async function deleteSelected() {
    if (selected.size === 0) return;
    setDeleting(true);
    setError(null);
    try {
      await invoke("delete_files", { paths: Array.from(selected) });
      setResult((prev) => {
        if (!prev) return null;
        const groups = prev.groups
          .map((g) => ({
            ...g,
            files: g.files.filter((f) => !selected.has(f.path)),
          }))
          .filter((g) => g.files.length > 1);
        const wasted = groups.reduce(
          (acc, g) => acc + g.size * (g.files.length - 1),
          0
        );
        return { ...prev, groups, total_wasted_bytes: wasted };
      });
      setSelected(new Set());
    } catch (e) {
      setError(String(e));
    } finally {
      setDeleting(false);
    }
  }

  const selectedSize = result
    ? result.groups
        .flatMap((g) => g.files)
        .filter((f) => selected.has(f.path))
        .reduce((acc, f) => acc + f.size, 0)
    : 0;

  return (
    <div className="app">
      <header className="header">
        <h1 className="title">Déduplicateur</h1>

        <div className="folder-row">
          <div className="folder-input" onClick={pickFolder} style={{ opacity: picking ? 0.5 : 1, pointerEvents: picking ? "none" : "auto" }}>
            <span className="folder-icon">📁</span>
            <span className="folder-path">
              {folder || "Cliquer pour choisir un dossier…"}
            </span>
          </div>
          <button
            className="btn-primary"
            onClick={scan}
            disabled={!folder || scanning}
          >
            {scanning ? "Analyse…" : "Analyser"}
          </button>
        </div>

        {result && (
          <div className="stats-row">
            <span className="stat">
              <strong>{result.scanned_files}</strong> fichiers analysés
            </span>
            <span className="stat">
              <strong>{result.groups.length}</strong> groupes de doublons
            </span>
            <span className="stat waste">
              <strong>{formatSize(result.total_wasted_bytes)}</strong> récupérables
            </span>
            <span className="stat duration">en {result.duration_ms} ms</span>
          </div>
        )}
      </header>

      {error && <div className="error-banner">{error}</div>}

      {result && result.groups.length > 0 && (
        <>
          <div className="toolbar">
            <button className="btn-ghost" onClick={selectAllDuplicates}>
              Sélectionner les doublons
            </button>
            <button className="btn-ghost" onClick={clearSelection}>
              Tout désélectionner
            </button>
            {selected.size > 0 && (
              <button
                className="btn-danger"
                onClick={deleteSelected}
                disabled={deleting}
              >
                {deleting
                  ? "Suppression…"
                  : `Supprimer ${selected.size} fichier${selected.size > 1 ? "s" : ""} (${formatSize(selectedSize)})`}
              </button>
            )}
          </div>

          <div className="groups-list">
            {result.groups.map((group) => (
              <GroupCard
                key={group.id}
                group={group}
                selected={selected}
                onToggle={toggleFile}
              />
            ))}
          </div>
        </>
      )}

      {result && result.groups.length === 0 && (
        <div className="empty-state">
          <span className="empty-icon">✓</span>
          <p>Aucun doublon trouvé dans ce dossier.</p>
        </div>
      )}

      {!result && !scanning && (
        <div className="empty-state">
          <span className="empty-icon">🔍</span>
          <p>Choisissez un dossier et lancez l'analyse.</p>
        </div>
      )}

      {scanning && (
        <div className="empty-state">
          <div className="spinner" />
          <p>Analyse en cours…</p>
        </div>
      )}
    </div>
  );
}
