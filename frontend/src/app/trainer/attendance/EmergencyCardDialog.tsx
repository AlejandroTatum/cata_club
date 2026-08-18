/**
 * EmergencyCardDialog — issue #360.
 *
 * A trainer running a session has no way to call anyone or tell a paramedic
 * anything useful if an alumno gets hurt mid-training. This is the one
 * on-demand lookup that closes that gap: tap the alert on a roster row,
 * get exactly the seven fields `fetchFichaEmergencia` returns, nothing else.
 *
 * ## Why on-demand, not bundled into the roster
 *
 * The roster fetch (`fetchAlumnosPorHorario`) stays untouched. Fetching this
 * per-tap instead of per-row means there is no N+1 to guard: one open is one
 * `fetchFichaEmergencia(id)` call for exactly the alumno the trainer tapped,
 * never one query per row on every roster render.
 *
 * ## Why no confirmation
 *
 * The issue is explicit: "en una emergencia cada segundo cuenta y una
 * compuerta extra es daño, no protección." Opening the card is one tap;
 * closing it is one tap or Escape. The protection is the audit trail the
 * backend writes on every successful read, not a gate here.
 *
 * ## The missing-ficha-médica case
 *
 * `tipoSangre`/`alergias`/`contactoEmergencia`/`telefonoEmergencia` all
 * `null` is not a fetch failure — it is what the backend returns when an
 * alumno has no ficha médica registered yet. The screen must never go blank
 * or show an error for that; the representative's contact (always present
 * for a menor) is what carries the emergency instead.
 *
 * ## Cuando tampoco hay representante — issue #362
 *
 * "Always present for a menor" resultó ser falso, y está medido: de 66 alumnos
 * con horario, 24 no tienen NI ficha médica NI representante legal. Para esos
 * 24 los seis campos llegan en null y la tarjeta salía en blanco — seis
 * renglones que dicen "No registra" y nada más.
 *
 * Eso es peor que inútil. El entrenador abre esta tarjeta en el minuto en que
 * ya es tarde, y una lista de vacíos lo deja deduciendo solo si el hueco es del
 * sistema o del club. El padrón no trae bandera de "tiene ficha" y no se va a
 * inventar una, así que este diálogo es el único lugar donde se puede decir qué
 * falta y a quién pedírselo. Ver `estaCompletamenteVacia` abajo.
 */

"use client";

import { useEffect, useRef, useState } from "react";
import { AlertTriangle } from "lucide-react";
import { fetchFichaEmergencia, type FichaEmergencia } from "@/services/api";
import { ICON } from "@/lib/icon-size";
import Button from "@/components/ui/Button";
import DataBox from "@/components/ui/DataBox";
import EmptyState from "@/components/ui/EmptyState";
import ErrorState from "@/components/ui/ErrorState";
import LoadingState from "@/components/ui/LoadingState";

export interface EmergencyCardStudent {
  id: number;
  name: string;
}

export interface EmergencyCardDialogProps {
  /** The tapped roster row, or `null` when the dialog is closed. */
  student: EmergencyCardStudent | null;
  onClose: () => void;
}

type CargaEstado =
  | { tipo: "cargando" }
  | { tipo: "error" }
  | { tipo: "lista"; ficha: FichaEmergencia };

function Campo({
  etiqueta,
  valor,
}: {
  etiqueta: string;
  valor: string | null;
}): React.ReactElement {
  return (
    <div className="flex flex-col gap-1 border-b border-line px-5 py-3 last:border-b-0">
      <span className="text-2xs font-bold uppercase tracking-flat text-ink-3">{etiqueta}</span>
      {valor ? (
        <span className="text-sm font-semibold text-ink">{valor}</span>
      ) : (
        <span className="text-sm text-ink-3">No registra</span>
      )}
    </div>
  );
}

/**
 * Los SEIS campos accionables en null — no hay a quién llamar ni qué decirle a
 * un paramédico.
 *
 * `alumnoNombreCompleto` queda fuera a propósito: lo trae siempre y no sirve
 * para nada en una emergencia, así que contarlo haría que la tarjeta nunca se
 * declare vacía. La cadena en blanco cuenta como ausente igual que el null: un
 * `contacto_emergencia` con un espacio no es un teléfono.
 */
function estaCompletamenteVacia(ficha: FichaEmergencia): boolean {
  return [
    ficha.tipoSangre,
    ficha.alergias,
    ficha.contactoEmergencia,
    ficha.telefonoEmergencia,
    ficha.representanteNombreCompleto,
    ficha.representanteTelefono,
  ].every((valor) => !valor?.trim());
}

