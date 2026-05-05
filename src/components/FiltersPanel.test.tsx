import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { FiltersPanel } from "./FiltersPanel";
import { LangProvider } from "../LangContext";


vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
});

function renderWithLang(ui: React.ReactElement) {
  return render(<LangProvider>{ui}</LangProvider>);
}

// ---- F : FiltersPanel ----
describe("F - FiltersPanel", () => {
  function makeProps(overrides: Partial<Parameters<typeof FiltersPanel>[0]> = {}) {
    return {
      excluded: ["node_modules"],
      onChangeExcluded: vi.fn(),
      excludeExtensions: ["tmp"],
      onChangeExclude: vi.fn(),
      includeExtensions: [],
      onChangeInclude: vi.fn(),
      minFileSizeKb: 0,
      onChangeMin: vi.fn(),
      maxFileSizeKb: 0,
      onChangeMax: vi.fn(),
      exactCacheEnabled: true,
      onChangeCache: vi.fn(),
      disabled: false,
      ...overrides,
    };
  }

  it("est ferme par defaut et affiche le count total de filtres actifs", () => {
    // 1 dossier exclu + 2 extensions exclues = 3
    renderWithLang(<FiltersPanel {...makeProps({ excludeExtensions: ["tmp", "log"] })} />);
    expect(screen.queryByText("Extensions exclues")).not.toBeInTheDocument();
    expect(screen.getByText("3")).toBeInTheDocument();
  });

  it("s'ouvre au clic sur le toggle", async () => {
    const user = userEvent.setup();
    renderWithLang(<FiltersPanel {...makeProps()} />);
    await user.click(screen.getByText(/Filtres/));
    expect(screen.getByText("Extensions exclues")).toBeInTheDocument();
  });

  it("affiche la chip du dossier exclu et de l'extension exclue", async () => {
    const user = userEvent.setup();
    renderWithLang(<FiltersPanel {...makeProps()} />);
    await user.click(screen.getByText(/Filtres/));
    expect(screen.getByText("node_modules")).toBeInTheDocument();
    expect(screen.getByText(".tmp")).toBeInTheDocument();
  });

  it("appelle onChangeExcluded sans le dossier supprime au clic sur son x", async () => {
    const user = userEvent.setup();
    const onChangeExcluded = vi.fn();
    renderWithLang(<FiltersPanel {...makeProps({ onChangeExcluded })} />);
    await user.click(screen.getByText(/Filtres/));
    // Le premier × correspond a la chip "node_modules"
    await user.click(screen.getAllByText("×")[0]);
    expect(onChangeExcluded).toHaveBeenCalledWith([]);
  });

  it("appelle onChangeExclude avec la nouvelle extension via Entree", async () => {
    const user = userEvent.setup();
    const onChangeExclude = vi.fn();
    renderWithLang(<FiltersPanel {...makeProps({ onChangeExclude })} />);
    await user.click(screen.getByText(/Filtres/));
    const inputs = screen.getAllByPlaceholderText(/ex\./i);
    await user.type(inputs[0], "bak{Enter}");
    expect(onChangeExclude).toHaveBeenCalledWith(["tmp", "bak"]);
  });

  it("appelle onChangeInclude avec la nouvelle extension via Entree", async () => {
    const user = userEvent.setup();
    const onChangeInclude = vi.fn();
    renderWithLang(<FiltersPanel {...makeProps({ onChangeInclude })} />);
    await user.click(screen.getByText(/Filtres/));
    const inputs = screen.getAllByPlaceholderText(/ex\./i);
    await user.type(inputs[1], "jpg{Enter}");
    expect(onChangeInclude).toHaveBeenCalledWith(["jpg"]);
  });

  it("appelle onChangeMin quand on change la taille minimale", async () => {
    const user = userEvent.setup();
    const onChangeMin = vi.fn();
    renderWithLang(<FiltersPanel {...makeProps({ onChangeMin })} />);
    await user.click(screen.getByText(/Filtres/));
    const sizeInputs = screen.getAllByDisplayValue("0");
    fireEvent.change(sizeInputs[0], { target: { value: "100" } });
    expect(onChangeMin).toHaveBeenCalledWith(100);
  });

  it("appelle onChangeCache quand on coche/decoche le cache exact", async () => {
    const user = userEvent.setup();
    const onChangeCache = vi.fn();
    renderWithLang(<FiltersPanel {...makeProps({ onChangeCache })} />);
    await user.click(screen.getByText(/Filtres/));
    const cacheCheckbox = screen.getByRole("checkbox");
    await user.click(cacheCheckbox);
    expect(onChangeCache).toHaveBeenCalledWith(false);
  });

  it("se referme automatiquement quand disabled passe a true (demarrage d'un scan)", async () => {
    const { rerender } = renderWithLang(<FiltersPanel {...makeProps({ disabled: false })} />);
    await userEvent.setup().click(screen.getByText(/Filtres/));
    expect(screen.getByText("Extensions exclues")).toBeInTheDocument();
    rerender(<LangProvider><FiltersPanel {...makeProps({ disabled: true })} /></LangProvider>);
    await screen.findByText(/Filtres/);
    expect(screen.queryByText("Extensions exclues")).not.toBeInTheDocument();
  });
});
