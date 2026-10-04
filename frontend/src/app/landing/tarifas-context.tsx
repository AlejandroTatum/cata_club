"use client";

import { createContext, useEffect, useState } from "react";
import { mapPublicTarifas, type LandingTarifa } from "./tarifas-data";

/** The published price catalog as the page sees it; `loading` is also what server rendering produces. */
export type TarifasState =
  | { kind: "loading" }
  | { kind: "ready"; tarifas: LandingTarifa[] }
  | { kind: "empty" }
  | { kind: "error" };

export const TarifasContext = createContext<TarifasState>({ kind: "loading" });

/**
 * One request to the public `GET /api/membresias/tarifas` for the whole page
 * (LAN-03), the way `PublicSchedules` does for the schedules: the club edits
 * its prices in the app, so that catalog is the only source and the page never
 * states a price of its own.
 */
export function PublicTarifas({ children }: { children: React.ReactNode }): React.ReactElement {
  const [state, setState] = useState<TarifasState>({ kind: "loading" });

  useEffect((): (() => void) => {
    let cancelled = false;
    fetch("/api/membresias/tarifas", { cache: "no-store" })
      .then((response): Promise<unknown> => {
        if (!response.ok) throw new Error("tarifas unavailable");
        return response.json();
      })
      .then((payload: unknown): void => {
        if (cancelled) return;
        const tarifas = mapPublicTarifas(payload);
        setState(tarifas.length > 0 ? { kind: "ready", tarifas } : { kind: "empty" });
      })
      .catch((): void => {
        if (!cancelled) setState({ kind: "error" });
      });
    return (): void => { cancelled = true; };
  }, []);

  return <TarifasContext.Provider value={state}>{children}</TarifasContext.Provider>;
}
