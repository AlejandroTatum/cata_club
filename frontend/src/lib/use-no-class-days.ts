"use client";

import { useEffect, useState } from "react";
import type { NoClassRange } from "@/lib/no-class-days";
import { fetchDiasSinClase } from "@/services/api";

const NONE: readonly NoClassRange[] = [];

/**
 * The club's no-class days touching `[desde, hasta]` (issue #1665), for the
 * attendance estimates that must not count them as scheduled sessions.
 *
 * Best-effort: while loading, with no range, or when the lookup fails, it
 * yields an empty list — the estimate then behaves as it did before no-class
 * days existed, which is already declared as an estimate on screen.
 */
export function useNoClassDays(desde: string | null | undefined, hasta: string | null | undefined): readonly NoClassRange[] {
  const [days, setDays] = useState<readonly NoClassRange[]>(NONE);

  useEffect(() => {
    if (!desde || !hasta) {
      setDays(NONE);
      return;
    }
    let cancelled = false;
    fetchDiasSinClase({ desde, hasta })
      .then((all) => {
        if (!cancelled) setDays(all);
      })
      .catch(() => {
        if (!cancelled) setDays(NONE);
      });
    return () => {
      cancelled = true;
    };
  }, [desde, hasta]);

  return days;
}
