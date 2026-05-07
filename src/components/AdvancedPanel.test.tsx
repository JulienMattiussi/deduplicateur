import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { AdvancedPanel } from "./AdvancedPanel";
import { LangProvider } from "../LangContext";
import type { PHashConfig } from "../types";
import { DEFAULT_PHASH_CONFIG } from "../hooks/useScanConfig";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

function renderPanel(props: {
  config?: PHashConfig;
  onChange?: (cfg: PHashConfig) => void;
  disabled?: boolean;
}) {
  const config = props.config ?? { ...DEFAULT_PHASH_CONFIG };
  const onChange = props.onChange ?? vi.fn();
  const disabled = props.disabled ?? false;
  render(
    <LangProvider>
      <AdvancedPanel config={config} onChange={onChange} disabled={disabled} />
    </LangProvider>
  );
  return { config, onChange };
}

describe("AdvancedPanel", () => {
  it("est ferme par defaut : le contenu n'est pas visible", () => {
    renderPanel({});
    expect(screen.queryByText("Filtre de taille")).not.toBeInTheDocument();
  });

  it("s'ouvre au clic sur le toggle", () => {
    renderPanel({});
    fireEvent.click(screen.getByText(/Param/));
    expect(screen.getByText("Filtre de taille")).toBeInTheDocument();
  });

  it("se referme au deuxieme clic", () => {
    renderPanel({});
    fireEvent.click(screen.getByText(/Param/));
    fireEvent.click(screen.getByText(/Param/));
    expect(screen.queryByText("Filtre de taille")).not.toBeInTheDocument();
  });

  it("input taille minimale (Ko) : onBlur appelle onChange avec min_file_size_bytes * 1024", () => {
    const onChange = vi.fn();
    renderPanel({ onChange });
    fireEvent.click(screen.getByText(/Param/));
    const inputs = screen.getAllByRole("spinbutton");
    // premier input numerique : taille min en Ko
    fireEvent.blur(inputs[0], { target: { value: "20" } });
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ min_file_size_bytes: 20 * 1024 })
    );
  });

  it("input min_images_size_filter : onBlur appelle onChange avec la valeur numerique", () => {
    const onChange = vi.fn();
    renderPanel({ onChange });
    fireEvent.click(screen.getByText(/Param/));
    const inputs = screen.getAllByRole("spinbutton");
    fireEvent.blur(inputs[1], { target: { value: "100" } });
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ min_images_size_filter: 100 })
    );
  });

  it("input tolerance aspect ratio : onBlur appelle onChange avec valeur / 100", () => {
    const onChange = vi.fn();
    renderPanel({ onChange });
    fireEvent.click(screen.getByText(/Param/));
    const inputs = screen.getAllByRole("spinbutton");
    fireEvent.blur(inputs[2], { target: { value: "30" } });
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ aspect_ratio_tolerance: 0.3 })
    );
  });

  it("checkbox two_pass_enabled : onChange appelle onChange avec la nouvelle valeur", () => {
    const onChange = vi.fn();
    const config = { ...DEFAULT_PHASH_CONFIG, two_pass_enabled: false };
    renderPanel({ config, onChange });
    fireEvent.click(screen.getByText(/Param/));
    const checkboxes = screen.getAllByRole("checkbox");
    // premier checkbox : two_pass_enabled
    fireEvent.click(checkboxes[0]);
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ two_pass_enabled: true })
    );
  });

  it("checkbox cache_enabled : onChange appelle onChange avec la nouvelle valeur", () => {
    const onChange = vi.fn();
    const config = { ...DEFAULT_PHASH_CONFIG, cache_enabled: false };
    renderPanel({ config, onChange });
    fireEvent.click(screen.getByText(/Param/));
    const checkboxes = screen.getAllByRole("checkbox");
    // deuxieme checkbox : cache_enabled
    fireEvent.click(checkboxes[1]);
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ cache_enabled: true })
    );
  });

  it("checkbox parallel_compare_enabled : onChange appelle onChange avec la nouvelle valeur", () => {
    const onChange = vi.fn();
    const config = { ...DEFAULT_PHASH_CONFIG, parallel_compare_enabled: false };
    renderPanel({ config, onChange });
    fireEvent.click(screen.getByText(/Param/));
    const checkboxes = screen.getAllByRole("checkbox");
    // troisieme checkbox : parallel_compare_enabled
    fireEvent.click(checkboxes[2]);
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ parallel_compare_enabled: true })
    );
  });

  it("checkbox use_exif_thumbnail : onChange appelle onChange avec la nouvelle valeur", () => {
    const onChange = vi.fn();
    const config = { ...DEFAULT_PHASH_CONFIG, use_exif_thumbnail: false };
    renderPanel({ config, onChange });
    fireEvent.click(screen.getByText(/Param/));
    const checkboxes = screen.getAllByRole("checkbox");
    // quatrieme checkbox : use_exif_thumbnail
    fireEvent.click(checkboxes[3]);
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ use_exif_thumbnail: true })
    );
  });

  it("checkbox use_bucket_index : onChange appelle onChange avec la nouvelle valeur", () => {
    const onChange = vi.fn();
    const config = { ...DEFAULT_PHASH_CONFIG, use_bucket_index: false };
    renderPanel({ config, onChange });
    fireEvent.click(screen.getByText(/Param/));
    const checkboxes = screen.getAllByRole("checkbox");
    // cinquieme checkbox : use_bucket_index
    fireEvent.click(checkboxes[4]);
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ use_bucket_index: true })
    );
  });

  it("checkbox use_sorted_aspect : onChange appelle onChange avec la nouvelle valeur", () => {
    const onChange = vi.fn();
    const config = { ...DEFAULT_PHASH_CONFIG, use_sorted_aspect: false };
    renderPanel({ config, onChange });
    fireEvent.click(screen.getByText(/Param/));
    const checkboxes = screen.getAllByRole("checkbox");
    // sixieme checkbox : use_sorted_aspect
    fireEvent.click(checkboxes[5]);
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ use_sorted_aspect: true })
    );
  });

  it("bouton Reset appelle onChange avec DEFAULT_PHASH_CONFIG", () => {
    const onChange = vi.fn();
    const config = { ...DEFAULT_PHASH_CONFIG, min_file_size_bytes: 999999 };
    renderPanel({ config, onChange });
    fireEvent.click(screen.getByText(/Param/));
    fireEvent.click(screen.getByText("Réinitialiser"));
    expect(onChange).toHaveBeenCalledWith(DEFAULT_PHASH_CONFIG);
  });

  it("disabled=true : le toggle est desactive", () => {
    renderPanel({ disabled: true });
    expect(screen.getByText(/Param/).closest("button")).toBeDisabled();
  });

  it("se referme automatiquement quand disabled passe a true (demarrage d'un scan)", () => {
    const { rerender } = render(
      <LangProvider>
        <AdvancedPanel config={DEFAULT_PHASH_CONFIG} onChange={vi.fn()} disabled={false} />
      </LangProvider>
    );
    fireEvent.click(screen.getByText(/Param/));
    expect(screen.getAllByRole("spinbutton").length).toBeGreaterThan(0);
    rerender(
      <LangProvider>
        <AdvancedPanel config={DEFAULT_PHASH_CONFIG} onChange={vi.fn()} disabled={true} />
      </LangProvider>
    );
    expect(screen.queryAllByRole("spinbutton")).toHaveLength(0);
  });
});
