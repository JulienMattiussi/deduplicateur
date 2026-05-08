import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { useRef } from "react";
import { ProgressETA } from "./ProgressETA";
import { translations } from "../i18n";

const t = translations.fr;

function renderETA({
  progress,
  history,
  scanStartMs,
  isLastPhase,
  phaseCurrent,
  phaseTotal,
}: {
  progress: { current: number; total: number };
  history: { time: number; current: number }[];
  scanStartMs?: number;
  isLastPhase?: boolean;
  phaseCurrent?: number;
  phaseTotal?: number;
}) {
  function Wrapper() {
    const historyRef = useRef(history);
    const scanStartRef = useRef(scanStartMs ?? Date.now() - 10_000);
    return (
      <ProgressETA
        progress={progress}
        historyRef={historyRef}
        scanStartRef={scanStartRef}
        isLastPhase={isLastPhase ?? true}
        phaseCurrent={phaseCurrent ?? 0}
        phaseTotal={phaseTotal ?? 0}
        t={t}
      />
    );
  }
  return render(<Wrapper />);
}

describe("ProgressETA", () => {
  it("affiche le temps ecoule quand pas en derniere phase (apres 5s)", () => {
    renderETA({
      progress: { current: 100, total: 1000 },
      history: [],
      scanStartMs: Date.now() - 30_000,
      isLastPhase: false,
    });
    expect(screen.getByText(/écoul/i)).toBeInTheDocument();
  });

  it("n'affiche rien quand pas en derniere phase et scan < 5s", () => {
    const { container } = renderETA({
      progress: { current: 100, total: 1000 },
      history: [],
      scanStartMs: Date.now() - 2_000,
      isLastPhase: false,
    });
    expect(container.querySelector(".progress-eta")).toBeNull();
  });

  it("affiche le temps ecoule quand en derniere phase mais historique insuffisant", () => {
    renderETA({
      progress: { current: 10, total: 1000 },
      history: [{ time: Date.now() - 5_000, current: 0 }],
      scanStartMs: Date.now() - 20_000,
      isLastPhase: true,
    });
    expect(screen.getByText(/écoul/i)).toBeInTheDocument();
  });

  it("affiche 'c'est presque fini' quand il reste < 10 items dans la derniere phase", () => {
    renderETA({
      progress: { current: 980, total: 1000 },
      history: [],
      isLastPhase: true,
      phaseCurrent: 995,
      phaseTotal: 1000,
    });
    expect(screen.getByText(t.almostDone)).toBeInTheDocument();
  });

  it("ne montre PAS 'presque fini' si on n'est pas en derniere phase, meme si phase_total - phase_current < 10", () => {
    renderETA({
      progress: { current: 980, total: 1000 },
      history: [],
      isLastPhase: false,
      phaseCurrent: 995,
      phaseTotal: 1000,
      scanStartMs: Date.now() - 30_000,
    });
    expect(screen.queryByText(t.almostDone)).not.toBeInTheDocument();
  });

  it("ne montre PAS 'presque fini' si phaseTotal=0 (phase pas encore demarree)", () => {
    renderETA({
      progress: { current: 980, total: 1000 },
      history: [],
      isLastPhase: true,
      phaseCurrent: 0,
      phaseTotal: 0,
    });
    expect(screen.queryByText(t.almostDone)).not.toBeInTheDocument();
  });

  it("affiche le temps restant en phase intermediaire (estimation globale)", () => {
    const now = Date.now();
    // Phase intermediaire (isLastPhase=false) : on a 6 min ecoulees, 6% de progres,
    // donc ~94 min restantes par extrapolation globale.
    renderETA({
      progress: { current: 6, total: 100 },
      history: [{ time: now - 60_000, current: 0 }, { time: now - 1_000, current: 5 }],
      scanStartMs: now - 6 * 60_000,
      isLastPhase: false,
    });
    const eta = screen.getByText(/écoul/i);
    expect(eta.textContent).toContain("écoul");
    // Devrait inclure une estimation de temps restant (en min ou h)
    expect(eta.textContent).toMatch(/min|h/);
  });

  it("ne montre PAS 'presque fini' s'il reste >= 10 items dans la phase, meme a 98% global", () => {
    // Cas reel : pourcentage global trompeur (estimation total_work imprecise) mais
    // la phase n'est pas pres de finir. Le declencheur ne doit pas se baser sur le global.
    const now = Date.now();
    const history = [
      { time: now - 60_000, current: 980 },
      { time: now - 1_000, current: 980 },
    ];
    renderETA({
      progress: { current: 980, total: 1000 },
      history,
      scanStartMs: now - 60_000,
      isLastPhase: true,
      phaseCurrent: 100,
      phaseTotal: 1000,
    });
    expect(screen.queryByText(t.almostDone)).not.toBeInTheDocument();
    expect(screen.getByText(/écoul/i)).toBeInTheDocument();
  });

  it("affiche elapsed et remaining apres 15s de donnees en derniere phase", () => {
    const now = Date.now();
    const history = [
      { time: now - 60_000, current: 0 },
      { time: now - 30_000, current: 300 },
      { time: now - 1_000, current: 599 },
    ];
    renderETA({
      progress: { current: 600, total: 10000 },
      history,
      scanStartMs: now - 60_000,
      isLastPhase: true,
    });
    const eta = screen.getByText(/environ/);
    expect(eta).toBeInTheDocument();
    expect(eta.textContent).toContain("écoul");
  });

  it("affiche le temps restant en heures quand >= 2h", () => {
    const now = Date.now();
    const history = [
      { time: now - 60_000, current: 0 },
      { time: now - 30_000, current: 10 },
      { time: now - 1_000, current: 19 },
    ];
    renderETA({
      progress: { current: 20, total: 10000 },
      history,
      scanStartMs: now - 60_000,
      isLastPhase: true,
    });
    const eta = screen.getByText(/environ/);
    expect(eta.textContent).toMatch(/\d+[.,]\d\s*h/);
  });

  it("le span a la classe progress-eta", () => {
    renderETA({
      progress: { current: 100, total: 1000 },
      history: [],
      scanStartMs: Date.now() - 30_000,
      isLastPhase: false,
    });
    const span = document.querySelector(".progress-eta");
    expect(span).not.toBeNull();
  });
});
