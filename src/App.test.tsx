import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import App, { GroupCard, FiltersPanel } from "./App";
import { LangProvider } from "./LangContext";

// ----- Mocks globaux -----
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(() => Promise.resolve(() => {})),
}));
vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: vi.fn(),
}));
vi.mock("@tauri-apps/api/webview", () => ({
  getCurrentWebview: vi.fn(() => ({
    onDragDropEvent: vi.fn(() => Promise.resolve(() => {})),
  })),
}));

import { invoke } from "@tauri-apps/api/core";
import { open as dialogOpen } from "@tauri-apps/plugin-dialog";

const mockInvoke = invoke as ReturnType<typeof vi.fn>;
const mockDialogOpen = dialogOpen as ReturnType<typeof vi.fn>;

const baseSummary = {
  id: "1000",
  folder: "/home/test",
  total_wasted_bytes: 2048,
  total_groups: 2,
  scanned_files: 10,
  duration_ms: 50,
  by_folder: false,
  total_folders: 0,
  partial: false,
};

const baseGroup = {
  id: "g1",
  hash: "abc",
  size: 1024,
  files: [
    { path: "/a/file1.txt", size: 1024, name: "file1.txt", modified: 1700000000 },
    { path: "/b/file2.txt", size: 1024, name: "file2.txt", modified: 1700001000 },
  ],
};

const defaultPhashConfig = {
  min_file_size_bytes: 10240,
  min_images_size_filter: 50,
  aspect_ratio_tolerance: 0.2,
  min_images_aspect_filter: 10,
  two_pass_enabled: true,
  coarse_hash_size: 4,
  fine_hash_size: 8,
  coarse_threshold_multiplier: 2.0,
  min_images_two_pass: 20,
  cache_enabled: true,
  parallel_compare_enabled: true,
  min_images_parallel_compare: 200,
  perf_log_enabled: false,
};

const defaultVideoConfig = {
  n_frames: 8,
  duration_tolerance: 0.2,
  cache_enabled: true,
  use_dtw: false,
};

function makeDefaultMock(overrides: Record<string, unknown> = {}) {
  return (cmd: string, ...args: unknown[]) => {
    if (cmd in overrides) {
      const val = overrides[cmd];
      if (typeof val === "function") return (val as (...a: unknown[]) => unknown)(cmd, ...args);
      return Promise.resolve(val);
    }
    if (cmd === "list_sessions") return Promise.resolve([]);
    if (cmd === "get_phash_config") return Promise.resolve(defaultPhashConfig);
    if (cmd === "get_video_config") return Promise.resolve(defaultVideoConfig);
    return Promise.resolve(null);
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  mockInvoke.mockImplementation(makeDefaultMock());
});

// Helper pour rendre avec LangProvider (test de langue)
function renderWithLang(ui: React.ReactElement) {
  return render(<LangProvider>{ui}</LangProvider>);
}

// ---- A : resetResults est appelé quand on clique "Mes analyses" ----
describe("A - bouton retour Mes analyses", () => {
  it("fait disparaitre le summary de l'UI après clic", async () => {
    const user = userEvent.setup();

    mockInvoke.mockImplementation(
      makeDefaultMock({
        list_sessions: [baseSummary],
        load_session: baseSummary,
        get_groups_page: { groups: [baseGroup], offset: 0, total: 1, has_more: false },
      })
    );

    render(<App />);

    const resumeBtn = await screen.findByText("Reprendre");
    await user.click(resumeBtn);

    const backBtn = await screen.findByText(/Mes analyses/, {}, { timeout: 3000 });
    expect(backBtn).toBeInTheDocument();

    await waitFor(() => {
      const statElems = document.querySelectorAll(".stat");
      expect(statElems.length).toBeGreaterThan(0);
    });

    await user.click(backBtn);

    await waitFor(() => {
      expect(document.querySelector(".stats-row")).not.toBeInTheDocument();
    }, { timeout: 3000 });
  });
});

// ---- B : sélection toggle d'un fichier ----
describe("B - toggle de sélection d'un fichier", () => {
  it("appelle onToggle avec le bon path quand on clique sur la checkbox", () => {
    const onToggle = vi.fn();
    render(<GroupCard group={baseGroup} selected={new Set()} onToggle={onToggle} />);
    fireEvent.click(screen.getAllByRole("checkbox")[0]);
    expect(onToggle).toHaveBeenCalledWith("/a/file1.txt");
  });

  it("appelle onToggle avec le second path quand on clique sur la deuxième checkbox", () => {
    const onToggle = vi.fn();
    render(<GroupCard group={baseGroup} selected={new Set()} onToggle={onToggle} />);
    fireEvent.click(screen.getAllByRole("checkbox")[1]);
    expect(onToggle).toHaveBeenCalledWith("/b/file2.txt");
  });
});

// ---- C : suppression appelle delete_files avec les bons paths ----
describe("C - suppression de fichiers", () => {
  it("appelle invoke('delete_files') avec les paths sélectionnés", async () => {
    const user = userEvent.setup();

    mockInvoke.mockImplementation(
      makeDefaultMock({
        scan_folder: baseSummary,
        get_groups_page: { groups: [baseGroup], offset: 0, total: 1, has_more: false },
        delete_files: [],
      })
    );
    mockDialogOpen.mockResolvedValue("/home/test");

    render(<App />);

    await user.click(screen.getByText(/Cliquer pour choisir un dossier/));
    await waitFor(() => expect(screen.getByText("/home/test")).toBeInTheDocument());

    await user.click(screen.getByText("Analyser"));
    await waitFor(() => expect(screen.getByText(/fichiers identiques/)).toBeInTheDocument());

    const groupCard = document.querySelector(".group-card");
    const fileCheckboxes = groupCard!.querySelectorAll('input[type="checkbox"]');
    await user.click(fileCheckboxes[0] as HTMLElement);

    const deleteBtn = await screen.findByText(/Supprimer \d+ fichier/);
    await user.click(deleteBtn);

    const confirmBtn = await screen.findByRole("button", { name: "Supprimer" });
    await user.click(confirmBtn);

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith("delete_files", {
        paths: expect.arrayContaining(["/a/file1.txt"]),
      });
    });
  });
});

