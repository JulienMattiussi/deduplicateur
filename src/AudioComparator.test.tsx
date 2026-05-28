import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { AudioComparator } from "./AudioComparator";
import { LangProvider } from "./LangContext";
import type { DuplicateGroup } from "./types";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn().mockResolvedValue(8765) }));

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
});

function renderWithLang(ui: React.ReactElement) {
  return render(<LangProvider>{ui}</LangProvider>);
}

const makeGroup = (id: string, paths: string[]): DuplicateGroup => ({
  id,
  hash: id,
  size: 1024,
  files: paths.map((p, i) => ({
    path: p,
    name: p.split("/").pop()!,
    size: 1024,
    modified: 1700000000,
    audio_metadata: { duration_secs: 180 + i * 10 },
  })),
  similar: false,
  video_similar: false,
  audio_similar: true,
});

const groups = [
  makeGroup("g1", ["/music/a.mp3", "/music/b.flac"]),
  makeGroup("g2", ["/music/c.mp3", "/music/d.ogg"]),
];

// ---- E4 : AudioComparator ----
describe("E4 - AudioComparator", () => {
  it("rend le titre 'Comparateur audio'", () => {
    renderWithLang(
      <AudioComparator groups={groups} startIdx={0} selected={new Set()} onSelectPaths={vi.fn()} onIgnore={vi.fn()} onClose={vi.fn()} />
    );
    expect(screen.getByText("Comparateur audio")).toBeInTheDocument();
  });

  it("affiche les deux elements audio", () => {
    renderWithLang(
      <AudioComparator groups={groups} startIdx={0} selected={new Set()} onSelectPaths={vi.fn()} onIgnore={vi.fn()} onClose={vi.fn()} />
    );
    expect(screen.getByTestId("audio-left")).toBeInTheDocument();
    expect(screen.getByTestId("audio-right")).toBeInTheDocument();
  });

  it("le lecteur gauche a controls, le droit n'en a pas", () => {
    renderWithLang(
      <AudioComparator groups={groups} startIdx={0} selected={new Set()} onSelectPaths={vi.fn()} onIgnore={vi.fn()} onClose={vi.fn()} />
    );
    const left = screen.getByTestId("audio-left") as HTMLAudioElement;
    const right = screen.getByTestId("audio-right") as HTMLAudioElement;
    expect(left.controls).toBe(true);
    expect(right.controls).toBe(false);
  });

  it("Garder & fermer sur le fichier gauche appelle onSelectPaths et onClose", () => {
    const onSelectPaths = vi.fn();
    const onClose = vi.fn();
    renderWithLang(
      <AudioComparator groups={groups} startIdx={0} selected={new Set()} onSelectPaths={onSelectPaths} onIgnore={vi.fn()} onClose={onClose} />
    );
    fireEvent.click(screen.getAllByText(/Garder & fermer/)[0]);
    expect(onSelectPaths).toHaveBeenCalledWith(["/music/b.flac"], ["/music/a.mp3"]);
    expect(onClose).toHaveBeenCalled();
  });

  it("Garder & suivant sur le fichier gauche avance au groupe suivant", () => {
    const onSelectPaths = vi.fn();
    const onClose = vi.fn();
    renderWithLang(
      <AudioComparator groups={groups} startIdx={0} selected={new Set()} onSelectPaths={onSelectPaths} onIgnore={vi.fn()} onClose={onClose} />
    );
    fireEvent.click(screen.getAllByText(/Garder & suivant/)[0]);
    expect(onSelectPaths).toHaveBeenCalledWith(["/music/b.flac"], ["/music/a.mp3"]);
    expect(screen.getByText("2 / 2")).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("le bouton 🚫 ignore le groupe courant", () => {
    const onIgnore = vi.fn();
    renderWithLang(
      <AudioComparator groups={groups} startIdx={0} selected={new Set()} onSelectPaths={vi.fn()} onIgnore={onIgnore} onClose={vi.fn()} />
    );
    fireEvent.click(screen.getByTestId("comparator-ignore-btn"));
    expect(onIgnore).toHaveBeenCalledWith("g1");
  });

  it("affiche la duree des fichiers audio", () => {
    renderWithLang(
      <AudioComparator groups={groups} startIdx={0} selected={new Set()} onSelectPaths={vi.fn()} onIgnore={vi.fn()} onClose={vi.fn()} />
    );
    expect(screen.getByText("3:00")).toBeInTheDocument();
    expect(screen.getByText("3:10")).toBeInTheDocument();
  });

  it("le bouton Ouvrir le dossier est present dans les metadonnees", () => {
    renderWithLang(
      <AudioComparator groups={groups} startIdx={0} selected={new Set()} onSelectPaths={vi.fn()} onIgnore={vi.fn()} onClose={vi.fn()} />
    );
    const revealBtns = screen.getAllByTitle("Ouvrir le dossier");
    expect(revealBtns.length).toBeGreaterThanOrEqual(2);
  });

  it("retourne null si le groupe n'a qu'un fichier", () => {
    const single = [makeGroup("g-single", ["/music/a.mp3"])];
    const { container } = renderWithLang(
      <AudioComparator groups={single} startIdx={0} selected={new Set()} onSelectPaths={vi.fn()} onIgnore={vi.fn()} onClose={vi.fn()} />
    );
    expect(container.firstChild).toBeNull();
  });

  it("Escape appelle onClose", () => {
    const onClose = vi.fn();
    renderWithLang(
      <AudioComparator groups={groups} startIdx={0} selected={new Set()} onSelectPaths={vi.fn()} onIgnore={vi.fn()} onClose={onClose} />
    );
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
  });
});
