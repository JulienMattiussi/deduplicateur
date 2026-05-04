import type { VideoConfig } from "../types";
import { useLang } from "../LangContext";
import { DEFAULT_VIDEO_CONFIG } from "../hooks/useScanConfig";
import { AdvancedPanelWrapper } from "./AdvancedPanelWrapper";

export function VideoAdvancedPanel({
  config,
  onChange,
  disabled,
}: {
  config: VideoConfig;
  onChange: (cfg: VideoConfig) => void;
  disabled: boolean;
}) {
  const { t } = useLang();

  function set<K extends keyof VideoConfig>(key: K, value: VideoConfig[K]) {
    onChange({ ...config, [key]: value });
  }

  return (
    <AdvancedPanelWrapper onReset={() => onChange(DEFAULT_VIDEO_CONFIG)} disabled={disabled} configKey={JSON.stringify(config)}>
      <div className="adv-section">
        <span className="adv-section-title" title={t.tipFramesPerVideo}>{t.extractionLabel}</span>
        <label className="adv-row">
          <span>{t.framesPerVideo}</span>
          <input type="number" min={2} max={30} className="adv-input" defaultValue={config.n_frames}
            onBlur={(e) => set("n_frames", Math.max(2, Math.min(30, Number(e.target.value))))} disabled={disabled} />
        </label>
      </div>
      <div className="adv-section">
        <span className="adv-section-title" title={t.tipDurationFilterVideo}>{t.durationFilter}</span>
        <label className="adv-row">
          <span>{t.tolerance}</span>
          <input type="number" min={0} max={100} className="adv-input"
            defaultValue={Math.round(config.duration_tolerance * 100)}
            onBlur={(e) => set("duration_tolerance", Number(e.target.value) / 100)} disabled={disabled} />
        </label>
      </div>
      <div className="adv-section">
        <span className="adv-section-title" title={t.tipCacheVideo}>{t.cacheLabel}</span>
        <label className="adv-row">
          <span>{t.enable}</span>
          <input type="checkbox" checked={config.cache_enabled}
            onChange={(e) => set("cache_enabled", e.target.checked)} disabled={disabled} />
        </label>
      </div>
      <div className="adv-section">
        <span className="adv-section-title" title={t.tipDTW}>{t.temporalAlign}</span>
        <label className="adv-row">
          <span>DTW <span className="adv-hint">{t.dtwHint}</span></span>
          <input type="checkbox" checked={config.use_dtw}
            onChange={(e) => set("use_dtw", e.target.checked)} disabled={disabled} />
        </label>
      </div>
    </AdvancedPanelWrapper>
  );
}
