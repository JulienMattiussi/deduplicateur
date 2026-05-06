import "@testing-library/jest-dom";

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
