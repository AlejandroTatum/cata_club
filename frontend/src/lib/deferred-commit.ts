/**
 * Hold a mutation for a few seconds so "Deshacer" can still mean something.
 *
 * ## Why holding, and not reverting
 *
 * The roll call can undo a mark by putting the roster back, because nothing
 * has left the browser yet. A payment decision is not like that: approving
 * flips the payment's state, activates the membership, and hands a receipt to
 * a Celery worker that generates a PDF and mails it. "Undoing" that on the
 * server would not be an undo, it would be a compensating transaction with
 * visible side effects — a membership that blinked active, a receipt already
 * in someone's inbox for a payment now marked pending again.
 *
 * So the undo happens BEFORE the request: the UI moves immediately, the
 * request waits, and pressing "Deshacer" cancels a thing that never happened.
 * That is the only version of undo that is honest here.
 *
 * ## The two ways a held commit could be lost, and how neither happens
 *
 * 1. **A second decision arrives.** The pending one is flushed first, so the
 *    admin's decisions reach the server in the order they made them. One
 *    commit is ever in flight; there is no queue to reorder.
 * 2. **They navigate away or close the tab.** `flush` runs on unmount and on
 *    `pagehide`, so leaving the screen COMMITS rather than silently discards.
 *    Discarding would be the worse failure by far: the admin saw "Pago
 *    aprobado", and the only safe reading of walking away is that they meant
 *    it.
 *
 * A commit that fails after the window closed has no button left to attach an
 * error to, which is why `schedule` takes an `onError` — the caller reports it
 * where the admin can still see it and puts the row back.
 */

"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/** How long a decision stays reversible. Matches the undo toast's dwell. */
export const UNDO_WINDOW_MS = 8000;

export interface DeferredCommitRequest {
  /**
   * What is being held, in the user's words — "Aprobación de Juan Pérez".
   *
   * A held mutation is a state the user is IN, and a toast is a state that
   * scrolls away: it dismisses itself, and it can be dismissed by hand or
   * buried under the next one. Whatever surface shows the hold needs the label
   * to say what it is about, so the hold is visible for as long as it lasts
   * rather than for as long as a toast happens to survive.
   */
  label: string;
  /** Runs when the window closes, or when a flush is forced. */
  commit: () => Promise<void>;
  /** Runs instead of `commit` when the user takes the undo back. */
  onUndo: () => void;
  /** Runs when a committed request fails, with the window already gone. */
  onError: (error: unknown) => void;
}

export interface DeferredCommitHandle {
  /** Hold a mutation, flushing any previous one first. */
  schedule: (request: DeferredCommitRequest) => void;
  /** Cancel the held mutation and run its `onUndo`. No-op when none is held. */
  undo: () => void;
  /** Send the held mutation now. */
  flush: () => void;
  /** Whether a mutation is currently held — for disabling conflicting UI. */
  isPending: boolean;
  /** The held mutation's label, or `null` when nothing is held. */
  pendingLabel: string | null;
}

export function useDeferredCommit(windowMs: number = UNDO_WINDOW_MS): DeferredCommitHandle {
  const pending = useRef<DeferredCommitRequest | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [pendingLabel, setPendingLabel] = useState<string | null>(null);

  const clearTimer = useCallback((): void => {
    if (timer.current !== null) {
      clearTimeout(timer.current);
      timer.current = null;
    }
  }, []);

  /**
   * Takes the pending request out of the ref BEFORE awaiting it, so a commit
   * that is already in flight cannot be flushed a second time by an unmount
   * that lands mid-request.
   */
  const flush = useCallback((): void => {
    clearTimer();
    const request = pending.current;
    if (!request) return;
    pending.current = null;
    setPendingLabel(null);
    request.commit().catch(request.onError);
  }, [clearTimer]);

  const undo = useCallback((): void => {
    clearTimer();
    const request = pending.current;
    if (!request) return;
    pending.current = null;
    setPendingLabel(null);
    request.onUndo();
  }, [clearTimer]);

  const schedule = useCallback(
    (request: DeferredCommitRequest): void => {
      // Decisions reach the server in the order they were made.
      flush();
      pending.current = request;
      setPendingLabel(request.label);
      timer.current = setTimeout(flush, windowMs);
    },
    [flush, windowMs],
  );

  /**
   * `pagehide` rather than `beforeunload`: it fires on the back/forward cache
   * path and on mobile tab disposal, where `beforeunload` does not, and it does
   * not ask the browser to show a "leave site?" prompt.
   */
  useEffect(() => {
    const onPageHide = (): void => flush();
    window.addEventListener("pagehide", onPageHide);
    return (): void => {
      window.removeEventListener("pagehide", onPageHide);
      flush();
    };
  }, [flush]);

  return { schedule, undo, flush, isPending: pendingLabel !== null, pendingLabel };
}
