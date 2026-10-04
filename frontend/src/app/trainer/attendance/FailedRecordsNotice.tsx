import { AlertTriangle } from "lucide-react";
import { ICON } from "@/lib/icon-size";
import type { SessionStudent } from "./attendance-utils";
import type { RegisterAttendanceResult } from "@/services/api";

interface FailedRecordsNoticeProps {
  failed: RegisterAttendanceResult["failed"];
  students: SessionStudent[];
}

/** Past this many, already-registered students are summarised, not enumerated (ENT-03). */
const MAX_LISTED_ALREADY_REGISTERED = 5;

/**
 * NAME the students (issue #213 decision 3) — this used to say "N registro(s)
 * no se pudieron guardar" and ask the trainer to retry for names it refused
 * to identify. An id with no matching row falls back to the id itself rather
 * than disappearing, because a partially-named failure is still more
 * actionable than a count.
 *
 * ENT-04: a student who ALREADY had a record (first registration wins) is not
 * a failure to retry — it is said apart, with who recorded them, so the trainer
 * knows the roster will refresh and only the missing students are left.
 */
export default function FailedRecordsNotice({
  failed,
  students,
}: FailedRecordsNoticeProps): React.ReactElement {
  const nameById = new Map(students.map((s) => [s.id, s.name]));
  const nameOf = (personaId: number): string => nameById.get(String(personaId)) ?? `Jugador #${personaId}`;
  const alreadyRegistered = failed.filter((f) => f.alreadyRegistered);
  const unsaved = failed.filter((f) => !f.alreadyRegistered);
  // ENT-03: a long list pushed the summary off screen — one line naming who filed it instead.
  const summarised = alreadyRegistered.length > MAX_LISTED_ALREADY_REGISTERED;
  const alreadyRegisteredBy = alreadyRegistered.find((f) => f.registradoPorNombre)?.registradoPorNombre ?? null;

  return (
    <div role="alert" className="rounded-ctl border border-state-warn/25 bg-state-warn-bg p-3.5 text-xs text-state-warn">
      {unsaved.length > 0 && (
        <>
          <p className="flex items-center gap-1.5 font-bold">
            <AlertTriangle size={ICON.sm} strokeWidth={2} aria-hidden="true" />
            {unsaved.length === 1
              ? "No se pudo guardar 1 registro"
              : `No se pudieron guardar ${unsaved.length} registros`}
          </p>
          <ul className="mt-1.5 list-inside list-disc font-semibold">
            {unsaved.map((f) => (
              <li key={f.personaId}>{nameOf(f.personaId)}</li>
            ))}
          </ul>
        </>
      )}
      {alreadyRegistered.length > 0 && (
        <>
          <p className={`flex items-center gap-1.5 font-bold ${unsaved.length > 0 ? "mt-3" : ""}`}>
            <AlertTriangle size={ICON.sm} strokeWidth={2} aria-hidden="true" />
            {alreadyRegistered.length === 1
              ? "1 jugador ya estaba registrado"
              : `${alreadyRegistered.length} jugadores ya estaban registrados`}
            {summarised && alreadyRegisteredBy ? ` por ${alreadyRegisteredBy}` : ""}
          </p>
          {summarised ? null : (
            <ul className="mt-1.5 list-inside list-disc font-semibold">
              {alreadyRegistered.map((f) => (
                <li key={f.personaId}>
                  {nameOf(f.personaId)}
                  {f.registradoPorNombre ? ` — registrado por ${f.registradoPorNombre}` : ""}
                </li>
              ))}
            </ul>
          )}
          <p className="mt-1.5 text-state-warn/80">
            Otra persona tomó la lista al mismo tiempo; se conserva el primer registro de cada alumno.
          </p>
        </>
      )}
      {unsaved.length > 0 && (
        <p className="mt-1.5 text-state-warn/80">
          Actualiza la lista de este horario y completa solo a los jugadores que faltan — el resto ya
          quedó guardado.
        </p>
      )}
    </div>
  );
}
