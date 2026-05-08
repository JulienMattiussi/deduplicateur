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
  findSimilar: boolean;
  simThreshold: number;
  onClose: () => void;
}

type MatchType = "exact" | "similar" | "unique";

interface AlignedRow {
  left: ArchiveEntryResult | null;
  right: ArchiveEntryResult | null;
  matchType: MatchType;
}

/**
 * Apparie les entrees de deux archives pour un affichage face-a-face.
 * Etapes (dans l'ordre) :
 * 1. Doublons exacts (xxh3 identique) : groupes par hash, appariement greedy index-a-index
 *    quand plusieurs entrees partagent le meme hash dans une meme archive.
 * 2. Doublons similaires (status="similar", appariement via duplicate_in) : utilise pour
 *    les images proches mais pas identiques.
 * 3. Uniques (sans correspondance) : tail de la liste, une seule colonne par ligne.
 */
function alignEntries(a: ArchiveEntryResult[], b: ArchiveEntryResult[]): AlignedRow[] {
  const rows: AlignedRow[] = [];
  const matchedA = new Set<number>();
  const matchedB = new Set<number>();

  // 1. Exact : groupement par hash
  const aByHash = new Map<string, number[]>();
  const bByHash = new Map<string, number[]>();
  a.forEach((e, i) => {
    const arr = aByHash.get(e.hash);
    if (arr) arr.push(i); else aByHash.set(e.hash, [i]);
  });
  b.forEach((e, i) => {
    const arr = bByHash.get(e.hash);
    if (arr) arr.push(i); else bByHash.set(e.hash, [i]);
  });

  const sharedHashes = [...aByHash.keys()]
    .filter((h) => bByHash.has(h))
    .sort((h1, h2) => a[aByHash.get(h1)![0]].internal_path.localeCompare(a[aByHash.get(h2)![0]].internal_path));
  for (const hash of sharedHashes) {
    const idxsA = aByHash.get(hash)!.slice().sort((x, y) => a[x].internal_path.localeCompare(a[y].internal_path));
    const idxsB = bByHash.get(hash)!.slice().sort((x, y) => b[x].internal_path.localeCompare(b[y].internal_path));
    const max = Math.max(idxsA.length, idxsB.length);
    for (let k = 0; k < max; k++) {
      const ai = idxsA[k];
      const bi = idxsB[k];
      if (ai !== undefined) matchedA.add(ai);
      if (bi !== undefined) matchedB.add(bi);
      rows.push({
        left: ai !== undefined ? a[ai] : null,
        right: bi !== undefined ? b[bi] : null,
        matchType: "exact",
      });
    }
  }

  // 2. Similaire : appariement par duplicate_in
  for (let i = 0; i < a.length; i++) {
    if (matchedA.has(i)) continue;
    const ea = a[i];
    if (ea.status !== "similar" || !ea.duplicate_in) continue;
    const j = b.findIndex((eb, idx) => !matchedB.has(idx) && eb.internal_path === ea.duplicate_in);
    if (j === -1) continue;
    matchedA.add(i);
    matchedB.add(j);
    rows.push({ left: ea, right: b[j], matchType: "similar" });
  }

  // 3. Uniques cote A puis cote B
  for (let i = 0; i < a.length; i++) {
    if (matchedA.has(i)) continue;
    rows.push({ left: a[i], right: null, matchType: "unique" });
  }
  for (let j = 0; j < b.length; j++) {
    if (matchedB.has(j)) continue;
    rows.push({ left: null, right: b[j], matchType: "unique" });
  }

  return rows;
}

function EntryCell({ entry, score }: { entry: ArchiveEntryResult | null; score?: number }) {
  if (!entry) return <span className="archive-row-empty" />;
  return (
    <span className="archive-row-content">
      <span className="archive-row-icon"><FileTypeIcon path={entry.internal_path} /></span>
      <span className="archive-row-path" title={entry.internal_path}>{entry.internal_path}</span>
      {score != null && <span className="archive-row-score">{score.toFixed(0)}%</span>}
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

export function ArchiveComparator({ archiveA, archiveB, findSimilar, simThreshold, onClose }: Props) {
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
    invoke<ArchiveComparison>("get_archive_comparison", {
      pathA: archiveA.path,
      pathB: archiveB.path,
      findSimilar,
      simThreshold,
    })
      .then((c) => { setComparison(c); setLoading(false); })
      .catch(() => setLoading(false));
  }, [archiveA.path, archiveB.path, findSimilar, simThreshold]);

  const rows = useMemo(() => {
    if (!comparison) return [];
    return alignEntries(comparison.a.entries, comparison.b.entries);
  }, [comparison]);

  const visibleRows = useMemo(() => {
    return duplicatesOnly ? rows.filter((r) => r.matchType !== "unique") : rows;
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

  function rowClass(matchType: MatchType): string {
    if (matchType === "exact") return "archive-entry-row archive-entry-row--duplicate";
    if (matchType === "similar") return "archive-entry-row archive-entry-row--similar";
    return "archive-entry-row archive-entry-row--unique";
  }

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
                  <div key={`l${i}`} className={rowClass(row.matchType)}>
                    <EntryCell entry={row.left} score={row.matchType === "similar" ? row.left?.similarity_score : undefined} />
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
                  <div key={`r${i}`} className={rowClass(row.matchType)}>
                    <EntryCell entry={row.right} score={row.matchType === "similar" ? row.right?.similarity_score : undefined} />
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
