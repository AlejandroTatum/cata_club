/**
 * usePendingPaymentsCount — the number behind the sidebar's count badge on
 * "Membresías y Pagos" (prototype `_nav-admin.html`: `<span class="cnt">14</span>`).
 *
 * Reads the same aggregate the admin dashboard already uses
 * (`GET /api/dashboard` → `pendingPayments`), fetched once per mount (plus on request, see
 * `refreshPendingPaymentsCount`) and NOT polled: the badge is a nudge toward the validation queue, not a live meter,
 * and that endpoint composes several backend calls.
 *
 * Returns `null` while loading, when disabled, or on any failure — the badge
 * simply does not render rather than showing a wrong or zero-looking count.
 */

"use client";

import { useEffect, useState } from "react";
import { fetchDashboardStats } from "@/services/api";

/** Window event asking every mounted badge to re-read the count. */
export const PENDING_PAYMENTS_REFRESH_EVENT = "cataclub:pending-payments-refresh";

/**
 * Re-read the badge now. For a screen that learns the count changed under it
 * (another admin resolved a payment), so the menu and the screen agree (ADMA-28).
 */
export function refreshPendingPaymentsCount(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(PENDING_PAYMENTS_REFRESH_EVENT));
}

export function usePendingPaymentsCount(enabled: boolean): number | null {
  const [count, setCount] = useState<number | null>(null);

  useEffect(() => {
    if (!enabled) {
      setCount(null);
      return;
    }
    let cancelled = false;

    const load = async (): Promise<void> => {
      try {
        const stats = await fetchDashboardStats();
        if (!cancelled) {
          setCount(typeof stats?.pendingPayments === "number" ? stats.pendingPayments : null);
        }
      } catch {
        // Silent: a badge that cannot be resolved is simply absent.
        if (!cancelled) setCount(null);
      }
    };

    void load();
    const onRefresh = (): void => {
      void load();
    };
    window.addEventListener(PENDING_PAYMENTS_REFRESH_EVENT, onRefresh);

    return (): void => {
      cancelled = true;
      window.removeEventListener(PENDING_PAYMENTS_REFRESH_EVENT, onRefresh);
    };
  }, [enabled]);

  return count;
}
