import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MissingToolBanner } from "./MissingToolBanner";
import { LangProvider } from "../LangContext";

vi.mock("@tauri-apps/plugin-shell", () => ({ open: vi.fn() }));

import { invoke } from "@tauri-apps/api/core";
import { open as shellOpen } from "@tauri-apps/plugin-shell";

const mockInvoke = invoke as ReturnType<typeof vi.fn>;
const mockShellOpen = shellOpen as ReturnType<typeof vi.fn>;

function renderBanner(tool: "ffmpeg" | "fpcalc", onAvailable = vi.fn()) {
  return render(
    <LangProvider>
      <MissingToolBanner tool={tool} onAvailable={onAvailable} />
    </LangProvider>
  );
}

describe("MissingToolBanner", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("affiche le nom de l'outil manquant (ffmpeg)", () => {
    renderBanner("ffmpeg");
    expect(screen.getByText(/ffmpeg introuvable/i)).toBeInTheDocument();
  });

  it("affiche le nom de l'outil manquant (fpcalc)", () => {
    renderBanner("fpcalc");
    expect(screen.getByText(/fpcalc introuvable/i)).toBeInTheDocument();
  });

  it("affiche les boutons Télécharger et Vérifier à nouveau", () => {
    renderBanner("ffmpeg");
    expect(screen.getByText("Télécharger")).toBeInTheDocument();
    expect(screen.getByText("Vérifier à nouveau")).toBeInTheDocument();
  });

  it("clic Télécharger ouvre l'URL via shell open", async () => {
    const user = userEvent.setup();
    mockShellOpen.mockResolvedValue(undefined);
    renderBanner("ffmpeg");
    await user.click(screen.getByText("Télécharger"));
    expect(mockShellOpen).toHaveBeenCalledWith("https://ffmpeg.org/download.html");
  });

  it("clic Télécharger pour fpcalc ouvre la bonne URL", async () => {
    const user = userEvent.setup();
    mockShellOpen.mockResolvedValue(undefined);
    renderBanner("fpcalc");
    await user.click(screen.getByText("Télécharger"));
    expect(mockShellOpen).toHaveBeenCalledWith("https://acoustid.org/chromaprint");
  });

  it("clic Vérifier à nouveau appelle check_tools et affiche message trouvé si disponible", async () => {
    const user = userEvent.setup();
    const onAvailable = vi.fn();
    mockInvoke.mockResolvedValue({ ffmpeg_available: true, fpcalc_available: true });
    renderBanner("ffmpeg", onAvailable);
    await user.click(screen.getByText("Vérifier à nouveau"));
    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith("check_tools");
      expect(onAvailable).toHaveBeenCalled();
    });
  });

  it("clic Vérifier à nouveau n'appelle pas onAvailable si l'outil reste absent", async () => {
    const user = userEvent.setup();
    const onAvailable = vi.fn();
    mockInvoke.mockResolvedValue({ ffmpeg_available: false, fpcalc_available: false });
    renderBanner("ffmpeg", onAvailable);
    await user.click(screen.getByText("Vérifier à nouveau"));
    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith("check_tools");
    });
    expect(onAvailable).not.toHaveBeenCalled();
  });

  it("affiche le message trouvé après détection réussie", async () => {
    const user = userEvent.setup();
    mockInvoke.mockResolvedValue({ ffmpeg_available: true, fpcalc_available: false });
    renderBanner("ffmpeg");
    await user.click(screen.getByText("Vérifier à nouveau"));
    await waitFor(() => {
      expect(screen.getByText(/ffmpeg détecté/i)).toBeInTheDocument();
    });
  });
});