export default function EmergencyCardDialog({
  student,
  onClose,
}: EmergencyCardDialogProps): React.ReactElement | null {
  const [estado, setEstado] = useState<CargaEstado>({ tipo: "cargando" });
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const triggerElementRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!student) return;
    let cancelado = false;
    setEstado({ tipo: "cargando" });
    fetchFichaEmergencia(student.id)
      .then((ficha) => {
        if (!cancelado) setEstado({ tipo: "lista", ficha });
      })
      .catch((err: unknown) => {
        console.error("[trainer/attendance] fetchFichaEmergencia failed", err);
        if (!cancelado) setEstado({ tipo: "error" });
      });
    return (): void => {
      cancelado = true;
    };
    // `reintentar` below bumps this same effect by recreating `student`'s
    // identity is NOT how retry works here — retry re-runs deliberately via
    // the button's own handler, see below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [student?.id]);

  // Focus the close control on open, Escape closes, focus returns to the
  // trigger on close — same pattern as `ConfirmDialog`, minus the second
  // (confirm) button: viewing this data is not an action to confirm.
  useEffect(() => {
    if (!student) return;
    triggerElementRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeButtonRef.current?.focus();

    function handleKeyDown(event: KeyboardEvent): void {
      if (event.key === "Escape") onClose();
    }

    document.addEventListener("keydown", handleKeyDown);
    return (): void => {
      document.removeEventListener("keydown", handleKeyDown);
      triggerElementRef.current?.focus();
    };
  }, [student, onClose]);

  if (!student) return null;

  function reintentar(): void {
    setEstado({ tipo: "cargando" });
    fetchFichaEmergencia(student!.id)
      .then((ficha) => setEstado({ tipo: "lista", ficha }))
      .catch((err: unknown) => {
        console.error("[trainer/attendance] fetchFichaEmergencia retry failed", err);
        setEstado({ tipo: "error" });
      });
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-cata-black/40 px-4"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="emergency-card-title"
        onClick={(event) => event.stopPropagation()}
        className="card w-full max-w-md overflow-hidden p-0"
      >
        <div className="flex items-center gap-3 border-b border-line bg-state-bad-bg px-5 py-4">
          <span
            aria-hidden="true"
            className="flex h-9 w-9 flex-none items-center justify-center rounded-full bg-paper text-state-bad"
          >
            <AlertTriangle size={ICON.base} strokeWidth={1.5} />
          </span>
          <div className="min-w-0 flex-1">
            <h2 id="emergency-card-title" className="truncate text-base font-bold text-ink">
              Ficha de emergencia
            </h2>
            <p className="truncate text-xs text-ink-3">{student.name}</p>
          </div>
        </div>

        <div className="max-h-[70vh] overflow-y-auto">
          {estado.tipo === "cargando" && (
            <LoadingState label={`Cargando la ficha de emergencia de ${student.name}…`} />
          )}

          {estado.tipo === "error" && (
            <div className="p-5">
              <ErrorState
                title="No se pudo cargar la ficha de emergencia"
                message="Revise su conexión e intente nuevamente."
                onRetry={reintentar}
              />
            </div>
          )}

          {/*
           * El vacío total se dice, no se deja deducir. Sin `role="alert"` y
           * sin botón de reintentar: no es una falla de carga, y reintentar no
           * trae un dato que nadie cargó — ofrecerlo mandaría al entrenador a
           * golpear un botón inútil en el peor momento posible.
           */}
          {estado.tipo === "lista" && estaCompletamenteVacia(estado.ficha) && (
            <div data-testid="emergency-card-empty">
              <EmptyState
                surface="inset"
                icon={<AlertTriangle size={ICON.lg} strokeWidth={1.5} aria-hidden="true" />}
                title="Sin datos de emergencia"
                description={`El club no tiene cargada la ficha médica de ${student.name} ni un representante legal, así que esta tarjeta no puede decirle a quién llamar. Pídalos en secretaría antes del próximo entrenamiento.`}
              />
            </div>
          )}

          {estado.tipo === "lista" && !estaCompletamenteVacia(estado.ficha) && (
            <div className="flex flex-col">
              <Campo etiqueta="Tipo de sangre" valor={estado.ficha.tipoSangre} />
              <Campo etiqueta="Alergias" valor={estado.ficha.alergias} />
              <div className="flex flex-col gap-1 border-b border-line px-5 py-3">
                <span className="text-2xs font-bold uppercase tracking-flat text-ink-3">
                  Contacto de emergencia
                </span>
                {estado.ficha.contactoEmergencia || estado.ficha.telefonoEmergencia ? (
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-semibold text-ink">
                      {estado.ficha.contactoEmergencia ?? "No registra"}
                    </span>
                    {estado.ficha.telefonoEmergencia && (
                      <DataBox>{estado.ficha.telefonoEmergencia}</DataBox>
                    )}
                  </div>
                ) : (
                  <span className="text-sm text-ink-3">No registra</span>
                )}
              </div>
              <div className="flex flex-col gap-1 px-5 py-3">
                <span className="text-2xs font-bold uppercase tracking-flat text-ink-3">
                  Representante legal (respaldo)
                </span>
                {estado.ficha.representanteNombreCompleto || estado.ficha.representanteTelefono ? (
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-semibold text-ink">
                      {estado.ficha.representanteNombreCompleto ?? "No registra"}
                    </span>
                    {estado.ficha.representanteTelefono && (
                      <DataBox>{estado.ficha.representanteTelefono}</DataBox>
                    )}
                  </div>
                ) : (
                  <span className="text-sm text-ink-3">No registra</span>
                )}
              </div>
            </div>
          )}
        </div>

        <div className="flex justify-end border-t border-line px-5 py-3">
          <Button ref={closeButtonRef} onClick={onClose}>
            Cerrar
          </Button>
        </div>
      </div>
    </div>
  );
}
