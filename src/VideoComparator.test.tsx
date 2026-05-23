import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { VideoComparator } from "./VideoComparator";
import { LangProvider } from "./LangContext";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

import { invoke } from "@tauri-apps/api/core";
const mockInvoke = invoke as ReturnType<typeof vi.fn>;

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
  mockInvoke.mockImplementation((cmd: string, args?: any) => {
    if (cmd === "get_media_server_port") return Promise.resolve(9876);
    if (cmd === "prepare_video_for_playback") return Promise.resolve({ kind: "Direct", path: args?.path ?? "" });
    return Promise.resolve(null);
  });
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
    expect(screen.getAllByText("vid1.mp4").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("vid2.mp4").length).toBeGreaterThanOrEqual(1);
  });

  it("affiche deux elements video", () => {
    renderComp();
    expect(screen.getAllByTestId(/^video-/)).toHaveLength(2);
  });

  it("les elements video recoivent une src http://127.0.0.1 apres initialisation", async () => {
    renderComp();
    await waitFor(() => {
      const leftVideo = screen.getByTestId("video-left") as HTMLVideoElement;
      expect(leftVideo.src).toContain("127.0.0.1:9876");
    });
  });

  it("appelle get_media_server_port au montage", async () => {
    renderComp();
    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith("get_media_server_port");
    });
  });

  it("appelle prepare_video_for_playback pour chaque cote au montage", async () => {
    renderComp();
    await waitFor(() => {
      const calls = mockInvoke.mock.calls.filter((c) => c[0] === "prepare_video_for_playback");
      expect(calls.length).toBeGreaterThanOrEqual(2);
    });
  });

  it("affiche le placeholder unsupported quand prepare retourne Unsupported", async () => {
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "get_media_server_port") return Promise.resolve(9876);
      if (cmd === "prepare_video_for_playback") return Promise.resolve({ kind: "Unsupported" });
      if (cmd === "get_video_metadata") return Promise.resolve({ duration_secs: 60, width: 640, height: 480, codec: "mpeg4" });
      return Promise.resolve(null);
    });
    renderComp();
    await waitFor(() => {
      expect(screen.getByTestId("video-unsupported-left")).toBeInTheDocument();
      expect(screen.getByTestId("video-unsupported-right")).toBeInTheDocument();
    });
    expect(screen.queryAllByTestId(/^video-(left|right)$/)).toHaveLength(0);
  });

  it("affiche les infos audio dans le footer (codec + canaux)", async () => {
    mockInvoke.mockImplementation((cmd: string, args?: any) => {
      if (cmd === "get_media_server_port") return Promise.resolve(9876);
      if (cmd === "prepare_video_for_playback") return Promise.resolve({ kind: "Direct", path: args?.path ?? "" });
      if (cmd === "get_video_metadata") return Promise.resolve({
        duration_secs: 60, width: 1920, height: 1080, codec: "h264",
        audio_codec: "aac", audio_channels: 2,
      });
      return Promise.resolve(null);
    });
    renderComp();
    await waitFor(() => {
      expect(screen.getAllByText(/aac stereo/i).length).toBeGreaterThan(0);
    });
  });

  it("affiche 'aucun son' quand audio_codec est null", async () => {
    mockInvoke.mockImplementation((cmd: string, args?: any) => {
      if (cmd === "get_media_server_port") return Promise.resolve(9876);
      if (cmd === "prepare_video_for_playback") return Promise.resolve({ kind: "Direct", path: args?.path ?? "" });
      if (cmd === "get_video_metadata") return Promise.resolve({
        duration_secs: 60, width: 640, height: 480, codec: "mpeg4",
        audio_codec: null, audio_channels: null,
      });
      return Promise.resolve(null);
    });
    renderComp();
    await waitFor(() => {
      expect(screen.getAllByText(/aucun son/i).length).toBeGreaterThan(0);
    });
  });

  it("affiche les boutons Garder celui-ci", () => {
    renderComp();
    expect(screen.getAllByText(/Garder celui-ci/)).toHaveLength(2);
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
    await user.click(screen.getByText("▶"));
    expect(screen.getByText("2 / 2")).toBeInTheDocument();
  });

  it("revient au groupe precedent avec la fleche ◀", async () => {
    const user = userEvent.setup();
    renderComp({ groups: [group2, group3], startIdx: 1 });
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
    fireEvent.click(screen.getAllByText(/Garder celui-ci/)[0]);
    expect(onSelectPaths).toHaveBeenCalledWith(["/videos/vid2.mp4"], ["/videos/vid1.mp4"]);
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
    expect(within(screen.getByTestId("tabs-left")).getAllByRole("button")).toHaveLength(3);
    expect(within(screen.getByTestId("tabs-right")).getAllByRole("button")).toHaveLength(3);
  });
});

