import { useLang } from "../LangContext";
import { interp } from "../i18n";
import { formatSize } from "../utils";
import { SessionCard } from "./SessionCard";
import type { ScanSummary } from "../types";

interface Props {
  sessions: ScanSummary[];
  resumingId: string | null;
  cacheBytes: number | null;
  purgeConfirm: boolean;
  onResume: (id: string) => void;
  onDelete: (id: string) => void;
  onPurge: () => void;
  onPurgeConfirm: (v: boolean) => void;
}

export function SessionPicker({
  sessions, resumingId, cacheBytes, purgeConfirm,
  onResume, onDelete, onPurge, onPurgeConfirm,
}: Props) {
  const { t } = useLang();
  return (
    <div className="session-list">
      <p className="session-list-title">{t.previousSessions}</p>
      {sessions.length === 0 ? (
        <p className="session-list-empty">{t.noSessions}</p>
      ) : (
        sessions.map((s) => (
          <SessionCard key={s.id} session={s} active={false} resuming={resumingId === s.id} onResume={onResume} onDelete={onDelete} />
        ))
      )}
      {cacheBytes !== null && cacheBytes > 0 && (
        <div className="cache-section">
          {purgeConfirm ? (
            <>
              <span className="cache-confirm-text">{t.purgeCacheQuestion}</span>
              <div className="cache-confirm-buttons">
                <button className="btn-ghost btn-sm btn-danger" onClick={onPurge}>{t.purgeCache}</button>
                <button className="btn-ghost btn-sm" onClick={() => onPurgeConfirm(false)}>{t.confirmCancel}</button>
              </div>
            </>
          ) : (
            <>
              <span className="cache-size-label">{interp(t.cacheSize, { size: formatSize(cacheBytes) })}</span>
              <button className="btn-ghost btn-sm" onClick={() => onPurgeConfirm(true)}>{t.purgeCache}</button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
