/**
 * Password step-up for role changes (#1653, S5): run an action; if the backend
 * answers `reautenticacion_requerida`, ask for the password, then retry the
 * action ONCE. Cancelling rejects with `ReauthCancelledError` and the action is
 * never retried, so nothing changes.
 *
 * Only the code is inspected, never the status text, and the password never
 * leaves `ReauthDialog` except into `reautenticar`.
 */

"use client";

import { type ReactElement, useCallback, useEffect, useRef, useState } from "react";
import ReauthDialog from "@/components/ReauthDialog";
import { reautenticar } from "@/services/api";

export const REAUTH_REQUIRED_CODE = "reautenticacion_requerida";

/** The admin dismissed the password prompt: the pending change was NOT made. */
export class ReauthCancelledError extends Error {
  constructor() {
    super("Se canceló la confirmación de contraseña.");
    this.name = "ReauthCancelledError";
  }
}

export function isReauthRequired(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { code?: unknown }).code === REAUTH_REQUIRED_CODE;
}

export interface ReauthRetry {
  /** Runs `action`; on `reautenticacion_requerida` prompts for the password and retries once. */
  withReauth: <T>(action: () => Promise<T>) => Promise<T>;
  /** Render once, anywhere in the tree that owns the action. */
  reauthDialog: ReactElement;
}

export function useReauthRetry(): ReauthRetry {
  const [open, setOpen] = useState(false);
  const pending = useRef<{ promise: Promise<boolean>; settle: (confirmed: boolean) => void } | null>(null);

  const finish = useCallback((confirmed: boolean): void => {
    const current = pending.current;
    pending.current = null;
    setOpen(false);
    current?.settle(confirmed);
  }, []);

  // A prompt left open by an unmounting owner resolves as cancelled.
  useEffect(() => () => finish(false), [finish]);

  const ask = useCallback((): Promise<boolean> => {
    if (pending.current) return pending.current.promise;
    let settle: (confirmed: boolean) => void = () => undefined;
    const promise = new Promise<boolean>((resolve) => {
      settle = resolve;
    });
    pending.current = { promise, settle };
    setOpen(true);
    return promise;
  }, []);

  const withReauth = useCallback(
    async <T,>(action: () => Promise<T>): Promise<T> => {
      try {
        return await action();
      } catch (error: unknown) {
        if (!isReauthRequired(error)) throw error;
      }
      if (!(await ask())) throw new ReauthCancelledError();
      return action();
    },
    [ask],
  );

  const submit = useCallback(
    async (password: string): Promise<void> => {
      await reautenticar(password);
      finish(true);
    },
    [finish],
  );
  const cancel = useCallback((): void => finish(false), [finish]);

  return { withReauth, reauthDialog: <ReauthDialog open={open} onSubmit={submit} onCancel={cancel} /> };
}
