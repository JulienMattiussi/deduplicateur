import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useLang } from "./LangContext";
import { formatSize } from "./utils";
import type { ArchiveComparison, ArchiveEntryResult } from "./types";

interface Props {
  pathA: string;
  pathB: string;
  onClose: () => void;
}

function basename(p: string): string {
  return p.split(/[\\/]/).pop() ?? p;
}

function EntryRow({ entry }: { entry: ArchiveEntryResult }) {
  const { t } = useLang();
  const isDuplicate = entry.status === "duplicate";
  return (
    <div className={`archive-entry-row${isDuplicate ? " archive-entry-row--duplicate" : " archive-entry-row--unique"}`}>
      <span className={`badge${isDuplicate ? " badge-ref" : " archive-badge-unique"}`}>
        {isDuplicate ? t.archiveDuplicate : t.archiveUnique}
      </span>
      <span className={`archive-entry-internal-path${isDuplicate ? "" : " archive-entry-muted"}`}>
        {entry.internal_path}
      </span>
      <span className="archive-entry-size">{formatSize(entry.size)}</span>
      {entry.duplicate_in && (
        <span className="archive-entry-dup-in" title={entry.duplicate_in}>
          {basename(entry.duplicate_in)}
        </span>
      )}
    </div>
  );
}

export function ArchiveComparator({ pathA, pathB, onClose }: Props) {
  const { t } = useLang();
  const [comparison, setComparison] = useState<ArchiveComparison | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    setComparison(null);
    invoke<ArchiveComparison>("get_archive_comparison", { pathA, pathB })
      .then((c) => { setComparison(c); setLoading(false); })
      .catch(() => setLoading(false));
  }, [pathA, pathB]);

  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [onClose]);

  return (
    <div className="comparator-overlay" onClick={onClose} data-testid="archive-comparator-overlay">
      <div className="comparator-panel archive-comparator-panel" onClick={(e) => e.stopPropagation()}>
        <div className="comparator-header">
          <span className="comparator-title">{t.archiveComparator}</span>
          <button className="comparator-close-btn" onClick={onClose} data-testid="archive-comparator-close">
            ×
          </button>
        </div>
        {loading ? (
          <div className="archive-comparator-loading">
            <span className="file-thumb-spinner comparator-spin" />
          </div>
        ) : comparison ? (
          <div className="comparator-body archive-comparator-body" data-testid="archive-comparator-body">
            <div className="comparator-panel archive-col">
              <div className="archive-col-header" title={comparison.a.path}>
                {basename(comparison.a.path)}
              </div>
              <div className="archive-col-entries">
                {comparison.a.entries.length === 0 ? (
                  <span className="archive-empty-label">-</span>
                ) : (
                  comparison.a.entries.map((entry, i) => (
                    <EntryRow key={i} entry={entry} />
                  ))
                )}
              </div>
            </div>
            <div className="comparator-divider" />
            <div className="comparator-panel archive-col">
              <div className="archive-col-header" title={comparison.b.path}>
                {basename(comparison.b.path)}
              </div>
              <div className="archive-col-entries">
                {comparison.b.entries.length === 0 ? (
                  <span className="archive-empty-label">-</span>
                ) : (
                  comparison.b.entries.map((entry, i) => (
                    <EntryRow key={i} entry={entry} />
                  ))
                )}
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
