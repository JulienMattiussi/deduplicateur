import "@testing-library/jest-dom";
import { vi } from "vitest";

// Mock global du module Tauri core : tous les tests qui font `invoke(...)` doivent
// passer par un vi.fn() configurable. Centraliser ici evite la duplication du
// `vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }))` au debut de
// chaque fichier de test (~18 fichiers concernes). Chaque test conserve la main :
// `import { invoke } from "@tauri-apps/api/core"; const mockInvoke = invoke as
// ReturnType<typeof vi.fn>; mockInvoke.mockImplementation(...)`.
vi.mock("@tauri-apps/api/core", () => ({
  // Implementation par defaut : Promise.resolve() pour que les composants qui
  // enchainent `.then(...)` sans configurer le mock dans leur fichier de test
  // ne crashent pas. Les tests qui ont besoin d'une valeur specifique font
  // `mockInvoke.mockImplementation(...)` ou `mockInvoke.mockResolvedValue(...)`.
  invoke: vi.fn(() => Promise.resolve()),
}));

// Mock global du module Tauri window : les tests jsdom n'ont pas d'environnement
// Tauri runtime, donc `getCurrentWindow().setTitle(...)` planterait. On expose
// un objet stub avec un `setTitle` mock que les tests peuvent inspecter en
// re-important `getCurrentWindow` depuis `@tauri-apps/api/window`. Ainsi toute
// future feature qui utilise une API de la fenetre (setTitle, setMinimumSize...)
// est testable sans repeter le vi.mock dans chaque fichier.
vi.mock("@tauri-apps/api/window", () => {
  const setTitle = vi.fn(() => Promise.resolve());
  return {
    getCurrentWindow: () => ({ setTitle }),
    __mockSetTitle: setTitle,
  };
});

// IntersectionObserver n'existe pas dans jsdom.
// Ce mock declenche immediatement isIntersecting=true pour que les tests
// voient les thumbnails se charger comme avant.
(globalThis as unknown as Record<string, unknown>).IntersectionObserver = class {
  private cb: IntersectionObserverCallback;
  constructor(cb: IntersectionObserverCallback) { this.cb = cb; }
  observe(el: Element) {
    this.cb([{ isIntersecting: true, target: el } as IntersectionObserverEntry], this as unknown as IntersectionObserver);
  }
  unobserve() {}
  disconnect() {}
};

// ResizeObserver non plus n'existe pas dans jsdom (utilise par NativeVideo, etc.).
// Mock minimal qui ne fire pas de callback - les tests qui ont besoin d'observer
// un resize peuvent appeler manuellement update() via le code testable.
(globalThis as unknown as Record<string, unknown>).ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
};
