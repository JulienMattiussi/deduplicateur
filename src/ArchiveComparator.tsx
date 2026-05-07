import { useState, useEffect, useMemo, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useLang } from "./LangContext";
import { formatSize, formatDate, dirname, basename } from "./utils";
import { revealInFolder } from "./fileActions";
import { FileTypeIcon } from "./components/FileThumbnail";
import { ComparatorBasicShell } from "./comparatorShared";
import type { ArchiveComparison, ArchiveEntryResult, ArchiveInGroup } from "./types";

interface Props {
  archiveA: ArchiveInGroup;
  archiveB: ArchiveInGroup;
  onClose: () => void;
}

interface AlignedRow {
  left: ArchiveEntryResult | null;
  right: ArchiveEntryResult | null;
  isDuplicate: boolean;
}

/**
 * Apparie les entrees de deux archives pour un affichage face-a-face :
 * - groupe par hash, fait un appariement greedy index-a-index a l'interieur d'un meme hash
 *   (ex. si A a 3 fichiers de hash X et B en a 1, on a 3 lignes avec right=null sur 2 d'entre elles)
 * - les uniques (hash present d'un seul cote) sont en bas, dans une seule colonne
 */
function alignEntries(a: ArchiveEntryResult[], b: ArchiveEntryResult[]): AlignedRow[] {
  const byHash = (list: ArchiveEntryResult[]) => {
    const m = new Map<string, ArchiveEntryResult[]>();
    for (const e of list) {
      const arr = m.get(e.hash);
      if (arr) arr.push(e); else m.set(e.hash, [e]);
    }
    // Tri stable par chemin interne pour que l'ordre soit reproductible
    for (const arr of m.values()) arr.sort((x, y) => x.internal_path.localeCompare(y.internal_path));
    return m;
  };
  const aByHash = byHash(a);
  const bByHash = byHash(b);

  const rows: AlignedRow[] = [];

  // Hashes presents des deux cotes (= doublons), tries par chemin du 1er element
  const sharedHashes = [...aByHash.keys()]
    .filter((h) => bByHash.has(h))
    .sort((h1, h2) => {
      const p1 = aByHash.get(h1)![0].internal_path;
      const p2 = aByHash.get(h2)![0].internal_path;
      return p1.localeCompare(p2);
    });
  for (const hash of sharedHashes) {
    const listA = aByHash.get(hash)!;
    const listB = bByHash.get(hash)!;
    const max = Math.max(listA.length, listB.length);
    for (let i = 0; i < max; i++) {
      rows.push({ left: listA[i] ?? null, right: listB[i] ?? null, isDuplicate: true });
    }
  }

  // Uniques cote A (hash absent cote B)
  const uniqueAHashes = [...aByHash.keys()].filter((h) => !bByHash.has(h));
  const uniqueA = uniqueAHashes.flatMap((h) => aByHash.get(h)!)
    .sort((x, y) => x.internal_path.localeCompare(y.internal_path));
  for (const ea of uniqueA) rows.push({ left: ea, right: null, isDuplicate: false });

  // Uniques cote B (hash absent cote A)
  const uniqueBHashes = [...bByHash.keys()].filter((h) => !aByHash.has(h));
  const uniqueB = uniqueBHashes.flatMap((h) => bByHash.get(h)!)
    .sort((x, y) => x.internal_path.localeCompare(y.internal_path));
  for (const eb of uniqueB) rows.push({ left: null, right: eb, isDuplicate: false });

  return rows;
}

function EntryCell({ entry }: { entry: ArchiveEntryResult | null }) {
  if (!entry) return <span className="archive-row-empty" />;
  return (
    <span className="archive-row-content">
      <span className="archive-row-icon"><FileTypeIcon path={entry.internal_path} /></span>
      <span className="archive-row-path" title={entry.internal_path}>{entry.internal_path}</span>
      <span className="archive-row-size">{formatSize(entry.size)}</span>
    </span>
  );
}

function ArchiveMetaBlock({ archive }: { archive: ArchiveInGroup }) {
  const { t } = useLang();
  return (
    <div className="comparator-meta">
      <div className="comparator-meta-row">
        <span className="comparator-meta-label">{t.colName}</span>
        <span className="comparator-meta-value comparator-meta-filename">{basename(archive.path)}</span>
      </div>
      <div className="comparator-meta-row">
        <span className="comparator-meta-label">{t.colFolder}</span>
        <span className="comparator-meta-value comparator-meta-path" title={archive.path}>{dirname(archive.path)}</span>
        <button
          className="btn-ghost btn-sm comparator-reveal-btn"
          title={t.openInExplorer}
          onClick={() => revealInFolder(archive.path)}
        >
          📂
        </button>
      </div>
      <div className="comparator-meta-row">
        <span className="comparator-meta-label">{t.colSize}</span>
        <span className="comparator-meta-value">{formatSize(archive.size)}</span>
      </div>
      <div className="comparator-meta-row">
        <span className="comparator-meta-label">{t.colModified}</span>
        <span className="comparator-meta-value">{formatDate(archive.modified, t.dateLocale)}</span>
      </div>
      <div className="comparator-meta-row">
        <span className="comparator-meta-label">{t.archiveTotalEntries}</span>
        <span className="comparator-meta-value">{archive.total_entries}</span>
      </div>
      <div className="comparator-meta-row">
        <span className="comparator-meta-label">{t.archiveDuplicateCount}</span>
        <span className="comparator-meta-value">{archive.duplicated_entries}</span>
      </div>
    </div>
  );
}

