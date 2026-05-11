import { useState, useEffect, useMemo } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useLang } from "./LangContext";
import { formatSize, formatDate, formatDurationSecs, dirname, basename } from "./utils";
import { revealInFolder } from "./fileActions";
import { ArchiveEntryThumbnail, ArchiveEntryAudioPlayer, isAudioPath } from "./components/FileThumbnail";
import { ComparatorBasicShell } from "./comparatorShared";
import type { ArchiveComparison, ArchiveEntryResult, ArchiveInGroup } from "./types";

interface Props {
  archiveA: ArchiveInGroup;
  archiveB: ArchiveInGroup;
  findSimilar: boolean;
  simThreshold: number;
  findSimilarAudio?: boolean;
  audioSimThreshold?: number;
  audioDurationTolerance?: number;
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

/**
 * Cellule pour une entree d'archive dans une des deux colonnes.
 * `side` controle l'ordre des elements pour que la miniature/icone soit toujours
 * du cote interne (proche de la colonne centrale des scores) :
 * - left  : [taille] [chemin] [thumb]
 * - right : [thumb] [chemin] [taille]
 */
function EntryCell({
  entry,
  archivePath,
  side,
}: {
  entry: ArchiveEntryResult | null;
  archivePath: string;
  side: "left" | "right";
}) {
  if (!entry) return <span className="archive-row-empty" />;
  const sizeEl = <span className="archive-row-size">{formatSize(entry.size)}</span>;
  const pathEl = <span className="archive-row-path" title={entry.internal_path}>{entry.internal_path}</span>;
  // Lecteur audio inline pour les entrees audio, miniature lazy pour les images,
  // icone de type de fichier pour le reste (gere par ArchiveEntryThumbnail).
  const mediaEl = isAudioPath(entry.internal_path) ? (
    <span className="archive-row-icon">
      <ArchiveEntryAudioPlayer archivePath={archivePath} internalPath={entry.internal_path} />
    </span>
  ) : (
    <span className="archive-row-icon">
      <ArchiveEntryThumbnail archivePath={archivePath} internalPath={entry.internal_path} />
    </span>
  );
  // Duree audio : affichee a cote du lecteur audio, cote centre. Donnee deja en cache
  // (calculee par fpcalc pendant le scan en mode Audio archives), pas de re-extraction.
  const durationEl = entry.audio_duration_secs != null ? (
    <span className="archive-row-size">{formatDurationSecs(entry.audio_duration_secs)}</span>
  ) : null;
  return (
    <span className={`archive-row-content archive-row-content--${side}`}>
      {side === "left"
        ? <>{sizeEl}{pathEl}{durationEl}{mediaEl}</>
        : <>{mediaEl}{durationEl}{pathEl}{sizeEl}</>}
    </span>
  );
}

function ScoreCell({ matchType, score }: { matchType: MatchType; score?: number | null }) {
  if (matchType === "exact") return <span className="archive-score-cell">100%</span>;
  if (matchType === "similar" && score != null) {
    return <span className="archive-score-cell archive-score-cell--similar">{score.toFixed(0)}%</span>;
  }
  return <span className="archive-score-cell archive-score-cell--empty" />;
}

function ArchiveMetaBlock({ archive }: { archive: ArchiveInGroup }) {
  const { t } = useLang();
  return (
    <div className="comparator-meta">
      <div className="comparator-meta-row">
        <span className="comparator-meta-label">{t.colName}</span>
        <span className="comparator-meta-value comparator-meta-filename" title={basename(archive.path)}>{basename(archive.path)}</span>
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

export function ArchiveComparator({
  archiveA, archiveB,
  findSimilar, simThreshold,
  findSimilarAudio, audioSimThreshold, audioDurationTolerance,
  onClose,
}: Props) {
  const { t } = useLang();
  const [comparison, setComparison] = useState<ArchiveComparison | null>(null);
  const [loading, setLoading] = useState(true);
  const [duplicatesOnly, setDuplicatesOnly] = useState(false);

  useEffect(() => {
    setLoading(true);
    setComparison(null);
    invoke<ArchiveComparison>("get_archive_comparison", {
      pathA: archiveA.path,
      pathB: archiveB.path,
      findSimilar,
      simThreshold,
      findSimilarAudio: findSimilarAudio ?? false,
      audioSimThreshold: audioSimThreshold ?? 20,
      audioDurationTolerance: audioDurationTolerance ?? 0.20,
    })
      .then((c) => { setComparison(c); setLoading(false); })
      .catch(() => setLoading(false));
  }, [archiveA.path, archiveB.path, findSimilar, simThreshold, findSimilarAudio, audioSimThreshold, audioDurationTolerance]);

  const rows = useMemo(() => {
    if (!comparison) return [];
    return alignEntries(comparison.a.entries, comparison.b.entries);
  }, [comparison]);

  const visibleRows = useMemo(() => {
    return duplicatesOnly ? rows.filter((r) => r.matchType !== "unique") : rows;
  }, [rows, duplicatesOnly]);

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
          <div className="archive-grid" data-testid="archive-comparator-grid">
            {visibleRows.length === 0 ? (
              <span className="archive-empty-label">-</span>
            ) : (
              visibleRows.map((row, i) => (
                <div key={i} className={rowClass(row.matchType)}>
                  <EntryCell entry={row.left} archivePath={archiveA.path} side="left" />
                  <ScoreCell
                    matchType={row.matchType}
                    score={row.matchType === "similar" ? (row.left?.similarity_score ?? row.right?.similarity_score) : null}
                  />
                  <EntryCell entry={row.right} archivePath={archiveB.path} side="right" />
                </div>
              ))
            )}
          </div>
          <div className="archive-footers">
            <div className="comparator-footer archive-footer-cell">
              <ArchiveMetaBlock archive={archiveA} />
            </div>
            <div className="comparator-footer archive-footer-cell">
              <ArchiveMetaBlock archive={archiveB} />
            </div>
          </div>
        </div>
      ) : null}
    </ComparatorBasicShell>
  );
}
