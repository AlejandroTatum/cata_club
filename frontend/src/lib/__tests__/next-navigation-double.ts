/**
 * A `useSearchParams` that is backed by jsdom's REAL history, not a fixture.
 *
 * The wizards now keep their step in the URL and move between steps with the
 * native History API, so a test double that returns a frozen `URLSearchParams`
 * would assert nothing about the one thing that matters: that pressing Back
 * actually walks the entries the wizard pushed. jsdom implements
 * `pushState` / `replaceState` / `back()` and fires `popstate` for real, so
 * this double simply reads `window.location.search` and re-renders whenever
 * the URL could have changed.
 *
 * `pushState` and `replaceState` do not fire any event, so they are wrapped
 * here to notify subscribers — which is exactly what the Next.js App Router
 * does in the browser for the same reason.
 */

import { useSyncExternalStore } from "react";

const listeners = new Set<() => void>();
let installed = false;
let cachedSearch: string | null = null;
let cachedParams = new URLSearchParams();

function notify(): void {
  for (const listener of listeners) listener();
}

function install(): void {
  if (installed) return;
  installed = true;
  for (const method of ["pushState", "replaceState"] as const) {
    const original = window.history[method].bind(window.history);
    window.history[method] = (...args: Parameters<History["pushState"]>): void => {
      original(...args);
      notify();
    };
  }
}

function subscribe(listener: () => void): () => void {
  install();
  if (listeners.size === 0) window.addEventListener("popstate", notify);
  listeners.add(listener);
  return (): void => {
    listeners.delete(listener);
    if (listeners.size === 0) window.removeEventListener("popstate", notify);
  };
}

/**
 * Cached by search string: `useSyncExternalStore` compares snapshots by
 * identity, so building a fresh `URLSearchParams` on every read would loop
 * forever.
 */
function getSnapshot(): URLSearchParams {
  const search = window.location.search;
  if (search !== cachedSearch) {
    cachedSearch = search;
    cachedParams = new URLSearchParams(search);
  }
  return cachedParams;
}

/** Stand-in for `next/navigation`'s `useSearchParams`. */
export function useTestSearchParams(): URLSearchParams {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

/** Put the address bar back to a clean path between cases. */
export function resetTestHistory(path = "/"): void {
  cachedSearch = null;
  cachedParams = new URLSearchParams();
  window.history.replaceState(null, "", path);
}
