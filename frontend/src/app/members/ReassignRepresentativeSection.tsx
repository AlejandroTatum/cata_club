/**
 * Reasignar al representante de un menor — comando PRESENCIAL del mostrador
 * (#1133/#1137).
 *
 * Decisión del dueño (2026-09-11, punto 2): una reasignación no puede
 * ejecutarse por autoservicio con solo conocer la cédula; la ejecuta un
 * ADMINISTRADOR con la persona enfrente. Este formulario llama al comando
 * atómico `POST /personas/{id}/reasignar-representante`
 * (`reasignarRepresentante` en `services/api.ts`), distinto del `vincular-
 * representado` que reusa `LinkRepresentativeSection` para el primer alta:
 * este comando conoce el vínculo ACTUAL (`representanteActualId`) y el
 * backend responde 409 si cambió desde que se abrió el trámite, en vez de
 * pisarlo.
 *
 * Solo tiene sentido para un menor que YA tiene representante —
 * `MemberEditDialog` monta `LinkRepresentativeSection` (sin conflicto
 * posible) cuando todavía no tiene ninguno, y esta sección cuando sí.
 */

"use client";

import { useState } from "react";
import { Loader2, Repeat } from "lucide-react";
import { ICON } from "@/lib/icon-size";
import { buttonClasses } from "@/components/ui";
import StudentSearch from "@/components/StudentSearch";
import { reasignarRepresentante } from "@/services/api";
import { toUserMessage } from "@/lib/error-message";
import type { PersonaBusqueda } from "@/types/domain";

interface ReassignRepresentativeSectionProps {
  personaId: number;
  personaNombreCompleto: string;
  representanteActualId: number;
  representanteActualNombre: string;
  /** Refetch the member list so the new link appears in place. */
  onReasignado: () => void;
}

export default function ReassignRepresentativeSection({
  personaId,
  personaNombreCompleto,
  representanteActualId,
  representanteActualNombre,
  onReasignado,
}: ReassignRepresentativeSectionProps): React.ReactElement {
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<PersonaBusqueda | null>(null);
  const [evidenciaIdentidad, setEvidenciaIdentidad] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(): Promise<void> {
    if (!selected) {
      setError("Busque y seleccione al nuevo representante.");
      return;
    }
    if (!evidenciaIdentidad.trim()) {
      setError("La evidencia del trámite es obligatoria.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      await reasignarRepresentante(
        personaId,
        {
          nuevoRepresentanteId: selected.id,
          representanteActualId,
          evidenciaIdentidad: evidenciaIdentidad.trim(),
        },
        crypto.randomUUID(),
      );
      setOpen(false);
      setSelected(null);
      setEvidenciaIdentidad("");
      onReasignado();
    } catch (err: unknown) {
      // El backend habla directo cuando falla — 409 (el vínculo cambió
      // mientras se abría el trámite) o 422 (el destino no cumple la regla
      // de dominio) — así que se muestra tal cual, sin traducirlo.
      setError(toUserMessage(err, "No se pudo reasignar el representante de esta persona."));
    } finally {
      setLoading(false);
    }
  }

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className={buttonClasses("secondary", "sm")}>
        <Repeat size={ICON.sm} strokeWidth={1.5} aria-hidden="true" />
        Reasignar representante
      </button>
    );
  }

  return (
    <div className="space-y-2 rounded-ctl border border-line bg-sunken p-3">
      <p className="text-xs text-ink-3">
        Representante actual: {representanteActualNombre}. Trámite presencial: confirme la
        identidad del nuevo representante de {personaNombreCompleto} en el mostrador.
      </p>
      <StudentSearch
        onSelect={setSelected}
        onClear={() => setSelected(null)}
        placeholder="Buscar nuevo representante por nombre…"
        disabled={loading}
      />
      <label className="block text-sm font-semibold text-ink-2">
        Evidencia del trámite
        <input
          type="text"
          value={evidenciaIdentidad}
          onChange={(e) => setEvidenciaIdentidad(e.target.value)}
          maxLength={500}
          className="mt-0.5 h-ctl w-full rounded-lg border border-line bg-paper px-3 text-sm text-ink"
          placeholder="Cédula verificada en el mostrador"
        />
      </label>
      {error && (
        <p className="text-xs text-state-bad" role="alert">
          {error}
        </p>
      )}
      <div className="flex flex-wrap gap-1.5">
        <button
          type="button"
          onClick={() => void handleSubmit()}
          disabled={loading || !selected}
          className={buttonClasses("primary", "sm")}
        >
          {loading ? (
            <Loader2 size={ICON.sm} className="animate-spin" aria-hidden="true" />
          ) : (
            <Repeat size={ICON.sm} strokeWidth={1.5} aria-hidden="true" />
          )}
          {loading
            ? "Procesando…"
            : selected
              ? `Confirmar reasignación a ${selected.nombres} ${selected.apellidos}`
              : "Confirmar reasignación"}
        </button>
        <button
          type="button"
          onClick={() => {
            setOpen(false);
            setSelected(null);
            setError(null);
          }}
          className={buttonClasses("secondary", "sm")}
        >
          Cancelar
        </button>
      </div>
    </div>
  );
}
