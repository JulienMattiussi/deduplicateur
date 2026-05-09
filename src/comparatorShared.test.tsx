import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { LangProvider } from "./LangContext";
import { KeepButton, MetaBlockBase, toMediaUrl } from "./comparatorShared";

const mockInvoke = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...args: any[]) => mockInvoke(...args) }));

describe("toMediaUrl", () => {
  it("normalise les separateurs Windows en /", () => {
    const url = toMediaUrl("C:\\Users\\me\\file.mp3", 12345);
    expect(url).toContain("C%3A/Users/me/file.mp3");
    expect(url).toMatch(/^http:\/\/127\.0\.0\.1:12345\//);
  });

  it("ajoute un slash en debut si absent", () => {
    const url = toMediaUrl("relative/path.mp4", 8080);
    expect(url).toBe("http://127.0.0.1:8080/relative/path.mp4");
  });

  it("URI-encode les caracteres speciaux par segment", () => {
    const url = toMediaUrl("/data/mon dossier/le fichier.mp3", 9999);
    expect(url).toContain("/data/mon%20dossier/le%20fichier.mp3");
  });
});

describe("KeepButton", () => {
  function renderBtn(kept: boolean, onKeep = vi.fn()) {
    return render(
      <LangProvider>
        <KeepButton kept={kept} onKeep={onKeep} />
      </LangProvider>
    );
  }

  it("affiche le label keepThis sans coche quand non garde", () => {
    renderBtn(false);
    const btn = screen.getByRole("button");
    expect(btn.textContent).not.toContain("✓");
    expect(btn.textContent).toMatch(/Garder/i);
    expect(btn.className).not.toContain("--kept");
  });

  it("affiche une coche prefixee quand garde", () => {
    renderBtn(true);
    const btn = screen.getByRole("button");
    expect(btn.textContent).toContain("✓");
    expect(btn.className).toContain("comparator-keep-btn--kept");
  });

  it("appelle onKeep au clic", async () => {
    const user = userEvent.setup();
    const onKeep = vi.fn();
    renderBtn(false, onKeep);
    await user.click(screen.getByRole("button"));
    expect(onKeep).toHaveBeenCalledTimes(1);
  });
});

describe("MetaBlockBase - bouton ouvrir le fichier", () => {
  function renderBlock() {
    const file = { path: "/a/b/c.mp4", name: "c.mp4", size: 1024, modified: 0 };
    return render(
      <LangProvider>
        <MetaBlockBase file={file} />
      </LangProvider>
    );
  }

  it("affiche un bouton lecteur (testid)", () => {
    renderBlock();
    expect(screen.getByTestId("comparator-open-file-btn")).toBeInTheDocument();
  });

  it("appelle invoke('open_file') au clic", async () => {
    const user = userEvent.setup();
    mockInvoke.mockReset();
    renderBlock();
    await user.click(screen.getByTestId("comparator-open-file-btn"));
    expect(mockInvoke).toHaveBeenCalledWith("open_file", { path: "/a/b/c.mp4" });
  });
});
