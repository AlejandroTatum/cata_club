"use client";

import { useCallback, useRef, useState } from "react";

/**
 * Keeps only the newest of several overlapping async file preparations.
 *
 * A receipt photo is shrunk asynchronously, so picking file A and then file B
 * can settle A after B. `run` tags each preparation with a sequence id and
 * resolves `null` for any that is no longer the latest; `pending` is true
 * while the latest one is still in flight so callers can hold their submit.
 */
export function useLatestPick(): {
  run: <T>(work: Promise<T>) => Promise<T | null>;
  cancel: () => void;
  pending: boolean;
} {
  const sequence = useRef(0);
  const [pending, setPending] = useState(false);

  const run = useCallback(async <T,>(work: Promise<T>): Promise<T | null> => {
    const id = ++sequence.current;
    setPending(true);
    try {
      const value = await work;
      return id === sequence.current ? value : null;
    } finally {
      if (id === sequence.current) setPending(false);
    }
  }, []);

  /** Drops whatever is in flight (the file was cleared or replaced by a non-async path). */
  const cancel = useCallback(() => {
    sequence.current += 1;
    setPending(false);
  }, []);

  return { run, cancel, pending };
}
