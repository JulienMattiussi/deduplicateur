import { useLang } from "../LangContext";

interface Props {
  neededBytes: number;
  availableBytes: number;
  deficitBytes: number;
  onCancel: () => void;
  onContinueSkipping: () => void;
}

/** Format adaptatif : Mo arrondis si < 1 Go, sinon Go avec 1 decimale. */
function formatBytesAdaptive(bytes: number): string {
  const mb = bytes / (1024 * 1024);
  if (mb < 1024) return `${Math.round(mb)} Mo`;
  const gb = mb / 1024;
  return `${gb.toFixed(1)} Go`;
}

/** Remplace les marqueurs **gras** par <strong>...</strong>. */
function renderBold(template: string, vars: Record<string, string>): React.ReactNode[] {
  // Substitue d'abord les variables {key}
  const filled = template.replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? `{${k}}`);
  // Decoupe les **...** en <strong>
  const parts = filled.split(/\*\*([^*]+)\*\*/g);
  return parts.map((p, i) => i % 2 === 1 ? <strong key={i}>{p}</strong> : <span key={i}>{p}</span>);
}

export function DiskSpaceWarningModal({ neededBytes, availableBytes, deficitBytes, onCancel, onContinueSkipping }: Props) {
  const { t } = useLang();
  const vars = {
    needed: formatBytesAdaptive(neededBytes),
    available: formatBytesAdaptive(availableBytes),
    deficit: formatBytesAdaptive(deficitBytes),
  };
  const lines = t.diskWarningBody.split("\n\n");
  return (
    <div className="modal-overlay" onClick={onCancel} data-testid="disk-warning-overlay">
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2 className="modal-title">{t.diskWarningTitle}</h2>
        {lines.map((line, i) => (
          <p key={i} className="modal-body">{renderBold(line, vars)}</p>
        ))}
        <div className="modal-actions">
          <button className="btn-ghost" onClick={onCancel} data-testid="disk-warning-cancel">
            {t.diskWarningCancel}
          </button>
          <button className="btn-primary" onClick={onContinueSkipping} data-testid="disk-warning-continue">
            {t.diskWarningContinueWithoutImages}
          </button>
        </div>
      </div>
    </div>
  );
}
