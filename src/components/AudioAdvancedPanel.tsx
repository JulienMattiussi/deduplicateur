import { useState } from "react";
import type { AudioConfig } from "../types";
import { useLang } from "../LangContext";
import { DEFAULT_AUDIO_CONFIG } from "../hooks/useScanConfig";

export function AudioAdvancedPanel({
  config,
  onChange,
  disabled,
}: {
  config: AudioConfig;
  onChange: (cfg: AudioConfig) => void;
  disabled: boolean;
}) {
  const { t } = useLang();
  const [open, setOpen] = useState(false);

  function set<K extends keyof AudioConfig>(key: K, value: AudioConfig[K]) {
    onChange({ ...config, [key]: value });
  }

  return (
    <div className="advanced-panel">
      <button className="advanced-panel-toggle" onClick={() => setOpen((v) => !v)} disabled={disabled}>
        <span>{open ? "▾" : "▸"}</span>
        {t.advancedSettings}
      </button>
      {open && (
        <button className="adv-reset" onClick={() => onChange(DEFAULT_AUDIO_CONFIG)} disabled={disabled} title={t.resetTitle}>
          {t.reset}
        </button>
      )}
      {open && (
        <div key={JSON.stringify(config)} className="advanced-panel-body">
          <div className="adv-section">
            <span className="adv-section-title">{t.durationFilter}</span>
            <label className="adv-row">
              <span>{t.tolerance}</span>
              <input type="number" min={0} max={100} className="adv-input"
                defaultValue={Math.round(config.duration_tolerance * 100)}
                onBlur={(e) => set("duration_tolerance", Number(e.target.value) / 100)} disabled={disabled} />
            </label>
          </div>
          <div className="adv-section">
            <span className="adv-section-title">{t.cacheLabel}</span>
            <label className="adv-row">
              <span>{t.enable}</span>
              <input type="checkbox" checked={config.cache_enabled}
                onChange={(e) => set("cache_enabled", e.target.checked)} disabled={disabled} />
            </label>
          </div>
        </div>
      )}
    </div>
  );
}
