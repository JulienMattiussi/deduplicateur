import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { LangProvider } from "../LangContext";
import { SessionCard } from "./SessionCard";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

// ---- L : SessionCard ----
const makeSession = (overrides = {}) => ({
  id: String(Date.now()),
  folder: "/home/test",
  total_wasted_bytes: 2048,
  total_groups: 1,
  scanned_files: 10,
  duration_ms: 50,
  by_folder: false,
  total_folders: 0,
  partial: false,
  ...overrides,
});

function renderSession(overrides = {}) {
  return render(
    <LangProvider>
      <SessionCard
        session={makeSession(overrides)}
        active={false}
        resuming={false}
        onResume={vi.fn()}
        onDelete={vi.fn()}
      />
    </LangProvider>
  );
}

describe("L - SessionCard", () => {
  it("relativeDate : affiche 'a l'instant' si la session vient d'etre creee", () => {
    renderSession({ id: String(Date.now()) });
    expect(screen.getByText("à l'instant")).toBeInTheDocument();
  });

  it("relativeDate : affiche 'il y a N min' pour une session de 5 minutes", () => {
    renderSession({ id: String(Date.now() - 5 * 60 * 1000) });
    expect(screen.getByText("il y a 5 min")).toBeInTheDocument();
  });

  it("relativeDate : affiche 'il y a N h' pour une session de 3 heures", () => {
    renderSession({ id: String(Date.now() - 3 * 3_600_000) });
    expect(screen.getByText("il y a 3 h")).toBeInTheDocument();
  });

  it("relativeDate : affiche 'il y a N j' pour une session de 2 jours", () => {
    renderSession({ id: String(Date.now() - 2 * 86_400_000) });
    expect(screen.getByText("il y a 2 j")).toBeInTheDocument();
  });

  it("sessionTags : tag 'doublons exacts' quand aucune similarite n'est activee", () => {
    renderSession();
    expect(screen.getByText("doublons exacts")).toBeInTheDocument();
  });

  it("sessionTags : tag 'par dossier' quand by_folder est vrai", () => {
    renderSession({ by_folder: true });
    expect(screen.getByText("par dossier")).toBeInTheDocument();
  });

  it("sessionTags : tag 'recursif' quand recursive est vrai et by_folder faux", () => {
    renderSession({ recursive: true, by_folder: false });
    expect(screen.getByText("récursif")).toBeInTheDocument();
  });

  it("sessionTags : tag 'dossier plat' quand ni by_folder ni recursive", () => {
    renderSession({ recursive: false, by_folder: false });
    expect(screen.getByText("dossier plat")).toBeInTheDocument();
  });

  it("sessionTags : tags images + videos + audio cumulables", () => {
    renderSession({ find_similar: true, find_similar_videos: true, find_similar_audio: true });
    expect(screen.getByText("similarité images")).toBeInTheDocument();
    expect(screen.getByText("similarité vidéos")).toBeInTheDocument();
    expect(screen.getByText("similarité audio")).toBeInTheDocument();
    expect(screen.queryByText("doublons exacts")).not.toBeInTheDocument();
  });

  it("bouton Reprendre desactive quand active=true, affiche 'En cours'", () => {
    render(
      <LangProvider>
        <SessionCard
          session={makeSession()}
          active={true}
          resuming={false}
          onResume={vi.fn()}
          onDelete={vi.fn()}
        />
      </LangProvider>
    );
    expect(screen.getByText("En cours")).toBeInTheDocument();
    expect(screen.getByText("En cours").closest("button")).toBeDisabled();
  });

  it("bouton Reprendre desactive et spinner visible quand resuming=true", () => {
    render(
      <LangProvider>
        <SessionCard
          session={makeSession()}
          active={false}
          resuming={true}
          onResume={vi.fn()}
          onDelete={vi.fn()}
        />
      </LangProvider>
    );
    expect(screen.getByText("Chargement…")).toBeInTheDocument();
    expect(screen.getByText("Chargement…").closest("button")).toBeDisabled();
  });
});

// ---- J test 4 : SessionCard affiche le tag similarite audio ----
describe("J - mode audio (SessionCard)", () => {
  it("SessionCard affiche le tag similarite audio quand find_similar_audio est vrai", () => {
    const audioSession = {
      id: String(Date.now()),
      folder: "/home/test",
      total_wasted_bytes: 2048,
      total_groups: 1,
      scanned_files: 10,
      duration_ms: 50,
      by_folder: false,
      total_folders: 0,
      partial: false,
      find_similar_audio: true,
    };
    render(
      <LangProvider>
        <SessionCard
          session={audioSession}
          active={false}
          resuming={false}
          onResume={vi.fn()}
          onDelete={vi.fn()}
        />
      </LangProvider>
    );
    expect(screen.getByText("similarité audio")).toBeInTheDocument();
  });
});
