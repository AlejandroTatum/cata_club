/**
 * Cambiar el plan de una membresía YA existente — issue #400, criterio 1.
 *
 * Mismo esqueleto que `CreateMembershipForm` (mismo catálogo, misma forma):
 * la diferencia de negocio es que ESTA membresía ya existe, así que el
 * backend muta `tipo_membresia_id` en lugar de crear una fila nueva.
 * Prospectivo (decisión de producto ya tomada): la cobertura ya pagada no se
 * toca; la tarifa nueva rige recién desde el próximo pago que se registre.
 *
 * El selector NO excluye el plan actual de la lista: `MemberStudentSummary.
 * membresia` no expone `tipoMembresiaId` (solo un `tipo: string` ya
 * formateado para mostrar, no comparable de forma confiable contra el
 * catálogo), y agregarlo tocaría el adaptador del BFF (`members-adapter.ts`)
 * fuera del alcance pedido para esta entrega. El backend ya rechaza
 * "cambiar" al mismo tipo con un mensaje claro (`MENSAJE_CAMBIO_PLAN_MISMO_
 * TIPO`), que `toUserMessage` muestra si el admin lo elige por error.
 */

"use client";

import { useState } from "react";
import { CheckCircle2, Loader2, Repeat } from "lucide-react";
import { ICON } from "@/lib/icon-size";
import { useToast } from "@/contexts/ToastContext";
import { cambiarPlanMembresia, fetchTiposMembresia } from "@/services/api";
import type { TipoMembresiaCatalogo } from "@/services/api";
import { formatCurrency } from "@/lib/format-utils";
import { toUserMessage } from "@/lib/error-message";

interface CambiarPlanFormProps {
  membresiaId: number;
  /** Refetch the member list so the new plan (y su tarifa) aparece en el acto. */
  onChanged: () => void;
}

export default function CambiarPlanForm({
  membresiaId,
  onChanged,
}: CambiarPlanFormProps): React.ReactElement {
  const { showSuccess, showError } = useToast();
  const [open, setOpen] = useState(false);
  const [tipos, setTipos] = useState<TipoMembresiaCatalogo[]>([]);
  const [selectedTipoId, setSelectedTipoId] = useState<number | "">("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleOpen(): Promise<void> {
    setOpen(true);
    setError(null);
    setSelectedTipoId("");
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
      // Igual que CreateMembershipForm: el catálogo se muestra con su precio
      // para que el admin sepa qué está asignando, pero solo se envía el id
      // — el backend resuelve la tarifa nueva desde `TipoMembresia.precio`.
      await cambiarPlanMembresia(membresiaId, selectedTipoId);
      setOpen(false);
      showSuccess("Plan cambiado correctamente.");
      onChanged();
    } catch (err) {
      const message = toUserMessage(err, "Error al cambiar el plan de la membresía.");
      setError(message);
      showError(message);
    } finally {
      setLoading(false);
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => void handleOpen()}
        className="mt-2.5 inline-flex items-center gap-1 rounded-lg bg-cata-red/15 px-2.5 py-1 text-xs font-semibold text-cata-red transition-colors hover:bg-cata-red/25"
      >
        <Repeat size={ICON.sm} strokeWidth={2} aria-hidden="true" />
        Cambiar plan
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
        <option value="">Seleccionar plan nuevo…</option>
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
            <CheckCircle2 size={ICON.sm} aria-hidden="true" />
          )}
          Cambiar
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