// ---- D : erreur affichée dans la bannière ----
describe("D - bannière d'erreur", () => {
  it("affiche le message d'erreur quand scan_folder échoue", async () => {
    const user = userEvent.setup();

    mockInvoke.mockImplementation(
      makeDefaultMock({
        scan_folder: () => Promise.reject("dossier introuvable"),
      })
    );
    mockDialogOpen.mockResolvedValue("/home/inexistant");

    render(<App />);

    await user.click(screen.getByText(/Cliquer pour choisir un dossier/));
    await waitFor(() => expect(screen.getByText("/home/inexistant")).toBeInTheDocument());

    await user.click(screen.getByText("Analyser"));

    await waitFor(() => {
      expect(screen.getByText(/dossier introuvable/)).toBeInTheDocument();
    });
  });
});

// ---- E : pagination ----
describe("E - pagination", () => {
  it("affiche le bouton 'Afficher plus' quand has_more est true", async () => {
    const user = userEvent.setup();
    const summaryWithMore = { ...baseSummary, total_groups: 60 };

    mockInvoke.mockImplementation(
      makeDefaultMock({
        scan_folder: summaryWithMore,
        get_groups_page: { groups: [baseGroup], offset: 0, total: 60, has_more: true },
      })
    );
    mockDialogOpen.mockResolvedValue("/home/test");

    render(<App />);
    await user.click(screen.getByText(/Cliquer pour choisir un dossier/));
    await waitFor(() => screen.getByText("/home/test"));
    await user.click(screen.getByText("Analyser"));

    const loadMoreBtn = await screen.findByText(/Afficher 50 de plus/);
    expect(loadMoreBtn).toBeInTheDocument();
  });

  it("charge la page suivante en passant le bon offset", async () => {
    const user = userEvent.setup();
    const summaryWithMore = { ...baseSummary, total_groups: 60 };
    let callCount = 0;

    mockInvoke.mockImplementation(
      makeDefaultMock({
        scan_folder: summaryWithMore,
        get_groups_page: () => {
          callCount++;
          if (callCount === 1) {
            return Promise.resolve({ groups: [baseGroup], offset: 0, total: 60, has_more: true });
          }
          return Promise.resolve({ groups: [], offset: 1, total: 60, has_more: false });
        },
      })
    );
    mockDialogOpen.mockResolvedValue("/home/test");

    render(<App />);
    await user.click(screen.getByText(/Cliquer pour choisir un dossier/));
    await waitFor(() => screen.getByText("/home/test"));
    await user.click(screen.getByText("Analyser"));

    const loadMoreBtn = await screen.findByText(/Afficher 50 de plus/);
    await user.click(loadMoreBtn);

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith("get_groups_page", { offset: 1, limit: 50 });
    });
  });
});

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

  it("est fermé par défaut et affiche le count total de filtres actifs", () => {
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

  it("appelle onChangeExcluded sans le dossier supprimé au clic sur son ×", async () => {
    const user = userEvent.setup();
    const onChangeExcluded = vi.fn();
    renderWithLang(<FiltersPanel {...makeProps({ onChangeExcluded })} />);
    await user.click(screen.getByText(/Filtres/));
    // Le premier × correspond à la chip "node_modules"
    await user.click(screen.getAllByText("×")[0]);
    expect(onChangeExcluded).toHaveBeenCalledWith([]);
  });

  it("appelle onChangeExclude avec la nouvelle extension via Entrée", async () => {
    const user = userEvent.setup();
    const onChangeExclude = vi.fn();
    renderWithLang(<FiltersPanel {...makeProps({ onChangeExclude })} />);
    await user.click(screen.getByText(/Filtres/));
    const inputs = screen.getAllByPlaceholderText(/ex\./i);
    await user.type(inputs[0], "bak{Enter}");
    expect(onChangeExclude).toHaveBeenCalledWith(["tmp", "bak"]);
  });
});

// ---- G : bascule de langue ----
describe("G - bascule de langue", () => {
  it("affiche 'Scan' en anglais après clic sur EN", async () => {
    const user = userEvent.setup();
    renderWithLang(<App />);

    expect(screen.getByText("Analyser")).toBeInTheDocument();

    await user.click(screen.getByText("EN"));

    await waitFor(() => {
      expect(screen.getByText("Scan")).toBeInTheDocument();
    });
  });

  it("persiste la langue dans localStorage", async () => {
    const user = userEvent.setup();
    renderWithLang(<App />);

    await user.click(screen.getByText("EN"));

    expect(localStorage.getItem("lang")).toBe("en");
  });

  it("démarre en anglais si localStorage contient 'en'", async () => {
    localStorage.setItem("lang", "en");
    renderWithLang(<App />);

    await waitFor(() => {
      expect(screen.getByText("Scan")).toBeInTheDocument();
    });
  });
});
