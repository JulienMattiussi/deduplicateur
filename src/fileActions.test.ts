import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

import { invoke } from "@tauri-apps/api/core";
import { openFile, revealInFolder } from "./fileActions";

const mockInvoke = invoke as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
});

describe("openFile", () => {
  it("invoque open_file avec le chemin", async () => {
    mockInvoke.mockResolvedValue(null);
    await openFile("/path/to/file.txt");
    expect(mockInvoke).toHaveBeenCalledWith("open_file", { path: "/path/to/file.txt" });
  });

  it("avale les erreurs silencieusement (best-effort)", async () => {
    mockInvoke.mockRejectedValue(new Error("boom"));
    await expect(openFile("/x")).resolves.toBeUndefined();
  });
});

describe("revealInFolder", () => {
  it("invoque reveal_in_folder avec le chemin", async () => {
    mockInvoke.mockResolvedValue(null);
    await revealInFolder("/path/to/file.txt");
    expect(mockInvoke).toHaveBeenCalledWith("reveal_in_folder", { path: "/path/to/file.txt" });
  });

  it("avale les erreurs silencieusement (best-effort)", async () => {
    mockInvoke.mockRejectedValue(new Error("boom"));
    await expect(revealInFolder("/x")).resolves.toBeUndefined();
  });
});
