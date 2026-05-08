import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ArchiveComparator } from "./ArchiveComparator";
import { LangProvider } from "./LangContext";
import type { ArchiveInGroup } from "./types";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

import { invoke } from "@tauri-apps/api/core";
const mockInvoke = invoke as ReturnType<typeof vi.fn>;

const archiveA: ArchiveInGroup = {
  path: "/data/archive_a.zip",
  size: 4096,
  modified: 1700000000,
  total_entries: 3,
  duplicated_entries: 2,
  can_delete: false,
  wasted_bytes: 0,
};
const archiveB: ArchiveInGroup = {
  path: "/data/archive_b.zip",
  size: 8192,
  modified: 1700001000,
  total_entries: 2,
  duplicated_entries: 2,
  can_delete: true,
  wasted_bytes: 1024,
};

const baseComparison = {
  a: {
    path: "/data/archive_a.zip",
    entries: [
      { internal_path: "doc/readme.txt", size: 512, status: "duplicate" as const, duplicate_in: "doc/readme.txt", hash: "h1" },
      { internal_path: "doc/setup.md", size: 256, status: "duplicate" as const, duplicate_in: "doc/setup.md", hash: "h2" },
      { internal_path: "only_in_a.txt", size: 128, status: "unique" as const, hash: "h3" },
    ],
  },
  b: {
    path: "/data/archive_b.zip",
    entries: [
      { internal_path: "doc/readme.txt", size: 512, status: "duplicate" as const, duplicate_in: "doc/readme.txt", hash: "h1" },
      { internal_path: "doc/setup.md", size: 256, status: "duplicate" as const, duplicate_in: "doc/setup.md", hash: "h2" },
    ],
  },
};

