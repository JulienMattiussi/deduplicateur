import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { AdvancedPanelWrapper } from "./AdvancedPanelWrapper";

function renderWrapper(props: { disabled?: boolean; onReset?: () => void } = {}) {
  const onReset = props.onReset ?? vi.fn();
  render(
    <AdvancedPanelWrapper onReset={onReset} disabled={props.disabled ?? false}>
      <span data-testid="child">contenu</span>
    </AdvancedPanelWrapper>
  );
  return { onReset };
}

describe("AdvancedPanelWrapper", () => {
  it("est fermé par défaut : le contenu enfant n'est pas visible", () => {
    renderWrapper();
    expect(screen.queryByTestId("child")).not.toBeInTheDocument();
  });

  it("s'ouvre au clic sur le toggle", () => {
    renderWrapper();
    fireEvent.click(screen.getByText(/Param/));
    expect(screen.getByTestId("child")).toBeInTheDocument();
  });

  it("se referme au deuxième clic sur le toggle", () => {
    renderWrapper();
    fireEvent.click(screen.getByText(/Param/));
    fireEvent.click(screen.getByText(/Param/));
    expect(screen.queryByTestId("child")).not.toBeInTheDocument();
  });

  it("le bouton reset n'est visible que quand le panneau est ouvert", () => {
    renderWrapper();
    expect(screen.queryByText("Réinitialiser")).not.toBeInTheDocument();
    fireEvent.click(screen.getByText(/Param/));
    expect(screen.getByText("Réinitialiser")).toBeInTheDocument();
  });

  it("clic sur reset appelle onReset", () => {
    const onReset = vi.fn();
    renderWrapper({ onReset });
    fireEvent.click(screen.getByText(/Param/));
    fireEvent.click(screen.getByText("Réinitialiser"));
    expect(onReset).toHaveBeenCalledOnce();
  });

  it("disabled=true : le bouton toggle est désactivé", () => {
    renderWrapper({ disabled: true });
    expect(screen.getByText(/Param/).closest("button")).toBeDisabled();
  });

  it("se referme automatiquement quand disabled passe à true (démarrage d'un scan)", async () => {
    const onReset = vi.fn();
    const { rerender } = render(
      <AdvancedPanelWrapper onReset={onReset} disabled={false}>
        <span data-testid="inner">contenu</span>
      </AdvancedPanelWrapper>
    );
    fireEvent.click(screen.getByText(/Param/));
    expect(screen.getByTestId("inner")).toBeInTheDocument();
    rerender(
      <AdvancedPanelWrapper onReset={onReset} disabled={true}>
        <span data-testid="inner">contenu</span>
      </AdvancedPanelWrapper>
    );
    await waitFor(() => {
      expect(screen.queryByTestId("inner")).not.toBeInTheDocument();
    });
  });

  it("reste ferme quand disabled repasse à false apres un scan", async () => {
    const onReset = vi.fn();
    const { rerender } = render(
      <AdvancedPanelWrapper onReset={onReset} disabled={false}>
        <span data-testid="inner">contenu</span>
      </AdvancedPanelWrapper>
    );
    fireEvent.click(screen.getByText(/Param/));
    rerender(<AdvancedPanelWrapper onReset={onReset} disabled={true}><span data-testid="inner">contenu</span></AdvancedPanelWrapper>);
    rerender(<AdvancedPanelWrapper onReset={onReset} disabled={false}><span data-testid="inner">contenu</span></AdvancedPanelWrapper>);
    await waitFor(() => {
      expect(screen.queryByTestId("inner")).not.toBeInTheDocument();
    });
  });
});
