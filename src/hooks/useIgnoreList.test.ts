import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { invoke } from "@tauri-apps/api/core";
import { useIgnoreList } from "./useIgnoreList";

const mockInvoke = invoke as ReturnType<typeof vi.fn>;

describe("useIgnoreList", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("charge la liste au mount via get_ignore_list", async () => {
    const entries = [
      { key: "a", display_names: ["a.txt"], ignored_at: 123 },
      { key: "b", display_names: ["b.txt"], ignored_at: 124 },
    ];
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "get_ignore_list") return Promise.resolve(entries);
      return Promise.resolve();
    });

    const { result } = renderHook(() => useIgnoreList());

    await waitFor(() => {
      expect(result.current.ignoredEntries).toHaveLength(2);
    });
    expect(mockInvoke).toHaveBeenCalledWith("get_ignore_list");
  });

  it("retourne une liste vide quand le backend rejette", async () => {
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "get_ignore_list") return Promise.reject(new Error("fail"));
      return Promise.resolve();
    });

    const { result } = renderHook(() => useIgnoreList());

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith("get_ignore_list");
    });
    expect(result.current.ignoredEntries).toEqual([]);
  });

  it("reload() refetch et met a jour la liste", async () => {
    let call = 0;
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd !== "get_ignore_list") return Promise.resolve();
      call++;
      return Promise.resolve(call === 1
        ? [{ key: "a", display_names: ["a.txt"], ignored_at: 1 }]
        : [
            { key: "a", display_names: ["a.txt"], ignored_at: 1 },
            { key: "b", display_names: ["b.txt"], ignored_at: 2 },
          ]);
    });

    const { result } = renderHook(() => useIgnoreList());
    await waitFor(() => expect(result.current.ignoredEntries).toHaveLength(1));

    await act(async () => { await result.current.reload(); });
    expect(result.current.ignoredEntries).toHaveLength(2);
  });
});
