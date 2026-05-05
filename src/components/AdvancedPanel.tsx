import type { PHashConfig } from "../types";
import { useLang } from "../LangContext";
import { DEFAULT_PHASH_CONFIG } from "../hooks/useScanConfig";
import { AdvancedPanelWrapper } from "./AdvancedPanelWrapper";

export function AdvancedPanel({
  config,
  onChange,
  disabled,
}: {
  config: PHashConfig;
  onChange: (cfg: PHashConfig) => void;
  disabled: boolean;
}) {
  const { t } = useLang();

  function set<K extends keyof PHashConfig>(key: K, value: PHashConfig[K]) {
    onChange({ ...config, [key]: value });
  }

  return (
    <AdvancedPanelWrapper onReset={() => onChange(DEFAULT_PHASH_CONFIG)} disabled={disabled}>
      <div className="adv-section">
        <span className="adv-section-title" title={t.tipSizeFilter}>{t.sizeFilter}</span>
        <label className="adv-row" title={t.tipMinSizeImages}>
          <span>{t.minSizeKb}</span>
          <input type="number" min={0} className="adv-input"
            defaultValue={Math.round(config.min_file_size_bytes / 1024)}
            onBlur={(e) => set("min_file_size_bytes", Number(e.target.value) * 1024)} disabled={disabled} />
        </label>
        <label className="adv-row" title={t.tipEnableIfN}>
          <span>{t.enableIfN}</span>
          <input type="number" min={1} className="adv-input" defaultValue={config.min_images_size_filter}
            onBlur={(e) => set("min_images_size_filter", Number(e.target.value))} disabled={disabled} />
        </label>
      </div>
      <div className="adv-section">
        <span className="adv-section-title" title={t.tipAspectFilter}>{t.aspectFilter}</span>
        <label className="adv-row" title={t.tipAspectTolerance}>
          <span>{t.tolerance}</span>
          <input type="number" min={0} max={100} className="adv-input"
            defaultValue={Math.round(config.aspect_ratio_tolerance * 100)}
            onBlur={(e) => set("aspect_ratio_tolerance", Number(e.target.value) / 100)} disabled={disabled} />
        </label>
        <label className="adv-row" title={t.tipEnableIfN}>
          <span>{t.enableIfN}</span>
          <input type="number" min={1} className="adv-input" defaultValue={config.min_images_aspect_filter}
            onBlur={(e) => set("min_images_aspect_filter", Number(e.target.value))} disabled={disabled} />
        </label>
      </div>
      <div className="adv-section">
        <span className="adv-section-title" title={t.tipTwoPassHash}>{t.twoPassHash}</span>
        <label className="adv-row">
          <span>{t.enable}</span>
          <input type="checkbox" checked={config.two_pass_enabled}
            onChange={(e) => set("two_pass_enabled", e.target.checked)} disabled={disabled} />
        </label>
        <label className="adv-row" title={t.tipEnableIfN}>
          <span>{t.enableIfN}</span>
          <input type="number" min={1} className="adv-input" defaultValue={config.min_images_two_pass}
            onBlur={(e) => set("min_images_two_pass", Number(e.target.value))} disabled={disabled} />
        </label>
        <label className="adv-row" title={t.tipCoarseMultiplier}>
          <span>{t.coarseMultiplier}</span>
          <input type="number" min={1} step={0.1} className="adv-input"
            defaultValue={config.coarse_threshold_multiplier}
            onBlur={(e) => set("coarse_threshold_multiplier", Number(e.target.value))} disabled={disabled} />
        </label>
      </div>
      <div className="adv-section">
        <span className="adv-section-title" title={t.tipCacheImages}>{t.cacheLabel}</span>
        <label className="adv-row">
          <span>{t.enable}</span>
          <input type="checkbox" checked={config.cache_enabled}
            onChange={(e) => set("cache_enabled", e.target.checked)} disabled={disabled} />
        </label>
      </div>
      <div className="adv-section">
        <span className="adv-section-title" title={t.tipParallelCompare}>{t.parallelCompare}</span>
        <label className="adv-row">
          <span>{t.enable}</span>
          <input type="checkbox" checked={config.parallel_compare_enabled}
            onChange={(e) => set("parallel_compare_enabled", e.target.checked)} disabled={disabled} />
        </label>
        <label className="adv-row" title={t.tipEnableIfN}>
          <span>{t.enableIfN}</span>
          <input type="number" min={1} className="adv-input" defaultValue={config.min_images_parallel_compare}
            onBlur={(e) => set("min_images_parallel_compare", Number(e.target.value))} disabled={disabled} />
        </label>
      </div>
      <div className="adv-section">
        <span className="adv-section-title">{t.devMode}</span>
        <label className="adv-row">
          <span>{t.savePerfMetrics}</span>
          <input type="checkbox" checked={config.perf_log_enabled}
            onChange={(e) => set("perf_log_enabled", e.target.checked)} disabled={disabled} />
        </label>
      </div>
    </AdvancedPanelWrapper>
  );
}
