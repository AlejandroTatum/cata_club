/**
 * «Representantes» card on the representative's home (`/student`) — issue #1666.
 *
 * A minor can have two guardians: the primary representative and, if the
 * primary wants it, one more (owner decision, max 2). This card is where the
 * PRIMARY invites that second guardian and removes them:
 *
 *  - «Invitar a otro representante» opens a short form — the invitee's e-mail
 *    and, when the primary represents more than one minor, which of them. If
 *    the e-mail has no account yet the backend answers `REQUIERE_DATOS` and the
 *    form asks for the few fields needed to create one (the invitation creates
 *    the account and e-mails a one-time set-password link; no password ever
 *    travels).
 *  - The current second guardian is listed with «Quitar», confirmed inline
 *    because access is revoked on the next request.
 *
 * The button is for the primary only. A second guardian sees a one-line note
 * saying so and no controls; when every minor of the primary already has two
 * guardians the button is disabled with its reason on the line below.
 */

"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2, UserMinus, UserPlus } from "lucide-react";
import LinkifiedText from "@/components/LinkifiedText";
import { Badge, buttonClasses } from "@/components/ui";
import { useToast } from "@/contexts/ToastContext";
import { toUserMessage } from "@/lib/error-message";
import { ICON } from "@/lib/icon-size";
import {
  fetchMisMenoresConGuardianes,
  invitarCoRepresentante,
  quitarCoRepresentante,
} from "@/services/api";
import type { DatosInvitadoPayload, MenorConGuardianes } from "@/services/api";

export const MENSAJE_TOPE_DOS_REPRESENTANTES =
  "Tus hijos ya tienen dos representantes. Quita al segundo para invitar a otra persona.";

const INPUT_CLASS = "mt-0.5 h-ctl w-full rounded-lg border border-line bg-paper px-3 text-sm text-ink";

const DATOS_VACIOS: DatosInvitadoPayload = {
  nombres: "",
  apellidos: "",
  cedula: "",
  fechaNacimiento: "",
  telefono: "",
};

function nombreCompleto(persona: { nombres: string; apellidos: string }): string {
  return `${persona.nombres} ${persona.apellidos}`.trim();
}

interface InviteFormProps {
  /** Minors of the primary that still have room for a second guardian. */
  elegibles: MenorConGuardianes[];
  onCancel: () => void;
  onDone: () => void;
}

function InviteForm({ elegibles, onCancel, onDone }: InviteFormProps): React.ReactElement {
  const { showSuccess } = useToast();
  const [correo, setCorreo] = useState("");
  const [seleccion, setSeleccion] = useState<number[]>(() => elegibles.map((m) => m.personaId));
  const [datos, setDatos] = useState<DatosInvitadoPayload>(DATOS_VACIOS);
  const [pideDatos, setPideDatos] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const alternar = (personaId: number): void =>
    setSeleccion((actual) =>
      actual.includes(personaId) ? actual.filter((id) => id !== personaId) : [...actual, personaId],
    );
  const campo = (nombre: keyof DatosInvitadoPayload) => ({
    value: datos[nombre],
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => setDatos({ ...datos, [nombre]: e.target.value }),
  });

  async function handleSubmit(): Promise<void> {
    if (!correo.trim()) {
      setError("Escribe el correo de la persona a invitar.");
      return;
    }
    if (seleccion.length === 0) {
      setError("Elige al menos un hijo.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const resultado = await invitarCoRepresentante({
        personaIds: seleccion,
        correo: correo.trim(),
        ...(pideDatos ? { datos } : {}),
      });
      if (resultado.estado === "REQUIERE_DATOS") {
        setPideDatos(true);
        return;
      }
      showSuccess(
        resultado.estado === "INVITADO"
          ? `Enviamos la invitación a ${correo.trim()}. Creará su contraseña desde el enlace del correo.`
          : `${correo.trim()} ya tenía cuenta de representante y quedó agregado.`,
      );
      onDone();
    } catch (err: unknown) {
      setError(toUserMessage(err, "No se pudo enviar la invitación."));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-2 rounded-ctl border border-line bg-sunken p-3">
      <label className="block text-sm font-semibold text-ink-2">
        Correo de la persona a invitar
        <input
          type="email"
          value={correo}
          onChange={(e) => setCorreo(e.target.value)}
          className={INPUT_CLASS}
          placeholder="correo@ejemplo.com"
          autoComplete="off"
        />
      </label>
      {elegibles.length > 1 && (
        <fieldset className="space-y-1">
          <legend className="text-sm font-semibold text-ink-2">¿De cuál hijo será representante?</legend>
          {elegibles.map((menor) => (
            <label key={menor.personaId} className="flex items-center gap-2 text-sm text-ink-2">
              <input
                type="checkbox"
                checked={seleccion.includes(menor.personaId)}
                onChange={() => alternar(menor.personaId)}
              />
              {nombreCompleto(menor)}
            </label>
          ))}
        </fieldset>
      )}
      {elegibles.length === 1 && (
        <p className="text-xs text-ink-3">Será representante de {nombreCompleto(elegibles[0])}.</p>
      )}
      {pideDatos && (
        <div className="space-y-2">
          <p className="text-xs text-ink-3" role="status">
            Ese correo todavía no tiene cuenta. Completa los datos para crearla: le llegará un enlace de
            un solo uso para elegir su contraseña.
          </p>
          <label className="block text-sm font-semibold text-ink-2">
            Nombres
            <input type="text" className={INPUT_CLASS} {...campo("nombres")} />
          </label>
          <label className="block text-sm font-semibold text-ink-2">
            Apellidos
            <input type="text" className={INPUT_CLASS} {...campo("apellidos")} />
          </label>
          <label className="block text-sm font-semibold text-ink-2">
            Cédula
            <input type="text" inputMode="numeric" className={INPUT_CLASS} {...campo("cedula")} />
          </label>
          <label className="block text-sm font-semibold text-ink-2">
            Fecha de nacimiento
            <input type="date" className={INPUT_CLASS} {...campo("fechaNacimiento")} />
          </label>
          <label className="block text-sm font-semibold text-ink-2">
            Teléfono
            <input type="tel" className={INPUT_CLASS} {...campo("telefono")} />
          </label>
        </div>
      )}
      {error && (
        <p className="text-xs text-state-bad" role="alert">
          <LinkifiedText text={error} />
        </p>
      )}
      <div className="flex flex-wrap gap-1.5">
        <button
          type="button"
          onClick={() => void handleSubmit()}
          disabled={loading}
          className={buttonClasses("primary", "sm")}
        >
          {loading ? (
            <Loader2 size={ICON.sm} className="animate-spin" aria-hidden="true" />
          ) : (
            <UserPlus size={ICON.sm} strokeWidth={1.5} aria-hidden="true" />
          )}
          {loading ? "Enviando…" : pideDatos ? "Crear cuenta e invitar" : "Enviar invitación"}
        </button>
        <button type="button" onClick={onCancel} className={buttonClasses("secondary", "sm")}>
          Cancelar
        </button>
      </div>
    </div>
  );
}

