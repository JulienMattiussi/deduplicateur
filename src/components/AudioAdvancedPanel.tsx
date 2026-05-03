import type { AudioConfig } from "../types";
import { useLang } from "../LangContext";
import { DEFAULT_AUDIO_CONFIG } from "../hooks/useScanConfig";
import { AdvancedPanelWrapper } from "./AdvancedPanelWrapper";

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

  function set<K extends keyof AudioConfig>(key: K, value: AudioConfig[K]) {
    onChange({ ...config, [key]: value });
  }

  return (
    <AdvancedPanelWrapper onReset={() => onChange(DEFAULT_AUDIO_CONFIG)} disabled={disabled} configKey={JSON.stringify(config)}>
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
    </AdvancedPanelWrapper>
  );
}
