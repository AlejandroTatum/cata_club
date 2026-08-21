/**
 * The one exit the app cannot re-enter (`sessionStorage` dies with the tab)
 * and the discard-a-draft confirmation — both funnel through the same
 * `ConfirmDialog`, so both funnel through the same pending-confirmation
 * state.
 */

"use client";

import { useCallback, useEffect, useState } from "react";
import type { useRouter } from "next/navigation";
import { clearAttendanceDraft } from "./attendance-utils";

/**
 * What the trainer is being asked to give up when they walk out of a roll
 * call they have already started, or throw away a draft from the picker.
 */
export type PendingConfirmation =
  | { kind: "leave"; href: string }
  | { kind: "discard-draft"; draftKey: string; label: string; markCount: number };

interface UseLeaveGuardArgs {
  hasUnsavedMarks: boolean;
  backHref: string;
  router: ReturnType<typeof useRouter>;
  refreshResumableDrafts: () => void;
}

export interface LeaveGuard {
  pendingConfirmation: PendingConfirmation | null;
  setPendingConfirmation: (value: PendingConfirmation | null) => void;
  handleLeaveWizard: (event: React.MouseEvent<HTMLAnchorElement>) => void;
  handleConfirmPending: () => void;
}

export function useLeaveGuard({
  hasUnsavedMarks,
  backHref,
  router,
  refreshResumableDrafts,
}: UseLeaveGuardArgs): LeaveGuard {
  const [pendingConfirmation, setPendingConfirmation] = useState<PendingConfirmation | null>(null);

  useEffect(() => {
    if (!hasUnsavedMarks) return;
    function warnBeforeUnload(event: BeforeUnloadEvent): void {
      event.preventDefault();
      event.returnValue = "";
    }
    window.addEventListener("beforeunload", warnBeforeUnload);
    return () => window.removeEventListener("beforeunload", warnBeforeUnload);
  }, [hasUnsavedMarks]);

  /** The in-app way out — guarded only while there is something to discard. */
  const handleLeaveWizard = useCallback(
    (event: React.MouseEvent<HTMLAnchorElement>): void => {
      if (!hasUnsavedMarks) return;
      event.preventDefault();
      setPendingConfirmation({ kind: "leave", href: backHref });
    },
    [backHref, hasUnsavedMarks],
  );

  const handleConfirmPending = useCallback((): void => {
    const pending = pendingConfirmation;
    setPendingConfirmation(null);
    if (!pending) return;
    if (pending.kind === "leave") {
      router.push(pending.href);
      return;
    }
    clearAttendanceDraft(pending.draftKey);
    refreshResumableDrafts();
  }, [pendingConfirmation, refreshResumableDrafts, router]);

  return { pendingConfirmation, setPendingConfirmation, handleLeaveWizard, handleConfirmPending };
}
