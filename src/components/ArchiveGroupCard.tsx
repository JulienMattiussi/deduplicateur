import { useState } from "react";
import { useLang } from "../LangContext";
import { formatSize, formatDate, dirname } from "../utils";
import { revealInFolder } from "../fileActions";
import { FileThumbnail } from "./FileThumbnail";
import type { ArchiveGroupResult, ArchiveInGroup, DuplicateFile } from "../types";

interface Props {
  group: ArchiveGroupResult;
  selected: Set<string>;
  onToggle: (path: string) => void;
  onCompare: (a: ArchiveInGroup, b: ArchiveInGroup) => void;
}

function basename(p: string): string {
  return p.split(/[\\/]/).pop() ?? p;
}

function FolderIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 14" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path
        d="M0.75 3C0.75 2.17 1.42 1.5 2.25 1.5H6.25L7.75 3H13.75C14.58 3 15.25 3.67 15.25 4.5V11.5C15.25 12.33 14.58 13 13.75 13H2.25C1.42 13 0.75 12.33 0.75 11.5V3Z"
        stroke="currentColor" strokeWidth="1.25" fill="none"
      />
    </svg>
  );
}

function archiveAsFile(a: ArchiveInGroup): DuplicateFile {
  return {
    path: a.path,
    name: basename(a.path),
    size: a.size,
    modified: a.modified,
  };
}

export function ArchiveGroupCard({ group, selected, onToggle, onCompare }: Props) {
  const { t } = useLang();
  const [expanded, setExpanded] = useState(true);
  const { archives, shared_entry_count } = group;
  const wastedTotal = archives.reduce((acc, a) => acc + a.wasted_bytes, 0);
  const allFullyDuplicated = archives.length > 0 && archives.every((a) => a.can_delete);
  const anyDeletable = archives.some((a) => a.can_delete);

  function handleCompareClick(e: React.MouseEvent) {
    e.stopPropagation();
    onCompare(archives[0], archives[1]);
  }

  return (
    <div className="group-card archive-group-card" data-testid="archive-group-card">
      <div className="group-header" onClick={() => setExpanded((v) => !v)}>
        <span className="group-chevron">{expanded ? "▾" : "▸"}</span>
        <span className="group-count">
          📦 {archives.length} {t.archiveLabel} {allFullyDuplicated ? t.identical : `- ${shared_entry_count} ${t.archiveSharedFiles}`}
        </span>
        {archives.length >= 2 && (
          <button className="btn-compare" onClick={handleCompareClick}>
            {t.compare}
          </button>
        )}
        {wastedTotal > 0 && (
          <span className="group-waste">
            {formatSize(wastedTotal)} {t.duplicate}
          </span>
        )}
      </div>

      {expanded && (
        <div className="group-files" data-testid="archive-group-files">
          <div className="file-row-header">
            <span className="file-col-cb" />
            <span className="file-col-thumb" />
            <span className="file-col-name">{t.colName}</span>
            <span className="file-col-date">{t.colModified}</span>
            <span className="file-col-size">{t.colSize}</span>
            <span className="file-col-video-meta">{t.archiveEntries}</span>
            <span className="file-col-dir">{t.colFolder}</span>
            <span className="file-col-badge" />
          </div>
          {archives.map((archive) => {
            const fileDir = dirname(archive.path);
            const fakeFile = archiveAsFile(archive);
            const isChecked = selected.has(archive.path);
            const canSelect = archive.can_delete;
            return (
              <div
                key={archive.path}
                className={`file-row file-row--media ${isChecked ? "file-row--checked" : ""}`}
                onClick={() => { if (canSelect) onToggle(archive.path); }}
              >
                <span
                  className={`file-col-cb${!canSelect ? " file-col-cb--no-delete" : ""}`}
                  title={!canSelect ? t.archiveCannotDeleteTooltip : undefined}
                  aria-label={!canSelect ? t.archiveCannotDeleteTooltip : undefined}
                  onClick={(e) => { if (!canSelect) e.stopPropagation(); }}
                >
                  {canSelect ? (
                    <input
                      type="checkbox"
                      data-testid="archive-row-checkbox"
                      checked={isChecked}
                      onChange={() => onToggle(archive.path)}
                      onClick={(e) => e.stopPropagation()}
                    />
                  ) : (
                    <span
                      className="archive-no-delete-icon"
                      data-testid="archive-no-delete-icon"
                    >
                      <svg width="14" height="14" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                        <circle cx="8" cy="8" r="6.5" stroke="currentColor" strokeWidth="1.5" />
                        <line x1="3.5" y1="12.5" x2="12.5" y2="3.5" stroke="currentColor" strokeWidth="1.5" />
                      </svg>
                    </span>
                  )}
                </span>
                <span className="file-col-thumb">
                  <FileThumbnail file={fakeFile} mode="other" />
                </span>
                <span className="file-col-name file-name">{basename(archive.path)}</span>
                <span className="file-col-date file-meta">{formatDate(archive.modified, t.dateLocale)}</span>
                <span className="file-col-size file-meta">{formatSize(archive.size)}</span>
                <span className="file-col-video-meta file-meta">
                  {archive.duplicated_entries}/{archive.total_entries} {t.archiveEntries}
                </span>
                <span className="file-col-dir">
                  <span className="file-col-dir-text file-meta" title={fileDir}>
                    {fileDir}
                  </span>
                  <button
                    className="btn-reveal"
                    onClick={(e) => { e.stopPropagation(); revealInFolder(archive.path); }}
                    title={t.openInExplorer}
                  >
                    <FolderIcon />
                  </button>
                </span>
                <span className="file-col-badge">
                  {archive.can_delete && (
                    <span className="badge-ref archive-badge-deletable">{t.archiveCanDelete}</span>
                  )}
                </span>
              </div>
            );
          })}
        </div>
      )}
      {!anyDeletable && null}
    </div>
  );
}
