import { useState, useEffect, useMemo } from "react";
import { useLang } from "../LangContext";
import type { IgnoreEntry } from "../types";

function formatIgnoreDate(ts: number): string {
  return new Date(ts * 1000).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

type SortMode = "date" | "name";

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
  const [search, setSearch] = useState("");
  const [sortMode, setSortMode] = useState<SortMode>("date");

  // Escape ferme le drawer.
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const visibleEntries = useMemo(() => {
    const q = search.trim().toLowerCase();
    const filtered = q
      ? entries.filter((e) => e.display_names.some((n) => n.toLowerCase().includes(q)))
      : entries;
    const sorted = [...filtered];
    if (sortMode === "name") {
      sorted.sort((a, b) => (a.display_names[0] ?? "").localeCompare(b.display_names[0] ?? ""));
    } else {
      // Date : plus recents en premier.
      sorted.sort((a, b) => b.ignored_at - a.ignored_at);
    }
    return sorted;
  }, [entries, search, sortMode]);

  return (
    <div className="ignored-container" data-testid="ignored-panel">
      <button className="btn-ghost" onClick={() => setOpen((v) => !v)}>
        {t.ignoredGroups}
        {entries.length > 0 && <span className="ignored-badge">{entries.length}</span>}
      </button>
      {open && (
        <>
          <div className="ignored-overlay" onClick={() => setOpen(false)} />
          <div className="ignored-drawer" data-testid="ignored-drawer">
            <div className="ignored-drawer-header">
              <span className="ignored-drawer-title">
                {t.ignoredGroups}{entries.length > 0 ? ` (${entries.length})` : ""}
              </span>
              <button className="btn-ghost btn-sm" onClick={() => setOpen(false)} aria-label="Close">✕</button>
            </div>

            {entries.length > 0 && (
              <div className="ignored-drawer-toolbar">
                <input
                  className="ignored-search filter-input"
                  placeholder={t.helpSearch}
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  data-testid="ignored-search"
                />
                <div className="ignored-sort">
                  <span className="ignored-sort-label">{t.sortBy}</span>
                  <button
                    className={`ignored-sort-btn${sortMode === "date" ? " ignored-sort-btn--active" : ""}`}
                    onClick={() => setSortMode("date")}
                  >{t.sortDate}</button>
                  <button
                    className={`ignored-sort-btn${sortMode === "name" ? " ignored-sort-btn--active" : ""}`}
                    onClick={() => setSortMode("name")}
                  >{t.sortName}</button>
                </div>
              </div>
            )}

            <div className="ignored-drawer-body">
              {entries.length === 0 ? (
                <p className="ignored-panel-empty">{t.noIgnoredGroups}</p>
              ) : visibleEntries.length === 0 ? (
                <p className="ignored-panel-empty">{t.helpNoResults}</p>
              ) : (
                <ul className="ignored-list">
                  {visibleEntries.map((entry) => (
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

            {entries.length > 0 && (
              <div className="ignored-drawer-footer">
                <button
                  className="btn-ghost btn-sm"
                  onClick={onClearAll}
                  data-testid="clear-all-ignored"
                >
                  {t.clearAllIgnored}
                </button>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
