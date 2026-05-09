import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import App from "./App";
import { LangProvider } from "./LangContext";

// ----- Mocks globaux -----
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(() => Promise.resolve(() => {})),
}));
vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: vi.fn(),
  save: vi.fn(),
}));
vi.mock("@tauri-apps/api/webview", () => ({
  getCurrentWebview: vi.fn(() => ({
    onDragDropEvent: vi.fn(() => Promise.resolve(() => {})),
  })),
}));

import { invoke } from "@tauri-apps/api/core";
import { open as dialogOpen, save as dialogSave } from "@tauri-apps/plugin-dialog";

const mockInvoke = invoke as ReturnType<typeof vi.fn>;
const mockDialogOpen = dialogOpen as ReturnType<typeof vi.fn>;
const mockDialogSave = dialogSave as ReturnType<typeof vi.fn>;

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

const defaultAudioConfig = {
  duration_tolerance: 0.2,
  cache_enabled: true,
};

function makeDefaultMock(overrides: Record<string, unknown> = {}) {
  return (cmd: string, ...args: unknown[]) => {
    if (cmd in overrides) {
      const val = overrides[cmd];
      if (typeof val === "function") return (val as (...a: unknown[]) => unknown)(cmd, ...args);
      return Promise.resolve(val);
    }
    if (cmd === "list_sessions") return Promise.resolve([]);
    if (cmd === "get_cache_size") return Promise.resolve(0);
    if (cmd === "check_tools") return Promise.resolve({ ffmpeg_available: true, fpcalc_available: true });
    if (cmd === "get_phash_config") return Promise.resolve(defaultPhashConfig);
    if (cmd === "get_video_config") return Promise.resolve(defaultVideoConfig);
    if (cmd === "get_audio_config") return Promise.resolve(defaultAudioConfig);
    if (cmd === "list_profiles") return Promise.resolve([]);
    if (cmd === "get_ignore_list") return Promise.resolve([]);
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
      expect(screen.getByTestId("stats-row")).toBeInTheDocument();
    });

    await user.click(backBtn);

    await waitFor(() => {
      expect(screen.queryByTestId("stats-row")).not.toBeInTheDocument();
    }, { timeout: 3000 });
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

    await user.click(within(screen.getAllByTestId("group-files")[0]).getAllByRole("checkbox")[0]);

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

  it("met a jour total_wasted_bytes apres suppression", async () => {
    const user = userEvent.setup();

    const group1 = { id: "g1", hash: "a", size: 1024, files: [
      { path: "/a/file1.txt", size: 1024, name: "file1.txt", modified: 1 },
      { path: "/a/file2.txt", size: 1024, name: "file2.txt", modified: 2 },
    ]};
    const group2 = { id: "g2", hash: "b", size: 2048, files: [
      { path: "/b/file3.txt", size: 2048, name: "file3.txt", modified: 1 },
      { path: "/b/file4.txt", size: 2048, name: "file4.txt", modified: 2 },
    ]};
    // total_wasted_bytes = 1024*(2-1) + 2048*(2-1) = 3072
    const summary2 = { ...baseSummary, total_groups: 2, total_wasted_bytes: 3072 };

    mockInvoke.mockImplementation(
      makeDefaultMock({
        scan_folder: summary2,
        get_groups_page: { groups: [group1, group2], offset: 0, total: 2, has_more: false },
        delete_files: [],
      })
    );
    mockDialogOpen.mockResolvedValue("/home/test");

    render(<App />);
    await user.click(screen.getByText(/Cliquer pour choisir un dossier/));
    await waitFor(() => expect(screen.getByText("/home/test")).toBeInTheDocument());
    await user.click(screen.getByText("Analyser"));
    // Attendre l'affichage du total récupérable initial
    await waitFor(() => expect(screen.getByText("3.0 Ko")).toBeInTheDocument());

    // Supprimer file1 du groupe 1 (groupe 1 disparait, seul groupe 2 reste : 2048 o)
    await user.click(within(screen.getAllByTestId("group-files")[0]).getAllByRole("checkbox")[0]);
    const deleteBtn = await screen.findByText(/Supprimer \d+ fichier/);
    await user.click(deleteBtn);
    await user.click(await screen.findByRole("button", { name: "Supprimer" }));

    await waitFor(() => {
      // Apres suppression : seul groupe 2 reste -> 2048 o = 2.0 Ko
      expect(screen.getByText("2.0 Ko")).toBeInTheDocument();
      expect(screen.queryByText("3.0 Ko")).not.toBeInTheDocument();
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

// ---- I : export de résultats ----
describe("I - export de résultats", () => {
  it("appelle dialog.save puis invoke export_results pour le CSV", async () => {
    const user = userEvent.setup();

    mockInvoke.mockImplementation(
      makeDefaultMock({
        scan_folder: baseSummary,
        get_groups_page: { groups: [baseGroup], offset: 0, total: 1, has_more: false },
        export_results: null,
      })
    );
    mockDialogOpen.mockResolvedValue("/home/test");
    mockDialogSave.mockResolvedValue("/home/test/rapport.csv");

    render(<App />);
    await user.click(screen.getByText(/Cliquer pour choisir un dossier/));
    await waitFor(() => screen.getByText("/home/test"));
    await user.click(screen.getByText("Analyser"));
    await waitFor(() => screen.getByText(/fichiers identiques/));

    await user.click(screen.getByText("Export CSV"));

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith("export_results", {
        sessionId: baseSummary.id,
        format: "csv",
        outputPath: "/home/test/rapport.csv",
      });
    });
  });

  it("appelle dialog.save avec les bons filtres pour le HTML", async () => {
    const user = userEvent.setup();

    mockInvoke.mockImplementation(
      makeDefaultMock({
        scan_folder: baseSummary,
        get_groups_page: { groups: [baseGroup], offset: 0, total: 1, has_more: false },
        export_results: null,
      })
    );
    mockDialogOpen.mockResolvedValue("/home/test");
    mockDialogSave.mockResolvedValue("/home/test/rapport.html");

    render(<App />);
    await user.click(screen.getByText(/Cliquer pour choisir un dossier/));
    await waitFor(() => screen.getByText("/home/test"));
    await user.click(screen.getByText("Analyser"));
    await waitFor(() => screen.getByText(/fichiers identiques/));

    await user.click(screen.getByText("Rapport HTML"));

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith("export_results", {
        sessionId: baseSummary.id,
        format: "html",
        outputPath: "/home/test/rapport.html",
      });
    });
  });

  it("n'appelle pas export_results si dialog.save est annulé", async () => {
    const user = userEvent.setup();

    mockInvoke.mockImplementation(
      makeDefaultMock({
        scan_folder: baseSummary,
        get_groups_page: { groups: [baseGroup], offset: 0, total: 1, has_more: false },
      })
    );
    mockDialogOpen.mockResolvedValue("/home/test");
    mockDialogSave.mockResolvedValue(null);

    render(<App />);
    await user.click(screen.getByText(/Cliquer pour choisir un dossier/));
    await waitFor(() => screen.getByText("/home/test"));
    await user.click(screen.getByText("Analyser"));
    await waitFor(() => screen.getByText(/fichiers identiques/));

    await user.click(screen.getByText("Export CSV"));

    await waitFor(() => {
      expect(mockInvoke).not.toHaveBeenCalledWith("export_results", expect.anything());
    });
  });
});

