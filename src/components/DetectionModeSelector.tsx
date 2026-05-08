import { useLang } from "../LangContext";

type DetectionMode = "files" | "images" | "videos" | "audio";

interface Props {
  detectionMode: DetectionMode;
  onSetDetectionMode: (m: DetectionMode) => void;
  simSimilarity: number;
  onSetSimSimilarity: (n: number) => void;
  videoSimilarity: number;
  onSetVideoSimilarity: (n: number) => void;
  audioSimilarity: number;
  onSetAudioSimilarity: (n: number) => void;
  disabled: boolean;
}

export function DetectionModeSelector(props: Props) {
  const { t } = useLang();
  const { detectionMode, onSetDetectionMode, disabled } = props;

  return (
    <div className="similar-options-row">
      <div className="detection-mode-selector">
        {(["files", "images", "videos", "audio"] as const).map((mode) => (
          <button
            key={mode}
            className={`detection-mode-btn${detectionMode === mode ? " detection-mode-btn--active" : ""}`}
            onClick={() => onSetDetectionMode(mode)}
            disabled={disabled}
            title={mode === "files" ? t.tipModeFiles : mode === "images" ? t.tipModeImages : mode === "videos" ? t.tipModeVideos : t.tipModeAudio}
          >
            {mode === "files" ? t.modeFiles : mode === "images" ? t.modeImages : mode === "videos" ? t.modeVideos : t.modeAudio}
          </button>
        ))}
      </div>
      {detectionMode === "images" && (
        <label className="slider-threshold" title={t.tipSimilarityThreshold}>
          {t.minSimilarity}&nbsp;: <strong>{props.simSimilarity}&nbsp;%</strong>
          <input type="range" min={60} max={100} step={1} value={props.simSimilarity}
            onChange={(e) => props.onSetSimSimilarity(Number(e.target.value))}
            disabled={disabled} className="threshold-slider" />
        </label>
      )}
      {detectionMode === "videos" && (
        <label className="slider-threshold" title={t.tipSimilarityThreshold}>
          {t.minSimilarity}&nbsp;: <strong>{props.videoSimilarity}&nbsp;%</strong>
          <input type="range" min={60} max={100} step={1} value={props.videoSimilarity}
            onChange={(e) => props.onSetVideoSimilarity(Number(e.target.value))}
            disabled={disabled} className="threshold-slider" />
        </label>
      )}
      {detectionMode === "audio" && (
        <label className="slider-threshold" title={t.tipSimilarityThreshold}>
          {t.minSimilarity}&nbsp;: <strong>{props.audioSimilarity}&nbsp;%</strong>
          <input type="range" min={60} max={100} step={1} value={props.audioSimilarity}
            onChange={(e) => props.onSetAudioSimilarity(Number(e.target.value))}
            disabled={disabled} className="threshold-slider" />
        </label>
      )}
    </div>
  );
}
