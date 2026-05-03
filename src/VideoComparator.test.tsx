import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { VideoComparator } from "./VideoComparator";
import { LangProvider } from "./LangContext";

// Mock Tauri core - both invoke and convertFileSrc
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(() => Promise.resolve(null)),
  convertFileSrc: vi.fn((path: string) => `asset://${path}`),
}));

import { invoke, convertFileSrc } from "@tauri-apps/api/core";
const mockInvoke = invoke as ReturnType<typeof vi.fn>;
const mockConvertFileSrc = convertFileSrc as ReturnType<typeof vi.fn>;

// jsdom does not implement HTMLMediaElement methods - stub them
Object.defineProperty(HTMLMediaElement.prototype, "play", {
  configurable: true,
  value: vi.fn(() => Promise.resolve()),
});
Object.defineProperty(HTMLMediaElement.prototype, "pause", {
  configurable: true,
  value: vi.fn(),
});

beforeEach(() => {
  vi.clearAllMocks();
  mockInvoke.mockResolvedValue(null);
  mockConvertFileSrc.mockImplementation((p: string) => `asset://${p}`);
});

function makeFile(path: string, name: string) {
  return { path, name, size: 2048, modified: 1700000000 };
}

const group2 = {
  id: "vg1", hash: "vidabc", size: 2048, similar: false, video_similar: true,
  files: [makeFile("/videos/vid1.mp4", "vid1.mp4"), makeFile("/videos/vid2.mp4", "vid2.mp4")],
};

const group3 = {
  id: "vg2", hash: "viddef", size: 4096, similar: false, video_similar: true,
  files: [
    makeFile("/videos/a.mp4", "a.mp4"),
    makeFile("/videos/b.mp4", "b.mp4"),
    makeFile("/videos/c.mp4", "c.mp4"),
  ],
};

function renderComp(props: Partial<Parameters<typeof VideoComparator>[0]> = {}) {
  const defaultProps = {
    groups: [group2],
    startIdx: 0,
    selected: new Set<string>(),
    onSelectPaths: vi.fn(),
    onClose: vi.fn(),
  };
  return render(
    <LangProvider>
      <VideoComparator {...defaultProps} {...props} />
    </LangProvider>
  );
}

