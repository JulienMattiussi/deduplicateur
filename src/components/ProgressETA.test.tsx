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
}: {
  progress: { current: number; total: number };
  history: { time: number; current: number }[];
  scanStartMs?: number;
  isLastPhase?: boolean;
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

  it("affiche 'c'est presque fini' quand pct >= 0.95", () => {
    const now = Date.now();
    const history = [
      { time: now - 5000, current: 900 },
      { time: now - 1000, current: 970 },
    ];
    renderETA({ progress: { current: 980, total: 1000 }, history, isLastPhase: true });
    expect(screen.getByText(t.almostDone)).toBeInTheDocument();
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
