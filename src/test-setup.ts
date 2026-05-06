import "@testing-library/jest-dom";

// IntersectionObserver n'existe pas dans jsdom.
// Ce mock declenche immediatement isIntersecting=true pour que les tests
// voient les thumbnails se charger comme avant.
global.IntersectionObserver = class {
  private cb: IntersectionObserverCallback;
  constructor(cb: IntersectionObserverCallback) { this.cb = cb; }
  observe(el: Element) {
    this.cb([{ isIntersecting: true, target: el } as IntersectionObserverEntry], this);
  }
  unobserve() {}
  disconnect() {}
} as unknown as typeof IntersectionObserver;
