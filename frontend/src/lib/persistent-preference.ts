/**
 * A choice the product remembers between visits.
 *
 * ## What this is, and what it deliberately is not
 *
 * `managed-selection-store` also persists a choice, and the two look alike
 * until you ask what the choice MEANS. Which dependent a guardian is looking
 * at is "where am I right now" — it belongs to the tab, and a browser reopened
 * tomorrow should start from the top of the list. Which filter an admin works
 * from is a PREFERENCE: the person who validates payments every morning opens
 * the queue on "Pendientes" because that is their job, and re-picking it daily
 * is a tax on the one screen they use most. So: `localStorage`, not
 * `sessionStorage`, and the difference is intentional in both directions.
 *
 * ## Why a validator is required rather than optional
 *
 * Stored values outlive the code that wrote them. A filter key renamed in a
 * later release, a half-written value, someone editing devtools — all produce
 * a string that no longer means anything, and restoring it would render a
 * screen filtered by a state that does not exist, showing nothing, with a
 * pill highlighted that is not in the list. `isValid` makes that impossible to
 * forget: an unrecognised value falls back and the user simply gets the
 * default they would have got anyway.
 */

"use client";

import { useCallback, useEffect, useState } from "react";

/** Namespaced so a key can never collide with another app on the same origin. */
export function preferenceKey(name: string): string {
  return `cata:pref:${name}`;
}

function readPreference<T extends string>(
  name: string,
  isValid: (value: string) => value is T,
): T | null {
  if (typeof window === "undefined") return null;
  try {
    const stored = window.localStorage.getItem(preferenceKey(name));
    return stored !== null && isValid(stored) ? stored : null;
  } catch {
    // Private browsing and locked-down profiles throw on access. Losing a
    // remembered filter is a smaller failure than taking the screen down.
    return null;
  }
}

/**
 * Remember one choice under `name`, falling back to `fallback` whenever there
 * is nothing stored or what is stored is no longer meaningful.
 *
 * The stored value is applied in an effect rather than as the initial state,
 * because the server cannot know it: seeding `useState` from `localStorage`
 * would make the first client render disagree with the server's HTML and
 * React would discard the hydration. One extra render on mount is the price,
 * and it is invisible next to the request the screen is making anyway.
 */
export function usePersistentPreference<T extends string>(
  name: string,
  fallback: T,
  isValid: (value: string) => value is T,
): [T, (next: T) => void] {
  const [value, setValue] = useState<T>(fallback);

  useEffect(() => {
    const stored = readPreference(name, isValid);
    if (stored !== null) setValue(stored);
    // `isValid` is a fresh closure on most renders; the NAME is the identity
    // of this preference, and re-reading storage on every render would fight
    // the user's own clicks.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [name]);

  const choose = useCallback(
    (next: T): void => {
      setValue(next);
      if (typeof window === "undefined") return;
      try {
        window.localStorage.setItem(preferenceKey(name), next);
      } catch {
        // The choice still applies to this session.
      }
    },
    [name],
  );

  return [value, choose];
}
