import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ImageComparator } from "./ImageComparator";
import { LangProvider } from "./LangContext";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(() => Promise.resolve("data:image/jpeg;base64,abc")) }));

import { invoke } from "@tauri-apps/api/core";
const mockInvoke = invoke as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  mockInvoke.mockResolvedValue("data:image/jpeg;base64,abc");
});

function makeFile(path: string, name: string) {
  return { path, name, size: 1024, modified: 1700000000 };
}

const group2 = {
  id: "g1", hash: "abc", size: 1024, similar: true, video_similar: false,
  files: [makeFile("/a/img1.jpg", "img1.jpg"), makeFile("/b/img2.jpg", "img2.jpg")],
};

const group3 = {
  id: "g2", hash: "def", size: 2048, similar: true, video_similar: false,
  files: [
    makeFile("/c/img3.jpg", "img3.jpg"),
    makeFile("/d/img4.jpg", "img4.jpg"),
    makeFile("/e/img5.jpg", "img5.jpg"),
  ],
};

function render2(props: Partial<Parameters<typeof ImageComparator>[0]> = {}) {
  const defaultProps = {
    groups: [group2],
    startIdx: 0,
    selected: new Set<string>(),
    onSelectPaths: vi.fn(),
    onIgnore: vi.fn(),
    onClose: vi.fn(),
  };
  return render(
    <LangProvider>
      <ImageComparator {...defaultProps} {...props} />
    </LangProvider>
  );
}

