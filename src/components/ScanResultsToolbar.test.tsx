import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ScanResultsToolbar } from "./ScanResultsToolbar";
import { LangProvider } from "../LangContext";
import type { SmartMode } from "../hooks/useSelectionState";

function renderToolbar(overrides: Partial<{
  selecting: boolean;
  deleting: boolean;
  selectedCount: number;
  selectedSize: number;
  smartRule: SmartMode;
  priorityFolder: string;
  onSetSmartRule: (rule: SmartMode) => void;
  onSetPriorityFolder: (path: string) => void;
  onSelectAll: () => void;
  onApplyRule: () => void;
  onClearSelection: () => void;
  onAskDelete: () => void;
}> = {}) {
  const props = {
    selecting: false,
    deleting: false,
    selectedCount: 0,
    selectedSize: 0,
    smartRule: "newest" as SmartMode,
    priorityFolder: "",
    onSetSmartRule: vi.fn(),
    onSetPriorityFolder: vi.fn(),
    onSelectAll: vi.fn(),
    onApplyRule: vi.fn(),
    onClearSelection: vi.fn(),
    onAskDelete: vi.fn(),
    ...overrides,
  };
  return { ...render(<LangProvider><ScanResultsToolbar {...props} /></LangProvider>), props };
}

describe("ScanResultsToolbar - selection", () => {
  it("clic sur 'Tout cocher' appelle onSelectAll", async () => {
    const user = userEvent.setup();
    const { props } = renderToolbar();
    await user.click(screen.getByText(/Tout cocher/i));
    expect(props.onSelectAll).toHaveBeenCalled();
  });

  it("clic sur 'Désélectionner' appelle onClearSelection", async () => {
    const user = userEvent.setup();
    const { props } = renderToolbar();
    await user.click(screen.getByText(/Désélectionner/));
    expect(props.onClearSelection).toHaveBeenCalled();
  });
});

describe("ScanResultsToolbar - bouton supprimer", () => {
  it("absent quand selectedCount=0", () => {
    renderToolbar({ selectedCount: 0 });
    expect(screen.queryByText(/Supprimer \d/)).not.toBeInTheDocument();
  });

  it("present avec compte et taille quand selectedCount>0", () => {
    renderToolbar({ selectedCount: 3, selectedSize: 1024 * 1024 });
    expect(screen.getByText(/Supprimer 3 fichiers/)).toBeInTheDocument();
    expect(screen.getByText(/1\.0 Mo/)).toBeInTheDocument();
  });

  it("clic appelle onAskDelete", async () => {
    const user = userEvent.setup();
    const { props } = renderToolbar({ selectedCount: 1, selectedSize: 100 });
    await user.click(screen.getByText(/Supprimer 1 fichier/));
    expect(props.onAskDelete).toHaveBeenCalled();
  });

  it("affiche 'Suppression…' quand deleting", () => {
    renderToolbar({ selectedCount: 1, selectedSize: 100, deleting: true });
    expect(screen.getByText(/Suppression/)).toBeInTheDocument();
  });
});

describe("ScanResultsToolbar - regle smart", () => {
  it("input dossier prioritaire visible seulement si smartRule=priority_folder", () => {
    const { rerender } = renderToolbar({ smartRule: "newest" });
    expect(screen.queryByPlaceholderText(/Chemin/i)).not.toBeInTheDocument();
    rerender(
      <LangProvider>
        <ScanResultsToolbar
          selecting={false} deleting={false} selectedCount={0} selectedSize={0}
          smartRule="priority_folder" priorityFolder="" onSetSmartRule={vi.fn()}
          onSetPriorityFolder={vi.fn()} onSelectAll={vi.fn()} onApplyRule={vi.fn()}
          onClearSelection={vi.fn()} onAskDelete={vi.fn()}
        />
      </LangProvider>
    );
    expect(screen.getByPlaceholderText(/Chemin/i)).toBeInTheDocument();
  });

  it("clic sur 'Appliquer' appelle onApplyRule", async () => {
    const user = userEvent.setup();
    const { props } = renderToolbar();
    await user.click(screen.getByText(/Appliquer/));
    expect(props.onApplyRule).toHaveBeenCalled();
  });
});

describe("ScanResultsToolbar - calcul en cours", () => {
  it("affiche le loader quand selecting=true", () => {
    renderToolbar({ selecting: true });
    expect(screen.getByText(/Calcul/)).toBeInTheDocument();
  });
});
