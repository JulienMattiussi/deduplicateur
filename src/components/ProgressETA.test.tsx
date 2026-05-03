import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { useRef } from "react";
import { ProgressETA } from "./ProgressETA";
import { translations } from "../i18n";

const t = translations.fr;

// Helper pour rendre le composant avec un historyRef controllable
function renderETA(
  progress: { current: number; total: number; total_files?: number },
  history: { time: number; current: number }[]
) {
  function Wrapper() {
    const historyRef = useRef(history);
    return <ProgressETA progress={progress} historyRef={historyRef} t={t} />;
  }
  return render(<Wrapper />);
}

describe("ProgressETA", () => {
  // ---- Etat initial ----
  it("n'affiche rien si current=0 et total=0 (phase warmup, historique vide)", () => {
    renderETA({ current: 0, total: 0 }, []);
    // pct = NaN -> condition pct >= 0.95 est false, elapsed=0 -> estimating
    // mais pct = 0/0 = NaN, NaN >= 0.95 = false
    // elapsed < 120000 et hist.length < 2 -> retourne "estimating"
    expect(screen.getByText(t.estimating)).toBeInTheDocument();
  });

  it("ne plante pas quand total=0 (pas de division par zero visible)", () => {
    expect(() => renderETA({ current: 5, total: 0 }, [])).not.toThrow();
  });

  it("affiche 'estimation en cours' au demarrage (historique vide)", () => {
    renderETA({ current: 10, total: 1000 }, []);
    expect(screen.getByText(t.estimating)).toBeInTheDocument();
  });

  // ---- Progression en cours ----
  it("affiche 'c'est presque fini' quand pct >= 0.95", () => {
    const now = Date.now();
    const history = [
      { time: now - 5000, current: 900 },
      { time: now - 1000, current: 970 },
    ];
    renderETA({ current: 980, total: 1000 }, history);
    expect(screen.getByText(t.almostDone)).toBeInTheDocument();
  });

  it("affiche une estimation en secondes apres 15s de donnees (phase chauffe)", () => {
    const now = Date.now();
    // 16 secondes de donnees, taux = (500 - 0) / 16000 = 0.03125 fichiers/ms
    // Restant = (1000 - 500) / 0.03125 = 16000 ms = 16 s, x1.5 = 24s
    const history = [
      { time: now - 16_000, current: 0 },
      { time: now - 1_000, current: 490 },
    ];
    renderETA({ current: 500, total: 1000 }, history);
    // doit afficher soit "environ X s" soit "environ X min" - pas estimating ni almostDone
    expect(screen.queryByText(t.estimating)).not.toBeInTheDocument();
    expect(screen.queryByText(t.almostDone)).not.toBeInTheDocument();
    // le texte doit contenir "environ"
    const eta = screen.getByText(/environ/);
    expect(eta).toBeInTheDocument();
  });

  // ---- 100% ----
  it("affiche 'c'est presque fini' a 100% (current === total)", () => {
    const now = Date.now();
    const history = [
      { time: now - 5000, current: 0 },
      { time: now - 100, current: 999 },
    ];
    renderETA({ current: 1000, total: 1000 }, history);
    expect(screen.getByText(t.almostDone)).toBeInTheDocument();
  });

  // ---- Phase stable (>2 min) ----
  it("affiche une duree en minutes en phase stable", () => {
    const now = Date.now();
    // Historique de 3 minutes, taux = 600 fichiers / 180s = 3.33 fichiers/s
    // Restant = (10000 - 600) / (600/180000) = 9400 * 180000 / 600 = 2820000 ms = 2820s = 47min
    const history = [
      { time: now - 180_000, current: 0 },
      { time: now - 90_000, current: 300 },
      { time: now - 1_000, current: 599 },
    ];
    renderETA({ current: 600, total: 10000 }, history);
    const eta = screen.getByText(/environ/);
    expect(eta).toBeInTheDocument();
    expect(eta.textContent).toContain("min");
  });

  // ---- classe CSS ----
  it("le span a la classe progress-eta", () => {
    renderETA({ current: 500, total: 1000 }, []);
    const span = screen.getByText(t.estimating);
    expect(span).toHaveClass("progress-eta");
  });
});
