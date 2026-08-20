/**
 * Link an existing representative to a minor from the admin edit panel —
 * issue #460's third discoverability gap.
 *
 * The backend has always allowed an ADMINISTRADOR to call `POST
 * /personas/{representanteId}/vincular-representado`
 * (`backend/app/presentacion/routers/personas_router.py:474`,
 * `PoliticaAccesoPersona.exigir_acceso_directo` with `SOLO_ADMINISTRADOR`) —
 * but no screen in "Miembros → Editar" exposed it: the modal had roles,
 * estado, and per-student membership/ficha médica, and nothing to assign a
 * representante. This reuses the exact endpoint the self-service "Agregar
 * dependiente" flow already calls (`vincularRepresentado` in
 * `services/api.ts`) — no new backend behavior.
 *
 * The endpoint identifies the person being linked by CÉDULA (its body is
 * `{cedula}`), not by id — the representative is the one in the URL path.
 * `MemberEditDialog` is already editing a specific student, so this needs
 * only that student's own cédula (`studentCedula`) plus a way to find the
 * representative: `StudentSearch` (the same by-name autocomplete
 * `/admin/crear-cuenta` already uses for its "representante legal" field),
 * because `GET /personas/buscar` only matches nombres/apellidos — there is
 * no by-cédula lookup exposed to the admin panel.
 */

"use client";

import { useState } from "react";
import { CheckCircle2, Link2, Loader2 } from "lucide-react";
import { ICON } from "@/lib/icon-size";
import { buttonClasses } from "@/components/ui";
import StudentSearch from "@/components/StudentSearch";
import { vincularRepresentado } from "@/services/api";
import { toUserMessage } from "@/lib/error-message";
import type { PersonaBusqueda } from "@/types/domain";

interface LinkRepresentativeSectionProps {
  /** The minor's own cédula — what `vincular-representado`'s body needs. */
  studentCedula?: string;
  /** Current representative's full name, or `undefined` when the minor has none on file. */
  currentRepresentativeName?: string;
  /** Refetch the member list so the new/changed link appears in place. */
  onLinked: () => void;
}

export default function LinkRepresentativeSection({
  studentCedula,
  currentRepresentativeName,
  onLinked,
}: LinkRepresentativeSectionProps): React.ReactElement {
  const [selected, setSelected] = useState<PersonaBusqueda | null>(null);
  const [linking, setLinking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [linked, setLinked] = useState<string | null>(null);

  async function handleLink(): Promise<void> {
    if (!selected || !studentCedula) return;
    setLinking(true);
    setError(null);
    setLinked(null);
    try {
      await vincularRepresentado(selected.id, studentCedula);
      setLinked(`${selected.nombres} ${selected.apellidos}`);
      setSelected(null);
      onLinked();
    } catch (err: unknown) {
      setError(toUserMessage(err, "No se pudo vincular al representante."));
    } finally {
      setLinking(false);
    }
  }

  return (
    <div className="space-y-2">
      <p className="text-xs text-ink-3">
        {currentRepresentativeName
          ? `Representante actual: ${currentRepresentativeName}. Buscar y vincular otro lo reemplaza.`
          : "Este alumno no tiene un representante vinculado."}
      </p>
      {!studentCedula ? (
        // Defensive only — every persona this admin can reach carries a
        // cédula (backend column is NOT NULL); see `BackendPersonaFull`'s own
        // doc comment for why the type still treats it as optional.
        <p className="text-xs text-state-bad" role="alert">
          No se pudo determinar la cédula de este alumno; no es posible vincular un representante desde aquí.
        </p>
      ) : (
        <>
          <StudentSearch
            onSelect={setSelected}
            onClear={() => setSelected(null)}
            placeholder="Buscar representante por nombre…"
            disabled={linking}
          />
          {selected && (
            <button
              type="button"
              onClick={() => void handleLink()}
              disabled={linking}
              className={buttonClasses("primary", "sm")}
            >
              {linking ? (
                <Loader2 size={ICON.sm} className="animate-spin" aria-hidden="true" />
              ) : (
                <Link2 size={ICON.sm} strokeWidth={1.5} aria-hidden="true" />
              )}
              {linking ? "Vinculando…" : `Vincular a ${selected.nombres} ${selected.apellidos}`}
            </button>
          )}
        </>
      )}
      {linked && (
        <p className="flex items-center gap-1 text-xs text-state-ok" role="status">
          <CheckCircle2 size={ICON.sm} strokeWidth={2} aria-hidden="true" />
          Vinculado a {linked}.
        </p>
      )}
      {error && (
        <p className="text-xs text-state-bad" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
