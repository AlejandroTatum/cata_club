/**
 * Create a membership for a student who has none — the first of the two
 * independent forms inside a student's edit panel.
 *
 * It owns every piece of state its own flow needs (catalog, selection,
 * in-flight, error, success) and tells the page nothing except "a membership
 * now exists", via `onCreated`. Nothing here is shared with the payment form
 * beside it: they open independently, fail independently, and the only thing
 * they have in common is the student they hang off.
 */

"use client";

import { useState } from "react";
import { CheckCircle2, Loader2, Plus } from "lucide-react";
import { ICON } from "@/lib/icon-size";
import { useToast } from "@/contexts/ToastContext";
import { crearMembresia, fetchTiposMembresia } from "@/services/api";
import type { TipoMembresiaCatalogo } from "@/services/api";
import { formatCurrency } from "@/lib/format-utils";
import { toUserMessage } from "@/lib/error-message";

interface CreateMembershipFormProps {
  personaId: number;
  /** Refetch the member list so the new membership appears in place. */
  onCreated: () => void;
}

export default function CreateMembershipForm({
  personaId,
  onCreated,
}: CreateMembershipFormProps): React.ReactElement {
  const { showSuccess, showError } = useToast();
  const [open, setOpen] = useState(false);
  const [tipos, setTipos] = useState<TipoMembresiaCatalogo[]>([]);
  const [selectedTipoId, setSelectedTipoId] = useState<number | "">("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState(false);

  async function handleOpen(): Promise<void> {
    setOpen(true);
    setError(null);
    setCreated(false);
    if (tipos.length === 0) {
      try {
        setTipos(await fetchTiposMembresia());
      } catch {
        setError("No se pudieron cargar los tipos de membresía.");
      }
    }
  }

  async function handleCreate(): Promise<void> {
    if (!selectedTipoId || !personaId) return;

    setLoading(true);
    setError(null);
    try {
      // Only who and which plan. The catalogue price is still fetched and
      // shown in the selector so the admin sees what they are assigning, but
      // it is NOT sent: the backend resolves the current tariff from
      // `tipoMembresiaId` (issue #400). Echoing the price back would make the
      // number the club charges with editable in transit.
      await crearMembresia({
        personaId,
        tipoMembresiaId: selectedTipoId,
      });
      setCreated(true);
      setOpen(false);
      showSuccess("Membresía creada correctamente.");
      onCreated();
    } catch (err) {
      const message = toUserMessage(err, "Error al crear la membresía.");
      setError(message);
      showError(message);
    } finally {
      setLoading(false);
    }
  }

  if (created) {
    return (
      <p className="mt-2 flex items-center gap-1 text-xs text-state-ok">
        <CheckCircle2 size={ICON.sm} strokeWidth={2} aria-hidden="true" />
        Membresía creada.
      </p>
    );
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => void handleOpen()}
        className="mt-2.5 inline-flex items-center gap-1 rounded-lg bg-cata-red/15 px-2.5 py-1 text-xs font-semibold text-cata-red transition-colors hover:bg-cata-red/25"
      >
        <Plus size={ICON.sm} strokeWidth={2} aria-hidden="true" />
        Crear membresía
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
        <option value="">Seleccionar tipo…</option>
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
          onClick={() => void handleCreate()}
          disabled={!selectedTipoId || loading}
          className="inline-flex items-center gap-1 rounded-lg bg-cata-red px-2.5 py-1 text-xs font-semibold text-white transition-colors hover:bg-cata-red/80 disabled:opacity-50"
        >
          {loading ? <Loader2 size={ICON.sm} className="animate-spin" /> : <Plus size={ICON.sm} />}
          Crear
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
