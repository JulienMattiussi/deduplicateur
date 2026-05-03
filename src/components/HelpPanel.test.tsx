import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HelpPanel } from "./HelpPanel";
import { LangProvider } from "../LangContext";
import { HELP_ARTICLES, HELP_SECTIONS } from "../help/content";

function renderPanel(onClose = vi.fn()) {
  render(
    <LangProvider>
      <HelpPanel onClose={onClose} />
    </LangProvider>
  );
  return onClose;
}

describe("HelpPanel", () => {
  it("s'affiche avec le titre et la barre de recherche", () => {
    renderPanel();
    expect(screen.getByTestId("help-panel")).toBeInTheDocument();
    expect(screen.getByTestId("help-search")).toBeInTheDocument();
  });

  it("affiche la navigation par sections sans recherche", () => {
    renderPanel();
    const firstSection = HELP_SECTIONS[0];
    expect(screen.getByText(firstSection.title.fr)).toBeInTheDocument();
  });

  it("affiche le premier article par défaut", () => {
    renderPanel();
    const first = HELP_ARTICLES[0];
    expect(screen.getByRole("heading", { name: first.title.fr })).toBeInTheDocument();
  });

  it("clique sur un article l'affiche dans le panneau droit", async () => {
    const user = userEvent.setup();
    renderPanel();
    const second = HELP_ARTICLES[1];
    const btns = screen.getAllByRole("button", { name: second.title.fr });
    await user.click(btns[0]);
    expect(screen.getByRole("heading", { name: second.title.fr })).toBeInTheDocument();
  });

  it("la recherche filtre les articles", async () => {
    const user = userEvent.setup();
    renderPanel();
    await user.type(screen.getByTestId("help-search"), "ignore");
    const results = screen.getAllByRole("button", { name: /ignor/i });
    expect(results.length).toBeGreaterThan(0);
    expect(screen.queryByText(HELP_SECTIONS[0].title.fr)).not.toBeInTheDocument();
  });

  it("affiche 'Aucun résultat' si la recherche ne correspond à rien", async () => {
    const user = userEvent.setup();
    renderPanel();
    await user.type(screen.getByTestId("help-search"), "xqzwmvpqrst");
    expect(screen.getByText("Aucun résultat")).toBeInTheDocument();
  });

  it("le bouton ✕ appelle onClose", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    renderPanel(onClose);
    await user.click(screen.getByRole("button", { name: /fermer/i }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("Escape appelle onClose", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    renderPanel(onClose);
    await user.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("cliquer l'overlay appelle onClose", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    renderPanel(onClose);
    await user.click(document.querySelector(".help-overlay")!);
    expect(onClose).toHaveBeenCalledOnce();
  });
});
