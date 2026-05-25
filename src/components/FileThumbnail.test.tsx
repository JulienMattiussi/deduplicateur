import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { FileThumbnail } from "./FileThumbnail";

vi.mock("../fileActions", () => ({ openFile: vi.fn() }));

import { invoke } from "@tauri-apps/api/core";
import { openFile } from "../fileActions";

const mockInvoke = invoke as ReturnType<typeof vi.fn>;
const mockOpenFile = openFile as ReturnType<typeof vi.fn>;

const imageFile = { path: "/photos/img.jpg", name: "img.jpg", size: 50000, modified: 1700000000 };
const videoFile = {
  path: "/videos/clip.mp4",
  name: "clip.mp4",
  size: 10000000,
  modified: 1700000000,
  video_metadata: { duration_secs: 60, width: 1920, height: 1080, codec: "h264" },
};
const audioFile = { path: "/music/song.mp3", name: "song.mp3", size: 5000000, modified: 1700000000 };

beforeEach(() => {
  vi.clearAllMocks();
  mockInvoke.mockResolvedValue("data:image/jpeg;base64,abc");
});

// ---- A : mode audio ----
describe("A - mode audio", () => {
  it("affiche le bouton play SVG sans appeler invoke", () => {
    render(<FileThumbnail file={audioFile} mode="audio" />);
    expect(document.querySelector("svg")).toBeInTheDocument();
    expect(mockInvoke).not.toHaveBeenCalled();
  });

  it("clic appelle openFile avec le bon path", async () => {
    const user = userEvent.setup();
    render(<FileThumbnail file={audioFile} mode="audio" />);
    await user.click(document.querySelector("svg")!.closest("span")!);
    expect(mockOpenFile).toHaveBeenCalledWith(audioFile.path);
  });
});

// ---- lazy loading ----
describe("lazy loading", () => {
  it("n'appelle pas invoke tant que l'element n'est pas pres du viewport", () => {
    // Override du mock global : observer qui ne tire jamais le callback
    const g = globalThis as unknown as Record<string, unknown>;
    const original = g.IntersectionObserver;
    g.IntersectionObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    };

    render(<FileThumbnail file={imageFile} mode="image" />);
    expect(mockInvoke).not.toHaveBeenCalled();

    g.IntersectionObserver = original;
  });

  it("appelle invoke une fois que l'element entre dans le viewport", async () => {
    render(<FileThumbnail file={imageFile} mode="image" />);
    await waitFor(() => expect(mockInvoke).toHaveBeenCalledTimes(1));
  });
});

// ---- B : mode image ----
describe("B - mode image", () => {
  it("appelle get_image_thumbnail avec le bon path", async () => {
    render(<FileThumbnail file={imageFile} mode="image" />);
    await waitFor(() =>
      expect(mockInvoke).toHaveBeenCalledWith("get_image_thumbnail", {
        path: imageFile.path,
        maxSize: 64,
      })
    );
  });

  it("affiche une image une fois la thumbnail chargée", async () => {
    render(<FileThumbnail file={imageFile} mode="image" />);
    await waitFor(() => expect(screen.getByTestId("thumb-img")).toBeInTheDocument());
  });

  it("affiche 🖼 si invoke échoue", async () => {
    mockInvoke.mockRejectedValue(new Error("erreur"));
    render(<FileThumbnail file={imageFile} mode="image" />);
    await waitFor(() => expect(screen.getByText("🖼")).toBeInTheDocument());
  });

  it("clic sur la thumbnail appelle openFile", async () => {
    const user = userEvent.setup();
    render(<FileThumbnail file={imageFile} mode="image" />);
    await waitFor(() => screen.getByTestId("thumb-img"));
    await user.click(screen.getByTestId("thumb-img"));
    expect(mockOpenFile).toHaveBeenCalledWith(imageFile.path);
  });
});

// ---- C : mode vidéo ----
describe("C - mode vidéo", () => {
  it("appelle get_video_thumbnail avec path et duration", async () => {
    render(<FileThumbnail file={videoFile} mode="video" />);
    await waitFor(() =>
      expect(mockInvoke).toHaveBeenCalledWith("get_video_thumbnail", {
        path: videoFile.path,
        maxSize: 64,
        duration: 60,
      })
    );
  });

  it("affiche 🎬 si invoke échoue", async () => {
    mockInvoke.mockRejectedValue(new Error("pas de ffmpeg"));
    render(<FileThumbnail file={videoFile} mode="video" />);
    await waitFor(() => expect(screen.getByText("🎬")).toBeInTheDocument());
  });

  it("passe duration:null si video_metadata absent", async () => {
    const fileNoMeta = { ...videoFile, video_metadata: undefined };
    render(<FileThumbnail file={fileNoMeta} mode="video" />);
    await waitFor(() =>
      expect(mockInvoke).toHaveBeenCalledWith("get_video_thumbnail", {
        path: videoFile.path,
        maxSize: 64,
        duration: null,
      })
    );
  });
});

// ---- D : mode other ----
describe("D - mode other", () => {
  const pdfFile = { path: "/docs/rapport.pdf", name: "rapport.pdf", size: 200000, modified: 1700000000 };
  const txtFile = { path: "/notes/readme.txt", name: "readme.txt", size: 1000, modified: 1700000000 };
  const unknownFile = { path: "/data/archive.xyz", name: "archive.xyz", size: 5000, modified: 1700000000 };

  it("affiche un SVG sans appeler invoke pour un fichier PDF", () => {
    render(<FileThumbnail file={pdfFile} mode="other" />);
    expect(document.querySelector("svg")).toBeInTheDocument();
    expect(mockInvoke).not.toHaveBeenCalled();
  });

  it("affiche un SVG sans appeler invoke pour un fichier texte", () => {
    render(<FileThumbnail file={txtFile} mode="other" />);
    expect(document.querySelector("svg")).toBeInTheDocument();
    expect(mockInvoke).not.toHaveBeenCalled();
  });

  it("affiche un SVG sans appeler invoke pour une extension inconnue", () => {
    render(<FileThumbnail file={unknownFile} mode="other" />);
    expect(document.querySelector("svg")).toBeInTheDocument();
    expect(mockInvoke).not.toHaveBeenCalled();
  });

  it("le container a la classe file-thumb-other", () => {
    render(<FileThumbnail file={pdfFile} mode="other" />);
    expect(document.querySelector(".file-thumb-other")).toBeInTheDocument();
  });
});
