/**
 * What the legal re-accept gate currently knows, shared with anything that
 * must not open over it (the what's-new dialog).
 *
 * `unknown` is the fail-closed default: before the gate has answered, while
 * its check keeps failing, and whenever it is not mounted. Only an answered
 * "nothing pending" is `clear`.
 */

import { useSyncExternalStore } from "react";

export type LegalGateStatus = "unknown" | "pending" | "clear";

let status: LegalGateStatus = "unknown";
const listeners = new Set<() => void>();

export function publishLegalGateStatus(next: LegalGateStatus): void {
  if (next === status) return;
  status = next;
  listeners.forEach((listener) => listener());
}

export function getLegalGateStatus(): LegalGateStatus {
  return status;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useLegalGateStatus(): LegalGateStatus {
  return useSyncExternalStore(subscribe, getLegalGateStatus, () => "unknown");
}
