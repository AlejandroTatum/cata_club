/**
 * usePendingPaymentsCount — the number behind the sidebar's count badge on
 * "Membresías y Pagos" (prototype `_nav-admin.html`: `<span class="cnt">14</span>`).
 *
 * Reads the same aggregate the admin dashboard already uses
 * (`GET /api/dashboard` → `pendingPayments`), fetched once per mount and NOT
 * polled: the badge is a nudge toward the validation queue, not a live meter,
 * and that endpoint composes several backend calls.
 *
 * Returns `null` while loading, when disabled, or on any failure — the badge
 * simply does not render rather than showing a wrong or zero-looking count.
 */

"use client";

import { useEffect, useState } from "react";
import { fetchDashboardStats } from "@/services/api";

export function usePendingPaymentsCount(enabled: boolean): number | null {
  const [count, setCount] = useState<number | null>(null);

  useEffect(() => {
    if (!enabled) {
      setCount(null);
      return;
    }
    let cancelled = false;

    void (async (): Promise<void> => {
      try {
        const stats = await fetchDashboardStats();
        if (!cancelled) {
          setCount(typeof stats?.pendingPayments === "number" ? stats.pendingPayments : null);
        }
      } catch {
        // Silent: a badge that cannot be resolved is simply absent.
        if (!cancelled) setCount(null);
      }
    })();

    return (): void => {
      cancelled = true;
    };
  }, [enabled]);

  return count;
}