// ---- A : rendu de base ----
describe("A - rendu de base", () => {
  it("affiche le titre du comparateur video", () => {
    renderComp();
    expect(screen.getByText("Comparateur de vidéos")).toBeInTheDocument();
  });

  it("affiche le compteur de groupe", () => {
    renderComp({ groups: [group2, group3] });
    expect(screen.getByText("1 / 2")).toBeInTheDocument();
  });

  it("affiche les noms de fichiers dans les onglets", () => {
    renderComp();
    const tabs = screen.getAllByText("vid1.mp4");
    expect(tabs.length).toBeGreaterThanOrEqual(1);
    const tabs2 = screen.getAllByText("vid2.mp4");
    expect(tabs2.length).toBeGreaterThanOrEqual(1);
  });

  it("affiche deux elements video", () => {
    renderComp();
    const videos = screen.getAllByTestId(/^video-/);
    expect(videos).toHaveLength(2);
  });

  it("appelle convertFileSrc pour les deux fichiers", () => {
    renderComp();
    expect(mockConvertFileSrc).toHaveBeenCalledWith("/videos/vid1.mp4");
    expect(mockConvertFileSrc).toHaveBeenCalledWith("/videos/vid2.mp4");
  });

  it("affiche les boutons Garder celui-ci", () => {
    renderComp();
    const keepBtns = screen.getAllByText(/Garder celui-ci/);
    expect(keepBtns).toHaveLength(2);
  });

  it("affiche la barre de scrubbing", () => {
    renderComp();
    expect(screen.getByTestId("scrubbar")).toBeInTheDocument();
    expect(screen.getByTestId("scrub-slider")).toBeInTheDocument();
    expect(screen.getByTestId("btn-playpause")).toBeInTheDocument();
  });

  it("appelle onClose au clic sur ✕", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    renderComp({ onClose });
    await user.click(screen.getByText("✕"));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("appelle onClose sur Escape", () => {
    const onClose = vi.fn();
    renderComp({ onClose });
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalledOnce();
  });
});

// ---- B : navigation entre groupes ----
describe("B - navigation entre groupes", () => {
  it("les fleches de navigation sont desactivees sur le seul groupe", () => {
    renderComp({ groups: [group2] });
    const [prev, next] = screen.getAllByRole("button").filter(
      (b) => b.textContent === "◀" || b.textContent === "▶"
    );
    expect(prev).toBeDisabled();
    expect(next).toBeDisabled();
  });

  it("passe au groupe suivant avec la fleche ▶", async () => {
    const user = userEvent.setup();
    renderComp({ groups: [group2, group3] });
    expect(screen.getByText("1 / 2")).toBeInTheDocument();
    await user.click(screen.getByText("▶"));
    expect(screen.getByText("2 / 2")).toBeInTheDocument();
  });

  it("revient au groupe precedent avec la fleche ◀", async () => {
    const user = userEvent.setup();
    renderComp({ groups: [group2, group3], startIdx: 1 });
    expect(screen.getByText("2 / 2")).toBeInTheDocument();
    await user.click(screen.getByText("◀"));
    expect(screen.getByText("1 / 2")).toBeInTheDocument();
  });

  it("passe au groupe suivant avec ArrowRight", () => {
    renderComp({ groups: [group2, group3] });
    fireEvent.keyDown(window, { key: "ArrowRight" });
    expect(screen.getByText("2 / 2")).toBeInTheDocument();
  });

  it("revient au groupe precedent avec ArrowLeft", () => {
    renderComp({ groups: [group2, group3], startIdx: 1 });
    fireEvent.keyDown(window, { key: "ArrowLeft" });
    expect(screen.getByText("1 / 2")).toBeInTheDocument();
  });
});

// ---- C : keepFile ----
describe("C - keepFile", () => {
  it("appelle onSelectPaths avec les autres fichiers en toAdd et le fichier garde en toRemove", () => {
    const onSelectPaths = vi.fn();
    renderComp({ onSelectPaths });
    const keepBtns = screen.getAllByText(/Garder celui-ci/);
    fireEvent.click(keepBtns[0]);
    expect(onSelectPaths).toHaveBeenCalledWith(
      ["/videos/vid2.mp4"],
      ["/videos/vid1.mp4"]
    );
  });

  it("affiche un checkmark sur le fichier garde quand les autres sont selectionnes", () => {
    renderComp({ selected: new Set(["/videos/vid2.mp4"]) });
    expect(screen.getAllByText(/✓/).length).toBeGreaterThan(0);
  });
});

// ---- D : onglets L/R ----
describe("D - onglets L/R", () => {
  it("affiche les onglets Gauche et Droite", () => {
    renderComp({ groups: [group3] });
    expect(screen.getByText("Gauche")).toBeInTheDocument();
    expect(screen.getByText("Droite")).toBeInTheDocument();
  });

  it("groupe de 3 fichiers : affiche 3 onglets dans chaque groupe L et R", () => {
    renderComp({ groups: [group3] });
    const tabsLeft = screen.getByTestId("tabs-left");
    const tabsRight = screen.getByTestId("tabs-right");
    expect(within(tabsLeft).getAllByRole("button")).toHaveLength(3);
    expect(within(tabsRight).getAllByRole("button")).toHaveLength(3);
  });
});

// ---- E : synchronisation play/pause ----
describe("E - synchronisation play/pause", () => {
  it("les deux elements video ont les bons attributs src via convertFileSrc", () => {
    renderComp();
    const leftVideo = screen.getByTestId("video-left") as HTMLVideoElement;
    const rightVideo = screen.getByTestId("video-right") as HTMLVideoElement;
    expect(leftVideo.src).toContain("vid1.mp4");
    expect(rightVideo.src).toContain("vid2.mp4");
  });

  it("le scrub slider change la position de scrubbing", () => {
    renderComp();
    const slider = screen.getByTestId("scrub-slider") as HTMLInputElement;
    fireEvent.change(slider, { target: { value: "30" } });
    expect(slider.value).toBe("30");
  });
});

// ---- E2 : seek sync ----
describe("E2 - seek sync via slider", () => {
  it("met a jour currentTime des deux videos quand le slider change", () => {
    renderComp();
    const leftVideo = screen.getByTestId("video-left") as HTMLVideoElement;
    const rightVideo = screen.getByTestId("video-right") as HTMLVideoElement;

    // Definir les setters de currentTime via Object.defineProperty
    let leftTime = 0;
    let rightTime = 0;
    Object.defineProperty(leftVideo, "currentTime", {
      configurable: true,
      get: () => leftTime,
      set: (v: number) => { leftTime = v; },
    });
    Object.defineProperty(rightVideo, "currentTime", {
      configurable: true,
      get: () => rightTime,
      set: (v: number) => { rightTime = v; },
    });

    const slider = screen.getByTestId("scrub-slider") as HTMLInputElement;
    fireEvent.change(slider, { target: { value: "30" } });

    expect(leftTime).toBe(30);
    expect(rightTime).toBe(30);
  });
});

// ---- E3 : groupe avec 1 seul fichier ----
describe("E3 - groupe avec 1 seul fichier", () => {
  it("retourne null (ne crash pas) si le groupe n'a qu'un seul fichier", () => {
    const group1 = {
      id: "g1", hash: "abc", size: 1024, similar: false, video_similar: true,
      files: [makeFile("/videos/solo.mp4", "solo.mp4")],
    };
    const { container } = renderComp({ groups: [group1] });
    expect(container.firstChild).toBeNull();
  });
});

// ---- F : get_video_metadata est appele ----
describe("F - chargement des metadonnees", () => {
  it("appelle get_video_metadata pour les deux fichiers si pas de video_metadata pre-charge", async () => {
    renderComp();
    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith("get_video_metadata", { path: "/videos/vid1.mp4" });
      expect(mockInvoke).toHaveBeenCalledWith("get_video_metadata", { path: "/videos/vid2.mp4" });
    });
  });

  it("n'appelle pas get_video_metadata si video_metadata est deja present", async () => {
    const groupWithMeta = {
      ...group2,
      files: [
        { ...group2.files[0], video_metadata: { duration_secs: 60, width: 1920, height: 1080, codec: "h264" } },
        { ...group2.files[1], video_metadata: { duration_secs: 60, width: 1280, height: 720, codec: "h265" } },
      ],
    };
    renderComp({ groups: [groupWithMeta] });
    // Wait a tick to ensure effects have run
    await waitFor(() => {
      expect(mockInvoke).not.toHaveBeenCalledWith("get_video_metadata", expect.anything());
    });
  });

  it("affiche les metadonnees pre-chargees : resolution, duree, codec", async () => {
    const groupWithMeta = {
      ...group2,
      files: [
        { ...group2.files[0], video_metadata: { duration_secs: 125, width: 1920, height: 1080, codec: "h264" } },
        { ...group2.files[1], video_metadata: { duration_secs: 125, width: 1280, height: 720, codec: "h265" } },
      ],
    };
    renderComp({ groups: [groupWithMeta] });
    await waitFor(() => {
      expect(screen.getAllByText("1920x1080").length).toBeGreaterThan(0);
      expect(screen.getAllByText("h264").length).toBeGreaterThan(0);
    });
  });
});