// ---- J : mode audio ----
describe("J - mode audio", () => {
  it("scan_folder recu findSimilarAudio:true et audioSimThreshold:0 en mode audio a 100%", async () => {
    const user = userEvent.setup();
    const audioSummary = { ...baseSummary, find_similar_audio: true };
    mockInvoke.mockImplementation(
      makeDefaultMock({
        scan_folder: audioSummary,
        get_groups_page: { groups: [], offset: 0, total: 0, has_more: false },
      })
    );
    mockDialogOpen.mockResolvedValue("/home/music");

    render(<App />);
    await user.click(screen.getByText(/Cliquer pour choisir un dossier/));
    await waitFor(() => screen.getByText("/home/music"));

    await user.click(screen.getByText("🎵 Audio"));
    await user.click(screen.getByText("Analyser"));

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith(
        "scan_folder",
        expect.objectContaining({ findSimilarAudio: true, audioSimThreshold: 0 })
      );
    });
  });

  it("affiche le bandeau ffmpegMissing quand le scan retourne ffmpeg_missing:true", async () => {
    const user = userEvent.setup();
    const summaryFfmpegMissing = { ...baseSummary, ffmpeg_missing: true };
    mockInvoke.mockImplementation(
      makeDefaultMock({
        scan_folder: summaryFfmpegMissing,
        get_groups_page: { groups: [], offset: 0, total: 0, has_more: false },
      })
    );
    mockDialogOpen.mockResolvedValue("/home/videos");

    render(<App />);
    await user.click(screen.getByText(/Cliquer pour choisir un dossier/));
    await waitFor(() => screen.getByText("/home/videos"));
    await user.click(screen.getByText("Analyser"));

    await waitFor(() => {
      expect(screen.getByText(/ffmpeg introuvable/i)).toBeInTheDocument();
    });
  });

  it("affiche le bandeau fpcalcMissing quand le scan retourne fpcalc_missing:true", async () => {
    const user = userEvent.setup();
    const summaryFpcalcMissing = { ...baseSummary, fpcalc_missing: true };
    mockInvoke.mockImplementation(
      makeDefaultMock({
        scan_folder: summaryFpcalcMissing,
        get_groups_page: { groups: [], offset: 0, total: 0, has_more: false },
      })
    );
    mockDialogOpen.mockResolvedValue("/home/music");

    render(<App />);
    await user.click(screen.getByText(/Cliquer pour choisir un dossier/));
    await waitFor(() => screen.getByText("/home/music"));
    await user.click(screen.getByText("Analyser"));

    await waitFor(() => {
      expect(screen.getByText(/fpcalc introuvable/i)).toBeInTheDocument();
    });
  });

  it("affiche AudioAdvancedPanel quand le mode audio est selectionne", async () => {
    const user = userEvent.setup();
    render(<App />);

    const audioBtn = await screen.findByText("🎵 Audio");
    await user.click(audioBtn);

    const advancedToggle = screen.getByText(/Param.*tres avanc.*s/i);
    expect(advancedToggle).toBeInTheDocument();

    await user.click(advancedToggle);
    expect(screen.getByText("Cache entre scans")).toBeInTheDocument();
  });

});