function renderComparator(onClose = vi.fn(), findSimilar = false) {
  return render(
    <LangProvider>
      <ArchiveComparator archiveA={archiveA} archiveB={archiveB} findSimilar={findSimilar} simThreshold={10} onClose={onClose} />
    </LangProvider>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("ArchiveComparator - chargement", () => {
  it("affiche un spinner pendant le chargement", () => {
    mockInvoke.mockReturnValue(new Promise(() => {}));
    renderComparator();
    expect(document.querySelector(".archive-comparator-loading")).toBeInTheDocument();
  });
});

describe("ArchiveComparator - affichage", () => {
  it("affiche le titre et les noms d'archives en bas (meta-block)", async () => {
    mockInvoke.mockResolvedValue(baseComparison);
    renderComparator();
    await waitFor(() => screen.getByTestId("archive-comparator-body"));
    expect(screen.getByText("archive_a.zip")).toBeInTheDocument();
    expect(screen.getByText("archive_b.zip")).toBeInTheDocument();
  });

  it("aligne les doublons face-a-face dans les deux colonnes", async () => {
    mockInvoke.mockResolvedValue(baseComparison);
    renderComparator();
    await waitFor(() => screen.getByTestId("archive-comparator-body"));
    const left = screen.getByTestId("archive-col-left");
    const right = screen.getByTestId("archive-col-right");
    const leftRows = left.querySelectorAll(".archive-entry-row");
    const rightRows = right.querySelectorAll(".archive-entry-row");
    // 2 doublons + 1 unique cote A => 3 lignes alignees
    expect(leftRows.length).toBe(3);
    expect(rightRows.length).toBe(3);
  });

  it("la ligne unique de A a une cellule vide en face cote B", async () => {
    mockInvoke.mockResolvedValue(baseComparison);
    renderComparator();
    await waitFor(() => screen.getByTestId("archive-comparator-body"));
    const right = screen.getByTestId("archive-col-right");
    const rows = right.querySelectorAll(".archive-entry-row");
    const lastRowEmpty = rows[rows.length - 1].querySelector(".archive-row-empty");
    expect(lastRowEmpty).toBeInTheDocument();
  });

  it("n'affiche pas de badge unique/doublon (l'alignement parle pour lui)", async () => {
    mockInvoke.mockResolvedValue(baseComparison);
    renderComparator();
    await waitFor(() => screen.getByTestId("archive-comparator-body"));
    expect(screen.queryByText(/^doublon$/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/^unique$/i)).not.toBeInTheDocument();
  });

  it("affiche les chemins internes des entrees", async () => {
    mockInvoke.mockResolvedValue(baseComparison);
    renderComparator();
    await waitFor(() => screen.getByTestId("archive-comparator-body"));
    expect(screen.getAllByText("doc/readme.txt").length).toBeGreaterThan(0);
    expect(screen.getByText("only_in_a.txt")).toBeInTheDocument();
  });
});

describe("ArchiveComparator - pairing greedy quand cardinalites differentes", () => {
  it("3 fichiers identiques cote A et 1 cote B donnent 3 lignes (2 vides cote B)", async () => {
    const skewed = {
      a: {
        path: "/x.zip",
        entries: [
          { internal_path: "f1.txt", size: 100, status: "duplicate" as const, duplicate_in: "z.txt", hash: "samehash" },
          { internal_path: "f2.txt", size: 100, status: "duplicate" as const, duplicate_in: "z.txt", hash: "samehash" },
          { internal_path: "f3.txt", size: 100, status: "duplicate" as const, duplicate_in: "z.txt", hash: "samehash" },
        ],
      },
      b: {
        path: "/y.zip",
        entries: [
          { internal_path: "z.txt", size: 100, status: "duplicate" as const, duplicate_in: "f3.txt", hash: "samehash" },
        ],
      },
    };
    mockInvoke.mockResolvedValue(skewed);
    renderComparator();
    await waitFor(() => screen.getByTestId("archive-comparator-body"));
    const left = screen.getByTestId("archive-col-left");
    const right = screen.getByTestId("archive-col-right");
    expect(left.querySelectorAll(".archive-entry-row").length).toBe(3);
    expect(right.querySelectorAll(".archive-entry-row").length).toBe(3);
    // Une seule ligne cote B contient l'entree, les 2 autres sont vides
    const rightEmpties = right.querySelectorAll(".archive-row-empty");
    expect(rightEmpties.length).toBe(2);
  });
});

describe("ArchiveComparator - paires similaires (B-min)", () => {
  it("affiche les entrees similar face-a-face avec score", async () => {
    const sim = {
      a: {
        path: "/x.zip",
        entries: [
          { internal_path: "img1.png", size: 1024, status: "similar" as const, duplicate_in: "photo.png", hash: "haa", similarity_score: 95.5 },
        ],
      },
      b: {
        path: "/y.zip",
        entries: [
          { internal_path: "photo.png", size: 1024, status: "similar" as const, duplicate_in: "img1.png", hash: "hbb", similarity_score: 95.5 },
        ],
      },
    };
    mockInvoke.mockResolvedValue(sim);
    renderComparator(vi.fn(), true);
    await waitFor(() => screen.getByTestId("archive-comparator-body"));
    const left = screen.getByTestId("archive-col-left");
    const right = screen.getByTestId("archive-col-right");
    // 1 ligne similar de chaque cote (face-a-face)
    expect(left.querySelectorAll(".archive-entry-row--similar").length).toBe(1);
    expect(right.querySelectorAll(".archive-entry-row--similar").length).toBe(1);
    // Score affiche dans les deux colonnes
    expect(screen.getAllByText(/96%/).length).toBeGreaterThan(0);
  });

  it("passe findSimilar et simThreshold a get_archive_comparison", async () => {
    mockInvoke.mockResolvedValue(baseComparison);
    renderComparator(vi.fn(), true);
    await waitFor(() => screen.getByTestId("archive-comparator-body"));
    expect(mockInvoke).toHaveBeenCalledWith("get_archive_comparison", {
      pathA: archiveA.path,
      pathB: archiveB.path,
      findSimilar: true,
      simThreshold: 10,
    });
  });
});

describe("ArchiveComparator - filtre doublons", () => {
  it("masque les uniques quand le toggle 'Doublons uniquement' est actif", async () => {
    const user = userEvent.setup();
    mockInvoke.mockResolvedValue(baseComparison);
    renderComparator();
    await waitFor(() => screen.getByTestId("archive-comparator-body"));
    expect(screen.getByText("only_in_a.txt")).toBeInTheDocument();
    await user.click(screen.getByLabelText(/Doublons uniquement/));
    expect(screen.queryByText("only_in_a.txt")).not.toBeInTheDocument();
  });
});

describe("ArchiveComparator - scroll synchronise", () => {
  it("propage le scrollTop de gauche vers droite", async () => {
    mockInvoke.mockResolvedValue(baseComparison);
    renderComparator();
    await waitFor(() => screen.getByTestId("archive-comparator-body"));
    const left = screen.getByTestId("archive-col-left") as HTMLDivElement;
    const right = screen.getByTestId("archive-col-right") as HTMLDivElement;
    Object.defineProperty(left, "scrollTop", { value: 50, writable: true });
    fireEvent.scroll(left);
    expect(right.scrollTop).toBe(50);
  });
});

describe("ArchiveComparator - fermeture", () => {
  it("appelle onClose quand Escape est presse", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    mockInvoke.mockResolvedValue(baseComparison);
    renderComparator(onClose);
    await user.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalled();
  });
});

describe("ArchiveComparator - groupe vide", () => {
  it("affiche les colonnes sans erreur si les entrees sont vides", async () => {
    mockInvoke.mockResolvedValue({
      a: { path: "/data/archive_a.zip", entries: [] },
      b: { path: "/data/archive_b.zip", entries: [] },
    });
    renderComparator();
    await waitFor(() => screen.getByTestId("archive-comparator-body"));
    expect(screen.getByText("archive_a.zip")).toBeInTheDocument();
  });
});
