/**
 * useNotificaciones — fetch + 60s poll + mark-read for in-app notifications,
 * shared between `Header` (public/auth-adjacent routes) and `AppShell`
 * (admin/trainer routes) so each renders its own NotificationBell fed by one
 * data source instead of polling independently and drifting out of sync
 * with each other.
 */

"use client";

import { useCallback, useEffect, useState } from "react";
import { fetchNotificaciones, marcarNotificacionLeida } from "@/services/api";
import type { Notificacion } from "@/types/domain";

const NOTIFICACIONES_POLL_INTERVAL_MS = 60_000;

export function useNotificaciones(enabled: boolean): {
  notificaciones: Notificacion[];
  loadError: boolean;
  markRead: (id: number) => void;
} {
  const [notificaciones, setNotificaciones] = useState<Notificacion[]>([]);
  const [loadError, setLoadError] = useState(false);

  const load = useCallback(async (): Promise<void> => {
    try {
      const data = await fetchNotificaciones();
      setNotificaciones(data.items);
      setLoadError(false);
    } catch {
      // Silent — the bell degrades to "no notifications" rather than
      // interrupting the whole page on a transient failure.
      setLoadError(true);
    }
  }, []);

  useEffect(() => {
    if (!enabled) return;
    void load();
    const intervalId = setInterval(() => void load(), NOTIFICACIONES_POLL_INTERVAL_MS);
    return () => clearInterval(intervalId);
  }, [enabled, load]);

  const markRead = useCallback((id: number): void => {
    // Snapshot before the optimistic update so a failed mark-read call can
    // be restored explicitly, instead of relying on a reload to "revert" it
    // (a reload can itself fail during the same outage, stranding the item
    // as incorrectly read-with-no-retry).
    let previous: Notificacion[] = [];
    setNotificaciones((prev) => {
      previous = prev;
      return prev.map((n) => (n.id === id ? { ...n, leida: true } : n));
    });
    marcarNotificacionLeida(id).catch(() => setNotificaciones(previous));
  }, []);

  return { notificaciones, loadError, markRead };
}
