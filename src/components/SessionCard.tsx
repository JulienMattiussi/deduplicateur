import type { ScanSummary } from "../types";
import { useLang } from "../LangContext";
import { interp, type Translations } from "../i18n";
import { formatSize } from "../utils";

function relativeDate(id: string, t: Translations): string {
  const diff = Date.now() - parseInt(id);
  const minutes = Math.floor(diff / 60_000);
  const hours = Math.floor(diff / 3_600_000);
  const days = Math.floor(diff / 86_400_000);
  if (minutes < 1) return t.justNow;
  if (minutes < 60) return interp(t.minutesAgo, { n: minutes });
  if (hours < 24) return interp(t.hoursAgo, { n: hours });
  return interp(t.daysAgo, { n: days });
}

/** Convertit un seuil Hamming sur 64 bits (images/videos) en pourcentage de similarite. */
function pctFromHammingThreshold(threshold: number): number {
  return Math.round(100 - (threshold * 100) / 64);
}

function sessionTags(session: ScanSummary, t: Translations): string[] {
  const tags: string[] = [];
  if (session.by_folder) tags.push(t.tagByFolder);
  else if (session.recursive) tags.push(t.tagRecursive);
  else tags.push(t.tagFlat);
  if (session.find_similar) {
    const pct = session.sim_threshold != null ? pctFromHammingThreshold(session.sim_threshold) : null;
    tags.push(pct != null ? `${t.tagSimilarImages} (${pct} %)` : t.tagSimilarImages);
  }
  if (session.find_similar_videos) {
    const pct = session.video_sim_threshold != null ? pctFromHammingThreshold(session.video_sim_threshold) : null;
    tags.push(pct != null ? `${t.tagSimilarVideos} (${pct} %)` : t.tagSimilarVideos);
  }
  if (session.find_similar_audio) {
    // Audio threshold est deja en % (cote frontend : threshold = 100 - similarite)
    const pct = session.audio_sim_threshold != null ? 100 - session.audio_sim_threshold : null;
    tags.push(pct != null ? `${t.tagSimilarAudio} (${pct} %)` : t.tagSimilarAudio);
  }
  if (!session.find_similar && !session.find_similar_videos && !session.find_similar_audio) tags.push(t.tagExact);
  if (session.scan_archives) tags.push(t.tagArchives);
  return tags;
}

export function SessionCard({
  session,
  active,
  resuming,
  onResume,
  onDelete,
}: {
  session: ScanSummary;
  active: boolean;
  resuming: boolean;
  onResume: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  const { t } = useLang();
  return (
    <div className={`session-card ${active ? "session-card--active" : ""}`}>
      <div className="session-meta">
        <span className="session-folder">📁 {session.folder}</span>
        <span className="session-date">{relativeDate(session.id, t)}</span>
      </div>
      <div className="session-tags">
        {sessionTags(session, t).map((tag) => <span key={tag} className="session-tag">{tag}</span>)}
      </div>
      <div className="session-stats">
        <span>{session.total_groups} {session.total_groups > 1 ? t.groups : t.group}</span>
        <span className="session-waste">{formatSize(session.total_wasted_bytes)} {t.recoverable}</span>
        <span>{session.scanned_files} {t.filesScanned}</span>
      </div>
      <div className="session-actions">
        <button className="btn-primary" onClick={() => onResume(session.id)} disabled={active || resuming}>
          {resuming ? <><span className="btn-spinner" /> {t.loading}</> : active ? t.sessionActive : t.sessionResume}
        </button>
        <button className="btn-session-delete" onClick={() => onDelete(session.id)} disabled={resuming}>
          {t.sessionDelete}
        </button>
      </div>
    </div>
  );
}
