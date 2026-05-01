import { useState } from "react";
import type { FolderSummary, DuplicateGroup } from "../types";
import { useLang } from "../LangContext";
import { interp } from "../i18n";
import { formatSize } from "../utils";
import { GroupCard } from "./GroupCard";

export function FolderSection({
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
