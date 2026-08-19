/**
 * Suspender / reactivar una membresía — issue #400, criterio 3.
 *
 * Backend ya completo y probado (5a, PR #429): `POST .../suspender` exige
 * origen ACTIVA, `POST .../reactivar` exige origen SUSPENDIDA — ninguna de
 * las dos transiciones es válida desde VENCIDA/INACTIVA, así que este form
 * solo se ofrece para esos dos orígenes (ver `StudentEditPanel`, que decide
 * cuál mostrar según `student.membresia.estado`). `motivo` es obligatorio en
 * las dos operaciones (mismo criterio que `RegularizarDeudaForm`, que vive
 * al lado como precedente de forma en este mismo panel).
 */

"use client";

import { useState } from "react";
import { CheckCircle2, Loader2, PauseCircle, PlayCircle } from "lucide-react";
import { ICON } from "@/lib/icon-size";
import { useToast } from "@/contexts/ToastContext";
import { suspenderMembresia, reactivarMembresia } from "@/services/api";
import { toUserMessage } from "@/lib/error-message";
import type { EstadoMembresia } from "@/types/domain";

interface SuspenderReactivarFormProps {
  membresiaId: number;
  estado: EstadoMembresia;
  /** Refetch the member list so the new estado (and its badge) appears in place. */
  onChanged: () => void;
}

export default function SuspenderReactivarForm({
  membresiaId,
  estado,
  onChanged,
}: SuspenderReactivarFormProps): React.ReactElement | null {
  const { showSuccess, showError } = useToast();
  const [open, setOpen] = useState(false);
  const [motivo, setMotivo] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Ni ACTIVA ni SUSPENDIDA: el backend rechazaría las dos operaciones por
  // origen inválido (MENSAJE_SUSPENSION_ORIGEN_INVALIDO /
  // MENSAJE_REACTIVACION_ORIGEN_INVALIDO), así que no se ofrece ninguna.
  if (estado !== "activa" && estado !== "suspendida") return null;

  const accion = estado === "activa" ? "suspender" : "reactivar";
  // Distinta de `submitLabel` a propósito (mismo criterio que
  // `RegularizarDeudaForm`, cuyo disparador dice "Regularizar deuda" y su
  // botón de envío "Regularizar"): las dos conviven en pantalla una vez
  // abierto el formulario, y compartir el mismo texto las volvería
  // ambiguas para un lector de pantalla (dos botones con el mismo
  // `accessible name`).
  const triggerLabel = estado === "activa" ? "Suspender membresía" : "Reactivar membresía";
  const submitLabel = estado === "activa" ? "Suspender" : "Reactivar";
  const Icon = estado === "activa" ? PauseCircle : PlayCircle;

  function handleOpen(): void {
    setOpen(true);
    setError(null);
    setMotivo("");
  }

  async function handleSubmit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    if (!motivo.trim()) return;
    setLoading(true);
    setError(null);
    try {
      if (accion === "suspender") {
        await suspenderMembresia(membresiaId, { motivo: motivo.trim() });
      } else {
        await reactivarMembresia(membresiaId, { motivo: motivo.trim() });
      }
      showSuccess(accion === "suspender" ? "Membresía suspendida correctamente." : "Membresía reactivada correctamente.");
      setOpen(false);
      onChanged();
    } catch (err) {
      const message = toUserMessage(
        err,
        accion === "suspender" ? "No se pudo suspender la membresía." : "No se pudo reactivar la membresía.",
      );
      setError(message);
      showError(message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mt-2.5">
      <button
        type="button"
        onClick={open ? () => setOpen(false) : handleOpen}
        className="inline-flex items-center gap-1 rounded-lg bg-ink/10 px-2.5 py-1 text-2xs tracking-flat font-semibold text-ink transition-colors hover:bg-ink/20"
      >
        <Icon size={ICON.sm} strokeWidth={1.5} aria-hidden="true" />
        {triggerLabel}
      </button>

      {open && (
        <form
          onSubmit={handleSubmit}
          className="mt-2 rounded-lg border border-line bg-surface p-3"
          aria-label={triggerLabel}
        >
          <label className="block text-2xs text-ink-3">
            Motivo (obligatorio)
            <textarea
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
              rows={2}
              maxLength={255}
              placeholder={
                accion === "suspender"
                  ? "Por qué se suspende (p. ej. ausencia prolongada)"
                  : "Por qué se reactiva (p. ej. regresó al club)"
              }
              className="mt-0.5 w-full rounded-md border border-line bg-bg px-2 py-1 text-xs text-ink"
              required
            />
          </label>

          {error && <p className="mt-2 text-2xs text-cata-red">{error}</p>}

          <div className="mt-3 flex items-center gap-2">
            <button
              type="submit"
              disabled={loading || !motivo.trim()}
              className="inline-flex items-center gap-1 rounded-lg bg-cata-red px-2.5 py-1 text-2xs tracking-flat font-semibold text-white transition-colors hover:bg-cata-red/90 disabled:opacity-50"
            >
              {loading ? (
                <Loader2 size={ICON.sm} className="animate-spin" aria-hidden="true" />
              ) : (
                <CheckCircle2 size={ICON.sm} strokeWidth={1.5} aria-hidden="true" />
              )}
              {submitLabel}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
