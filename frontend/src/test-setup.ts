/**
 * Vitest setup — runs before every test file.
 *
 * Registers DOM-specific jest-dom matchers (toBeInTheDocument, toHaveClass, etc.)
 * on vitest's `expect`. Harmless in node‑environment tests — the matchers are only
 * called by jsdom test files that actually query for DOM elements.
 */
import { afterEach } from "vitest";

import "@testing-library/jest-dom/vitest";

// `usePersistentPreference` (src/lib/persistent-preference.ts) stores UI
// choices — the payments status filter, for one — under `cata:pref:*` in
// `localStorage`, on purpose: re-picking a filter on every visit is a tax on
// the screen an admin uses most. Tests inherit that persistence, so without
// this reset one test's click leaks into the next one in the same file.
//
// It hid for a while because whether it bites depends on the Node version,
// not on the test. Node 20 (what CI runs) gives jsdom a working
// `localStorage`, so the leak is real there. Node 26 exposes a built-in
// `localStorage` that throws unless started with `--localstorage-file`; the
// hook swallows that in a `catch` and falls back to the default, which
// silently isolates every test. So the suite passed on a modern local Node
// and failed on CI — and the failure read as a render race, which it was not.
//
// Guarded in a `try`: under the `node` environment there is no `window`, and
// on Node 26 the getter itself throws.
afterEach(() => {
  try {
    if (typeof window !== "undefined") window.localStorage.clear();
  } catch {
    // No usable localStorage in this environment — nothing persisted, so
    // nothing to reset.
  }
});

// jsdom does not implement HTMLDialogElement.showModal()/close() (only the
// `open` attribute reflection) — polyfill the minimum needed for components
// using native <dialog> modals so their tests can open/close them. Guarded
// because some test files run under the `node` environment, where this
// global doesn't exist at all.
if (typeof HTMLDialogElement !== "undefined") {
  if (!HTMLDialogElement.prototype.showModal) {
    HTMLDialogElement.prototype.showModal = function (this: HTMLDialogElement): void {
      this.setAttribute("open", "");
    };
  }
  if (!HTMLDialogElement.prototype.close) {
    HTMLDialogElement.prototype.close = function (this: HTMLDialogElement): void {
      this.removeAttribute("open");
      this.dispatchEvent(new Event("close"));
    };
  }
}
