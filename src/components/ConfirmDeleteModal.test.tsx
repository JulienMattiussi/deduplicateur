import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ConfirmDeleteModal } from "./ConfirmDeleteModal";
import { LangProvider } from "../LangContext";

function renderModal(count: number, totalSize: number, onCancel = vi.fn(), onConfirm = vi.fn()) {
  return render(
    <LangProvider>
      <ConfirmDeleteModal count={count} totalSize={totalSize} onCancel={onCancel} onConfirm={onConfirm} />
    </LangProvider>
  );
}

describe("ConfirmDeleteModal", () => {
  it("affiche le titre de confirmation", () => {
    renderModal(2, 2048);
    expect(screen.getByText(/Confirmer la suppression/i)).toBeInTheDocument();
  });

  it("affiche le pluriel pour 2 fichiers", () => {
    renderModal(2, 2048);
    expect(screen.getByText(/2 fichiers/)).toBeInTheDocument();
  });

  it("affiche le singulier pour 1 fichier", () => {
    renderModal(1, 1024);
    expect(screen.getByText(/1 fichier \(/)).toBeInTheDocument();
  });

  it("affiche la taille formatee", () => {
    renderModal(3, 1048576);
    expect(screen.getByText(/1.0 Mo/)).toBeInTheDocument();
  });

  it("appelle onCancel au clic sur Annuler", async () => {
    const user = userEvent.setup();
    const onCancel = vi.fn();
    renderModal(1, 100, onCancel);
    await user.click(screen.getByText(/Annuler/));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("appelle onConfirm au clic sur Supprimer", async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    renderModal(1, 100, vi.fn(), onConfirm);
    const supprimerBtn = screen.getAllByText("Supprimer").find((el) => el.tagName === "BUTTON")!;
    await user.click(supprimerBtn);
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("appelle onCancel au clic sur l'overlay (pas le contenu)", async () => {
    const user = userEvent.setup();
    const onCancel = vi.fn();
    const { container } = renderModal(1, 100, onCancel);
    const overlay = container.querySelector(".modal-overlay")!;
    await user.click(overlay);
    expect(onCancel).toHaveBeenCalled();
  });
});
