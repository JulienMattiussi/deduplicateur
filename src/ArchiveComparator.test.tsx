import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
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

  it("aligne les doublons face-a-face dans la grille a 3 colonnes", async () => {
    mockInvoke.mockResolvedValue(baseComparison);
    renderComparator();
    await waitFor(() => screen.getByTestId("archive-comparator-body"));
    const grid = screen.getByTestId("archive-comparator-grid");
    const rows = grid.querySelectorAll(".archive-entry-row");
    // 2 doublons + 1 unique cote A => 3 lignes
    expect(rows.length).toBe(3);
  });

  it("la ligne unique de A a une cellule vide en face cote B", async () => {
    mockInvoke.mockResolvedValue(baseComparison);
    renderComparator();
    await waitFor(() => screen.getByTestId("archive-comparator-body"));
    const grid = screen.getByTestId("archive-comparator-grid");
    const rows = grid.querySelectorAll(".archive-entry-row");
    // La derniere ligne (unique cote A) doit avoir un .archive-row-empty cote droit
    const lastRow = rows[rows.length - 1];
    expect(lastRow.querySelector(".archive-row-empty")).toBeInTheDocument();
  });

  it("affiche le score dans la colonne centrale uniquement (pas duplique de chaque cote)", async () => {
    mockInvoke.mockResolvedValue(baseComparison);
    renderComparator();
    await waitFor(() => screen.getByTestId("archive-comparator-body"));
    const grid = screen.getByTestId("archive-comparator-grid");
    // 2 lignes "duplicate" → 2 cellules "100%" (au centre)
    const scores = grid.querySelectorAll(".archive-score-cell");
    const exactScores = Array.from(scores).filter((s) => s.textContent === "100%");
    expect(exactScores.length).toBe(2);
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
    const grid = screen.getByTestId("archive-comparator-grid");
    const rows = grid.querySelectorAll(".archive-entry-row");
    expect(rows.length).toBe(3);
    // 2 lignes ont leur cote droit vide (les 2 entrees A sans pendant cote B)
    expect(grid.querySelectorAll(".archive-row-empty").length).toBe(2);
  });
});

describe("ArchiveComparator - entrees audio (mode Audio)", () => {
  it("affiche un bouton play (au lieu de la miniature) sur les entrees audio", async () => {
    const audioComparison = {
      a: {
        path: "/x.zip",
        entries: [
          { internal_path: "song.mp3", size: 5_000_000, status: "duplicate" as const, duplicate_in: "song.mp3", hash: "h1" },
        ],
      },
      b: {
        path: "/y.zip",
        entries: [
          { internal_path: "song.mp3", size: 5_000_000, status: "duplicate" as const, duplicate_in: "song.mp3", hash: "h1" },
        ],
      },
    };
    mockInvoke.mockResolvedValue(audioComparison);
    renderComparator();
    await waitFor(() => screen.getByTestId("archive-comparator-body"));
    // 2 boutons play (un par cote)
    expect(screen.getAllByTestId("archive-audio-btn").length).toBe(2);
  });

  it("affiche la duree audio (mm:ss) a cote du lecteur quand audio_duration_secs est dans le cache", async () => {
    const audioComparison = {
      a: {
        path: "/x.zip",
        entries: [
          { internal_path: "song.mp3", size: 5_000_000, status: "duplicate" as const, duplicate_in: "song.mp3", hash: "h1", audio_duration_secs: 222 },
        ],
      },
      b: {
        path: "/y.zip",
        entries: [
          { internal_path: "song.mp3", size: 5_000_000, status: "duplicate" as const, duplicate_in: "song.mp3", hash: "h1", audio_duration_secs: 222 },
        ],
      },
    };
    mockInvoke.mockResolvedValue(audioComparison);
    renderComparator();
    await waitFor(() => screen.getByTestId("archive-comparator-body"));
    // 222s = 3:42, deux occurrences (une par cote)
    expect(screen.getAllByText("3:42").length).toBe(2);
  });

  it("n'affiche pas de duree quand audio_duration_secs est absent (sessions pre-cache audio)", async () => {
    const audioComparison = {
      a: {
        path: "/x.zip",
        entries: [
          { internal_path: "song.mp3", size: 5_000_000, status: "duplicate" as const, duplicate_in: "song.mp3", hash: "h1" },
        ],
      },
      b: {
        path: "/y.zip",
        entries: [
          { internal_path: "song.mp3", size: 5_000_000, status: "duplicate" as const, duplicate_in: "song.mp3", hash: "h1" },
        ],
      },
    };
    mockInvoke.mockResolvedValue(audioComparison);
    renderComparator();
    await waitFor(() => screen.getByTestId("archive-comparator-body"));
    // Aucun texte mm:ss attendu
    expect(screen.queryByText(/^\d+:\d{2}$/)).not.toBeInTheDocument();
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
    const grid = screen.getByTestId("archive-comparator-grid");
    // 1 ligne similar dans la grille (couvre les deux cotes)
    expect(grid.querySelectorAll(".archive-entry-row--similar").length).toBe(1);
    // Score affiche une seule fois dans la colonne centrale
    expect(screen.getAllByText(/96%/).length).toBe(1);
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
      findSimilarAudio: false,
      audioSimThreshold: 20,
      audioDurationTolerance: 0.20,
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
