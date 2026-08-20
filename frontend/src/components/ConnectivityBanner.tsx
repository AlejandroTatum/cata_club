/**
 * ConnectivityBanner — the one app-wide "sin conexión" indicator.
 *
 * Issue #454: local error handling (every page's own `ErrorState`/toast on a
 * failed fetch) already works and is NOT what this covers — see the fetch
 * error handling this screen already does, left untouched. The gap was the
 * SILENT one: `AuthContext`'s periodic session revalidation (every 5 minutes,
 * or on tab focus) used to no-op completely on a backend outage, so a tab
 * left open through an outage showed nothing at all.
 *
 * Reads `AuthContext.periodicOutage` — see that field's own doc comment for
 * why the signal lives there instead of a separate polling mechanism: the
 * app has no generic fetch interceptor, and `revalidate()` was already the
 * one periodic network probe running while a tab sits open.
 *
 * Mounted ONCE, in `AuthProviderWrapper`, above every route (`AppShell` and
 * `AuthShell` both sit under it) — one boolean, one banner, never per-page,
 * so it cannot double up with itself the way a per-request toast could.
 */

"use client";

import type { ReactElement } from "react";
import { WifiOff } from "lucide-react";
import { ICON } from "@/lib/icon-size";
import { useAuth } from "@/contexts/AuthContext";

export default function ConnectivityBanner(): ReactElement | null {
  const { periodicOutage } = useAuth();

  if (!periodicOutage) return null;

  return (
    // `status`/`polite`, not `alert`: this is an ongoing condition, not a
    // one-off event — an assertive announcement on every 20s retry tick
    // would be exactly the kind of noise a screen reader user did not ask
    // for. It announces once, when it appears, and again when it clears.
    <div
      role="status"
      aria-live="polite"
      className="flex items-center justify-center gap-2 bg-state-warn-bg px-4 py-2 text-center text-xs font-semibold text-state-warn"
    >
      <WifiOff size={ICON.sm} strokeWidth={2} aria-hidden="true" className="shrink-0" />
      <span>Sin conexión con el servidor — reintentando…</span>
    </div>
  );
}
