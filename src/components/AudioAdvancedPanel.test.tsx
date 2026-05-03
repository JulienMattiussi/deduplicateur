import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { AudioAdvancedPanel } from "./AudioAdvancedPanel";
import { LangProvider } from "../LangContext";
import type { AudioConfig } from "../types";
import { DEFAULT_AUDIO_CONFIG } from "../hooks/useScanConfig";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

function renderPanel(props: {
  config?: AudioConfig;
  onChange?: (cfg: AudioConfig) => void;
  disabled?: boolean;
}) {
  const config = props.config ?? { ...DEFAULT_AUDIO_CONFIG };
  const onChange = props.onChange ?? vi.fn();
  const disabled = props.disabled ?? false;
  render(
    <LangProvider>
      <AudioAdvancedPanel config={config} onChange={onChange} disabled={disabled} />
    </LangProvider>
  );
  return { config, onChange };
}

describe("AudioAdvancedPanel", () => {
  it("est ferme par defaut : le contenu n'est pas visible", () => {
    renderPanel({});
    expect(screen.queryByText("Filtre de durée")).not.toBeInTheDocument();
  });

  it("s'ouvre au clic sur le toggle", () => {
    renderPanel({});
    fireEvent.click(screen.getByText(/Param/));
    expect(screen.getByText("Filtre de durée")).toBeInTheDocument();
  });

  it("se referme au deuxieme clic", () => {
    renderPanel({});
    fireEvent.click(screen.getByText(/Param/));
    fireEvent.click(screen.getByText(/Param/));
    expect(screen.queryByText("Filtre de durée")).not.toBeInTheDocument();
  });

  it("input tolerance duree : onBlur appelle onChange avec valeur / 100", () => {
    const onChange = vi.fn();
    renderPanel({ onChange });
    fireEvent.click(screen.getByText(/Param/));
    const input = screen.getByRole("spinbutton");
    fireEvent.blur(input, { target: { value: "30" } });
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ duration_tolerance: 0.3 })
    );
  });

  it("checkbox cache : onChange appelle onChange avec la nouvelle valeur", () => {
    const onChange = vi.fn();
    const config = { ...DEFAULT_AUDIO_CONFIG, cache_enabled: false };
    renderPanel({ config, onChange });
    fireEvent.click(screen.getByText(/Param/));
    const checkbox = screen.getByRole("checkbox");
    fireEvent.click(checkbox);
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ cache_enabled: true })
    );
  });

  it("bouton Reset appelle onChange avec DEFAULT_AUDIO_CONFIG", () => {
    const onChange = vi.fn();
    const config = { duration_tolerance: 0.5, cache_enabled: false };
    renderPanel({ config, onChange });
    fireEvent.click(screen.getByText(/Param/));
    fireEvent.click(screen.getByText("Réinitialiser"));
    expect(onChange).toHaveBeenCalledWith(DEFAULT_AUDIO_CONFIG);
  });

  it("disabled=true : le toggle est desactive", () => {
    renderPanel({ disabled: true });
    expect(screen.getByText(/Param/).closest("button")).toBeDisabled();
  });
});