export function ArchiveComparator({ archiveA, archiveB, onClose }: Props) {
  const { t } = useLang();
  const [comparison, setComparison] = useState<ArchiveComparison | null>(null);
  const [loading, setLoading] = useState(true);
  const [duplicatesOnly, setDuplicatesOnly] = useState(false);
  const leftRef = useRef<HTMLDivElement>(null);
  const rightRef = useRef<HTMLDivElement>(null);
  const syncingRef = useRef(false);

  useEffect(() => {
    setLoading(true);
    setComparison(null);
    invoke<ArchiveComparison>("get_archive_comparison", { pathA: archiveA.path, pathB: archiveB.path })
      .then((c) => { setComparison(c); setLoading(false); })
      .catch(() => setLoading(false));
  }, [archiveA.path, archiveB.path]);

  const rows = useMemo(() => {
    if (!comparison) return [];
    return alignEntries(comparison.a.entries, comparison.b.entries);
  }, [comparison]);

  const visibleRows = useMemo(() => {
    return duplicatesOnly ? rows.filter((r) => r.isDuplicate) : rows;
  }, [rows, duplicatesOnly]);

  function handleScrollLeft(e: React.UIEvent<HTMLDivElement>) {
    if (syncingRef.current) { syncingRef.current = false; return; }
    const right = rightRef.current;
    if (right && right.scrollTop !== e.currentTarget.scrollTop) {
      syncingRef.current = true;
      right.scrollTop = e.currentTarget.scrollTop;
    }
  }
  function handleScrollRight(e: React.UIEvent<HTMLDivElement>) {
    if (syncingRef.current) { syncingRef.current = false; return; }
    const left = leftRef.current;
    if (left && left.scrollTop !== e.currentTarget.scrollTop) {
      syncingRef.current = true;
      left.scrollTop = e.currentTarget.scrollTop;
    }
  }

  const headerExtra = (
    <label className="comparator-filter-toggle" data-testid="archive-only-duplicates-toggle">
      <input
        type="checkbox"
        checked={duplicatesOnly}
        onChange={(e) => setDuplicatesOnly(e.target.checked)}
      />
      {t.archiveOnlyDuplicates}
    </label>
  );

  return (
    <ComparatorBasicShell title={t.archiveComparator} headerExtra={headerExtra} onClose={onClose}>
      {loading ? (
        <div className="archive-comparator-loading">
          <span className="file-thumb-spinner comparator-spin" />
        </div>
      ) : comparison ? (
        <div className="comparator-body archive-comparator-body" data-testid="archive-comparator-body">
          <div className="comparator-panel archive-col">
            <div className="archive-col-entries" ref={leftRef} onScroll={handleScrollLeft} data-testid="archive-col-left">
              {visibleRows.length === 0 ? (
                <span className="archive-empty-label">-</span>
              ) : (
                visibleRows.map((row, i) => (
                  <div key={`l${i}`} className={`archive-entry-row${row.isDuplicate ? " archive-entry-row--duplicate" : " archive-entry-row--unique"}`}>
                    <EntryCell entry={row.left} />
                  </div>
                ))
              )}
            </div>
            <div className="comparator-footer">
              <ArchiveMetaBlock archive={archiveA} />
            </div>
          </div>
          <div className="comparator-divider" />
          <div className="comparator-panel archive-col">
            <div className="archive-col-entries" ref={rightRef} onScroll={handleScrollRight} data-testid="archive-col-right">
              {visibleRows.length === 0 ? (
                <span className="archive-empty-label">-</span>
              ) : (
                visibleRows.map((row, i) => (
                  <div key={`r${i}`} className={`archive-entry-row${row.isDuplicate ? " archive-entry-row--duplicate" : " archive-entry-row--unique"}`}>
                    <EntryCell entry={row.right} />
                  </div>
                ))
              )}
            </div>
            <div className="comparator-footer">
              <ArchiveMetaBlock archive={archiveB} />
            </div>
          </div>
        </div>
      ) : null}
    </ComparatorBasicShell>
  );
}
