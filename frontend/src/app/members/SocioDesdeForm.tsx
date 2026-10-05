/**
 * «Socio desde» — the admin sets the real date a member joined the club.
 *
 * A migrated member is enrolled on the launch day but has played for years;
 * the student's «Jugador desde» (member card, membership card, profile)
 * reads this date instead of the enrollment one. Never touches coverage or
 * debt. Admin-only by construction: the members page is `allowedRoles=["admin"]`
 * and the backend demands ADMINISTRADOR.
 */

"use client";

import LinkifiedText from "@/components/LinkifiedText";
import { useState } from "react";
import { CheckCircle2, Loader2 } from "lucide-react";
import { ICON } from "@/lib/icon-size";
import { useToast } from "@/contexts/ToastContext";
import { establecerSocioDesde } from "@/services/api";
import { clubIsoDate } from "@/lib/club-date";
import { formatDate } from "@/lib/format-utils";
import { toUserMessage } from "@/lib/error-message";
import CampoFormularioAdmin from "@/components/admin/CampoFormularioAdmin";
import { ACTION_TRIGGER } from "./payment-action-styles";

interface SocioDesdeFormProps {
  personaId: number;
  /** Current «Socio desde» as the backend returned it (ISO date or timestamp), if any. */
  actual?: string | null;
  /** Refetch the member list so the new date shows in place. */
  onChanged: () => void;
}

export default function SocioDesdeForm({ personaId, actual, onChanged }: SocioDesdeFormProps): React.ReactElement {
  const { showSuccess, showError } = useToast();
  const [fecha, setFecha] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const hoy = clubIsoDate();

  async function handleSubmit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    if (!fecha) return;
    if (fecha > hoy) {
      setError("La fecha de socio no puede ser futura.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      await establecerSocioDesde(personaId, fecha);
      showSuccess("Fecha de socio guardada correctamente.");
      setFecha("");
      onChanged();
    } catch (err) {
      const message = toUserMessage(err, "No se pudo guardar la fecha de socio.");
      setError(message);
      showError(message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} aria-label="Socio desde" className="grid gap-2">
      <p className="text-xs text-ink-2">
        Socio desde: <b className="text-ink">{actual ? formatDate(actual) : "—"}</b>
      </p>
      <CampoFormularioAdmin
        label="Nueva fecha de ingreso al club"
        type="date"
        value={fecha}
        onChange={(value) => {
          setFecha(value);
          setError(null);
        }}
        dateMax={hoy}
        required
      />
      {error && <p className="text-2xs text-cata-red"><LinkifiedText text={error} /></p>}
      <div>
        <button
          type="submit"
          disabled={loading || !fecha}
          className={`${ACTION_TRIGGER} disabled:opacity-50`}
        >
          {loading ? (
            <Loader2 size={ICON.sm} className="animate-spin" aria-hidden="true" />
          ) : (
            <CheckCircle2 size={ICON.sm} strokeWidth={1.5} aria-hidden="true" />
          )}
          Guardar fecha
        </button>
      </div>
    </form>
  );
}
