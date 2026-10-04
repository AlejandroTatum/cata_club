/**
 * Dialog for a categoría (or a día) that still has players (ADMB-04).
 *
 * The server refuses to delete a categoría, or remove a día, while players are
 * enrolled (409), so the admin gets two paths here instead of a dead end:
 *   (a) move EVERYONE to ONE target categoría — the page then makes ONE atomic
 *       backend call that moves and deletes (or saves the edit) together;
 *   (b) move players one by one, each to the target the admin picks. Nothing is
 *       deleted until no player remains, then the delete is offered.
 *
 * The component owns only what the admin is choosing and which players already
 * left; every backend call is a prop so the page keeps the one place that
 * knows how to reload, toast and close.
 */

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui";
import { toUserMessage } from "@/lib/error-message";

export interface MoverAlumnosAlumno {
  personaId: number;
  nombre: string;
}

export interface MoverAlumnosDestino {
  codigo: string;
  label: string;
}

interface MoverAlumnosDialogProps {
  title: string;
  /** Why this is blocked, already worded for the scope (group or días). */
  message: string;
  alumnos: MoverAlumnosAlumno[];
  /** Every categoría except the one being emptied. */
  destinos: MoverAlumnosDestino[];
  /** Label of the "move everyone" button, which names what happens after. */
  moveAllLabel: string;
  /** Label of the button offered once no player remains. */
  emptyConfirmLabel: string;
  /** Moves everyone and applies the delete/edit atomically; rejects on failure.
   *  Resolves with `noEliminada` when the players moved but the categoría could
   *  not be deleted (attendance history) — the dialog then offers to hide it. */
  onMoveAll: (destino: string) => Promise<{ noEliminada?: string } | void>;
  /** Hides the categoría from the public page; rejects on failure. */
  onHide: () => Promise<void>;
  /** Moves one player; rejects on failure. */
  onMoveOne: (personaId: number, destino: string) => Promise<void>;
  /** Nothing is left to move: run the plain delete / save. */
  onConfirmEmpty: () => void;
  /** `huboCambios` is true when at least one player was already moved. */
  onClose: (huboCambios: boolean) => void;
}

const FIELD_CONTROL =
  "h-ctl w-full rounded-ctl border border-line-2 bg-paper px-3 text-sm text-ink outline-none focus:border-cata-red";
const FIELD_LABEL = "flex flex-col gap-field text-2xs font-bold uppercase text-ink-3";

function DestinoSelect({
  label,
  value,
  destinos,
  onChange,
  disabled,
}: {
  label: string;
  value: string;
  destinos: MoverAlumnosDestino[];
  onChange: (codigo: string) => void;
  disabled: boolean;
}): React.ReactElement {
  return (
    <select
      aria-label={label}
      value={value}
      disabled={disabled}
      onChange={(event) => onChange(event.target.value)}
      className={FIELD_CONTROL}
    >
      <option value="">Elija una categoría</option>
      {destinos.map((destino) => (
        <option key={destino.codigo} value={destino.codigo}>
          {destino.label}
        </option>
      ))}
    </select>
  );
}

