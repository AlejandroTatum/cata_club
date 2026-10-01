/**
 * useActividad — loads one view of "Actividad del club" for one range.
 *
 * The caller keys the component by range, so a range change starts from
 * `loading` and a stale answer can never land on the new range. `pollMs` turns
 * on a background refresh that only runs while the tab is visible: a hidden
 * tab asks for nothing, and the first moment it is visible again it refreshes
 * once and resumes the cadence. A failed refresh keeps the last good figures
 * (the page already says how old each block is); only the first load or an
 * explicit retry can show an error.
 */

"use client";

import { useCallback, useEffect, useState } from "react";

export type ActividadState<T> =
  | { status: "loading" }
  | { status: "error"; error: unknown }
  | { status: "ready"; data: T; loadedAt: number };

export interface UseActividad<T> {
  state: ActividadState<T>;
  retry: () => void;
}

export function useActividad<T, R>(load: (range: R) => Promise<T>, range: R, pollMs?: number): UseActividad<T> {
  const [state, setState] = useState<ActividadState<T>>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let live = true;
    load(range).then(
      (data) => live && setState({ status: "ready", data, loadedAt: Date.now() }),
      (error: unknown) => live && setState({ status: "error", error }),
    );
    return (): void => {
      live = false;
    };
  }, [load, range, attempt]);

  useEffect(() => {
    if (!pollMs) return undefined;
    let live = true;
    let timer: ReturnType<typeof setInterval> | undefined;

    const refresh = (): void => {
      load(range).then(
        (data) => live && setState({ status: "ready", data, loadedAt: Date.now() }),
        () => undefined,
      );
    };
    const stop = (): void => {
      if (timer !== undefined) clearInterval(timer);
      timer = undefined;
    };
    const start = (): void => {
      stop();
      timer = setInterval(refresh, pollMs);
    };
    const onVisibility = (): void => {
      if (document.hidden) {
        stop();
      } else {
        refresh();
        start();
      }
    };

    if (!document.hidden) start();
    document.addEventListener("visibilitychange", onVisibility);
    return (): void => {
      live = false;
      stop();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [load, range, pollMs]);

  const retry = useCallback((): void => {
    setState({ status: "loading" });
    setAttempt((n) => n + 1);
  }, []);

  return { state, retry };
}
