import { useState, useMemo } from "react";
import type { DuplicateFile, DuplicateGroup } from "../types";
import { useLang } from "../LangContext";
import { formatSize, dirname, formatDate, formatDurationSecs, VIDEO_EXTS, IMAGE_EXTS, fileExt } from "../utils";
import { revealInFolder } from "../fileActions";
import { FileThumbnail } from "./FileThumbnail";

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
          {sortedFiles.map((file: DuplicateFile, idx: number) => (
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