// ---- M : règles de sélection par métadonnées ----
describe("M - règles de sélection", () => {
  async function renderWithResults() {
    const user = userEvent.setup();
    mockInvoke.mockImplementation(
      makeDefaultMock({
        scan_folder: baseSummary,
        get_groups_page: { groups: [baseGroup], offset: 0, total: 1, has_more: false },
        smart_select: [],
      })
    );
    mockDialogOpen.mockResolvedValue("/home/test");

    render(<App />);
    await user.click(screen.getByText(/Cliquer pour choisir un dossier/));
    await waitFor(() => expect(screen.getByText("/home/test")).toBeInTheDocument());
    await user.click(screen.getByText("Analyser"));
    await waitFor(() => expect(screen.getByText(/fichiers identiques/)).toBeInTheDocument());
    return user;
  }

  it("affiche le dropdown avec les 5 règles de sélection", async () => {
    await renderWithResults();
    const select = screen.getByTestId("rule-select") as HTMLSelectElement;
    const options = Array.from(select.options).map((o) => o.value);
    expect(options).toContain("newest");
    expect(options).toContain("oldest");
    expect(options).toContain("highest_resolution");
    expect(options).toContain("largest_size");
    expect(options).toContain("priority_folder");
  });

  it("l'input dossier prioritaire n'est pas visible par défaut", async () => {
    await renderWithResults();
    expect(screen.queryByPlaceholderText(/prioritaire/i)).not.toBeInTheDocument();
  });

  it("l'input dossier prioritaire apparaît quand priority_folder est sélectionné", async () => {
    const user = await renderWithResults();
    const select = screen.getByTestId("rule-select");
    await user.selectOptions(select, "priority_folder");
    expect(screen.getByPlaceholderText(/prioritaire/i)).toBeInTheDocument();
  });

  it("l'input dossier prioritaire disparaît quand on change de règle", async () => {
    const user = await renderWithResults();
    const select = screen.getByTestId("rule-select");
    await user.selectOptions(select, "priority_folder");
    await user.selectOptions(select, "newest");
    expect(screen.queryByPlaceholderText(/prioritaire/i)).not.toBeInTheDocument();
  });

  it("Appliquer avec newest appelle smart_select avec mode newest", async () => {
    const user = await renderWithResults();
    await user.click(screen.getByRole("button", { name: "Appliquer" }));
    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith("smart_select", {
        mode: "newest",
        folderPrefix: null,
      });
    });
  });

  it("Appliquer avec largest_size appelle smart_select avec mode largest_size", async () => {
    const user = await renderWithResults();
    const select = screen.getByTestId("rule-select");
    await user.selectOptions(select, "largest_size");
    await user.click(screen.getByRole("button", { name: "Appliquer" }));
    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith("smart_select", {
        mode: "largest_size",
        folderPrefix: null,
      });
    });
  });

  it("Appliquer avec priority_folder transmet le chemin saisi", async () => {
    const user = await renderWithResults();
    const select = screen.getByTestId("rule-select");
    await user.selectOptions(select, "priority_folder");
    const input = screen.getByPlaceholderText(/prioritaire/i);
    await user.type(input, "/home/important");
    await user.click(screen.getByRole("button", { name: "Appliquer" }));
    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith("smart_select", {
        mode: "priority_folder",
        folderPrefix: "/home/important",
      });
    });
  });

  it("aucun fichier coché si smart_select retourne [] (groupe ignoré)", async () => {
    const user = await renderWithResults();
    await user.click(screen.getByRole("button", { name: "Appliquer" }));
    await waitFor(() =>
      expect(mockInvoke).toHaveBeenCalledWith("smart_select", expect.anything())
    );
    expect(screen.queryByText(/Supprimer \d+ fichier/)).not.toBeInTheDocument();
  });

  it("les fichiers retournés par smart_select sont cochés dans l'UI", async () => {
    const user = userEvent.setup();
    mockInvoke.mockImplementation(
      makeDefaultMock({
        scan_folder: baseSummary,
        get_groups_page: { groups: [baseGroup], offset: 0, total: 1, has_more: false },
        smart_select: ["/a/file1.txt"],
      })
    );
    mockDialogOpen.mockResolvedValue("/home/test");

    render(<App />);
    await user.click(screen.getByText(/Cliquer pour choisir un dossier/));
    await waitFor(() => expect(screen.getByText("/home/test")).toBeInTheDocument());
    await user.click(screen.getByText("Analyser"));
    await waitFor(() => expect(screen.getByText(/fichiers identiques/)).toBeInTheDocument());

    await user.click(screen.getByRole("button", { name: "Appliquer" }));
    await waitFor(() =>
      expect(screen.getByText(/Supprimer 1 fichier/)).toBeInTheDocument()
    );
  });
});