export default function GuardiansCard(): React.ReactElement | null {
  const { showSuccess, showError } = useToast();
  const [menores, setMenores] = useState<MenorConGuardianes[] | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [confirmando, setConfirmando] = useState<number | null>(null);
  const [quitando, setQuitando] = useState(false);

  const cargar = useCallback(async (): Promise<void> => {
    try {
      setMenores(await fetchMisMenoresConGuardianes());
    } catch {
      // The card is supplementary: if it cannot load, the portal stays usable.
      setMenores((actual) => actual ?? []);
    }
  }, []);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  if (menores === null || menores.length === 0) return null;

  const comoPrincipal = menores.filter((m) => m.rol === "PRINCIPAL");
  const elegibles = comoPrincipal.filter((m) => !m.completo);

  async function quitar(menor: MenorConGuardianes): Promise<void> {
    setQuitando(true);
    try {
      await quitarCoRepresentante(menor.personaId);
      showSuccess(`Quitaste al segundo representante de ${nombreCompleto(menor)}. Ya no tiene acceso.`);
      setConfirmando(null);
      await cargar();
    } catch (err: unknown) {
      showError(toUserMessage(err, "No se pudo quitar al segundo representante."));
    } finally {
      setQuitando(false);
    }
  }

  return (
    <section aria-label="Representantes" className="card flex flex-col overflow-hidden">
      <div className="border-b border-line px-5 py-3">
        <h2 className="font-display text-lg uppercase leading-tight tracking-flat text-ink">Representantes</h2>
      </div>
      <div className="flex flex-col gap-3 px-5 py-4">
        <ul className="flex flex-col gap-2">
          {menores.map((menor) => (
            <li key={menor.personaId} className="flex flex-col gap-1 text-sm text-ink-2">
              <span className="font-semibold text-ink">{nombreCompleto(menor)}</span>
              {menor.rol === "SEGUNDO" ? (
                <span className="text-ink-3">
                  Eres su segundo representante: puedes verlo todo y pagar. La ficha médica y los
                  consentimientos los firma el representante principal.
                </span>
              ) : menor.segundoGuardian ? (
                <span className="flex flex-wrap items-center gap-2">
                  <span>
                    Segundo representante: {nombreCompleto(menor.segundoGuardian)}
                    {menor.segundoGuardian.correo ? ` (${menor.segundoGuardian.correo})` : ""}
                  </span>
                  {menor.segundoGuardian.estado === "PENDIENTE" && <Badge tone="warn">Invitación pendiente</Badge>}
                  {confirmando === menor.personaId ? (
                    <span className="flex flex-wrap items-center gap-1.5">
                      <span className="text-xs text-ink-3">
                        Perderá el acceso de inmediato.
                      </span>
                      <button
                        type="button"
                        disabled={quitando}
                        onClick={() => void quitar(menor)}
                        className={buttonClasses("primary", "sm")}
                      >
                        Confirmar
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirmando(null)}
                        className={buttonClasses("secondary", "sm")}
                      >
                        Cancelar
                      </button>
                    </span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setConfirmando(menor.personaId)}
                      className={buttonClasses("secondary", "sm")}
                      aria-label={`Quitar al segundo representante de ${nombreCompleto(menor)}`}
                    >
                      <UserMinus size={ICON.sm} strokeWidth={1.5} aria-hidden="true" />
                      Quitar
                    </button>
                  )}
                </span>
              ) : (
                <span className="text-ink-3">Sin segundo representante.</span>
              )}
            </li>
          ))}
        </ul>

        {comoPrincipal.length > 0 &&
          (formOpen && elegibles.length > 0 ? (
            <InviteForm
              elegibles={elegibles}
              onCancel={() => setFormOpen(false)}
              onDone={() => {
                setFormOpen(false);
                void cargar();
              }}
            />
          ) : (
            <div className="flex flex-col gap-1">
              <button
                type="button"
                onClick={() => setFormOpen(true)}
                disabled={elegibles.length === 0}
                className={buttonClasses("secondary")}
              >
                <UserPlus size={ICON.sm} strokeWidth={1.5} aria-hidden="true" />
                Invitar a otro representante
              </button>
              {elegibles.length === 0 && <p className="text-xs text-ink-3">{MENSAJE_TOPE_DOS_REPRESENTANTES}</p>}
            </div>
          ))}
      </div>
    </section>
  );
}
