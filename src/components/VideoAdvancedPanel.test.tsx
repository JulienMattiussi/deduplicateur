import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { VideoAdvancedPanel } from "./VideoAdvancedPanel";
import { LangProvider } from "../LangContext";
import type { VideoConfig } from "../types";
import { DEFAULT_VIDEO_CONFIG } from "../hooks/useScanConfig";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

function renderPanel(props: {
  config?: VideoConfig;
  onChange?: (cfg: VideoConfig) => void;
  disabled?: boolean;
}) {
  const config = props.config ?? { ...DEFAULT_VIDEO_CONFIG };
  const onChange = props.onChange ?? vi.fn();
  const disabled = props.disabled ?? false;
  render(
    <LangProvider>
      <VideoAdvancedPanel config={config} onChange={onChange} disabled={disabled} />
    </LangProvider>
  );
  return { config, onChange };
}

describe("VideoAdvancedPanel", () => {
  it("est ferme par defaut : le contenu n'est pas visible", () => {
    renderPanel({});
    expect(screen.queryByText("Extraction")).not.toBeInTheDocument();
  });

  it("s'ouvre au clic sur le toggle", () => {
    renderPanel({});
    fireEvent.click(screen.getByText(/Param/));
    expect(screen.getByText("Extraction")).toBeInTheDocument();
  });

  it("se referme au deuxieme clic", () => {
    renderPanel({});
    fireEvent.click(screen.getByText(/Param/));
    fireEvent.click(screen.getByText(/Param/));
    expect(screen.queryByText("Extraction")).not.toBeInTheDocument();
  });

  it("input n_frames : onBlur appelle onChange avec la valeur clampee", () => {
    const onChange = vi.fn();
    renderPanel({ onChange });
    fireEvent.click(screen.getByText(/Param/));
    const inputs = screen.getAllByRole("spinbutton");
    // premier input : n_frames
    fireEvent.blur(inputs[0], { target: { value: "10" } });
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ n_frames: 10 })
    );
  });

  it("input n_frames : valeur clampee a 30 si superieure", () => {
    const onChange = vi.fn();
    renderPanel({ onChange });
    fireEvent.click(screen.getByText(/Param/));
    const inputs = screen.getAllByRole("spinbutton");
    fireEvent.blur(inputs[0], { target: { value: "50" } });
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ n_frames: 30 })
    );
  });

  it("input n_frames : valeur clampee a 2 si inferieure", () => {
    const onChange = vi.fn();
    renderPanel({ onChange });
    fireEvent.click(screen.getByText(/Param/));
    const inputs = screen.getAllByRole("spinbutton");
    fireEvent.blur(inputs[0], { target: { value: "1" } });
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ n_frames: 2 })
    );
  });

  it("input tolerance duree : onBlur appelle onChange avec valeur / 100", () => {
    const onChange = vi.fn();
    renderPanel({ onChange });
    fireEvent.click(screen.getByText(/Param/));
    const inputs = screen.getAllByRole("spinbutton");
    // deuxieme input : duration_tolerance
    fireEvent.blur(inputs[1], { target: { value: "30" } });
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ duration_tolerance: 0.3 })
    );
  });

  it("checkbox cache : onChange appelle onChange avec la nouvelle valeur", () => {
    const onChange = vi.fn();
    const config = { ...DEFAULT_VIDEO_CONFIG, cache_enabled: false };
    renderPanel({ config, onChange });
    fireEvent.click(screen.getByText(/Param/));
    const checkboxes = screen.getAllByRole("checkbox");
    // premier checkbox : cache_enabled
    fireEvent.click(checkboxes[0]);
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ cache_enabled: true })
    );
  });

  it("checkbox DTW : onChange appelle onChange avec la nouvelle valeur", () => {
    const onChange = vi.fn();
    const config = { ...DEFAULT_VIDEO_CONFIG, use_dtw: false };
    renderPanel({ config, onChange });
    fireEvent.click(screen.getByText(/Param/));
    const checkboxes = screen.getAllByRole("checkbox");
    // deuxieme checkbox : use_dtw
    fireEvent.click(checkboxes[1]);
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ use_dtw: true })
    );
  });

  it("bouton Reset appelle onChange avec DEFAULT_VIDEO_CONFIG", () => {
    const onChange = vi.fn();
    const config = { ...DEFAULT_VIDEO_CONFIG, n_frames: 20, cache_enabled: false };
    renderPanel({ config, onChange });
    fireEvent.click(screen.getByText(/Param/));
    fireEvent.click(screen.getByText("Réinitialiser"));
    expect(onChange).toHaveBeenCalledWith(DEFAULT_VIDEO_CONFIG);
  });

  it("disabled=true : le toggle est desactive", () => {
    renderPanel({ disabled: true });
    expect(screen.getByText(/Param/).closest("button")).toBeDisabled();
  });

  it("disabled=true : les inputs sont desactives quand le panneau est ouvert", () => {
    const { rerender } = render(
      <LangProvider>
        <VideoAdvancedPanel config={DEFAULT_VIDEO_CONFIG} onChange={vi.fn()} disabled={false} />
      </LangProvider>
    );
    fireEvent.click(screen.getByText(/Param/));
    rerender(
      <LangProvider>
        <VideoAdvancedPanel config={DEFAULT_VIDEO_CONFIG} onChange={vi.fn()} disabled={true} />
      </LangProvider>
    );
    const inputs = screen.getAllByRole("spinbutton");
    expect(inputs[0]).toBeDisabled();
  });
});
