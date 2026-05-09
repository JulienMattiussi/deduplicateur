import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DiskSpaceWarningModal } from "./DiskSpaceWarningModal";
import { LangProvider } from "../LangContext";

function renderModal(opts: Partial<{
  neededBytes: number;
  availableBytes: number;
  deficitBytes: number;
  mode: "image" | "audio";
  onCancel: () => void;
  onContinueSkipping: () => void;
}> = {}) {
  const props = {
    neededBytes: opts.neededBytes ?? 500 * 1024 * 1024,    // 500 Mo par defaut
    availableBytes: opts.availableBytes ?? 200 * 1024 * 1024, // 200 Mo dispo
    deficitBytes: opts.deficitBytes ?? 1324 * 1024 * 1024,  // 1.3 Go a liberer
    mode: opts.mode ?? "image" as const,
    onCancel: opts.onCancel ?? vi.fn(),
    onContinueSkipping: opts.onContinueSkipping ?? vi.fn(),
  };
  return { ...render(<LangProvider><DiskSpaceWarningModal {...props} /></LangProvider>), props };
}

describe("DiskSpaceWarningModal - rendu", () => {
  it("affiche le titre d'alerte", () => {
    renderModal();
    expect(screen.getByText(/Espace disque insuffisant/i)).toBeInTheDocument();
  });

  it("formate les Mo quand < 1 Go", () => {
    renderModal({ neededBytes: 500 * 1024 * 1024 });
    expect(screen.getByText(/500 Mo/)).toBeInTheDocument();
  });

  it("formate les Go quand >= 1 Go", () => {
    renderModal({ neededBytes: 2.5 * 1024 * 1024 * 1024 });
    expect(screen.getByText(/2\.5 Go/)).toBeInTheDocument();
  });

  it("mode image : message et bouton mentionnent les images", () => {
    renderModal({ mode: "image" });
    expect(screen.getByText(/images contenues dans les archives/i)).toBeInTheDocument();
    expect(screen.getByText(/sans analyser les images archivées/i)).toBeInTheDocument();
  });

  it("mode audio : message et bouton mentionnent les sons", () => {
    renderModal({ mode: "audio" });
    expect(screen.getByText(/sons contenus dans les archives/i)).toBeInTheDocument();
    expect(screen.getByText(/sans analyser les sons archivés/i)).toBeInTheDocument();
  });
});

describe("DiskSpaceWarningModal - actions", () => {
  it("clic sur Annuler appelle onCancel", async () => {
    const user = userEvent.setup();
    const { props } = renderModal();
    await user.click(screen.getByTestId("disk-warning-cancel"));
    expect(props.onCancel).toHaveBeenCalledTimes(1);
  });

  it("clic sur Continuer sans... appelle onContinueSkipping", async () => {
    const user = userEvent.setup();
    const { props } = renderModal();
    await user.click(screen.getByTestId("disk-warning-continue"));
    expect(props.onContinueSkipping).toHaveBeenCalledTimes(1);
  });

  it("clic sur l'overlay (mais pas sur le contenu) appelle onCancel", async () => {
    const user = userEvent.setup();
    const { props } = renderModal();
    await user.click(screen.getByTestId("disk-warning-overlay"));
    expect(props.onCancel).toHaveBeenCalled();
  });
});
