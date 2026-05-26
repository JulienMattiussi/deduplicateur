import { describe, it, expect, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
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
      { key: "/a/photo.jpg|/b/photo_copy.jpg", display_names: ["photo.jpg", "photo_copy.jpg"], ignored_at: 1700000000 },
    ]);
    await user.click(screen.getByText(/Groupes ignorés/));
    expect(screen.getByText(/^photo\.jpg$/)).toBeInTheDocument();
    expect(screen.getByText(/^photo_copy\.jpg$/)).toBeInTheDocument();
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

  it("la recherche filtre les entrées par nom", async () => {
    const user = userEvent.setup();
    renderPanel([
      { key: "/photos/vacances.jpg", display_names: ["vacances.jpg"], ignored_at: 1700000000 },
      { key: "/docs/travail.pdf", display_names: ["travail.pdf"], ignored_at: 1700000001 },
    ]);
    await user.click(screen.getByText(/Groupes ignorés/));
    expect(screen.getAllByTestId("ignored-entry")).toHaveLength(2);

    await user.type(screen.getByTestId("ignored-search"), "vacances");
    expect(screen.getAllByTestId("ignored-entry")).toHaveLength(1);
    expect(screen.getByText(/vacances\.jpg/)).toBeInTheDocument();
    expect(screen.queryByText(/travail\.pdf/)).not.toBeInTheDocument();
  });

  it("la recherche sans résultat affiche le message vide", async () => {
    const user = userEvent.setup();
    renderPanel([{ key: "k1", display_names: ["a.jpg"], ignored_at: 1700000000 }]);
    await user.click(screen.getByText(/Groupes ignorés/));
    await user.type(screen.getByTestId("ignored-search"), "zzz-introuvable");
    expect(screen.queryAllByTestId("ignored-entry")).toHaveLength(0);
    expect(screen.getByText(/Aucun résultat/)).toBeInTheDocument();
  });

  it("tri par nom ordonne alphabétiquement", async () => {
    const user = userEvent.setup();
    renderPanel([
      { key: "/x/zebra.jpg", display_names: ["zebra.jpg"], ignored_at: 1700000099 },
      { key: "/x/alpha.jpg", display_names: ["alpha.jpg"], ignored_at: 1700000000 },
    ]);
    await user.click(screen.getByText(/Groupes ignorés/));
    // Tri par defaut = date (plus recent en premier) -> zebra (ts plus grand) d'abord
    let entries = screen.getAllByTestId("ignored-entry");
    expect(within(entries[0]).getByText(/zebra/)).toBeInTheDocument();

    // Bascule tri par nom -> alpha d'abord
    await user.click(screen.getByText("Nom"));
    entries = screen.getAllByTestId("ignored-entry");
    expect(within(entries[0]).getByText(/alpha/)).toBeInTheDocument();
  });

  it("Escape ferme le drawer", async () => {
    const user = userEvent.setup();
    renderPanel([{ key: "k1", display_names: ["a.jpg"], ignored_at: 1700000000 }]);
    await user.click(screen.getByText(/Groupes ignorés/));
    expect(screen.getByTestId("ignored-drawer")).toBeInTheDocument();
    await user.keyboard("{Escape}");
    expect(screen.queryByTestId("ignored-drawer")).not.toBeInTheDocument();
  });
});
