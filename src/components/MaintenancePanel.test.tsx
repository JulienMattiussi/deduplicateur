import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { invoke } from "@tauri-apps/api/core";
import { MaintenancePanel } from "./MaintenancePanel";
import { LangProvider } from "../LangContext";
import type { MaintenanceReport } from "../types";

const mockInvoke = invoke as unknown as ReturnType<typeof vi.fn>;

function makeReport(overrides: Partial<MaintenanceReport> = {}): MaintenanceReport {
  return {
    cache_bytes: 2_048_000,
    cache_total_entries: 10,
    cache_stale_entries: 3,
    ignored_total: 5,
    ignored_stale: 2,
    sessions: [
      // id = timestamp ms ; tres futur => "recent"
      { id: "2000000000000", folder: "/data/recent", folder_missing: false, total_groups: 3, total_wasted_bytes: 1024, size_bytes: 500 },
      // id ancien => folder disparu
      { id: "1000", folder: "/data/old-missing", folder_missing: true, total_groups: 1, total_wasted_bytes: 2048, size_bytes: 300 },
    ],
    ...overrides,
  };
}

function mockWith(report: MaintenanceReport) {
  mockInvoke.mockImplementation((cmd: string) => {
    if (cmd === "get_maintenance_report") return Promise.resolve(report);
    if (cmd === "purge_stale_caches") return Promise.resolve(report.cache_stale_entries);
    if (cmd === "purge_stale_ignored") return Promise.resolve(report.ignored_stale);
    return Promise.resolve(null);
  });
}

function renderPanel() {
  const onChanged = vi.fn();
  return { onChanged, ...render(<LangProvider><MaintenancePanel onChanged={onChanged} /></LangProvider>) };
}

async function openDrawer() {
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: /Maintenance/ }));
  await screen.findByText("Espace occupé");
  return user;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockWith(makeReport());
});

describe("MaintenancePanel", () => {
  it("le drawer est fermé au départ", () => {
    renderPanel();
    expect(screen.queryByText("Espace occupé")).not.toBeInTheDocument();
  });

  it("ouvre le drawer et charge le rapport", async () => {
    renderPanel();
    await openDrawer();
    expect(mockInvoke).toHaveBeenCalledWith("get_maintenance_report");
    expect(screen.getByText("Références obsolètes")).toBeInTheDocument();
  });

  it("nettoie les caches obsolètes", async () => {
    const { onChanged } = renderPanel();
    const user = await openDrawer();
    await user.click(screen.getByTestId("maint-clean-caches"));
    await waitFor(() => expect(mockInvoke).toHaveBeenCalledWith("purge_stale_caches"));
    expect(onChanged).toHaveBeenCalled();
  });

  it("désactive le bouton de nettoyage quand rien n'est obsolète", async () => {
    mockWith(makeReport({ cache_stale_entries: 0 }));
    renderPanel();
    await openDrawer();
    expect(screen.getByTestId("maint-clean-caches")).toBeDisabled();
  });

  it("nettoie les ignorés obsolètes", async () => {
    renderPanel();
    const user = await openDrawer();
    await user.click(screen.getByTestId("maint-clean-ignored"));
    await waitFor(() => expect(mockInvoke).toHaveBeenCalledWith("purge_stale_ignored"));
  });

  it("affiche un badge pour un dossier disparu", async () => {
    renderPanel();
    await openDrawer();
    expect(screen.getAllByTestId("maint-missing-badge")).toHaveLength(1);
  });

  it("sélectionne tout puis supprime les sessions après confirmation", async () => {
    const { onChanged } = renderPanel();
    const user = await openDrawer();
    await user.click(screen.getByText("Tout cocher"));
    // Le bouton de suppression reflète le nombre coché.
    await user.click(screen.getByTestId("maint-delete-sessions"));
    await user.click(screen.getByTestId("maint-delete-confirm"));
    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith("delete_session", { id: "2000000000000" });
      expect(mockInvoke).toHaveBeenCalledWith("delete_session", { id: "1000" });
    });
    expect(onChanged).toHaveBeenCalled();
  });

  it("cocher les dossiers introuvables ne sélectionne que la session disparue", async () => {
    renderPanel();
    const user = await openDrawer();
    await user.click(screen.getByTestId("maint-select-missing"));
    await user.click(screen.getByTestId("maint-delete-sessions"));
    await user.click(screen.getByTestId("maint-delete-confirm"));
    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith("delete_session", { id: "1000" });
    });
    expect(mockInvoke).not.toHaveBeenCalledWith("delete_session", { id: "2000000000000" });
  });

  it("sélectionne les analyses de plus de N jours", async () => {
    renderPanel();
    const user = await openDrawer();
    const input = screen.getByTestId("maint-older-days");
    await user.clear(input);
    await user.type(input, "1");
    await user.click(screen.getByTestId("maint-apply-older"));
    await user.click(screen.getByTestId("maint-delete-sessions"));
    await user.click(screen.getByTestId("maint-delete-confirm"));
    await waitFor(() => {
      // Seule la session ancienne (id=1000) a plus d'1 jour.
      expect(mockInvoke).toHaveBeenCalledWith("delete_session", { id: "1000" });
    });
    expect(mockInvoke).not.toHaveBeenCalledWith("delete_session", { id: "2000000000000" });
  });

  it("vide entièrement les caches après confirmation", async () => {
    renderPanel();
    const user = await openDrawer();
    await user.click(screen.getByTestId("maint-full-purge"));
    await user.click(screen.getByTestId("maint-full-purge-confirm"));
    await waitFor(() => expect(mockInvoke).toHaveBeenCalledWith("purge_cache"));
  });
});
