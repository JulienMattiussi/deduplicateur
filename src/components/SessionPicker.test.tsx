import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
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
}> = {}) {
  const props = {
    sessions: overrides.sessions ?? [],
    resumingId: overrides.resumingId ?? null,
    onResume: vi.fn(),
    onDelete: vi.fn(),
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

  it("ne contient plus de section cache (déplacée vers le menu Maintenance)", () => {
    renderPicker({ sessions: [makeSummary()] });
    expect(screen.queryByText(/Cache/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Purger/)).not.toBeInTheDocument();
  });
});