describe("N - liste d'ignorés", () => {
  async function renderWithResults(overrides: Record<string, unknown> = {}) {
    const user = userEvent.setup();
    mockInvoke.mockImplementation(
      makeDefaultMock({
        scan_folder: baseSummary,
        get_groups_page: { groups: [baseGroup], offset: 0, total: 1, has_more: false },
        ignore_group: null,
        get_ignore_list: [],
        clear_ignore_entry: null,
        clear_all_ignored: null,
        ...overrides,
      })
    );
    mockDialogOpen.mockResolvedValue("/home/test");

    render(<App />);
    await user.click(screen.getByText(/Cliquer pour choisir un dossier/));
    await waitFor(() => expect(screen.getByText("/home/test")).toBeInTheDocument());
    await user.click(screen.getByText("Analyser"));
    await waitFor(() => expect(screen.getByText(/fichiers identiques/)).toBeInTheDocument());
    return user;
  }

  it("le bouton ignorer est visible sur chaque GroupCard", async () => {
    await renderWithResults();
    expect(screen.getByTestId("ignore-group-btn")).toBeInTheDocument();
  });

  it("cliquer ignorer affiche la confirmation", async () => {
    const user = await renderWithResults();
    await user.click(screen.getByTestId("ignore-group-btn"));
    expect(screen.getByTestId("ignore-confirm-row")).toBeInTheDocument();
  });

  it("confirmer ignore appelle invoke ignore_group avec le bon id", async () => {
    const user = await renderWithResults();
    await user.click(screen.getByTestId("ignore-group-btn"));
    await user.click(screen.getByTestId("ignore-confirm-btn"));
    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith("ignore_group", { groupId: "g1" });
    });
  });

  it("après confirm ignore, le groupe disparaît de la liste", async () => {
    const user = await renderWithResults();
    expect(screen.getByText("file1.txt")).toBeInTheDocument();
    await user.click(screen.getByTestId("ignore-group-btn"));
    await user.click(screen.getByTestId("ignore-confirm-btn"));
    await waitFor(() => {
      expect(screen.queryByText("file1.txt")).not.toBeInTheDocument();
    });
  });

  it("le bouton du panneau ignorés est visible même sans résultats", async () => {
    render(<App />);
    expect(screen.getByTestId("ignored-panel")).toBeInTheDocument();
  });

  it("le panneau affiche les entrées après ouverture du dropdown", async () => {
    const user = await renderWithResults({
      get_ignore_list: [
        { key: "k1", display_names: ["photo.jpg", "photo_copy.jpg"], ignored_at: 1700000000 },
      ],
    });
    await waitFor(() => expect(screen.getByText("1")).toBeInTheDocument());
    await user.click(screen.getByTestId("ignored-panel").querySelector("button")!);
    expect(screen.getByText(/photo\.jpg/)).toBeInTheDocument();
  });

  it("cliquer Retirer appelle clear_ignore_entry avec la bonne clé", async () => {
    const user = await renderWithResults({
      get_ignore_list: [
        { key: "k1", display_names: ["photo.jpg", "photo_copy.jpg"], ignored_at: 1700000000 },
      ],
    });
    await waitFor(() => expect(screen.getByText("1")).toBeInTheDocument());
    await user.click(screen.getByTestId("ignored-panel").querySelector("button")!);
    await user.click(screen.getByTestId("remove-ignored"));
    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith("clear_ignore_entry", { key: "k1" });
    });
  });

  it("cliquer Tout effacer appelle clear_all_ignored", async () => {
    const user = await renderWithResults({
      get_ignore_list: [
        { key: "k1", display_names: ["photo.jpg"], ignored_at: 1700000000 },
      ],
    });
    await waitFor(() => expect(screen.getByText("1")).toBeInTheDocument());
    await user.click(screen.getByTestId("ignored-panel").querySelector("button")!);
    await user.click(screen.getByTestId("clear-all-ignored"));
    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith("clear_all_ignored");
    });
  });
});

