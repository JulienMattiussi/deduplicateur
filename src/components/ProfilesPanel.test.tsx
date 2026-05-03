import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ProfilesPanel } from "./ProfilesPanel";
import { LangProvider } from "../LangContext";
import type { ScanProfile } from "../types";

const profile: ScanProfile = {
  id: "p1",
  name: "Mon profil",
  created_at: 1700000000000,
  folder: "/home/test",
  recursive: true,
  scan_mode: "all",
  detection_mode: "files",
  sim_similarity: 100,
  video_similarity: 100,
  audio_similarity: 80,
  excluded: [],
  exclude_extensions: [],
  include_extensions: [],
  min_file_size_kb: 0,
  max_file_size_kb: 0,
  exact_cache_enabled: true,
};

function makeProps(overrides: Partial<Parameters<typeof ProfilesPanel>[0]> = {}) {
  return {
    profiles: [profile],
    currentFolder: "/home/test",
    onSave: vi.fn(),
    onLoad: vi.fn(),
    onLaunch: vi.fn(),
    onDelete: vi.fn(),
    disabled: false,
    ...overrides,
  };
}

function renderPanel(overrides: Partial<Parameters<typeof ProfilesPanel>[0]> = {}) {
  const props = makeProps(overrides);
  render(
    <LangProvider>
      <ProfilesPanel {...props} />
    </LangProvider>
  );
  return props;
}

describe("ProfilesPanel", () => {
  it("est ferme par defaut : les profils ne sont pas visibles", () => {
    renderPanel();
    expect(screen.queryByText("Mon profil")).not.toBeInTheDocument();
  });

  it("affiche le badge avec le count de profils", () => {
    renderPanel();
    expect(screen.getByText("1")).toBeInTheDocument();
  });

  it("s'ouvre au clic sur le toggle", async () => {
    const user = userEvent.setup();
    renderPanel();
    await user.click(screen.getByText(/profils/i));
    expect(screen.getByText("Mon profil")).toBeInTheDocument();
  });

  it("affiche le dossier du profil quand ouvert", async () => {
    const user = userEvent.setup();
    renderPanel();
    await user.click(screen.getByText(/profils/i));
    expect(screen.getByText("/home/test")).toBeInTheDocument();
  });

  it("saisie d'un nom + clic Sauvegarder appelle onSave avec le bon nom", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    renderPanel({ onSave });
    await user.click(screen.getByText(/profils/i));
    const input = screen.getByPlaceholderText(/nom du profil/i);
    await user.type(input, "Nouveau profil");
    await user.click(screen.getByText("Sauvegarder"));
    expect(onSave).toHaveBeenCalledWith("Nouveau profil");
  });

  it("saisie d'un nom + Entree appelle onSave avec le bon nom", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    renderPanel({ onSave });
    await user.click(screen.getByText(/profils/i));
    const input = screen.getByPlaceholderText(/nom du profil/i);
    await user.type(input, "Nouveau{Enter}");
    expect(onSave).toHaveBeenCalledWith("Nouveau");
  });

  it("clic sur le bouton Lancer (triangle) appelle onLaunch avec le bon profil", async () => {
    const user = userEvent.setup();
    const onLaunch = vi.fn();
    renderPanel({ onLaunch });
    await user.click(screen.getByText(/profils/i));
    await user.click(screen.getByTitle("Lancer"));
    expect(onLaunch).toHaveBeenCalledWith(profile);
  });

  it("clic sur le bouton Lancer ferme le dropdown", async () => {
    const user = userEvent.setup();
    renderPanel();
    await user.click(screen.getByText(/profils/i));
    await user.click(screen.getByTitle("Lancer"));
    expect(screen.queryByText("Mon profil")).not.toBeInTheDocument();
  });

  it("clic sur x appelle onDelete avec le bon id", async () => {
    const user = userEvent.setup();
    const onDelete = vi.fn();
    renderPanel({ onDelete });
    await user.click(screen.getByText(/profils/i));
    await user.click(screen.getByTitle("Supprimer"));
    expect(onDelete).toHaveBeenCalledWith("p1");
  });

  it("affiche le message vide quand il n'y a pas de profils", async () => {
    const user = userEvent.setup();
    renderPanel({ profiles: [] });
    await user.click(screen.getByText(/profils/i));
    expect(screen.getByText("Aucun profil sauvegardé")).toBeInTheDocument();
  });

  it("le bouton toggle est desactive quand disabled=true", () => {
    renderPanel({ disabled: true });
    expect(screen.getByText(/profils/i).closest("button")).toBeDisabled();
  });

  it("les boutons Charger et Lancer sont desactives quand disabled=true", async () => {
    const user = userEvent.setup();
    // ouvrir le panel en mode enabled d'abord, puis passer en disabled via rerender
    const { rerender } = render(
      <LangProvider>
        <ProfilesPanel {...makeProps({ disabled: false })} />
      </LangProvider>
    );
    await user.click(screen.getByText(/profils/i));
    rerender(
      <LangProvider>
        <ProfilesPanel {...makeProps({ disabled: true })} />
      </LangProvider>
    );
    expect(screen.getByTitle("Charger")).toBeDisabled();
    expect(screen.getByTitle("Lancer")).toBeDisabled();
  });

  it("clic Sauvegarder sans saisir de nom n'appelle pas onSave", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    renderPanel({ onSave });
    await user.click(screen.getByText(/profils/i));
    await user.click(screen.getByText("Sauvegarder"));
    expect(onSave).not.toHaveBeenCalled();
  });

  it("clic Sauvegarder avec un nom compose uniquement d'espaces n'appelle pas onSave", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    renderPanel({ onSave });
    await user.click(screen.getByText(/profils/i));
    const input = screen.getByPlaceholderText(/nom du profil/i);
    await user.type(input, "   ");
    await user.click(screen.getByText("Sauvegarder"));
    expect(onSave).not.toHaveBeenCalled();
  });

  it("fermeture au clic exterieur (click outside)", async () => {
    const user = userEvent.setup();
    renderPanel();
    await user.click(screen.getByText(/profils/i));
    expect(screen.getByText("Mon profil")).toBeInTheDocument();
    // cliquer hors du composant
    fireEvent.mouseDown(document.body);
    expect(screen.queryByText("Mon profil")).not.toBeInTheDocument();
  });
});
