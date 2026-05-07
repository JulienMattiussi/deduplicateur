import { useLang } from "../LangContext";
import { pluralInterp } from "../i18n";
import { formatSize } from "../utils";
import type { SmartMode } from "../hooks/useSelectionState";

interface Props {
  selecting: boolean;
  deleting: boolean;
  selectedCount: number;
  selectedSize: number;
  smartRule: SmartMode;
  priorityFolder: string;
  onSetSmartRule: (rule: SmartMode) => void;
  onSetPriorityFolder: (path: string) => void;
  onSelectAll: () => void;
  onApplyRule: () => void;
  onClearSelection: () => void;
  onAskDelete: () => void;
}

export function ScanResultsToolbar({
  selecting, deleting, selectedCount, selectedSize,
  smartRule, priorityFolder,
  onSetSmartRule, onSetPriorityFolder,
  onSelectAll, onApplyRule, onClearSelection, onAskDelete,
}: Props) {
  const { t } = useLang();
  return (
    <div className="toolbar">
      <button className="btn-ghost" onClick={onSelectAll} disabled={selecting}>{t.selectAll}</button>
      <span className="rule-selector">
        <span className="rule-label">{t.selectionRule}</span>
        <select
          data-testid="rule-select"
          className="rule-select"
          value={smartRule}
          onChange={(e) => onSetSmartRule(e.target.value as SmartMode)}
          disabled={selecting}
        >
          <option value="newest">{t.keepNewest}</option>
          <option value="oldest">{t.keepOldest}</option>
          <option value="highest_resolution">{t.keepHighestResolution}</option>
          <option value="largest_size">{t.keepLargestFile}</option>
          <option value="priority_folder">{t.keepPriorityFolder}</option>
        </select>
        {smartRule === "priority_folder" && (
          <input
            className="rule-folder-input"
            value={priorityFolder}
            onChange={(e) => onSetPriorityFolder(e.target.value)}
            placeholder={t.priorityFolderPlaceholder}
            disabled={selecting}
          />
        )}
        <button className="btn-ghost" onClick={onApplyRule} disabled={selecting}>
          {t.applyRule}
        </button>
      </span>
      <button className="btn-ghost" onClick={onClearSelection} disabled={selecting}>{t.deselect}</button>
      {selectedCount > 0 && !selecting && (
        <button className="btn-danger" onClick={onAskDelete} disabled={deleting}>
          {deleting ? t.deleting : pluralInterp(t.deleteN, selectedCount, { size: formatSize(selectedSize) })}
        </button>
      )}
      {selecting && (
        <span className="toolbar-loader">
          <span className="toolbar-spinner" />
          {t.calculating}
        </span>
      )}
    </div>
  );
}
