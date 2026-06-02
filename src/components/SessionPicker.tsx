import { useLang } from "../LangContext";
import { SessionCard } from "./SessionCard";
import type { ScanSummary } from "../types";

interface Props {
  sessions: ScanSummary[];
  resumingId: string | null;
  onResume: (id: string) => void;
  onDelete: (id: string) => void;
}

export function SessionPicker({ sessions, resumingId, onResume, onDelete }: Props) {
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
    </div>
  );
}
