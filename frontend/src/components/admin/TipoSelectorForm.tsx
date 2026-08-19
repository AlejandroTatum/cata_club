/**
 * "Pick a tipo de membresía from the catalog, then submit" — issue #400
 * (Sonar duplication follow-up). `CreateMembershipForm` (assign a plan to a
 * student with none) and `CambiarPlanForm` (issue #400, criterio 1 — swap
 * an EXISTING membership's plan) repeated this whole flow near
 * verbatim: trigger button, catalog fetch on open, `<select>` with the
 * exact same option formatting, submit/cancel buttons, loading/error state.
 * Only the labels/icons, the failure message, and what the actual submit
 * call does ever differed — everything else is extracted here, and each
 * caller owns its own `onSubmit` (the real API call, its own success toast,
 * and its own parent refetch).
 */

"use client";

import { useState } from "react";
import type { LucideIcon } from "lucide-react";
import { Loader2 } from "lucide-react";
import { ICON } from "@/lib/icon-size";
import { fetchTiposMembresia } from "@/services/api";
import type { TipoMembresiaCatalogo } from "@/services/api";
import { formatCurrency } from "@/lib/format-utils";
import { toUserMessage } from "@/lib/error-message";

interface TipoSelectorFormProps {
  triggerLabel: string;
  TriggerIcon: LucideIcon;
  submitLabel: string;
  SubmitIcon: LucideIcon;
  selectPlaceholder: string;
  submitFailureMessage: string;
  /** The real write — throws on failure (translated here with
   *  `toUserMessage`), resolves on success. Owns its own success toast and
   *  the parent's refetch callback; this form never assumes either. */
  onSubmit: (tipoMembresiaId: number) => Promise<void>;
  /** The caller's own `showError` — called with the same resolved message
   *  this form displays inline, so a submit failure still reaches a toast
   *  (both existing call sites did this before extraction). */
  onSubmitError?: (message: string) => void;
  /**
   * Rendered INSTEAD of the trigger button once `onSubmit` succeeds, when
   * provided (`CreateMembershipForm`'s persistent "Membresía creada."
   * line — that form's own parent stops rendering it once the membership
   * exists, so this state is only ever visible for a moment). Omitted
   * (the default, `CambiarPlanForm`'s case) just closes back to the
   * trigger, ready to be reopened — the success feedback lives entirely in
   * the caller's own toast.
   */
  renderSuccess?: () => React.ReactElement;
}

export default function TipoSelectorForm({
  triggerLabel,
  TriggerIcon,
  submitLabel,
  SubmitIcon,
  selectPlaceholder,
  submitFailureMessage,
  onSubmit,
  onSubmitError,
  renderSuccess,
}: TipoSelectorFormProps): React.ReactElement {
  const [open, setOpen] = useState(false);
  const [tipos, setTipos] = useState<TipoMembresiaCatalogo[]>([]);
  const [selectedTipoId, setSelectedTipoId] = useState<number | "">("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [succeeded, setSucceeded] = useState(false);

  async function handleOpen(): Promise<void> {
    setOpen(true);
    setError(null);
    setSucceeded(false);
    if (tipos.length === 0) {
      try {
        setTipos(await fetchTiposMembresia());
      } catch {
        setError("No se pudieron cargar los tipos de membresía.");
      }
    }
  }

  async function handleSubmit(): Promise<void> {
    if (!selectedTipoId) return;

    setLoading(true);
    setError(null);
    try {
      await onSubmit(selectedTipoId);
      setOpen(false);
      setSucceeded(true);
    } catch (err) {
      const message = toUserMessage(err, submitFailureMessage);
      setError(message);
      onSubmitError?.(message);
    } finally {
      setLoading(false);
    }
  }

  if (succeeded && renderSuccess) {
    return renderSuccess();
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => void handleOpen()}
        className="mt-2.5 inline-flex items-center gap-1 rounded-lg bg-cata-red/15 px-2.5 py-1 text-xs font-semibold text-cata-red transition-colors hover:bg-cata-red/25"
      >
        <TriggerIcon size={ICON.sm} strokeWidth={2} aria-hidden="true" />
        {triggerLabel}
      </button>
    );
  }

  return (
    <div className="mt-2.5 space-y-section rounded-ctl border border-line bg-sunken p-3">
      <select
        value={selectedTipoId}
        onChange={(e) => setSelectedTipoId(e.target.value ? Number(e.target.value) : "")}
        className="input-field text-xs"
      >
        <option value="">{selectPlaceholder}</option>
        {tipos.map((tipo) => (
          <option key={tipo.id} value={tipo.id}>
            {tipo.categoria} — {formatCurrency(tipo.precio)} ({tipo.modalidad})
          </option>
        ))}
      </select>
      {error && <p className="text-xs text-state-bad">{error}</p>}
      <div className="flex flex-wrap gap-1.5">
        <button
          type="button"
          onClick={() => void handleSubmit()}
          disabled={!selectedTipoId || loading}
          className="inline-flex items-center gap-1 rounded-lg bg-cata-red px-2.5 py-1 text-xs font-semibold text-white transition-colors hover:bg-cata-red/80 disabled:opacity-50"
        >
          {loading ? (
            <Loader2 size={ICON.sm} className="animate-spin" aria-hidden="true" />
          ) : (
            <SubmitIcon size={ICON.sm} aria-hidden="true" />
          )}
          {submitLabel}
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="rounded-lg border border-line px-2.5 py-1 text-xs text-ink-2 transition-colors hover:bg-paper"
        >
          Cancelar
        </button>
      </div>
    </div>
  );
}
