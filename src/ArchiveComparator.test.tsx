import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ArchiveComparator } from "./ArchiveComparator";
import { LangProvider } from "./LangContext";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

import { invoke } from "@tauri-apps/api/core";
const mockInvoke = invoke as ReturnType<typeof vi.fn>;

const baseComparison = {
  a: {
    path: "/data/archive_a.zip",
    entries: [
      { internal_path: "readme.txt", size: 512, status: "duplicate" as const, duplicate_in: "readme.txt" },
      { internal_path: "only_in_a.txt", size: 128, status: "unique" as const },
    ],
  },
  b: {
    path: "/data/archive_b.zip",
    entries: [
      { internal_path: "readme.txt", size: 512, status: "duplicate" as const, duplicate_in: "readme.txt" },
    ],
  },
};

function renderComparator(pathA = "/data/archive_a.zip", pathB = "/data/archive_b.zip", onClose = vi.fn()) {
  return render(
    <LangProvider>
      <ArchiveComparator pathA={pathA} pathB={pathB} onClose={onClose} />
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

describe("ArchiveComparator - affichage des colonnes", () => {
  it("affiche les deux colonnes avec les bons noms d'archives après chargement", async () => {
    mockInvoke.mockResolvedValue(baseComparison);
    renderComparator();
    await waitFor(() => {
      expect(screen.getByTestId("archive-comparator-body")).toBeInTheDocument();
    });
    expect(screen.getByText("archive_a.zip")).toBeInTheDocument();
    expect(screen.getByText("archive_b.zip")).toBeInTheDocument();
  });

  it("affiche le badge doublon sur les entrées dupliquées", async () => {
    mockInvoke.mockResolvedValue(baseComparison);
    renderComparator();
    await waitFor(() => screen.getByTestId("archive-comparator-body"));
    const badges = screen.getAllByText("doublon");
    expect(badges.length).toBeGreaterThan(0);
  });

  it("affiche le badge unique sur les entrées uniques", async () => {
    mockInvoke.mockResolvedValue(baseComparison);
    renderComparator();
    await waitFor(() => screen.getByTestId("archive-comparator-body"));
    expect(screen.getByText("unique")).toBeInTheDocument();
  });
});

describe("ArchiveComparator - fermeture", () => {
  it("appelle onClose au clic sur le bouton ×", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    mockInvoke.mockResolvedValue(baseComparison);
    renderComparator("/data/archive_a.zip", "/data/archive_b.zip", onClose);
    await user.click(screen.getByTestId("archive-comparator-close"));
    expect(onClose).toHaveBeenCalled();
  });

  it("appelle onClose quand Escape est pressé", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    mockInvoke.mockResolvedValue(baseComparison);
    renderComparator("/data/archive_a.zip", "/data/archive_b.zip", onClose);
    await user.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalled();
  });

  it("appelle onClose au clic sur l'overlay", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    mockInvoke.mockResolvedValue(baseComparison);
    renderComparator("/data/archive_a.zip", "/data/archive_b.zip", onClose);
    await user.click(screen.getByTestId("archive-comparator-overlay"));
    expect(onClose).toHaveBeenCalled();
  });
});

describe("ArchiveComparator - groupe vide", () => {
  it("affiche les colonnes sans erreur si les entrées sont vides", async () => {
    mockInvoke.mockResolvedValue({
      a: { path: "/data/archive_a.zip", entries: [] },
      b: { path: "/data/archive_b.zip", entries: [] },
    });
    renderComparator();
    await waitFor(() => screen.getByTestId("archive-comparator-body"));
    expect(screen.getByText("archive_a.zip")).toBeInTheDocument();
    expect(screen.getByText("archive_b.zip")).toBeInTheDocument();
  });
});
