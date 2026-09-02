/**
 * useNotificaciones — fetch + 60s poll + mark-read for in-app notifications,
 * shared between `Header` (public/auth-adjacent routes) and `AppShell`
 * (admin/trainer routes) so each renders its own NotificationBell fed by one
 * data source instead of polling independently and drifting out of sync
 * with each other.
 */

"use client";

import { useCallback, useEffect, useState } from "react";
import {
  fetchNotificaciones,
  marcarNotificacionLeida,
  marcarTodasNotificacionesLeidas,
} from "@/services/api";
import type { Notificacion } from "@/types/domain";

const NOTIFICACIONES_POLL_INTERVAL_MS = 60_000;

export function useNotificaciones(enabled: boolean): {
  notificaciones: Notificacion[];
  loadError: boolean;
  markRead: (id: number) => void;
  /** Marks every pending notification read (issue #859). No-op when none are pending. */
  marcarTodasLeidas: () => void;
  /** `true` while the "marcar todas" request is in flight. */
  marcandoTodas: boolean;
  /** `true` when the last "marcar todas" attempt failed and was rolled back. */
  errorMarcarTodas: boolean;
} {
  const [notificaciones, setNotificaciones] = useState<Notificacion[]>([]);
  const [loadError, setLoadError] = useState(false);
  const [marcandoTodas, setMarcandoTodas] = useState(false);
  const [errorMarcarTodas, setErrorMarcarTodas] = useState(false);

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

  const marcarTodasLeidas = useCallback((): void => {
    // A diferencia de `markRead`, acá SÍ hace falta leer `notificaciones`
    // del closure (no del updater funcional): "no request when nothing is
    // pending" (issue #859) tiene que decidirse ANTES de la actualización
    // optimista, y el updater funcional de `setState` no se ejecuta de
    // forma síncrona -- leer una variable que asigna adentro, justo después
    // de llamarlo, ve el valor previo a la actualización, no el nuevo.
    const huboPendientes = notificaciones.some((n) => !n.leida);
    if (!huboPendientes) return;

    const previous = notificaciones;
    setNotificaciones((prev) => prev.map((n) => (n.leida ? n : { ...n, leida: true })));

    setErrorMarcarTodas(false);
    setMarcandoTodas(true);
    marcarTodasNotificacionesLeidas()
      .catch(() => {
        setNotificaciones(previous);
        setErrorMarcarTodas(true);
      })
      .finally(() => setMarcandoTodas(false));
  }, [notificaciones]);

  return { notificaciones, loadError, markRead, marcarTodasLeidas, marcandoTodas, errorMarcarTodas };
}
