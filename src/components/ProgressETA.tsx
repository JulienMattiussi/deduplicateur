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
  phaseCurrent,
  phaseTotal,
  t,
}: {
  historyRef: React.MutableRefObject<{ time: number; current: number }[]>;
  scanStartRef: React.MutableRefObject<number>;
  isLastPhase: boolean;
  progress: { current: number; total: number };
  phaseCurrent: number;
  phaseTotal: number;
  t: Translations;
}) {
  const hist = historyRef.current;
  const now = Date.now();
  const elapsedMs = now - scanStartRef.current;
  const elapsedLabel = formatDuration(elapsedMs, t);

  // "Presque fini" = il reste moins de 10 items a traiter dans la derniere phase.
  // Heuristique simple et fiable, qui ne depend ni du pourcentage global (estimations
  // de total_work imprecises) ni du taux recent (clignote sur les phases parallelles).
  const almostDone = isLastPhase && phaseTotal > 0 && phaseTotal - phaseCurrent < 10;
  if (almostDone) {
    return <span className="progress-eta">{t.almostDone}</span>;
  }

  // Estimation globale du temps restant : basee sur la progression globale (current/total)
  // et le temps total ecoule depuis le debut du scan. Utilisee :
  // - pendant les phases intermediaires (l'ETA local serait trompeur car les rates varient
  //   fortement entre phases : exact bcp plus rapide que pHash, etc.)
  // - en fallback dans la derniere phase si l'historique local n'est pas encore assez fourni
  // Necessite >= 15s d'execution et >= 1% de progres pour eviter les estimations farfelues.
  function globalEtaLabel(): string | null {
    if (elapsedMs < 15_000) return null;
    if (progress.total <= 0 || progress.current <= 0) return null;
    if (progress.current * 100 < progress.total) return null;  // < 1% : trop tot pour estimer
    const remain = ((progress.total - progress.current) as number) / progress.current * elapsedMs;
    if (remain < 15_000) return null;
    return formatDuration(remain, t);
  }

  if (!isLastPhase) {
    if (elapsedMs < 5_000) return null;
    const remainLabel = globalEtaLabel();
    if (remainLabel) {
      return (
        <span className="progress-eta">
          {interp(t.elapsedAndRemaining, { elapsed: elapsedLabel, remaining: remainLabel })}
        </span>
      );
    }
    return <span className="progress-eta">{interp(t.elapsed, { t: elapsedLabel })}</span>;
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
