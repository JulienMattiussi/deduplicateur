import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { useRef } from "react";
import { ScanProgressView } from "./ScanProgressView";
import { LangProvider } from "../LangContext";
import { translations } from "../i18n";
import type { ScanProgress } from "../types";

function Wrapper({
  progress,
  detectionMode,
  scanArchives,
}: {
  progress: ScanProgress | null;
  detectionMode: "files" | "images" | "videos" | "audio";
  scanArchives: boolean;
}) {
  const historyRef = useRef<{ time: number; current: number }[]>([]);
  const scanStartRef = useRef(Date.now());
  return (
    <LangProvider>
      <ScanProgressView
        progress={progress}
        detectionMode={detectionMode}
        scanArchives={scanArchives}
        historyRef={historyRef}
        scanStartRef={scanStartRef}
        t={translations.fr}
      />
    </LangProvider>
  );
}

describe("ScanProgressView - bulles d'etape", () => {
  it("mode files : 2 etapes (lecture + exact) sans archives", () => {
    render(<Wrapper progress={{ current: 0, total: 0, phase: "reading" }} detectionMode="files" scanArchives={false} />);
    expect(screen.getByText(translations.fr.phaseReading)).toBeInTheDocument();
    expect(screen.getByText(translations.fr.phaseExact)).toBeInTheDocument();
    expect(screen.queryByText(translations.fr.phaseImages)).not.toBeInTheDocument();
  });

  it("mode files + scanArchives : 4 etapes incluant comptage + archives", () => {
    render(<Wrapper progress={{ current: 0, total: 0, phase: "reading" }} detectionMode="files" scanArchives={true} />);
    expect(screen.getByText(translations.fr.phaseReading)).toBeInTheDocument();
    expect(screen.getByText(translations.fr.phaseExact)).toBeInTheDocument();
    expect(screen.getByText(translations.fr.phaseCountingArchives)).toBeInTheDocument();
    expect(screen.getByText(translations.fr.phaseArchives)).toBeInTheDocument();
  });

  it("mode images : 3 etapes (lecture + exact + images)", () => {
    render(<Wrapper progress={null} detectionMode="images" scanArchives={false} />);
    expect(screen.getByText(translations.fr.phaseImages)).toBeInTheDocument();
    expect(screen.queryByText(translations.fr.phaseVideos)).not.toBeInTheDocument();
  });

  it("toutes les bulles sont rendues des le debut (pas de progressive disclosure)", () => {
    // Phase reading initiale : les bulles counting_archives/archives doivent deja apparaitre.
    // 4 etapes : reading + exact + counting_archives + archives.
    const { container } = render(
      <Wrapper progress={{ current: 0, total: 0, phase: "reading" }} detectionMode="files" scanArchives={true} />
    );
    expect(container.querySelectorAll(".progress-step").length).toBe(4);
  });

  it("les bulles suivent l'ordre d'execution : counting_archives apparait juste apres reading, pas a la fin", () => {
    // En mode Images + scanArchives, l'ordre attendu est :
    // reading -> counting_archives -> exact -> images -> archives -> archives_phash
    const { container } = render(
      <Wrapper progress={{ current: 0, total: 0, phase: "reading" }} detectionMode="images" scanArchives={true} />
    );
    const labels = Array.from(container.querySelectorAll(".progress-step-label"))
      .map(el => el.textContent);
    expect(labels).toEqual([
      translations.fr.phaseReading,
      translations.fr.phaseCountingArchives,
      translations.fr.phaseExact,
      translations.fr.phaseImages,
      translations.fr.phaseArchives,
      translations.fr.phaseArchivesPhash,
    ]);
  });
});

describe("ScanProgressView - libelles", () => {
  it("affiche le label 'fichiers archives' pendant la phase archives", () => {
    render(
      <Wrapper
        progress={{ current: 100, total: 1000, phase: "archives", phase_current: 100, phase_total: 1000 }}
        detectionMode="files" scanArchives={true}
      />
    );
    expect(screen.getByText(/fichiers archivés/)).toBeInTheDocument();
  });

  it("affiche le bon libelle selon la phase active (exact -> fichiers)", () => {
    render(
      <Wrapper
        progress={{ current: 50, total: 100, phase: "exact", phase_current: 50, phase_total: 100 }}
        detectionMode="files" scanArchives={false}
      />
    );
    // Le label doit contenir "fichiers" mais pas "audio"/"images"
    const label = screen.getByText(/Analyse en cours/);
    expect(label.textContent).toContain("fichiers");
    expect(label.textContent).not.toContain("audio");
  });

  it("affiche le compteur de doublons trouves", () => {
    render(
      <Wrapper
        progress={{ current: 50, total: 100, phase: "exact", groups_found: 5 }}
        detectionMode="files" scanArchives={false}
      />
    );
    expect(screen.getByText(/5 doublons/)).toBeInTheDocument();
  });
});

describe("ScanProgressView - etat des bulles", () => {
  it("la bulle de la phase active a le statut --active", () => {
    const { container } = render(
      <Wrapper progress={{ current: 50, total: 100, phase: "exact" }} detectionMode="files" scanArchives={false} />
    );
    const active = container.querySelector(".progress-step--active");
    expect(active).toBeInTheDocument();
    expect(active!.textContent).toContain(translations.fr.phaseExact);
  });

  it("les bulles avant la phase active sont --done", () => {
    const { container } = render(
      <Wrapper progress={{ current: 50, total: 100, phase: "exact" }} detectionMode="files" scanArchives={false} />
    );
    const done = container.querySelector(".progress-step--done");
    expect(done).toBeInTheDocument();
    expect(done!.textContent).toContain(translations.fr.phaseReading);
  });
});
