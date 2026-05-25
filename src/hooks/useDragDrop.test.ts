import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";


// Mock @tauri-apps/api/webview avec un emetteur simulé
type DragDropEvent =
  | { payload: { type: "enter" | "leave" } }
  | { payload: { type: "over" } }
  | { payload: { type: "drop"; paths: string[] } };

let registeredHandler: ((e: DragDropEvent) => void) | null = null;
const mockUnlisten = vi.fn();

vi.mock("@tauri-apps/api/webview", () => ({
  getCurrentWebview: () => ({
    onDragDropEvent: (handler: (e: DragDropEvent) => void) => {
      registeredHandler = handler;
      return Promise.resolve(mockUnlisten);
    },
  }),
}));

import { invoke } from "@tauri-apps/api/core";
import { useDragDrop } from "./useDragDrop";

const mockInvoke = invoke as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  registeredHandler = null;
  mockUnlisten.mockClear();
});

describe("useDragDrop", () => {
  it("dragOver passe a true sur 'over' quand scan inactif", async () => {
    const { result } = renderHook(() => useDragDrop(false, vi.fn()));
    await waitFor(() => expect(registeredHandler).not.toBeNull());
    await act(async () => { registeredHandler!({ payload: { type: "over" } }); });
    expect(result.current).toBe(true);
  });

  it("dragOver reste a false sur 'over' pendant un scan", async () => {
    const { result } = renderHook(() => useDragDrop(true, vi.fn()));
    await waitFor(() => expect(registeredHandler).not.toBeNull());
    await act(async () => { registeredHandler!({ payload: { type: "over" } }); });
    expect(result.current).toBe(false);
  });

  it("appelle onFolder avec le path si le drop est un dossier", async () => {
    const onFolder = vi.fn();
    mockInvoke.mockResolvedValue(true); // check_path_is_dir => true
    renderHook(() => useDragDrop(false, onFolder));
    await waitFor(() => expect(registeredHandler).not.toBeNull());
    await act(async () => {
      await registeredHandler!({ payload: { type: "drop", paths: ["/data/photos"] } });
    });
    await waitFor(() => expect(onFolder).toHaveBeenCalledWith("/data/photos"));
  });

  it("n'appelle pas onFolder si le drop est un fichier (pas un dossier)", async () => {
    const onFolder = vi.fn();
    mockInvoke.mockResolvedValue(false); // check_path_is_dir => false
    renderHook(() => useDragDrop(false, onFolder));
    await waitFor(() => expect(registeredHandler).not.toBeNull());
    await act(async () => {
      await registeredHandler!({ payload: { type: "drop", paths: ["/data/file.txt"] } });
    });
    expect(onFolder).not.toHaveBeenCalled();
  });

  it("n'appelle pas onFolder pendant un scan", async () => {
    const onFolder = vi.fn();
    renderHook(() => useDragDrop(true, onFolder));
    await waitFor(() => expect(registeredHandler).not.toBeNull());
    await act(async () => {
      await registeredHandler!({ payload: { type: "drop", paths: ["/data/photos"] } });
    });
    expect(onFolder).not.toHaveBeenCalled();
    expect(mockInvoke).not.toHaveBeenCalled();
  });

  it("dragOver revient a false sur 'leave'", async () => {
    const { result } = renderHook(() => useDragDrop(false, vi.fn()));
    await waitFor(() => expect(registeredHandler).not.toBeNull());
    await act(async () => { registeredHandler!({ payload: { type: "over" } }); });
    expect(result.current).toBe(true);
    await act(async () => { registeredHandler!({ payload: { type: "leave" } }); });
    expect(result.current).toBe(false);
  });
});
