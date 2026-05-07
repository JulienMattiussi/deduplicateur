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
      { path: "/data/archive_a.zip", total_entries: 5, duplicated_entries: 3, can_delete: false, wasted_bytes: 0 },
      { path: "/data/archive_b.zip", total_entries: 4, duplicated_entries: 3, can_delete: true, wasted_bytes: 1024 },
    ],
    ...overrides,
  };
}

function renderCard(group: ArchiveGroupResult, onViewContent = vi.fn(), onDelete = vi.fn()) {
  return render(
    <LangProvider>
      <ArchiveGroupCard group={group} onViewContent={onViewContent} onDelete={onDelete} />
    </LangProvider>
  );
}

describe("ArchiveGroupCard - rendu basique", () => {
  it("affiche le nombre d'archives et les fichiers en commun", () => {
    renderCard(makeGroup());
    expect(screen.getByText(/2 archives/)).toBeInTheDocument();
    expect(screen.getByText(/3 fichier\(s\) en commun/)).toBeInTheDocument();
  });

  it("affiche les noms des archives", () => {
    renderCard(makeGroup());
    expect(screen.getByText("archive_a.zip")).toBeInTheDocument();
    expect(screen.getByText("archive_b.zip")).toBeInTheDocument();
  });

  it("affiche le ratio de fichiers dupliqués", () => {
    renderCard(makeGroup());
    expect(screen.getByText(/3\/5 fichier\(s\)/)).toBeInTheDocument();
    expect(screen.getByText(/3\/4 fichier\(s\)/)).toBeInTheDocument();
  });
});

describe("ArchiveGroupCard - badge Supprimable", () => {
  it("affiche le badge Supprimable si can_delete est true", () => {
    renderCard(makeGroup());
    expect(screen.getByText("Supprimable")).toBeInTheDocument();
  });

  it("n'affiche pas le badge Supprimable si can_delete est false pour toutes", () => {
    const group = makeGroup({
      archives: [
        { path: "/a.zip", total_entries: 2, duplicated_entries: 1, can_delete: false, wasted_bytes: 0 },
        { path: "/b.zip", total_entries: 2, duplicated_entries: 1, can_delete: false, wasted_bytes: 0 },
      ],
    });
    renderCard(group);
    expect(screen.queryByText("Supprimable")).not.toBeInTheDocument();
  });
});

describe("ArchiveGroupCard - bouton Voir le contenu", () => {
  it("appelle onViewContent avec les bons chemins au clic", async () => {
    const user = userEvent.setup();
    const onViewContent = vi.fn();
    renderCard(makeGroup(), onViewContent);

    await user.click(screen.getByText("Voir le contenu"));

    expect(onViewContent).toHaveBeenCalledWith("/data/archive_a.zip", "/data/archive_b.zip");
  });
});

describe("ArchiveGroupCard - bouton Supprimer", () => {
  it("affiche le bouton Supprimer si can_delete est true", () => {
    renderCard(makeGroup());
    expect(screen.getByTestId("archive-delete-btn")).toBeInTheDocument();
  });

  it("n'affiche pas de bouton Supprimer si can_delete est false pour toutes", () => {
    const group = makeGroup({
      archives: [
        { path: "/a.zip", total_entries: 2, duplicated_entries: 1, can_delete: false, wasted_bytes: 0 },
        { path: "/b.zip", total_entries: 2, duplicated_entries: 1, can_delete: false, wasted_bytes: 0 },
      ],
    });
    renderCard(group);
    expect(screen.queryByTestId("archive-delete-btn")).not.toBeInTheDocument();
  });

  it("appelle onDelete avec le bon path au clic", async () => {
    const user = userEvent.setup();
    const onDelete = vi.fn();
    renderCard(makeGroup(), vi.fn(), onDelete);

    await user.click(screen.getByTestId("archive-delete-btn"));

    expect(onDelete).toHaveBeenCalledWith("/data/archive_b.zip");
  });
});
