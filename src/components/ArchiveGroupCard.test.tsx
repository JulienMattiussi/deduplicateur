import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ArchiveGroupCard } from "./ArchiveGroupCard";
import { LangProvider } from "../LangContext";
import type { ArchiveGroupResult } from "../types";

function makeGroup(overrides: Partial<ArchiveGroupResult> = {}): ArchiveGroupResult {
  return {
    id: "ag1",
    shared_entry_count: 3,
    archives: [
      { path: "/data/archive_a.zip", size: 1024, modified: 1700000000, total_entries: 5, duplicated_entries: 3, can_delete: false, wasted_bytes: 0 },
      { path: "/data/archive_b.zip", size: 2048, modified: 1700001000, total_entries: 4, duplicated_entries: 3, can_delete: true, wasted_bytes: 1024 },
    ],
    ...overrides,
  };
}

function renderCard(group: ArchiveGroupResult, opts: Partial<{ selected: Set<string>; onToggle: (p: string) => void; onCompare: (a: string, b: string) => void }> = {}) {
  return render(
    <LangProvider>
      <ArchiveGroupCard
        group={group}
        selected={opts.selected ?? new Set()}
        onToggle={opts.onToggle ?? vi.fn()}
        onCompare={opts.onCompare ?? vi.fn()}
      />
    </LangProvider>
  );
}

describe("ArchiveGroupCard - rendu basique", () => {
  it("affiche le nombre d'archives et les fichiers en commun dans le header", () => {
    renderCard(makeGroup());
    expect(screen.getByText(/2 archives/)).toBeInTheDocument();
    expect(screen.getByText(/3 fichier\(s\) en commun/)).toBeInTheDocument();
  });

  it("affiche un nom et une taille pour chaque archive", () => {
    renderCard(makeGroup());
    expect(screen.getByText("archive_a.zip")).toBeInTheDocument();
    expect(screen.getByText("archive_b.zip")).toBeInTheDocument();
    expect(screen.getByText("1.0 Ko")).toBeInTheDocument();
    expect(screen.getByText("2.0 Ko")).toBeInTheDocument();
  });

  it("affiche le ratio de fichiers dupliqués pour chaque archive", () => {
    renderCard(makeGroup());
    expect(screen.getByText(/3\/5 fichier\(s\)/)).toBeInTheDocument();
    expect(screen.getByText(/3\/4 fichier\(s\)/)).toBeInTheDocument();
  });
});

describe("ArchiveGroupCard - case a cocher conditionnelle", () => {
  it("affiche une case a cocher uniquement pour les archives can_delete=true", () => {
    renderCard(makeGroup());
    const checkboxes = screen.getAllByTestId("archive-row-checkbox");
    expect(checkboxes).toHaveLength(1);
  });

  it("aucune case a cocher si toutes les archives sont can_delete=false", () => {
    const g = makeGroup({
      archives: [
        { path: "/a.zip", size: 100, modified: 0, total_entries: 2, duplicated_entries: 1, can_delete: false, wasted_bytes: 0 },
        { path: "/b.zip", size: 100, modified: 0, total_entries: 2, duplicated_entries: 1, can_delete: false, wasted_bytes: 0 },
      ],
    });
    renderCard(g);
    expect(screen.queryAllByTestId("archive-row-checkbox")).toHaveLength(0);
  });

  it("la case a cocher est cochee si le path est dans selected", () => {
    renderCard(makeGroup(), { selected: new Set(["/data/archive_b.zip"]) });
    const cb = screen.getByTestId("archive-row-checkbox") as HTMLInputElement;
    expect(cb.checked).toBe(true);
  });

  it("cliquer sur la case appelle onToggle avec le bon path", async () => {
    const user = userEvent.setup();
    const onToggle = vi.fn();
    renderCard(makeGroup(), { onToggle });
    await user.click(screen.getByTestId("archive-row-checkbox"));
    expect(onToggle).toHaveBeenCalledWith("/data/archive_b.zip");
  });
});

describe("ArchiveGroupCard - badge Supprimable", () => {
  it("affiche le badge Supprimable sur les archives can_delete=true", () => {
    renderCard(makeGroup());
    expect(screen.getByText("Supprimable")).toBeInTheDocument();
  });

  it("aucun badge Supprimable si aucune archive n'est can_delete=true", () => {
    const g = makeGroup({
      archives: [
        { path: "/a.zip", size: 100, modified: 0, total_entries: 2, duplicated_entries: 1, can_delete: false, wasted_bytes: 0 },
        { path: "/b.zip", size: 100, modified: 0, total_entries: 2, duplicated_entries: 1, can_delete: false, wasted_bytes: 0 },
      ],
    });
    renderCard(g);
    expect(screen.queryByText("Supprimable")).not.toBeInTheDocument();
  });
});

describe("ArchiveGroupCard - bouton Comparer", () => {
  it("affiche un bouton Comparer dans le header pour 2 archives", () => {
    renderCard(makeGroup());
    expect(screen.getByText("Comparer")).toBeInTheDocument();
  });

  it("clic sur Comparer appelle onCompare avec la 1ere paire", async () => {
    const user = userEvent.setup();
    const onCompare = vi.fn();
    renderCard(makeGroup(), { onCompare });
    await user.click(screen.getByText("Comparer"));
    expect(onCompare).toHaveBeenCalledWith("/data/archive_a.zip", "/data/archive_b.zip");
  });
});
