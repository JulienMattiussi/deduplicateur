import { interp, type Translations } from "../i18n";

export function ProgressETA({
  progress,
  historyRef,
  t,
}: {
  progress: { current: number; total: number; total_files?: number };
  historyRef: React.MutableRefObject<{ time: number; current: number }[]>;
  t: Translations;
}) {
  const pct = progress.current / progress.total;
  const hist = historyRef.current;
  const now = Date.now();
  const elapsed = hist.length >= 2 ? now - hist[0].time : 0;

  // Presque termine (95%+ ou <15s restants au rythme recent)
  const recentRef = hist.length >= 2 ? hist[Math.max(0, hist.length - 20)] : null;
  const recentRate = recentRef ? (progress.current - recentRef.current) / (now - recentRef.time) : 0;
  if (pct >= 0.95 || (recentRate > 0 && (progress.total - progress.current) / recentRate < 15_000)) {
    return <span className="progress-eta">{t.almostDone}</span>;
  }

  // Chauffe (<2 min) - estimation pessimiste x1.5 apres 15s de donnees
  if (elapsed < 120_000) {
    if (elapsed < 15_000 || hist.length < 2) {
      return <span className="progress-eta">{t.estimating}</span>;
    }
    const earlyRate = (progress.current - hist[0].current) / elapsed;
    if (earlyRate <= 0) return <span className="progress-eta">{t.estimating}</span>;
    const earlyRemainS = Math.round((progress.total - progress.current) / earlyRate / 1000 * 1.5);
    if (earlyRemainS < 15) return null;
    const earlyLabel = earlyRemainS < 60
      ? `${earlyRemainS} ${t.durationS}`
      : `${Math.round(earlyRemainS / 60)} ${t.durationMin}`;
    return <span className="progress-eta">{interp(t.aboutTime, { t: earlyLabel })}</span>;
  }

  // Stable (>2 min) - taux calcule sur les 3 dernieres minutes
  const target = now - 180_000;
  const refIdx = hist.findIndex((s) => s.time >= target);
  const ref = refIdx > 0 ? hist[refIdx] : hist[0];
  const rate = (progress.current - ref.current) / (now - ref.time);
  if (rate <= 0) return null;
  const remainS = Math.round((progress.total - progress.current) / rate / 1000);
  if (remainS < 15) return null;
  const etaLabel = remainS < 60
    ? `${remainS} ${t.durationS}`
    : `${Math.round(remainS / 60)} ${t.durationMin}`;
  return <span className="progress-eta">{interp(t.aboutTime, { t: etaLabel })}</span>;
}
