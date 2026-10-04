/**
 * The trainer's own correction requests for ONE session (QA4 ENT-25), so each
 * closed-list row can show what became of the request without every row
 * fetching on its own. A garnish: a failure leaves the list empty and the
 * «Pedir corrección» door still works (the backend refuses a duplicate
 * pending request anyway).
 */

import { useCallback, useEffect, useState } from "react";
import { fetchCorrectionRequests, type CorrectionRequest } from "@/services/api";

export interface UseCorrectionRequests {
  requests: CorrectionRequest[];
  /** A request just created from a row: shown at once, no refetch. */
  addRequest: (request: CorrectionRequest) => void;
}

export function useCorrectionRequests(
  horarioId: number | null,
  fecha: string | null,
  enabled: boolean,
): UseCorrectionRequests {
  const [requests, setRequests] = useState<CorrectionRequest[]>([]);

  useEffect((): (() => void) => {
    let cancelled = false;
    setRequests([]);
    if (!enabled || horarioId === null || fecha === null) return (): void => {};
    (async (): Promise<void> => {
      try {
        const rows = await fetchCorrectionRequests({ horarioId, fecha });
        if (!cancelled) setRequests(Array.isArray(rows) ? rows : []);
      } catch (err: unknown) {
        console.error("[trainer/attendance] fetchCorrectionRequests failed", err);
      }
    })();
    return (): void => {
      cancelled = true;
    };
  }, [horarioId, fecha, enabled]);

  const addRequest = useCallback((request: CorrectionRequest): void => {
    setRequests((current) => [...current.filter((r) => r.id !== request.id), request]);
  }, []);

  return { requests, addRequest };
}
