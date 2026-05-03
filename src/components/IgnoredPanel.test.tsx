import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { IgnoredPanel } from "./IgnoredPanel";
import { LangProvider } from "../LangContext";

function renderPanel(entries: Parameters<typeof IgnoredPanel>[0]["entries"], onRemove = vi.fn(), onClearAll = vi.fn()) {
  return render(
    <LangProvider>
      <IgnoredPanel entries={entries} onRemove={onRemove} onClearAll={onClearAll} />
    </LangProvider>
  );
}

describe("IgnoredPanel", () => {
  it("affiche le bouton de toggle avec le titre", () => {
    renderPanel([]);
    expect(screen.getByText(/Groupes ignorés/)).toBeInTheDocument();
  });

  it("n'affiche pas le badge quand vide", () => {
    renderPanel([]);
    expect(screen.queryByText("0")).not.toBeInTheDocument();
  });

  it("affiche le badge avec le nombre d'entrées", () => {
    renderPanel([
      { key: "k1", display_names: ["a.jpg"], ignored_at: 1700000000 },
      { key: "k2", display_names: ["b.jpg"], ignored_at: 1700000001 },
    ]);
    expect(screen.getByText("2")).toBeInTheDocument();
  });

  it("le dropdown est fermé par défaut", () => {
    renderPanel([]);
    expect(screen.queryByText(/Aucun groupe ignoré/)).not.toBeInTheDocument();
  });

  it("ouvrir affiche le message vide quand pas d'entrées", async () => {
    const user = userEvent.setup();
    renderPanel([]);
    await user.click(screen.getByText(/Groupes ignorés/));
    expect(screen.getByText(/Aucun groupe ignoré/)).toBeInTheDocument();
  });

  it("ouvrir affiche les noms des fichiers ignorés", async () => {
    const user = userEvent.setup();
    renderPanel([
      { key: "k1", display_names: ["photo.jpg", "photo_copy.jpg"], ignored_at: 1700000000 },
    ]);
    await user.click(screen.getByText(/Groupes ignorés/));
    expect(screen.getByText(/photo\.jpg/)).toBeInTheDocument();
  });

  it("n'affiche pas le bouton Tout effacer si vide", async () => {
    const user = userEvent.setup();
    renderPanel([]);
    await user.click(screen.getByText(/Groupes ignorés/));
    expect(screen.queryByTestId("clear-all-ignored")).not.toBeInTheDocument();
  });

  it("affiche le bouton Tout effacer si des entrées existent", async () => {
    const user = userEvent.setup();
    renderPanel([{ key: "k1", display_names: ["a.jpg"], ignored_at: 1700000000 }]);
    await user.click(screen.getByText(/Groupes ignorés/));
    expect(screen.getByTestId("clear-all-ignored")).toBeInTheDocument();
  });

  it("clic Retirer appelle onRemove avec la bonne clé", async () => {
    const user = userEvent.setup();
    const onRemove = vi.fn();
    renderPanel(
      [{ key: "k1", display_names: ["photo.jpg"], ignored_at: 1700000000 }],
      onRemove
    );
    await user.click(screen.getByText(/Groupes ignorés/));
    await user.click(screen.getByTestId("remove-ignored"));
    expect(onRemove).toHaveBeenCalledWith("k1");
  });

  it("clic Tout effacer appelle onClearAll", async () => {
    const user = userEvent.setup();
    const onClearAll = vi.fn();
    renderPanel(
      [{ key: "k1", display_names: ["photo.jpg"], ignored_at: 1700000000 }],
      vi.fn(),
      onClearAll
    );
    await user.click(screen.getByText(/Groupes ignorés/));
    await user.click(screen.getByTestId("clear-all-ignored"));
    expect(onClearAll).toHaveBeenCalled();
  });

  it("affiche plusieurs entrées", async () => {
    const user = userEvent.setup();
    renderPanel([
      { key: "k1", display_names: ["a.jpg"], ignored_at: 1700000000 },
      { key: "k2", display_names: ["b.jpg"], ignored_at: 1700000001 },
    ]);
    await user.click(screen.getByText(/Groupes ignorés/));
    expect(screen.getAllByTestId("ignored-entry")).toHaveLength(2);
  });
});