describe("O - aide intégrée", () => {
  it("le bouton ? est présent dans le header", () => {
    render(<App />);
    expect(screen.getByTestId("help-open-btn")).toBeInTheDocument();
  });

  it("cliquer le bouton ? ouvre le panneau d'aide", async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByTestId("help-open-btn"));
    expect(screen.getByTestId("help-panel")).toBeInTheDocument();
  });

  it("F1 ouvre le panneau d'aide", async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.keyboard("{F1}");
    expect(screen.getByTestId("help-panel")).toBeInTheDocument();
  });

  it("le panneau d'aide se ferme avec Escape", async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByTestId("help-open-btn"));
    expect(screen.getByTestId("help-panel")).toBeInTheDocument();
    await user.keyboard("{Escape}");
    expect(screen.queryByTestId("help-panel")).not.toBeInTheDocument();
  });

  it("le panneau d'aide se ferme avec le bouton ✕", async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByTestId("help-open-btn"));
    await user.click(screen.getByRole("button", { name: /fermer/i }));
    expect(screen.queryByTestId("help-panel")).not.toBeInTheDocument();
  });
});

// ---- P : notifications ----
describe("P - notifications", () => {
  it("scan_folder recoit notificationThresholdSecs: 10", async () => {
    const user = userEvent.setup();
    mockInvoke.mockImplementation(
      makeDefaultMock({
        scan_folder: baseSummary,
        get_groups_page: { groups: [], offset: 0, total: 0, has_more: false },
      })
    );
    mockDialogOpen.mockResolvedValue("/home/test");

    render(<App />);
    await user.click(screen.getByText(/Cliquer pour choisir un dossier/));
    await waitFor(() => screen.getByText("/home/test"));
    await user.click(screen.getByText("Analyser"));

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith(
        "scan_folder",
        expect.objectContaining({ notificationThresholdSecs: 10 })
      );
    });
  });

  it("scan_folder recoit notificationLang egal a la langue active (fr par defaut)", async () => {
    const user = userEvent.setup();
    mockInvoke.mockImplementation(
      makeDefaultMock({
        scan_folder: baseSummary,
        get_groups_page: { groups: [], offset: 0, total: 0, has_more: false },
      })
    );
    mockDialogOpen.mockResolvedValue("/home/test");

    renderWithLang(<App />);
    await user.click(screen.getByText(/Cliquer pour choisir un dossier/));
    await waitFor(() => screen.getByText("/home/test"));
    await user.click(screen.getByText("Analyser"));

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith(
        "scan_folder",
        expect.objectContaining({ notificationLang: "fr" })
      );
    });
  });

  it("notificationLang change si on switche la langue en EN avant le scan", async () => {
    const user = userEvent.setup();
    mockInvoke.mockImplementation(
      makeDefaultMock({
        scan_folder: baseSummary,
        get_groups_page: { groups: [], offset: 0, total: 0, has_more: false },
      })
    );
    mockDialogOpen.mockResolvedValue("/home/test");

    renderWithLang(<App />);
    // switcher en anglais
    await user.click(screen.getByText("EN"));
    await user.click(screen.getByText(/Click to choose a folder/));
    await waitFor(() => screen.getByText("/home/test"));
    await user.click(screen.getByText("Scan"));

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith(
        "scan_folder",
        expect.objectContaining({ notificationLang: "en" })
      );
    });
  });
});

