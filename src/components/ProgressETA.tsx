import { interp, type Translations } from "../i18n";

function formatDuration(ms: number, t: Translations): string {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s} ${t.durationS}`;
  const min = Math.round(s / 60);
  if (min < 120) return `${min} ${t.durationMin}`;
  return `${(ms / 3_600_000).toFixed(1)} ${t.durationH}`;
}

export function ProgressETA({
  historyRef,
  scanStartRef,
  isLastPhase,
  progress,
  t,
}: {
  historyRef: React.MutableRefObject<{ time: number; current: number }[]>;
  scanStartRef: React.MutableRefObject<number>;
  isLastPhase: boolean;
  progress: { current: number; total: number };
  t: Translations;
}) {
  const hist = historyRef.current;
  const now = Date.now();
  const elapsedMs = now - scanStartRef.current;
  const elapsedLabel = formatDuration(elapsedMs, t);

  if (!isLastPhase) {
    if (elapsedMs < 5_000) return null;
    return <span className="progress-eta">{interp(t.elapsed, { t: elapsedLabel })}</span>;
  }

  const pct = progress.current / progress.total;
  const recentRef = hist.length >= 2 ? hist[Math.max(0, hist.length - 20)] : null;
  const recentRate = recentRef ? (progress.current - recentRef.current) / (now - recentRef.time) : 0;
  if (pct >= 0.95 || (recentRate > 0 && (progress.total - progress.current) / recentRate < 15_000)) {
    return <span className="progress-eta">{t.almostDone}</span>;
  }

  if (hist.length < 2 || (now - hist[0].time) < 15_000) {
    if (elapsedMs < 5_000) return null;
    return <span className="progress-eta">{interp(t.elapsed, { t: elapsedLabel })}</span>;
  }

  const ref = hist[0];
  const rate = (progress.current - ref.current) / (now - ref.time);
  if (rate <= 0) {
    return <span className="progress-eta">{interp(t.elapsed, { t: elapsedLabel })}</span>;
  }

  const remainMs = (progress.total - progress.current) / rate;
  if (remainMs < 15_000) return null;

  const remainLabel = formatDuration(remainMs, t);
  return (
    <span className="progress-eta">
      {interp(t.elapsedAndRemaining, { elapsed: elapsedLabel, remaining: remainLabel })}
    </span>
  );
}