// ---- A : rendu de base ----
describe("A - rendu de base", () => {
  it("affiche le compteur de groupe", () => {
    render2({ groups: [group2, group3] });
    expect(screen.getByText("1 / 2")).toBeInTheDocument();
  });

  it("affiche les noms de fichiers dans les onglets", () => {
    render2();
    // Les deux fichiers apparaissent dans les onglets (deux groupes d'onglets)
    const tabs = screen.getAllByText("img1.jpg");
    expect(tabs.length).toBeGreaterThanOrEqual(1);
    const tabs2 = screen.getAllByText("img2.jpg");
    expect(tabs2.length).toBeGreaterThanOrEqual(1);
  });

  it("affiche les boutons Garder & suivant et Garder & fermer (2 panneaux)", () => {
    render2();
    expect(screen.getAllByText(/Garder & suivant/)).toHaveLength(2);
    expect(screen.getAllByText(/Garder & fermer/)).toHaveLength(2);
  });

  it("appelle onClose au clic sur ✕", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render2({ onClose });
    await user.click(screen.getByText("✕"));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("appelle onClose sur Escape", () => {
    const onClose = vi.fn();
    render2({ onClose });
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalledOnce();
  });
});

// ---- B : navigation entre groupes ----
describe("B - navigation entre groupes", () => {
  it("les flèches de navigation sont désactivées sur le premier et dernier groupe", () => {
    render2({ groups: [group2] });
    const [prev, next] = screen.getAllByRole("button").filter((b) => b.textContent === "◀" || b.textContent === "▶");
    expect(prev).toBeDisabled();
    expect(next).toBeDisabled();
  });

  it("passe au groupe suivant avec la flèche ▶", async () => {
    const user = userEvent.setup();
    render2({ groups: [group2, group3] });
    expect(screen.getByText("1 / 2")).toBeInTheDocument();
    const next = screen.getByText("▶");
    await user.click(next);
    expect(screen.getByText("2 / 2")).toBeInTheDocument();
  });

  it("revient au groupe précédent avec la flèche ◀", async () => {
    const user = userEvent.setup();
    render2({ groups: [group2, group3], startIdx: 1 });
    expect(screen.getByText("2 / 2")).toBeInTheDocument();
    const prev = screen.getByText("◀");
    await user.click(prev);
    expect(screen.getByText("1 / 2")).toBeInTheDocument();
  });

  it("passe au groupe suivant avec ArrowRight", () => {
    render2({ groups: [group2, group3] });
    fireEvent.keyDown(window, { key: "ArrowRight" });
    expect(screen.getByText("2 / 2")).toBeInTheDocument();
  });

  it("revient au groupe précédent avec ArrowLeft", () => {
    render2({ groups: [group2, group3], startIdx: 1 });
    fireEvent.keyDown(window, { key: "ArrowLeft" });
    expect(screen.getByText("1 / 2")).toBeInTheDocument();
  });
});

// ---- C : keepFile ----
describe("C - keepFile", () => {
  it("Garder & suivant : onSelectPaths avec les autres en toAdd et le gardé en toRemove", () => {
    const onSelectPaths = vi.fn();
    render2({ onSelectPaths });
    fireEvent.click(screen.getAllByText(/Garder & suivant/)[0]);
    expect(onSelectPaths).toHaveBeenCalledWith(
      ["/b/img2.jpg"],
      ["/a/img1.jpg"]
    );
  });

  it("Garder & fermer : coche les doublons ET ferme le comparateur", () => {
    const onSelectPaths = vi.fn();
    const onClose = vi.fn();
    render2({ onSelectPaths, onClose, groups: [group2, group3] });
    fireEvent.click(screen.getAllByText(/Garder & fermer/)[0]);
    expect(onSelectPaths).toHaveBeenCalledWith(["/b/img2.jpg"], ["/a/img1.jpg"]);
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("Garder & suivant : passe au groupe suivant sans fermer (pas le dernier)", () => {
    const onClose = vi.fn();
    render2({ onClose, groups: [group2, group3] });
    expect(screen.getByText("1 / 2")).toBeInTheDocument();
    fireEvent.click(screen.getAllByText(/Garder & suivant/)[0]);
    expect(screen.getByText("2 / 2")).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("Garder & suivant sur le dernier groupe : ferme le comparateur", () => {
    const onClose = vi.fn();
    render2({ onClose, groups: [group2] });
    fireEvent.click(screen.getAllByText(/Garder & suivant/)[0]);
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("affiche ✓ sur le fichier gardé quand les autres sont sélectionnés", () => {
    // img2.jpg est dans selected → img1.jpg est "kept"
    render2({ selected: new Set(["/b/img2.jpg"]) });
    expect(screen.getAllByText(/✓/).length).toBeGreaterThan(0);
  });
});

// ---- C2 : ignore depuis le comparateur ----
describe("C2 - ignore & suivant", () => {
  it("le bouton 🚫 appelle onIgnore avec l'id du groupe courant", () => {
    const onIgnore = vi.fn();
    render2({ onIgnore, groups: [group2, group3] });
    fireEvent.click(screen.getByTestId("comparator-ignore-btn"));
    expect(onIgnore).toHaveBeenCalledWith(group2.id);
  });

  it("ignorer le dernier groupe ferme le comparateur", () => {
    const onIgnore = vi.fn();
    const onClose = vi.fn();
    render2({ onIgnore, onClose, groups: [group2] });
    fireEvent.click(screen.getByTestId("comparator-ignore-btn"));
    expect(onIgnore).toHaveBeenCalledWith(group2.id);
    expect(onClose).toHaveBeenCalledOnce();
  });
});

// ---- C3 : raccourcis clavier de triage ----
describe("C3 - raccourcis clavier", () => {
  it("'1' garde le fichier de gauche et passe au suivant", () => {
    const onSelectPaths = vi.fn();
    render2({ onSelectPaths, groups: [group2, group3] });
    fireEvent.keyDown(window, { key: "1" });
    expect(onSelectPaths).toHaveBeenCalledWith(["/b/img2.jpg"], ["/a/img1.jpg"]);
    expect(screen.getByText("2 / 2")).toBeInTheDocument();
  });

  it("'2' garde le fichier de droite et passe au suivant", () => {
    const onSelectPaths = vi.fn();
    render2({ onSelectPaths, groups: [group2, group3] });
    fireEvent.keyDown(window, { key: "2" });
    expect(onSelectPaths).toHaveBeenCalledWith(["/a/img1.jpg"], ["/b/img2.jpg"]);
    expect(screen.getByText("2 / 2")).toBeInTheDocument();
  });

  it("'i' ignore le groupe courant", () => {
    const onIgnore = vi.fn();
    render2({ onIgnore, groups: [group2, group3] });
    fireEvent.keyDown(window, { key: "i" });
    expect(onIgnore).toHaveBeenCalledWith(group2.id);
  });
});

// ---- D : onglets L/R et swap automatique ----
describe("D - onglets et swap", () => {
  it("affiche les onglets Gauche et Droite", () => {
    render2({ groups: [group3] });
    expect(screen.getByText("Gauche")).toBeInTheDocument();
    expect(screen.getByText("Droite")).toBeInTheDocument();
  });

  it("groupe de 3 fichiers : affiche 3 onglets dans chaque groupe L et R", () => {
    render2({ groups: [group3] });
    const tabsLeft = screen.getByTestId("tabs-left");
    const tabsRight = screen.getByTestId("tabs-right");
    expect(within(tabsLeft).getAllByRole("button")).toHaveLength(3);
    expect(within(tabsRight).getAllByRole("button")).toHaveLength(3);
  });
});

// ---- E : mode overlay ----
describe("E - mode overlay", () => {
  it("bascule en mode overlay au clic sur ⧉", async () => {
    const user = userEvent.setup();
    render2();
    expect(screen.getByTestId("comparator-body")).toBeInTheDocument();
    await user.click(screen.getByText("⧉"));
    expect(screen.getByTestId("comparator-body-overlay")).toBeInTheDocument();
  });

  it("repasse en mode normal au deuxième clic sur ⧉", async () => {
    const user = userEvent.setup();
    render2();
    await user.click(screen.getByText("⧉"));
    await user.click(screen.getByText("⧉"));
    expect(screen.queryByTestId("comparator-body-overlay")).not.toBeInTheDocument();
  });
});

// ---- F : get_image_url est appelé (anime les GIF, fallback data URL JPEG) ----
describe("F - chargement des images", () => {
  it("appelle get_image_url pour les deux fichiers", async () => {
    render2();
    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith("get_image_url", { path: "/a/img1.jpg", maxSize: 800 });
      expect(mockInvoke).toHaveBeenCalledWith("get_image_url", { path: "/b/img2.jpg", maxSize: 800 });
    });
  });

  it("groupe avec un GIF : changer un onglet refetch les DEUX urls (sync GIF animes)", async () => {
    // Quand le groupe contient au moins un GIF anime, changer le fichier compare
    // d'un cote re-fetch aussi l'URL de l'autre cote, et set les deux thumbs
    // ensemble dans le meme tick pour que les deux <img> remontent simultanement
    // (pas d'API JS pour controler une position dans un <img>, et sous WebView2
    // Windows la cle React seule ne suffit pas si la src est inchangee).
    const user = userEvent.setup();
    const gifGroup3 = {
      id: "gif3", hash: "ghi", size: 1024, similar: true, video_similar: false,
      files: [
        makeFile("/a/anim1.gif", "anim1.gif"),
        makeFile("/b/anim2.gif", "anim2.gif"),
        makeFile("/c/anim3.gif", "anim3.gif"),
      ],
    };
    render2({ groups: [gifGroup3] });
    await waitFor(() => {
      expect(screen.getByAltText("anim1.gif")).toBeInTheDocument();
      expect(screen.getByAltText("anim2.gif")).toBeInTheDocument();
    });

    mockInvoke.mockClear();

    // Clic sur l'onglet du 3e fichier dans la barre droite : seul rightIdx change
    const tabsRight = screen.getByTestId("tabs-right");
    await user.click(within(tabsRight).getByText("anim3.gif"));

    await waitFor(() => {
      expect(screen.getByAltText("anim3.gif")).toBeInTheDocument();
    });

    // Les deux URLs doivent avoir ete re-fetchees (gauche inchangee fonctionnellement
    // mais re-fetchee pour batcher le remount avec la droite).
    const urlCalls = mockInvoke.mock.calls
      .filter(c => c[0] === "get_image_url")
      .map(c => (c[1] as { path: string }).path);
    expect(urlCalls).toContain("/a/anim1.gif");
    expect(urlCalls).toContain("/c/anim3.gif");
  });

  it("groupe avec un GIF : un query `?_remount=N` est ajoute aux URLs HTTP et change a chaque changement d'onglet", async () => {
    // Sous WebView2 (Windows) le browser cache le GIF decode par URL et
    // l'animation continue meme apres reset+refetch d'une src identique. Un
    // fragment URL est strippe avant la lookup cache (comportement HTTP
    // standard) donc insuffisant. Un query param fait partie de la cle de
    // cache : `path.gif?_v=1` et `path.gif?_v=2` sont deux URLs distinctes
    // pour le browser, qui refait un fetch + decode + animation a frame 0.
    const user = userEvent.setup();
    const gifGroup3 = {
      id: "gif3", hash: "ghi", size: 1024, similar: true, video_similar: false,
      files: [
        makeFile("/a/anim1.gif", "anim1.gif"),
        makeFile("/b/anim2.gif", "anim2.gif"),
        makeFile("/c/anim3.gif", "anim3.gif"),
      ],
    };
    mockInvoke.mockImplementation((cmd, args: any) => {
      if (cmd === "get_image_url") return Promise.resolve(`http://127.0.0.1:1234/${encodeURIComponent(args.path)}`);
      return Promise.resolve(null);
    });
    render2({ groups: [gifGroup3] });
    await waitFor(() => {
      const src = screen.getByAltText("anim1.gif").getAttribute("src") ?? "";
      expect(src).toMatch(/[?&]_remount=\d+$/);
    });
    const leftSrc1 = screen.getByAltText("anim1.gif").getAttribute("src") ?? "";
    const tick1 = leftSrc1.match(/[?&]_remount=(\d+)/)?.[1];

    // Change l'onglet droit
    const tabsRight = screen.getByTestId("tabs-right");
    await user.click(within(tabsRight).getByText("anim3.gif"));
    await waitFor(() => {
      const src = screen.getByAltText("anim3.gif").getAttribute("src") ?? "";
      expect(src).toMatch(/[?&]_remount=\d+$/);
    });

    const leftSrc2 = screen.getByAltText("anim1.gif").getAttribute("src") ?? "";
    const rightSrc2 = screen.getByAltText("anim3.gif").getAttribute("src") ?? "";
    const tick2 = leftSrc2.match(/[?&]_remount=(\d+)/)?.[1];

    expect(tick2).toBeDefined();
    expect(tick2).not.toBe(tick1);
    // Les deux <img> portent le meme tick (sync) pour le meme cycle
    expect(rightSrc2).toContain(`_remount=${tick2}`);
  });

  it("groupe sans GIF : pas de query `_remount` ajoute aux src", async () => {
    render2({ groups: [group3] });
    await waitFor(() => expect(screen.getByAltText("img3.jpg")).toBeInTheDocument());
    const leftSrc = screen.getByAltText("img3.jpg").getAttribute("src") ?? "";
    const rightSrc = screen.getByAltText("img4.jpg").getAttribute("src") ?? "";
    expect(leftSrc).not.toContain("_remount=");
    expect(rightSrc).not.toContain("_remount=");
  });

  it("groupe sans GIF : changer un onglet ne refetch que le cote qui change", async () => {
    // Cas miroir : pour un groupe d'images statiques (PNG, JPEG, etc), inutile
    // de remonter l'autre cote a chaque changement d'onglet. On preserve l'UX
    // en ne re-fetching que le cote qui change vraiment.
    const user = userEvent.setup();
    render2({ groups: [group3] });
    await waitFor(() => {
      expect(screen.getByAltText("img3.jpg")).toBeInTheDocument();
      expect(screen.getByAltText("img4.jpg")).toBeInTheDocument();
    });

    mockInvoke.mockClear();

    const tabsRight = screen.getByTestId("tabs-right");
    await user.click(within(tabsRight).getByText("img5.jpg"));

    await waitFor(() => {
      expect(screen.getByAltText("img5.jpg")).toBeInTheDocument();
    });

    const urlCalls = mockInvoke.mock.calls
      .filter(c => c[0] === "get_image_url")
      .map(c => (c[1] as { path: string }).path);
    expect(urlCalls).toContain("/e/img5.jpg");
    expect(urlCalls).not.toContain("/c/img3.jpg"); // cote gauche non refetche
  });

  it("affiche l'URL retournee pour un .gif (URL media server, anime nativement)", async () => {
    mockInvoke.mockImplementation((cmd, args: any) => {
      if (cmd === "get_image_url" && args?.path?.endsWith(".gif")) {
        return Promise.resolve(`http://127.0.0.1:1234/${encodeURIComponent(args.path)}`);
      }
      if (cmd === "get_image_url") {
        return Promise.resolve("data:image/jpeg;base64,abc");
      }
      return Promise.resolve(null);
    });
    const gifGroup = {
      id: "gif", hash: "ghi", size: 1024, similar: true, video_similar: false,
      files: [makeFile("/a/anim.gif", "anim.gif"), makeFile("/b/anim2.gif", "anim2.gif")],
    };
    render2({ groups: [gifGroup] });
    await waitFor(() => {
      const imgs = screen.getAllByRole("img");
      expect(imgs.some(i => i.getAttribute("src")?.startsWith("http://127.0.0.1:"))).toBe(true);
    });
  });
});

// ---- G : zoom + pan ----
describe("G - zoom et pan synchronises", () => {
  function getTransform(img: HTMLElement): string {
    return img.style.transform ?? "";
  }

  it("scroll vers le haut (deltaY < 0) augmente le zoom des deux <img>", async () => {
    render2();
    await waitFor(() => expect(screen.getByAltText("img1.jpg")).toBeInTheDocument());
    const leftImg = screen.getByAltText("img1.jpg");
    const rightImg = screen.getByAltText("img2.jpg");
    expect(getTransform(leftImg)).toMatch(/scale\(1\)/);
    expect(getTransform(rightImg)).toMatch(/scale\(1\)/);

    const area = leftImg.parentElement!;
    fireEvent.wheel(area, { deltaY: -100, clientX: 50, clientY: 50 });

    // ZOOM_FACTOR = 1.2 -> apres un tic up, zoom = 1.2
    expect(getTransform(leftImg)).toMatch(/scale\(1\.2\)/);
    expect(getTransform(rightImg)).toMatch(/scale\(1\.2\)/);
  });

  it("scroll vers le bas (deltaY > 0) diminue le zoom mais clamp a 1", async () => {
    render2();
    await waitFor(() => expect(screen.getByAltText("img1.jpg")).toBeInTheDocument());
    const leftImg = screen.getByAltText("img1.jpg");
    const area = leftImg.parentElement!;

    // Trois scroll up puis quatre scroll down -> on doit etre clamp a 1
    fireEvent.wheel(area, { deltaY: -100, clientX: 50, clientY: 50 });
    fireEvent.wheel(area, { deltaY: -100, clientX: 50, clientY: 50 });
    fireEvent.wheel(area, { deltaY: -100, clientX: 50, clientY: 50 });
    fireEvent.wheel(area, { deltaY: 100, clientX: 50, clientY: 50 });
    fireEvent.wheel(area, { deltaY: 100, clientX: 50, clientY: 50 });
    fireEvent.wheel(area, { deltaY: 100, clientX: 50, clientY: 50 });
    fireEvent.wheel(area, { deltaY: 100, clientX: 50, clientY: 50 });

    expect(getTransform(leftImg)).toMatch(/scale\(1\)/);
    // Au retour a zoom=1, le pan est reset a (0, 0)
    expect(getTransform(leftImg)).toMatch(/translate\(0px, 0px\)/);
  });

  it("ne descend jamais en dessous de zoom = 1", async () => {
    render2();
    await waitFor(() => expect(screen.getByAltText("img1.jpg")).toBeInTheDocument());
    const leftImg = screen.getByAltText("img1.jpg");
    const area = leftImg.parentElement!;

    fireEvent.wheel(area, { deltaY: 100, clientX: 50, clientY: 50 });
    fireEvent.wheel(area, { deltaY: 100, clientX: 50, clientY: 50 });

    expect(getTransform(leftImg)).toMatch(/scale\(1\)/);
  });

  it("le scroll cote droit zoome aussi le cote gauche (sync)", async () => {
    render2();
    await waitFor(() => expect(screen.getByAltText("img2.jpg")).toBeInTheDocument());
    const leftImg = screen.getByAltText("img1.jpg");
    const rightImg = screen.getByAltText("img2.jpg");
    const rightArea = rightImg.parentElement!;

    fireEvent.wheel(rightArea, { deltaY: -100, clientX: 100, clientY: 50 });

    expect(getTransform(leftImg)).toMatch(/scale\(1\.2\)/);
    expect(getTransform(rightImg)).toMatch(/scale\(1\.2\)/);
  });

  it("cursor 'zoom-in' (loupe) sur la zone image a zoom = 1", async () => {
    render2();
    await waitFor(() => expect(screen.getByAltText("img1.jpg")).toBeInTheDocument());
    const area = screen.getByAltText("img1.jpg").parentElement!;
    expect(area.style.cursor).toBe("zoom-in");
  });

  it("cursor 'grab' apres un zoom > 1 (pan dispo)", async () => {
    render2();
    await waitFor(() => expect(screen.getByAltText("img1.jpg")).toBeInTheDocument());
    const leftImg = screen.getByAltText("img1.jpg");
    const area = leftImg.parentElement!;
    fireEvent.wheel(area, { deltaY: -100, clientX: 50, clientY: 50 });
    expect(area.style.cursor).toBe("grab");
  });

  it("clic sur l'image a zoom = 1 ouvre le fichier (pas de drag detecte)", async () => {
    const user = userEvent.setup();
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "open_file") return Promise.resolve(null);
      return Promise.resolve("data:image/jpeg;base64,abc");
    });
    render2();
    await waitFor(() => expect(screen.getByAltText("img1.jpg")).toBeInTheDocument());
    const leftImg = screen.getByAltText("img1.jpg");

    await user.click(leftImg);

    expect(mockInvoke).toHaveBeenCalledWith("open_file", expect.anything());
  });
});