// ---- Q : mode "comparer avec un autre dossier" ----
describe("Q - mode compare_folder", () => {
  it("le sélecteur de dossier secondaire n'est pas visible en mode 'all'", () => {
    render(<App />);
    expect(screen.queryByTestId("secondary-folder-row")).not.toBeInTheDocument();
  });

  it("le sélecteur de dossier secondaire n'est pas visible en mode 'by_folder'", async () => {
    const user = userEvent.setup();
    render(<App />);
    const selects = screen.getAllByRole("combobox");
    await user.selectOptions(selects[0], "by_folder");
    expect(screen.queryByTestId("secondary-folder-row")).not.toBeInTheDocument();
  });

  it("le sélecteur de dossier secondaire est visible en mode 'compare_folder'", async () => {
    const user = userEvent.setup();
    render(<App />);
    const selects = screen.getAllByRole("combobox");
    await user.selectOptions(selects[0], "compare_folder");
    expect(screen.getByTestId("secondary-folder-row")).toBeInTheDocument();
  });

  it("cliquer sur le sélecteur secondaire appelle open()", async () => {
    const user = userEvent.setup();
    mockDialogOpen.mockResolvedValue("/home/ref");
    render(<App />);
    const selects = screen.getAllByRole("combobox");
    await user.selectOptions(selects[0], "compare_folder");
    const secondaryInput = screen.getByTestId("secondary-folder-input");
    await user.click(secondaryInput);
    await waitFor(() => {
      expect(mockDialogOpen).toHaveBeenCalledWith({ directory: true, multiple: false });
    });
  });

  it("le chemin du dossier secondaire s'affiche après sélection", async () => {
    const user = userEvent.setup();
    mockDialogOpen.mockResolvedValue("/home/ref");
    render(<App />);
    const selects = screen.getAllByRole("combobox");
    await user.selectOptions(selects[0], "compare_folder");
    await user.click(screen.getByTestId("secondary-folder-input"));
    await waitFor(() => {
      expect(screen.getByText("/home/ref")).toBeInTheDocument();
    });
  });

  it("scan_folder est invoqué avec secondaryFolder en mode compare_folder", async () => {
    const user = userEvent.setup();
    mockInvoke.mockImplementation(
      makeDefaultMock({
        scan_folder: baseSummary,
        get_groups_page: { groups: [], offset: 0, total: 0, has_more: false },
      })
    );
    // First click picks primary folder, second picks secondary
    mockDialogOpen
      .mockResolvedValueOnce("/home/source")
      .mockResolvedValueOnce("/home/reference");

    render(<App />);
    const selects = screen.getAllByRole("combobox");
    await user.selectOptions(selects[0], "compare_folder");
    await user.click(screen.getByText(/Cliquer pour choisir un dossier/));
    await waitFor(() => expect(screen.getByText("/home/source")).toBeInTheDocument());
    await user.click(screen.getByTestId("secondary-folder-input"));
    await waitFor(() => expect(screen.getByText("/home/reference")).toBeInTheDocument());
    await user.click(screen.getByText("Analyser"));

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith(
        "scan_folder",
        expect.objectContaining({ secondaryFolder: "/home/reference" })
      );
    });
  });

  it("scan_folder est invoqué avec secondaryFolder: null en mode 'all'", async () => {
    const user = userEvent.setup();
    mockInvoke.mockImplementation(
      makeDefaultMock({
        scan_folder: baseSummary,
        get_groups_page: { groups: [], offset: 0, total: 0, has_more: false },
      })
    );
    mockDialogOpen.mockResolvedValue("/home/test");

    render(<App />);
    await user.click(screen.getByText(/Cliquer pour choisir un dossier/));
    await waitFor(() => expect(screen.getByText("/home/test")).toBeInTheDocument());
    await user.click(screen.getByText("Analyser"));

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith(
        "scan_folder",
        expect.objectContaining({ secondaryFolder: null })
      );
    });
  });
});

