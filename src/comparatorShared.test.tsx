import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { LangProvider } from "./LangContext";
import { KeepActions, MetaBlockBase, MetaField, toMediaUrl } from "./comparatorShared";

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

describe("KeepActions", () => {
  function renderActions(kept: boolean, onKeepNext = vi.fn(), onKeepClose = vi.fn()) {
    return render(
      <LangProvider>
        <KeepActions kept={kept} onKeepNext={onKeepNext} onKeepClose={onKeepClose} />
      </LangProvider>
    );
  }

  it("affiche deux boutons : 'Garder & suivant' (principal) et 'Garder & fermer' (ghost)", () => {
    renderActions(false);
    const buttons = screen.getAllByRole("button");
    expect(buttons).toHaveLength(2);
    expect(buttons[0].textContent).toMatch(/suivant/i);
    expect(buttons[1].textContent).toMatch(/fermer/i);
    expect(buttons[1].className).toContain("comparator-keep-btn--ghost");
  });

  it("le bouton principal affiche une coche quand garde", () => {
    renderActions(true);
    const primary = screen.getAllByRole("button")[0];
    expect(primary.textContent).toContain("✓");
    expect(primary.className).toContain("comparator-keep-btn--kept");
  });

  it("le clic sur 'Garder & suivant' appelle onKeepNext seulement", async () => {
    const user = userEvent.setup();
    const onKeepNext = vi.fn();
    const onKeepClose = vi.fn();
    renderActions(false, onKeepNext, onKeepClose);
    await user.click(screen.getAllByRole("button")[0]);
    expect(onKeepNext).toHaveBeenCalledTimes(1);
    expect(onKeepClose).not.toHaveBeenCalled();
  });

  it("le clic sur 'Garder & fermer' appelle onKeepClose seulement", async () => {
    const user = userEvent.setup();
    const onKeepNext = vi.fn();
    const onKeepClose = vi.fn();
    renderActions(false, onKeepNext, onKeepClose);
    await user.click(screen.getAllByRole("button")[1]);
    expect(onKeepClose).toHaveBeenCalledTimes(1);
    expect(onKeepNext).not.toHaveBeenCalled();
  });
});

describe("MetaField", () => {
  it("rend une ligne label + valeur", () => {
    render(<MetaField label="Taille" value="1.5 Mo" />);
    expect(screen.getByText("Taille")).toBeInTheDocument();
    expect(screen.getByText("1.5 Mo")).toBeInTheDocument();
  });

  it("accepte du markup React dans label et value", () => {
    render(
      <MetaField
        label={<span data-testid="label-node">L</span>}
        value={<span data-testid="value-node">V</span>}
      />
    );
    expect(screen.getByTestId("label-node")).toBeInTheDocument();
    expect(screen.getByTestId("value-node")).toBeInTheDocument();
  });

  it("applique valueClassName a la cellule value uniquement", () => {
    const { container } = render(
      <MetaField label="L" value="V" valueClassName="audio-list" />
    );
    const value = container.querySelector(".comparator-meta-value");
    expect(value).toHaveClass("comparator-meta-value");
    expect(value).toHaveClass("audio-list");
    // Le label n'a pas la classe additionnelle
    const label = container.querySelector(".comparator-meta-label");
    expect(label).not.toHaveClass("audio-list");
  });

  it("applique valueStyle a la cellule value", () => {
    const { container } = render(
      <MetaField label="L" value="V" valueStyle={{ opacity: 0.5 }} />
    );
    const value = container.querySelector(".comparator-meta-value") as HTMLElement;
    expect(value.style.opacity).toBe("0.5");
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
