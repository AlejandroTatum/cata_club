/**
 * useNotificaciones — fetch + 60s poll + mark-read for in-app notifications,
 * shared between `Header` (public/auth-adjacent routes) and `AppShell`
 * (admin/trainer routes) so each renders its own NotificationBell fed by one
 * data source instead of polling independently and drifting out of sync
 * with each other.
 */

"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  fetchNotificaciones,
  marcarNotificacionLeida,
  marcarTodasNotificacionesLeidas,
} from "@/services/api";
import type { Notificacion } from "@/types/domain";

const NOTIFICACIONES_POLL_INTERVAL_MS = 60_000;
/** Rows per request: the backend's own default page, asked for explicitly. */
const NOTIFICACIONES_PAGE_SIZE = 20;

export function useNotificaciones(enabled: boolean): {
  notificaciones: Notificacion[];
  loadError: boolean;
  /** Unread notifications across the WHOLE feed, not just the pages loaded so far. */
  noLeidas: number;
  /** `true` while older notifications remain on the server. */
  hasMore: boolean;
  /** Loads the next older page and appends it. No-op while one is in flight. */
  loadMore: () => void;
  cargandoMas: boolean;
  /** `true` when the last "load more" attempt failed. */
  errorCargarMas: boolean;
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
  const [total, setTotal] = useState(0);
  const [noLeidas, setNoLeidas] = useState(0);
  const [cargandoMas, setCargandoMas] = useState(false);
  const [errorCargarMas, setErrorCargarMas] = useState(false);
  // Latest rows for callbacks that must decide synchronously (see `markRead`).
  const ultimas = useRef(notificaciones);
  ultimas.current = notificaciones;
  const [marcandoTodas, setMarcandoTodas] = useState(false);
  const [errorMarcarTodas, setErrorMarcarTodas] = useState(false);

  const load = useCallback(async (): Promise<void> => {
    try {
      const data = await fetchNotificaciones({ skip: 0, limit: NOTIFICACIONES_PAGE_SIZE });
      // The poll refreshes the newest page only: older pages the user already
      // loaded stay below it (deduped) instead of vanishing every minute.
      setNotificaciones((prev) => {
        const fresh = new Set(data.items.map((n) => n.id));
        return [...data.items, ...prev.filter((n) => !fresh.has(n.id))];
      });
      setTotal(data.total);
      setNoLeidas(data.noLeidas ?? data.items.filter((n) => !n.leida).length);
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

  const loadMore = useCallback((): void => {
    if (cargandoMas) return;
    setCargandoMas(true);
    setErrorCargarMas(false);
    fetchNotificaciones({ skip: notificaciones.length, limit: NOTIFICACIONES_PAGE_SIZE })
      .then((data) => {
        setNotificaciones((prev) => {
          const have = new Set(prev.map((n) => n.id));
          return [...prev, ...data.items.filter((n) => !have.has(n.id))];
        });
        setTotal(data.total);
      })
      .catch(() => setErrorCargarMas(true))
      .finally(() => setCargandoMas(false));
  }, [cargandoMas, notificaciones.length]);

  const markRead = useCallback((id: number): void => {
    // Snapshot before the optimistic update so a failed mark-read call can
    // be restored explicitly, instead of relying on a reload to "revert" it
    // (a reload can itself fail during the same outage, stranding the item
    // as incorrectly read-with-no-retry).
    let previous: Notificacion[] = [];
    const eraPendiente = ultimas.current.some((n) => n.id === id && !n.leida);
    setNotificaciones((prev) => {
      previous = prev;
      return prev.map((n) => (n.id === id ? { ...n, leida: true } : n));
    });
    if (eraPendiente) setNoLeidas((n) => Math.max(0, n - 1));
    marcarNotificacionLeida(id).catch(() => {
      setNotificaciones(previous);
      if (eraPendiente) setNoLeidas((n) => n + 1);
    });
  }, []);

  const marcarTodasLeidas = useCallback((): void => {
    // A diferencia de `markRead`, acá SÍ hace falta leer `notificaciones`
    // del closure (no del updater funcional): "no request when nothing is
    // pending" (issue #859) tiene que decidirse ANTES de la actualización
    // optimista, y el updater funcional de `setState` no se ejecuta de
    // forma síncrona -- leer una variable que asigna adentro, justo después
    // de llamarlo, ve el valor previo a la actualización, no el nuevo.
    if (noLeidas === 0) return;

    const previous = notificaciones;
    const previousNoLeidas = noLeidas;
    setNoLeidas(0);
    setNotificaciones((prev) => prev.map((n) => (n.leida ? n : { ...n, leida: true })));

    setErrorMarcarTodas(false);
    setMarcandoTodas(true);
    marcarTodasNotificacionesLeidas()
      .catch(() => {
        setNotificaciones(previous);
        setNoLeidas(previousNoLeidas);
        setErrorMarcarTodas(true);
      })
      .finally(() => setMarcandoTodas(false));
  }, [notificaciones, noLeidas]);

  return {
    notificaciones,
    loadError,
    noLeidas,
    hasMore: notificaciones.length < total,
    loadMore,
    cargandoMas,
    errorCargarMas,
    markRead,
    marcarTodasLeidas,
    marcandoTodas,
    errorMarcarTodas,
  };
}