export default function MoverAlumnosDialog({
  title,
  message,
  alumnos,
  destinos,
  moveAllLabel,
  emptyConfirmLabel,
  onMoveAll,
  onHide,
  onMoveOne,
  onConfirmEmpty,
  onClose,
}: MoverAlumnosDialogProps): React.ReactElement {
  const [movidos, setMovidos] = useState<Set<number>>(new Set());
  const [destinoTodos, setDestinoTodos] = useState("");
  const [destinoPorAlumno, setDestinoPorAlumno] = useState<Record<number, string>>({});
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Set when everyone moved but the delete is impossible (history). */
  const [noEliminada, setNoEliminada] = useState<string | null>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  // The listener below must not re-subscribe (and re-focus) on every render,
  // yet it needs the latest `onClose` and count: read both through refs.
  const cerrarRef = useRef<(huboCambios: boolean) => void>(onClose);
  const movidosRef = useRef(movidos);
  useEffect(() => {
    cerrarRef.current = onClose;
    movidosRef.current = movidos;
  });

  const restantes = alumnos.filter((alumno) => !movidos.has(alumno.personaId));
  const sinDestinos = destinos.length === 0;

  useEffect(() => {
    closeRef.current?.focus();
    function onKeyDown(event: KeyboardEvent): void {
      if (event.key === "Escape") cerrarRef.current(movidosRef.current.size > 0);
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  async function moverTodos(): Promise<void> {
    setOcupado(true);
    setError(null);
    try {
      const resultado = await onMoveAll(destinoTodos);
      if (resultado?.noEliminada) setNoEliminada(resultado.noEliminada);
    } catch (err) {
      setError(toUserMessage(err, "No se pudo pasar a los alumnos. No se cambió nada."));
    } finally {
      setOcupado(false);
    }
  }

  async function ocultar(): Promise<void> {
    setOcupado(true);
    setError(null);
    try {
      await onHide();
    } catch (err) {
      setError(toUserMessage(err, "No se pudo ocultar la categoría."));
    } finally {
      setOcupado(false);
    }
  }

  async function moverUno(alumno: MoverAlumnosAlumno): Promise<void> {
    setOcupado(true);
    setError(null);
    try {
      await onMoveOne(alumno.personaId, destinoPorAlumno[alumno.personaId]);
      setMovidos((prev) => new Set(prev).add(alumno.personaId));
    } catch (err) {
      setError(toUserMessage(err, `No se pudo pasar a ${alumno.nombre}.`));
    } finally {
      setOcupado(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-cata-black/40 px-4"
      onClick={() => onClose(movidos.size > 0)}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="mover-alumnos-title"
        aria-describedby="mover-alumnos-message"
        onClick={(event) => event.stopPropagation()}
        className="card flex max-h-[90vh] w-full max-w-lg flex-col gap-4 overflow-y-auto p-6"
      >
        <div>
          <h2 id="mover-alumnos-title" className="text-base font-semibold text-cata-red">{title}</h2>
          <p id="mover-alumnos-message" className="mt-2 text-sm text-cata-text/65">{message}</p>
        </div>

        {error && <div className="alert-error" role="alert">{error}</div>}

        {noEliminada ? (
          <div className="flex flex-col gap-3">
            <p className="text-sm text-ink">{noEliminada}</p>
            <Button variant="primary" disabled={ocupado} onClick={() => void ocultar()}>
              Ocultar de la página pública
            </Button>
          </div>
        ) : restantes.length === 0 ? (
          <div className="flex flex-col gap-3">
            <p className="text-sm text-ink">Ya no quedan alumnos aquí. Puede continuar.</p>
            <Button variant="primary" onClick={onConfirmEmpty}>{emptyConfirmLabel}</Button>
          </div>
        ) : sinDestinos ? (
          <p className="text-sm text-ink">
            No hay otra categoría a la que pasar a los alumnos. Cree una primero.
          </p>
        ) : (
          <>
            <section className="flex flex-col gap-2">
              <h3 className="text-sm font-semibold text-ink">Pasar a todos a una sola categoría</h3>
              <label className={FIELD_LABEL}>
                Categoría de destino
                <DestinoSelect
                  label="Categoría de destino"
                  value={destinoTodos}
                  destinos={destinos}
                  onChange={setDestinoTodos}
                  disabled={ocupado}
                />
              </label>
              <Button
                variant="primary"
                disabled={!destinoTodos || ocupado}
                onClick={() => void moverTodos()}
              >
                {moveAllLabel}
              </Button>
            </section>

            <section className="flex flex-col gap-2">
              <h3 className="text-sm font-semibold text-ink">O pase a cada alumno por separado</h3>
              <ul className="flex max-h-60 flex-col gap-2 overflow-y-auto">
                {restantes.map((alumno) => {
                  const destino = destinoPorAlumno[alumno.personaId] ?? "";
                  return (
                    <li key={alumno.personaId} className="flex flex-wrap items-center gap-2">
                      <span className="min-w-0 flex-1 text-sm text-ink">{alumno.nombre}</span>
                      <div className="w-44">
                        <DestinoSelect
                          label={`Categoría de destino para ${alumno.nombre}`}
                          value={destino}
                          destinos={destinos}
                          onChange={(codigo) =>
                            setDestinoPorAlumno((prev) => ({ ...prev, [alumno.personaId]: codigo }))
                          }
                          disabled={ocupado}
                        />
                      </div>
                      <Button
                        size="sm"
                        aria-label={`Pasar a ${alumno.nombre}`}
                        disabled={!destino || ocupado}
                        onClick={() => void moverUno(alumno)}
                      >
                        Pasar
                      </Button>
                    </li>
                  );
                })}
              </ul>
            </section>
          </>
        )}

        <div className="flex justify-end">
          <Button ref={closeRef} onClick={() => onClose(movidos.size > 0 || noEliminada !== null)} disabled={ocupado}>
            {noEliminada ? "Cerrar" : "Cancelar"}
          </Button>
        </div>
      </div>
    </div>
  );
}
