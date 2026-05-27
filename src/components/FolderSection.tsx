import { useState, useRef, useEffect } from "react";
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
  onIgnore,
  onCompare,
  onCompareVideo,
  onCompareAudio,
}: {
  summary: FolderSummary;
  groups: DuplicateGroup[];
  loading: boolean;
  hasMore: boolean;
  selected: Set<string>;
  onToggle: (path: string) => void;
  onExpand: () => void;
  onLoadMore: () => void;
  onIgnore?: (groupId: string) => void;
  onCompare?: (group: DuplicateGroup) => void;
  onCompareVideo?: (group: DuplicateGroup) => void;
  onCompareAudio?: (group: DuplicateGroup) => void;
}) {
  const { t } = useLang();
  const [expanded, setExpanded] = useState(false);
  const sectionRef = useRef<HTMLDivElement>(null);
  const headerRef = useRef<HTMLButtonElement>(null);

  // Mesure la hauteur reelle du bandeau de dossier et l'expose en CSS var
  // `--folder-header-h` sur la section. Le bandeau de groupe (sticky) se cale
  // exactement dessous via `top: var(--folder-header-h)`. Sans cette mesure,
  // une valeur en dur (ex. 40px) laisse une fine bande ou le contenu defilant
  // transparait entre les deux bandeaux sticky (hauteur reelle != valeur figee).
  useEffect(() => {
    const header = headerRef.current;
    const section = sectionRef.current;
    if (!header || !section) return;
    const apply = () => {
      section.style.setProperty("--folder-header-h", `${header.offsetHeight}px`);
    };
    apply();
    const ro = new ResizeObserver(apply);
    ro.observe(header);
    return () => ro.disconnect();
  }, []);

  function toggle() {
    const next = !expanded;
    setExpanded(next);
    if (next && groups.length === 0 && !loading) onExpand();
  }

  return (
    <div className="folder-section" ref={sectionRef}>
      <button className="folder-section-header" ref={headerRef} onClick={toggle}>
        <span className="folder-section-chevron">{expanded ? "▾" : "▸"}</span>
        <span className="folder-section-name" title={summary.folder_key === "" ? t.rootFolder : summary.folder_key}>
          📁 {summary.folder_key === "" ? <em data-testid="root-folder-label">{t.rootFolder}</em> : summary.folder_key}
        </span>
        <span className="folder-section-stats">
          {summary.group_count} {summary.group_count > 1 ? t.groups : t.group} · {formatSize(summary.total_wasted_bytes)} {t.duplicate}
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
            <GroupCard
              key={group.id}
              group={group}
              selected={selected}
              onToggle={onToggle}
              onCompare={onCompare ? () => onCompare(group) : undefined}
              onCompareVideo={onCompareVideo ? () => onCompareVideo(group) : undefined}
              onCompareAudio={onCompareAudio ? () => onCompareAudio(group) : undefined}
              onIgnore={onIgnore ? () => onIgnore(group.id) : undefined}
            />
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
