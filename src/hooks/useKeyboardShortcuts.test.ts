import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { useKeyboardShortcuts } from "./useKeyboardShortcuts";

interface Hooks {
  onToggleHelp: () => void;
  onEscapeArchive: () => boolean;
  onEscapeConfirm: () => boolean;
  onDelete: () => void;
  onSelectAll: () => void;
  anyComparatorOpen: boolean;
  showResults: boolean;
  selecting: boolean;
  deleting: boolean;
  scanning: boolean;
  selectedCount: number;
}

function makeShortcuts(over: Partial<Hooks> = {}): Hooks {
  return {
    onToggleHelp: vi.fn(),
    onEscapeArchive: vi.fn(() => false),
    onEscapeConfirm: vi.fn(() => false),
    onDelete: vi.fn(),
    onSelectAll: vi.fn(),
    anyComparatorOpen: false,
    showResults: true,
    selecting: false,
    deleting: false,
    scanning: false,
    selectedCount: 1,
    ...over,
  };
}

function fireKey(key: string, opts: KeyboardEventInit = {}) {
  window.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, ...opts }));
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("useKeyboardShortcuts - F1", () => {
  it("F1 appelle onToggleHelp", () => {
    const s = makeShortcuts();
    renderHook(() => useKeyboardShortcuts(s));
    fireKey("F1");
    expect(s.onToggleHelp).toHaveBeenCalledTimes(1);
  });

  it("F1 fonctionne meme si un comparateur est ouvert", () => {
    const s = makeShortcuts({ anyComparatorOpen: true });
    renderHook(() => useKeyboardShortcuts(s));
    fireKey("F1");
    expect(s.onToggleHelp).toHaveBeenCalled();
  });
});

describe("useKeyboardShortcuts - Escape", () => {
  it("Escape ferme l'archive comparator en priorite", () => {
    const onEscapeArchive = vi.fn(() => true);
    const onEscapeConfirm = vi.fn(() => true);
    const s = makeShortcuts({ onEscapeArchive, onEscapeConfirm });
    renderHook(() => useKeyboardShortcuts(s));
    fireKey("Escape");
    expect(onEscapeArchive).toHaveBeenCalled();
    expect(onEscapeConfirm).not.toHaveBeenCalled();
  });

  it("Escape ferme la confirmation si l'archive comparator n'est pas ouvert", () => {
    const onEscapeArchive = vi.fn(() => false);
    const onEscapeConfirm = vi.fn(() => true);
    const s = makeShortcuts({ onEscapeArchive, onEscapeConfirm });
    renderHook(() => useKeyboardShortcuts(s));
    fireKey("Escape");
    expect(onEscapeArchive).toHaveBeenCalled();
    expect(onEscapeConfirm).toHaveBeenCalled();
  });
});

describe("useKeyboardShortcuts - Delete", () => {
  it("Delete declenche onDelete si conditions OK", () => {
    const s = makeShortcuts({ selectedCount: 2 });
    renderHook(() => useKeyboardShortcuts(s));
    fireKey("Delete");
    expect(s.onDelete).toHaveBeenCalledTimes(1);
  });

  it("Delete inactif si selectedCount=0", () => {
    const s = makeShortcuts({ selectedCount: 0 });
    renderHook(() => useKeyboardShortcuts(s));
    fireKey("Delete");
    expect(s.onDelete).not.toHaveBeenCalled();
  });

  it("Delete inactif si pas de resultats", () => {
    const s = makeShortcuts({ showResults: false });
    renderHook(() => useKeyboardShortcuts(s));
    fireKey("Delete");
    expect(s.onDelete).not.toHaveBeenCalled();
  });

  it("Delete inactif pendant suppression en cours", () => {
    const s = makeShortcuts({ deleting: true });
    renderHook(() => useKeyboardShortcuts(s));
    fireKey("Delete");
    expect(s.onDelete).not.toHaveBeenCalled();
  });
});

describe("useKeyboardShortcuts - Ctrl+A", () => {
  it("Ctrl+A declenche onSelectAll", () => {
    const s = makeShortcuts();
    renderHook(() => useKeyboardShortcuts(s));
    fireKey("a", { ctrlKey: true });
    expect(s.onSelectAll).toHaveBeenCalled();
  });

  it("Cmd+A (metaKey) declenche onSelectAll", () => {
    const s = makeShortcuts();
    renderHook(() => useKeyboardShortcuts(s));
    fireKey("A", { metaKey: true });
    expect(s.onSelectAll).toHaveBeenCalled();
  });

  it("'a' seul (sans modificateur) ne declenche pas onSelectAll", () => {
    const s = makeShortcuts();
    renderHook(() => useKeyboardShortcuts(s));
    fireKey("a");
    expect(s.onSelectAll).not.toHaveBeenCalled();
  });

  it("Ctrl+A inactif pendant un scan", () => {
    const s = makeShortcuts({ scanning: true });
    renderHook(() => useKeyboardShortcuts(s));
    fireKey("a", { ctrlKey: true });
    expect(s.onSelectAll).not.toHaveBeenCalled();
  });
});

describe("useKeyboardShortcuts - court-circuit comparator", () => {
  it("Delete ignore si un comparateur est ouvert", () => {
    const s = makeShortcuts({ anyComparatorOpen: true });
    renderHook(() => useKeyboardShortcuts(s));
    fireKey("Delete");
    expect(s.onDelete).not.toHaveBeenCalled();
  });
});
