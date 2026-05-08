import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SessionPicker } from "./SessionPicker";
import { LangProvider } from "../LangContext";
import type { ScanSummary } from "../types";

function makeSummary(overrides: Partial<ScanSummary> = {}): ScanSummary {
  return {
    id: "s1",
    folder: "/data",
    total_wasted_bytes: 1024,
    total_groups: 2,
    scanned_files: 100,
    duration_ms: 5000,
    by_folder: false,
    total_folders: 0,
    partial: false,
    recursive: true,
    find_similar: false,
    find_similar_videos: false,
    ffmpeg_missing: false,
    find_similar_audio: false,
    fpcalc_missing: false,
    ...overrides,
  };
}

function renderPicker(overrides: Partial<{
  sessions: ScanSummary[];
  resumingId: string | null;
  cacheBytes: number | null;
  purgeConfirm: boolean;
}> = {}) {
  const props = {
    sessions: overrides.sessions ?? [],
    resumingId: overrides.resumingId ?? null,
    cacheBytes: overrides.cacheBytes ?? null,
    purgeConfirm: overrides.purgeConfirm ?? false,
    onResume: vi.fn(),
    onDelete: vi.fn(),
    onPurge: vi.fn(),
    onPurgeConfirm: vi.fn(),
  };
  return { ...render(<LangProvider><SessionPicker {...props} /></LangProvider>), props };
}

describe("SessionPicker - liste des sessions", () => {
  it("affiche le message vide si aucune session", () => {
    renderPicker();
    expect(screen.getByText(/Aucune analyse/i)).toBeInTheDocument();
  });

  it("affiche une carte par session", () => {
    renderPicker({ sessions: [makeSummary({ id: "s1", folder: "/path-aaaa" }), makeSummary({ id: "s2", folder: "/path-bbbb" })] });
    expect(screen.getByText(/\/path-aaaa/)).toBeInTheDocument();
    expect(screen.getByText(/\/path-bbbb/)).toBeInTheDocument();
  });
});

describe("SessionPicker - section cache", () => {
  it("absent si cacheBytes=null", () => {
    renderPicker({ cacheBytes: null });
    expect(screen.queryByText(/Cache/)).not.toBeInTheDocument();
  });

  it("absent si cacheBytes=0", () => {
    renderPicker({ cacheBytes: 0 });
    expect(screen.queryByText(/Cache/)).not.toBeInTheDocument();
  });

  it("affiche la taille du cache et bouton Purger", () => {
    renderPicker({ cacheBytes: 1024 * 1024 });
    expect(screen.getByText(/1.0 Mo/)).toBeInTheDocument();
    expect(screen.getByText(/Purger/)).toBeInTheDocument();
  });

  it("clic sur Purger appelle onPurgeConfirm(true)", async () => {
    const user = userEvent.setup();
    const { props } = renderPicker({ cacheBytes: 1024 });
    await user.click(screen.getByText(/Purger/));
    expect(props.onPurgeConfirm).toHaveBeenCalledWith(true);
  });

  it("affiche la confirmation quand purgeConfirm=true", () => {
    renderPicker({ cacheBytes: 1024, purgeConfirm: true });
    expect(screen.getByText(/Cette action est irréversible/i)).toBeInTheDocument();
  });

  it("clic sur Annuler en mode confirm appelle onPurgeConfirm(false)", async () => {
    const user = userEvent.setup();
    const { props } = renderPicker({ cacheBytes: 1024, purgeConfirm: true });
    await user.click(screen.getByText(/Annuler/));
    expect(props.onPurgeConfirm).toHaveBeenCalledWith(false);
  });

  it("clic sur Purger en mode confirm appelle onPurge", async () => {
    const user = userEvent.setup();
    const { props } = renderPicker({ cacheBytes: 1024, purgeConfirm: true });
    // En mode confirm, le bouton "Purger" est rouge
    const purgeBtn = screen.getAllByText(/Purger/).find((el) => el.tagName === "BUTTON")!;
    await user.click(purgeBtn);
    expect(props.onPurge).toHaveBeenCalled();
  });
});
