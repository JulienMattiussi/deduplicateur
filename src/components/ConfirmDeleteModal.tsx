import { useLang } from "../LangContext";
import { pluralInterp } from "../i18n";
import { formatSize } from "../utils";

interface Props {
  count: number;
  totalSize: number;
  onCancel: () => void;
  onConfirm: () => void;
}

export function ConfirmDeleteModal({ count, totalSize, onCancel, onConfirm }: Props) {
  const { t } = useLang();
  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2 className="modal-title">{t.confirmTitle}</h2>
        <p className="modal-body">
          {pluralInterp(t.confirmBody, count, { size: formatSize(totalSize) })}
        </p>
        <div className="modal-actions">
          <button className="btn-ghost" onClick={onCancel}>{t.confirmCancel}</button>
          <button className="btn-danger" onClick={onConfirm}>{t.confirmConfirm}</button>
        </div>
      </div>
    </div>
  );
}
