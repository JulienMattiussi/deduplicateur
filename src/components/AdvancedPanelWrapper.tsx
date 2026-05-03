import { useState } from "react";
import { useLang } from "../LangContext";

export function AdvancedPanelWrapper({
  onReset,
  disabled,
  configKey,
  children,
}: {
  onReset: () => void;
  disabled: boolean;
  configKey?: string;
  children: React.ReactNode;
}) {
  const { t } = useLang();
  const [open, setOpen] = useState(false);

  return (
    <div className="advanced-panel">
      <button className="advanced-panel-toggle" onClick={() => setOpen((v) => !v)} disabled={disabled}>
        <span>{open ? "▾" : "▸"}</span>
        {t.advancedSettings}
      </button>
      {open && (
        <button className="adv-reset" onClick={onReset} disabled={disabled} title={t.resetTitle}>
          {t.reset}
        </button>
      )}
      {open && (
        <div key={configKey} className="advanced-panel-body">
          {children}
        </div>
      )}
    </div>
  );
}
