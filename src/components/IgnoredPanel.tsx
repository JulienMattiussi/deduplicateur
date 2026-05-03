import { useRef, useState, useEffect } from "react";
import { useLang } from "../LangContext";
import type { IgnoreEntry } from "../types";

function formatIgnoreDate(ts: number): string {
  return new Date(ts * 1000).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export function IgnoredPanel({
  entries,
  onRemove,
  onClearAll,
}: {
  entries: IgnoreEntry[];
  onRemove: (key: string) => void;
  onClearAll: () => void;
}) {
  const { t } = useLang();
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    if (open) document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [open]);

  return (
    <div className="ignored-container" ref={containerRef} data-testid="ignored-panel">
      <button className="btn-ghost" onClick={() => setOpen((v) => !v)}>
        {t.ignoredGroups}
        {entries.length > 0 && <span className="ignored-badge">{entries.length}</span>}
      </button>
      {open && (
        <div className="ignored-dropdown">
          <div className="ignored-dropdown-header">
            <span className="ignored-dropdown-title">{t.ignoredGroups}</span>
            {entries.length > 0 && (
              <button
                className="btn-ghost btn-sm"
                onClick={onClearAll}
                data-testid="clear-all-ignored"
              >
                {t.clearAllIgnored}
              </button>
            )}
          </div>
          {entries.length === 0 ? (
            <p className="ignored-panel-empty">{t.noIgnoredGroups}</p>
          ) : (
            <ul className="ignored-list">
              {entries.map((entry) => (
                <li key={entry.key} className="ignored-entry" data-testid="ignored-entry">
                  <div className="ignored-entry-info">
                    <span className="ignored-names">{entry.display_names.join(", ")}</span>
                    <span className="ignored-date">{t.ignoredAt} {formatIgnoreDate(entry.ignored_at)}</span>
                  </div>
                  <button
                    className="btn-ghost btn-sm"
                    onClick={() => onRemove(entry.key)}
                    data-testid="remove-ignored"
                  >
                    {t.removeFromIgnored}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
