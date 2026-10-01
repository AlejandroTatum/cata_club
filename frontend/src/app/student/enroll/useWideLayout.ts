/**
 * True from `lg` up — the width at which the enrollment frame becomes a
 * full-height split (brand panel on the left, form on the right).
 *
 * It is a hook and not a CSS toggle because the two layouts carry DIFFERENT
 * step navigation: a vertical list inside the panel when wide, the compact
 * `Stepper` above the form when not. Rendering both and hiding one with CSS
 * would expose two lists named "Pasos de la inscripción" to any test or tool
 * that does not apply the stylesheet. The wizard only renders on the client
 * (`useSearchParams` sits under a `Suspense`), so the first paint already knows
 * the width; where `matchMedia` does not exist (jsdom) it reads as narrow.
 */

import { useSyncExternalStore } from "react";

const WIDE_QUERY = "(min-width: 1024px)";

function subscribe(onChange: () => void): () => void {
  if (typeof window.matchMedia !== "function") return () => undefined;
  const query = window.matchMedia(WIDE_QUERY);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

function getSnapshot(): boolean {
  return typeof window.matchMedia === "function" && window.matchMedia(WIDE_QUERY).matches;
}

export default function useWideLayout(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, () => false);
}