// ---- R : session picker toujours visible + cache ----
describe("R - session picker et gestion du cache", () => {
  it("affiche 'Aucune analyse enregistrée' quand il n'y a pas de sessions", async () => {
    mockInvoke.mockImplementation(makeDefaultMock({ list_sessions: [] }));
    render(<App />);
    await waitFor(() => {
      expect(screen.getByText("Aucune analyse enregistrée")).toBeInTheDocument();
    });
  });

  it("affiche le titre 'Analyses précédentes' même sans session", async () => {
    mockInvoke.mockImplementation(makeDefaultMock({ list_sessions: [] }));
    render(<App />);
    await waitFor(() => {
      expect(screen.getByText("Analyses précédentes")).toBeInTheDocument();
    });
  });

  it("affiche la taille du cache et le bouton Purger quand cache > 0", async () => {
    mockInvoke.mockImplementation(makeDefaultMock({ get_cache_size: 2048000 }));
    render(<App />);
    await waitFor(() => {
      expect(screen.getByText(/Cache de détection/)).toBeInTheDocument();
      expect(screen.getByText("Purger")).toBeInTheDocument();
    });
  });

  it("n'affiche pas la section cache quand cache = 0", async () => {
    mockInvoke.mockImplementation(makeDefaultMock({ get_cache_size: 0 }));
    render(<App />);
    await waitFor(() => {
      expect(screen.queryByText(/Cache de détection/)).not.toBeInTheDocument();
    });
  });

  it("affiche la confirmation avant la purge", async () => {
    const user = userEvent.setup();
    mockInvoke.mockImplementation(makeDefaultMock({ get_cache_size: 1048576, purge_cache: null }));
    render(<App />);
    const purgeBtn = await screen.findByText("Purger");
    await user.click(purgeBtn);
    expect(screen.getByText(/Purger le cache de détection/)).toBeInTheDocument();
  });

  it("annule la confirmation au clic sur Annuler", async () => {
    const user = userEvent.setup();
    mockInvoke.mockImplementation(makeDefaultMock({ get_cache_size: 1048576, purge_cache: null }));
    render(<App />);
    const purgeBtn = await screen.findByText("Purger");
    await user.click(purgeBtn);
    await user.click(screen.getByText("Annuler"));
    expect(screen.queryByText(/Purger le cache de détection/)).not.toBeInTheDocument();
    expect(screen.getByText("Purger")).toBeInTheDocument();
  });

  it("appelle purge_cache et recharge la taille apres confirmation", async () => {
    const user = userEvent.setup();
    mockInvoke.mockImplementation(makeDefaultMock({
      get_cache_size: (cmd: string) => Promise.resolve(cmd === "get_cache_size" ? 1048576 : null),
      purge_cache: null,
    }));
    let callCount = 0;
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "list_sessions") return Promise.resolve([]);
      if (cmd === "get_phash_config") return Promise.resolve(defaultPhashConfig);
      if (cmd === "get_video_config") return Promise.resolve(defaultVideoConfig);
      if (cmd === "get_audio_config") return Promise.resolve(defaultAudioConfig);
      if (cmd === "list_profiles") return Promise.resolve([]);
      if (cmd === "get_ignore_list") return Promise.resolve([]);
      if (cmd === "get_cache_size") { callCount++; return Promise.resolve(callCount === 1 ? 1048576 : 0); }
      if (cmd === "purge_cache") return Promise.resolve(null);
      return Promise.resolve(null);
    });
    render(<App />);
    const purgeBtn = await screen.findByText("Purger");
    await user.click(purgeBtn);
    await user.click(screen.getAllByText("Purger")[0]);
    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith("purge_cache");
    });
  });
});