// ---- E : synchronisation maitre→esclave ----
describe("E - synchronisation (gauche maitresse)", () => {
  it("la video de gauche a les controles natifs", () => {
    renderComp();
    const leftVideo = screen.getByTestId("video-left") as HTMLVideoElement;
    expect(leftVideo).toHaveAttribute("controls");
  });

  it("la video de droite n'a pas de controles", () => {
    renderComp();
    const rightVideo = screen.getByTestId("video-right") as HTMLVideoElement;
    expect(rightVideo).not.toHaveAttribute("controls");
  });

  it("la video de droite est mutee par defaut", () => {
    renderComp();
    const rightVideo = screen.getByTestId("video-right") as HTMLVideoElement;
    expect(rightVideo.muted).toBe(true);
  });

  it("la video de gauche n'est pas mutee par defaut", () => {
    renderComp();
    const leftVideo = screen.getByTestId("video-left") as HTMLVideoElement;
    expect(leftVideo.muted).toBe(false);
  });

  it("onPlay gauche declenche play sur la droite", () => {
    renderComp();
    const rightVideo = screen.getByTestId("video-right") as HTMLVideoElement;
    fireEvent.play(screen.getByTestId("video-left"));
    expect(rightVideo.play).toHaveBeenCalled();
  });

  it("onPause gauche declenche pause sur la droite", () => {
    renderComp();
    const rightVideo = screen.getByTestId("video-right") as HTMLVideoElement;
    fireEvent.pause(screen.getByTestId("video-left"));
    expect(rightVideo.pause).toHaveBeenCalled();
  });

  it("onSeeked gauche aligne currentTime de la droite", () => {
    renderComp();
    const leftVideo = screen.getByTestId("video-left") as HTMLVideoElement;
    const rightVideo = screen.getByTestId("video-right") as HTMLVideoElement;
    let rightTime = 0;
    Object.defineProperty(leftVideo, "currentTime", { configurable: true, get: () => 15, set: () => {} });
    Object.defineProperty(rightVideo, "currentTime", { configurable: true, get: () => rightTime, set: (v) => { rightTime = v; } });
    fireEvent(leftVideo, new Event("seeked"));
    expect(rightTime).toBe(15);
  });

  it("les evenements de la droite ne declenchent pas de sync", () => {
    renderComp();
    const leftVideo = screen.getByTestId("video-left") as HTMLVideoElement;
    fireEvent.play(screen.getByTestId("video-right"));
    expect(leftVideo.play).not.toHaveBeenCalled();
  });
});

// ---- E3 : groupe avec 1 seul fichier ----
describe("E3 - groupe avec 1 seul fichier", () => {
  it("retourne null si le groupe n'a qu'un seul fichier", () => {
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
  it("appelle get_video_metadata pour les deux fichiers", async () => {
    renderComp();
    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith("get_video_metadata", { path: "/videos/vid1.mp4" });
      expect(mockInvoke).toHaveBeenCalledWith("get_video_metadata", { path: "/videos/vid2.mp4" });
    });
  });

  it("appelle get_video_metadata systematiquement (cache de session peut manquer les infos audio)", async () => {
    const groupWithMeta = {
      ...group2,
      files: [
        { ...group2.files[0], video_metadata: { duration_secs: 60, width: 1920, height: 1080, codec: "h264" } },
        { ...group2.files[1], video_metadata: { duration_secs: 60, width: 1280, height: 720, codec: "h265" } },
      ],
    };
    renderComp({ groups: [groupWithMeta] });
    await waitFor(() => {
      const calls = mockInvoke.mock.calls.filter((c) => c[0] === "get_video_metadata");
      expect(calls.length).toBeGreaterThanOrEqual(2);
    });
  });

  it("affiche les metadonnees pre-chargees", async () => {
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

// ---- G : zoom + pan synchronises ----
describe("G - zoom et pan synchronises", () => {
  function getTransform(el: HTMLElement): string {
    return el.style.transform ?? "";
  }

  it("scroll vers le haut augmente le zoom des deux <video>", async () => {
    renderComp();
    await waitFor(() => expect(screen.getByTestId("video-left")).toBeInTheDocument());
    const leftVideo = screen.getByTestId("video-left");
    const rightVideo = screen.getByTestId("video-right");
    expect(getTransform(leftVideo)).toMatch(/scale\(1\)/);
    expect(getTransform(rightVideo)).toMatch(/scale\(1\)/);

    const area = leftVideo.parentElement!;
    fireEvent.wheel(area, { deltaY: -100, clientX: 50, clientY: 50 });

    expect(getTransform(leftVideo)).toMatch(/scale\(1\.2\)/);
    expect(getTransform(rightVideo)).toMatch(/scale\(1\.2\)/);
  });

  it("le scroll cote droit zoome aussi le cote gauche (sync)", async () => {
    renderComp();
    await waitFor(() => expect(screen.getByTestId("video-right")).toBeInTheDocument());
    const leftVideo = screen.getByTestId("video-left");
    const rightVideo = screen.getByTestId("video-right");
    const rightArea = rightVideo.parentElement!;

    fireEvent.wheel(rightArea, { deltaY: -100, clientX: 100, clientY: 50 });

    expect(getTransform(leftVideo)).toMatch(/scale\(1\.2\)/);
    expect(getTransform(rightVideo)).toMatch(/scale\(1\.2\)/);
  });

  it("scroll vers le bas ne descend pas en dessous de zoom = 1", async () => {
    renderComp();
    await waitFor(() => expect(screen.getByTestId("video-left")).toBeInTheDocument());
    const leftVideo = screen.getByTestId("video-left");
    const area = leftVideo.parentElement!;

    fireEvent.wheel(area, { deltaY: 100, clientX: 50, clientY: 50 });
    fireEvent.wheel(area, { deltaY: 100, clientX: 50, clientY: 50 });

    expect(getTransform(leftVideo)).toMatch(/scale\(1\)/);
  });

  it("cursor 'zoom-in' (loupe) sur la zone video a zoom = 1", async () => {
    renderComp();
    await waitFor(() => expect(screen.getByTestId("video-left")).toBeInTheDocument());
    const area = screen.getByTestId("video-left").parentElement!;
    expect(area.style.cursor).toBe("zoom-in");
  });

  it("cursor 'grab' apres un zoom > 1 (pan dispo)", async () => {
    renderComp();
    await waitFor(() => expect(screen.getByTestId("video-left")).toBeInTheDocument());
    const leftVideo = screen.getByTestId("video-left");
    const area = leftVideo.parentElement!;
    fireEvent.wheel(area, { deltaY: -100, clientX: 50, clientY: 50 });
    expect(area.style.cursor).toBe("grab");
  });
});
