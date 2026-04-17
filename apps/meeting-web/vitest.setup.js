/**
 * Vitest setup for jsdom environments.
 *
 * jsdom does not implement window.matchMedia, which is required by
 * shadcn's SidebarProvider (via the useIsMobile hook). This polyfill
 * prevents "window.matchMedia is not a function" errors in tests.
 */
if (typeof window !== "undefined" && !window.matchMedia) {
  window.matchMedia = (query) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  });
}