// ---- S : option "Analyser les archives" ----
describe("S - option Analyser les archives", () => {
  it("la checkbox est visible en mode Fichiers", async () => {
    render(<App />);
    await waitFor(() => {
      expect(screen.getByTestId("scan-archives-checkbox")).toBeInTheDocument();
    });
  });

  it("la checkbox est visible en mode Images (Phase 27B - pHash dans archives)", async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByText("🖼 Images"));
    expect(screen.getByTestId("scan-archives-checkbox")).toBeInTheDocument();
  });

  it("la checkbox n'est pas visible en mode Vidéos", async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByText("🎬 Vidéos"));
    expect(screen.queryByTestId("scan-archives-checkbox")).not.toBeInTheDocument();
  });

  it("cocher la checkbox envoie scanArchives: true dans les args scan", async () => {
    const user = userEvent.setup();
    mockInvoke.mockImplementation(
      makeDefaultMock({
        scan_folder: baseSummary,
        get_groups_page: { groups: [], offset: 0, total: 0, has_more: false },
      })
    );
    mockDialogOpen.mockResolvedValue("/home/test");

    render(<App />);
    await user.click(screen.getByText(/Cliquer pour choisir un dossier/));
    await waitFor(() => screen.getByText("/home/test"));

    await user.click(screen.getByTestId("scan-archives-checkbox"));
    await user.click(screen.getByText("Analyser"));

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith(
        "scan_folder",
        expect.objectContaining({ scanArchives: true })
      );
    });
  });

  it("checkbox decochee envoie scanArchives: false (pas undefined) dans les args scan", async () => {
    const user = userEvent.setup();
    mockInvoke.mockImplementation(
      makeDefaultMock({
        scan_folder: baseSummary,
        get_groups_page: { groups: [], offset: 0, total: 0, has_more: false },
      })
    );
    mockDialogOpen.mockResolvedValue("/home/test");

    render(<App />);
    await user.click(screen.getByText(/Cliquer pour choisir un dossier/));
    await waitFor(() => screen.getByText("/home/test"));

    await user.click(screen.getByText("Analyser"));

    await waitFor(() => {
      const call = mockInvoke.mock.calls.find((c) => c[0] === "scan_folder");
      expect(call).toBeDefined();
      expect(call![1]).toHaveProperty("scanArchives", false);
    });
  });

  it("la section archives s'affiche si archiveGroups.length > 0 apres scan", async () => {
    const user = userEvent.setup();
    const summaryWithArchives = { ...baseSummary, archive_groups_count: 1 };
    const archiveGroup = {
      id: "ag1",
      shared_entry_count: 2,
      archives: [
        { path: "/data/a.zip", size: 1024, modified: 1700000000, total_entries: 3, duplicated_entries: 2, can_delete: false, wasted_bytes: 0 },
        { path: "/data/b.zip", size: 2048, modified: 1700001000, total_entries: 3, duplicated_entries: 2, can_delete: true, wasted_bytes: 512 },
      ],
    };

    mockInvoke.mockImplementation(
      makeDefaultMock({
        scan_folder: summaryWithArchives,
        get_groups_page: { groups: [], offset: 0, total: 0, has_more: false },
        get_archive_groups: [archiveGroup],
      })
    );
    mockDialogOpen.mockResolvedValue("/home/test");

    render(<App />);
    await user.click(screen.getByText(/Cliquer pour choisir un dossier/));
    await waitFor(() => screen.getByText("/home/test"));
    await user.click(screen.getByText("Analyser"));

    await waitFor(() => {
      expect(screen.getByTestId("archive-group-card")).toBeInTheDocument();
    });
  });

  it("invoke get_archive_comparison est appelé au clic sur Comparer", async () => {
    const user = userEvent.setup();
    const summaryWithArchives = { ...baseSummary, archive_groups_count: 1 };
    const archiveGroup = {
      id: "ag1",
      shared_entry_count: 2,
      archives: [
        { path: "/data/a.zip", size: 1024, modified: 1700000000, total_entries: 3, duplicated_entries: 2, can_delete: false, wasted_bytes: 0 },
        { path: "/data/b.zip", size: 2048, modified: 1700001000, total_entries: 3, duplicated_entries: 2, can_delete: true, wasted_bytes: 512 },
      ],
    };

    mockInvoke.mockImplementation(
      makeDefaultMock({
        scan_folder: summaryWithArchives,
        get_groups_page: { groups: [], offset: 0, total: 0, has_more: false },
        get_archive_groups: [archiveGroup],
        get_archive_comparison: {
          a: { path: "/data/a.zip", entries: [] },
          b: { path: "/data/b.zip", entries: [] },
        },
      })
    );
    mockDialogOpen.mockResolvedValue("/home/test");

    render(<App />);
    await user.click(screen.getByText(/Cliquer pour choisir un dossier/));
    await waitFor(() => screen.getByText("/home/test"));
    await user.click(screen.getByText("Analyser"));

    await waitFor(() => screen.getByTestId("archive-group-card"));

    await user.click(screen.getByRole("button", { name: "Comparer" }));

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith("get_archive_comparison", {
        pathA: "/data/a.zip",
        pathB: "/data/b.zip",
        findSimilar: false,
        simThreshold: 10,
        findSimilarAudio: false,
        audioSimThreshold: 20,
        audioDurationTolerance: 0.20,
      });
    });
  });
});
