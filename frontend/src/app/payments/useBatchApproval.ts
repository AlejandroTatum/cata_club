/**
 * Batch approval for the payment validation queue.
 *
 * The admin reviews payments one at a time and parks each one instead of
 * committing it, then approves the parked set in one go. That is a whole
 * concept — a review mark, a selection, progress, an outcome — and it was
 * interleaved with the queue's filtering, its detail panel and its single
 * approve/reject flow, so reading any one of them meant reading all of them.
 *
 * There is no batch endpoint: the backend exposes
 * `PATCH /membresias/pagos/{id}/validar` per payment, proxied by
 * `PUT /api/payments/[id]`, so a run is N sequential calls. Sequential rather
 * than parallel on purpose — each one is a membership activation, and a
 * partial failure has to be reportable item by item.
 *
 * What stays OUT of here, deliberately: which payment is selected, whether its
 * checklist is complete, and the period the admin picked. Those belong to the
 * detail panel; this hook is handed the period it should store and never
 * recomputes it.
 */

"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { updatePaymentValidation } from "@/services/api";
import type { PaymentValidationRequest } from "@/services/api";
import { useToast } from "@/contexts/ToastContext";
import type { BatchApprovalOutcome } from "./payments-utils";

/** The period the admin saw and approved, stored so the batch call sends exactly that. */
export interface ReviewedPeriod {
  startDate: string;
  endDate: string;
}

interface UseBatchApprovalArgs {
  /** The pending queue — drives the prune below. */
  pending: PaymentValidationRequest[];
  /** Applied one row at a time, so an interrupted run still shows real statuses. */
  onRequestUpdated: (updated: PaymentValidationRequest) => void;
}

export interface BatchApproval {
  reviewed: Record<string, ReviewedPeriod>;
  selection: string[];
  progress: { done: number; total: number } | null;
  outcome: BatchApprovalOutcome | null;
  confirmOpen: boolean;
  setConfirmOpen: (open: boolean) => void;
  /** Pending payments the admin has already been through. */
  reviewedPending: PaymentValidationRequest[];
  /** Of those, the ones currently ticked. */
  targets: PaymentValidationRequest[];
  total: number;
  running: boolean;
  toggleSelection: (id: string) => void;
  /** Tick every reviewed pending payment. */
  selectAllReviewed: () => void;
  clearSelection: () => void;
  /** Park one payment with the period the admin chose. */
  markReviewed: (id: string, period: ReviewedPeriod) => void;
  clearOutcome: () => void;
  run: () => Promise<void>;
}

export function useBatchApproval({ pending, onRequestUpdated }: UseBatchApprovalArgs): BatchApproval {
  const { showSuccess, showError } = useToast();
  const [reviewed, setReviewed] = useState<Record<string, ReviewedPeriod>>({});
  const [selection, setSelection] = useState<string[]>([]);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [outcome, setOutcome] = useState<BatchApprovalOutcome | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const reviewedPending = useMemo(() => pending.filter((r) => reviewed[r.id]), [pending, reviewed]);
  const targets = useMemo(
    () => reviewedPending.filter((r) => selection.includes(r.id)),
    [reviewedPending, selection],
  );
  const total = targets.reduce((sum, r) => sum + r.expectedAmount, 0);

  /**
   * A review mark is only ever valid for a payment that is still pending: once
   * it is approved or rejected — here, elsewhere, or by another admin on the
   * next reload — the mark and the selection have to go with it, or the batch
   * bar would offer to approve something that is already resolved.
   */
  useEffect(() => {
    const pendingIds = new Set(pending.map((r) => r.id));
    setReviewed((prev) => {
      const entries = Object.entries(prev).filter(([id]) => pendingIds.has(id));
      return entries.length === Object.keys(prev).length ? prev : Object.fromEntries(entries);
    });
    setSelection((prev) => {
      const next = prev.filter((id) => pendingIds.has(id));
      return next.length === prev.length ? prev : next;
    });
  }, [pending]);

  const toggleSelection = useCallback((id: string): void => {
    setSelection((prev) => (prev.includes(id) ? prev.filter((other) => other !== id) : [...prev, id]));
  }, []);

  const markReviewed = useCallback((id: string, period: ReviewedPeriod): void => {
    setReviewed((prev) => ({ ...prev, [id]: period }));
    setSelection((prev) => (prev.includes(id) ? prev : [...prev, id]));
    setOutcome(null);
  }, []);

  const selectAllReviewed = useCallback((): void => {
    setSelection(reviewedPending.map((r) => r.id));
  }, [reviewedPending]);

  const clearSelection = useCallback((): void => setSelection([]), []);

  const clearOutcome = useCallback((): void => setOutcome(null), []);

  const run = useCallback(async (): Promise<void> => {
    if (targets.length === 0) return;

    setOutcome(null);
    setProgress({ done: 0, total: targets.length });
    const approved: string[] = [];
    const failed: string[] = [];
    const failedIds: string[] = [];

    for (const target of targets) {
      try {
        const updated = await updatePaymentValidation(target.id, {
          action: "approved",
          ...reviewed[target.id],
        });
        onRequestUpdated(updated);
        approved.push(target.studentName);
      } catch (err) {
        console.error("[payments] batch approve failed", target.id, err);
        failed.push(target.studentName);
        failedIds.push(target.id);
      }
      setProgress((prev) => (prev ? { ...prev, done: prev.done + 1 } : prev));
    }

    setProgress(null);
    // The ones that failed stay selected and stay marked as reviewed, so
    // retrying is one click and nothing has to be reviewed twice.
    setSelection(failedIds);
    setOutcome({ approved, failed });

    if (failed.length === 0) {
      showSuccess(
        approved.length === 1
          ? "1 pago aprobado. La membresía ya está activa."
          : `${approved.length} pagos aprobados. Las membresías ya están activas.`,
      );
    } else {
      showError(`Se aprobaron ${approved.length} de ${targets.length} pagos. Revise el detalle del lote.`);
    }
  }, [onRequestUpdated, reviewed, showError, showSuccess, targets]);

  return {
    reviewed,
    selection,
    progress,
    outcome,
    confirmOpen,
    setConfirmOpen,
    reviewedPending,
    targets,
    total,
    running: progress !== null,
    toggleSelection,
    selectAllReviewed,
    clearSelection,
    markReviewed,
    clearOutcome,
    run,
  };
}
