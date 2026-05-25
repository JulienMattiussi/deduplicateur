import { describe, it, expect, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useTheme } from "./useTheme";

describe("useTheme", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("retourne 'dark' par defaut quand le storage est vide", () => {
    const { result } = renderHook(() => useTheme());
    expect(result.current.theme).toBe("dark");
  });

  it("lit la preference 'light' depuis le storage", () => {
    localStorage.setItem("theme", "light");
    const { result } = renderHook(() => useTheme());
    expect(result.current.theme).toBe("light");
  });

  it("toggle alterne dark <-> light", () => {
    const { result } = renderHook(() => useTheme());
    expect(result.current.theme).toBe("dark");
    act(() => { result.current.toggleTheme(); });
    expect(result.current.theme).toBe("light");
    act(() => { result.current.toggleTheme(); });
    expect(result.current.theme).toBe("dark");
  });

  it("persiste le nouveau theme dans le storage apres toggle", () => {
    const { result } = renderHook(() => useTheme());
    act(() => { result.current.toggleTheme(); });
    expect(localStorage.getItem("theme")).toBe("light");
    act(() => { result.current.toggleTheme(); });
    expect(localStorage.getItem("theme")).toBe("dark");
  });
});
