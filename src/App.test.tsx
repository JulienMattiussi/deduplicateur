import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import App, { GroupCard } from "./App";

// ----- Mocks globaux -----
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(() => Promise.resolve(() => {})),
}));
vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: vi.fn(),
}));

import { invoke } from "@tauri-apps/api/core";
import { open as dialogOpen } from "@tauri-apps/plugin-dialog";

const mockInvoke = invoke as ReturnType<typeof vi.fn>;
const mockDialogOpen = dialogOpen as ReturnType<typeof vi.fn>;

// Resume de scan minimal reutilisable dans plusieurs tests
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

function makeDefaultMock(overrides: Record<string, unknown> = {}) {
  return (cmd: string, ...args: unknown[]) => {
    if (cmd in overrides) {
      const val = overrides[cmd];
      if (typeof val === "function") return (val as (...a: unknown[]) => unknown)(cmd, ...args);
      return Promise.resolve(val);
    }
    if (cmd === "list_sessions") return Promise.resolve([]);
    if (cmd === "get_phash_config") return Promise.resolve(defaultPhashConfig);
    return Promise.resolve(null);
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockInvoke.mockImplementation(makeDefaultMock());
});

// ---- A : resetResults est appele quand on clique "Mes analyses" ----
describe("A - bouton retour Mes analyses", () => {
  it("fait disparaitre le summary de l'UI apres clic", async () => {
    const user = userEvent.setup();

    mockInvoke.mockImplementation(
      makeDefaultMock({
        list_sessions: [baseSummary],
        load_session: baseSummary,
        get_groups_page: { groups: [baseGroup], offset: 0, total: 1, has_more: false },
      })
    );

    render(<App />);

    // Attend que la session apparaisse et clique Reprendre
    const resumeBtn = await screen.findByText("Reprendre");
    await user.click(resumeBtn);

    // Attend que le bouton retour apparaisse (summary charge)
    const backBtn = await screen.findByText(/Mes analyses/, {}, { timeout: 3000 });
    expect(backBtn).toBeInTheDocument();

    // Verifie que le stats-row avec les stats du scan est visible
    await waitFor(() => {
      // Le stats-row affiche "N groupes" avec la classe "stat"
      const statElems = document.querySelectorAll(".stat");
      expect(statElems.length).toBeGreaterThan(0);
    });

    // Clique sur le bouton retour
    await user.click(backBtn);

    // Le stats-row doit avoir disparu (summary = null supprime .stats-row)
    await waitFor(() => {
      expect(document.querySelector(".stats-row")).not.toBeInTheDocument();
    }, { timeout: 3000 });
  });
});

// ---- B : selection toggle d'un fichier ----
describe("B - toggle de selection d'un fichier", () => {
  it("appelle onToggle avec le bon path quand on clique sur la checkbox", () => {
    const onToggle = vi.fn();
    const selected = new Set<string>();

    render(
      <GroupCard group={baseGroup} selected={selected} onToggle={onToggle} />
    );

    const checkboxes = screen.getAllByRole("checkbox");
    // La premiere checkbox correspond au premier fichier
    fireEvent.click(checkboxes[0]);
    expect(onToggle).toHaveBeenCalledWith("/a/file1.txt");
  });

  it("appelle onToggle avec le second path quand on clique sur la deuxieme checkbox", () => {
    const onToggle = vi.fn();
    const selected = new Set<string>();

    render(
      <GroupCard group={baseGroup} selected={selected} onToggle={onToggle} />
    );

    const checkboxes = screen.getAllByRole("checkbox");
    fireEvent.click(checkboxes[1]);
    expect(onToggle).toHaveBeenCalledWith("/b/file2.txt");
  });
});

// ---- C : suppression appelle delete_files avec les bons paths ----
describe("C - suppression de fichiers", () => {
  it("appelle invoke('delete_files') avec les paths selectionnes", async () => {
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

    // Selectionne un dossier
    const folderInput = screen.getByText(/Cliquer pour choisir un dossier/);
    await user.click(folderInput);

    // Attend que le chemin s'affiche
    await waitFor(() => {
      expect(screen.getByText("/home/test")).toBeInTheDocument();
    });

    // Lance le scan
    const analyseBtn = screen.getByText("Analyser");
    await user.click(analyseBtn);

    // Attend que les groupes apparaissent
    await waitFor(() => {
      expect(screen.getByText(/fichiers identiques/)).toBeInTheDocument();
    });

    // Coche le premier fichier via la checkbox (en cherchant dans le group-card)
    const groupCard = document.querySelector(".group-card");
    expect(groupCard).not.toBeNull();
    const fileCheckboxes = groupCard!.querySelectorAll('input[type="checkbox"]');
    await user.click(fileCheckboxes[0] as HTMLElement);

    // Clique sur le bouton Supprimer dans la toolbar
    const deleteBtn = await screen.findByText(/Supprimer \d+ fichier/);
    await user.click(deleteBtn);

    // Confirme dans la modal de confirmation
    const confirmBtn = await screen.findByRole("button", { name: "Supprimer" });
    await user.click(confirmBtn);

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith("delete_files", {
        paths: expect.arrayContaining(["/a/file1.txt"]),
      });
    });
  });
});

// ---- D : erreur affichee dans la banniere ----
describe("D - banniere d'erreur", () => {
  it("affiche le message d'erreur quand scan_folder echoue", async () => {
    const user = userEvent.setup();

    mockInvoke.mockImplementation(
      makeDefaultMock({
        scan_folder: () => Promise.reject("dossier introuvable"),
      })
    );
    mockDialogOpen.mockResolvedValue("/home/inexistant");

    render(<App />);

    // Selectionne un dossier
    const folderInput = screen.getByText(/Cliquer pour choisir un dossier/);
    await user.click(folderInput);

    await waitFor(() => {
      expect(screen.getByText("/home/inexistant")).toBeInTheDocument();
    });

    // Lance le scan
    const analyseBtn = screen.getByText("Analyser");
    await user.click(analyseBtn);

    // La banniere doit afficher le message d'erreur
    await waitFor(() => {
      expect(screen.getByText(/dossier introuvable/)).toBeInTheDocument();
    });
  });
});
