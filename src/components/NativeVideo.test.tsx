import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, waitFor, cleanup } from "@testing-library/react";
import { createRef } from "react";
import { NativeVideo, isNativePlayerAvailable, type NativeVideoHandle } from "./NativeVideo";

// Mock du module Tauri invoke. Vitest applique le mock avant l'import du composant.
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

// Reimporter apres le mock pour acces a la fonction mockee.
import { invoke } from "@tauri-apps/api/core";

const mockInvoke = invoke as ReturnType<typeof vi.fn>;

beforeEach(() => {
  mockInvoke.mockReset();
  // Comportement par defaut : create renvoie l'id 1, les autres no-op.
  mockInvoke.mockImplementation((cmd: string, _args?: unknown) => {
    if (cmd === "native_player_create") return Promise.resolve(1);
    if (cmd === "native_player_get_state") {
      return Promise.resolve({
        current_time: 0,
        duration: 0,
        paused: true,
        eof: false,
        loaded: false,
      });
    }
    return Promise.resolve(undefined);
  });
});

afterEach(() => {
  cleanup();
});

describe("NativeVideo", () => {
  it("appelle native_player_create au mount avec la geometrie initiale", async () => {
    render(<NativeVideo audio={true} side="left" />);
    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith(
        "native_player_create",
        expect.objectContaining({
          audio: true,
          geometry: expect.objectContaining({
            width: expect.any(Number),
            height: expect.any(Number),
          }),
        })
      );
    });
  });

  it("appelle native_player_destroy au unmount", async () => {
    const { unmount } = render(<NativeVideo audio={false} side="right" />);
    // Attendre que la creation se resolve avant unmount.
    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith("native_player_create", expect.anything());
    });
    unmount();
    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith("native_player_destroy", { id: 1 });
    });
  });

  it("appelle onReady avec l'id quand la creation reussit", async () => {
    const onReady = vi.fn();
    render(<NativeVideo audio={true} side="left" onReady={onReady} />);
    await waitFor(() => {
      expect(onReady).toHaveBeenCalledWith(1);
    });
  });

  it("appelle onError quand la creation echoue (ex. wayland_unsupported)", async () => {
    mockInvoke.mockImplementationOnce(() =>
      Promise.reject(new Error("native_player: wayland_unsupported"))
    );
    const onError = vi.fn();
    render(<NativeVideo audio={true} side="left" onError={onError} />);
    await waitFor(() => {
      expect(onError).toHaveBeenCalledWith(expect.stringContaining("wayland_unsupported"));
    });
  });

  it("expose load() qui delegue a native_player_load avec le path et l'id", async () => {
    const ref = createRef<NativeVideoHandle>();
    render(<NativeVideo ref={ref} audio={true} side="left" />);
    await waitFor(() => {
      expect(ref.current?.getId()).toBe(1);
    });
    await ref.current!.load("/path/to/movie.wmv");
    expect(mockInvoke).toHaveBeenCalledWith("native_player_load", {
      id: 1,
      path: "/path/to/movie.wmv",
    });
  });

  it("getState delegue a native_player_get_state", async () => {
    const ref = createRef<NativeVideoHandle>();
    render(<NativeVideo ref={ref} audio={false} side="right" />);
    await waitFor(() => {
      expect(ref.current?.getId()).toBe(1);
    });
    const state = await ref.current!.getState();
    expect(state.paused).toBe(true);
    expect(mockInvoke).toHaveBeenCalledWith("native_player_get_state", { id: 1 });
  });

  it("getState retourne un etat par defaut si pas encore initialise", async () => {
    // Simule un create qui ne se resout jamais (pour bloquer idRef.current null).
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "native_player_create") return new Promise(() => {});
      return Promise.resolve(undefined);
    });
    const ref = createRef<NativeVideoHandle>();
    render(<NativeVideo ref={ref} audio={true} side="left" />);
    // L'id n'est pas encore set ; getState doit renvoyer l'etat par defaut.
    const state = await ref.current!.getState();
    expect(state.paused).toBe(true);
    expect(state.loaded).toBe(false);
  });
});

describe("isNativePlayerAvailable", () => {
  it("appelle native_player_available et cache le resultat", async () => {
    // Reset le cache module via un re-import direct pour ce test si necessaire.
    // Vitest reimporte le module a chaque test si on utilise resetModules, mais ici
    // c'est plus simple de faire un appel direct.
    mockInvoke.mockResolvedValueOnce(true);
    const a = await isNativePlayerAvailable();
    expect(a).toBe(true);
    // Deuxieme appel : doit utiliser le cache, pas re-invoquer.
    const callCount = mockInvoke.mock.calls.filter(
      (c) => c[0] === "native_player_available"
    ).length;
    const b = await isNativePlayerAvailable();
    expect(b).toBe(true);
    const callCount2 = mockInvoke.mock.calls.filter(
      (c) => c[0] === "native_player_available"
    ).length;
    expect(callCount2).toBe(callCount); // pas d'appel supplementaire
  });
});
