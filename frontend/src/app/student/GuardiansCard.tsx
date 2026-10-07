/**
 * «Representantes» card on the representative's home (`/student`) — issue #1666.
 *
 * A minor can have two guardians: the primary representative and, if the
 * primary wants it, one more (owner decision, max 2). This card is where the
 * PRIMARY invites that second guardian and removes them:
 *
 *  - «Invitar a otro representante» opens ONE form — the invitee's e-mail,
 *    their personal data and, when the primary represents more than one minor,
 *    which of them. The data is always sent: the backend uses it only if the
 *    e-mail has no account and always answers the same neutral 202, so the
 *    form can never reveal whether an e-mail is registered. The invitation
 *    e-mails a one-time link; no password ever travels.
 *  - The current second guardian is listed with «Quitar», confirmed inline
 *    because access is revoked on the next request. While the invitee has not
 *    accepted, the line reads «Invitación pendiente: <correo>» and «Quitar»
 *    cancels it.
 *  - The INVITEE sees «Invitaciones recibidas» with an «Aceptar» per invite
 *    (their own session is the consent); the list is hidden when empty.
 *
 * The button is for the primary only. A second guardian sees a one-line note
 * saying so and no controls; when every minor of the primary already has two
 * guardians the button is disabled with its reason on the line below.
 */

"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, Mail, UserMinus, UserPlus } from "lucide-react";
import LinkifiedText from "@/components/LinkifiedText";
import { buttonClasses } from "@/components/ui";
import { PersonIdentityFields, WizardInput, example } from "@/components/wizard-fields";
import type { PersonIdentityErrors } from "@/components/wizard-fields";
import { useToast } from "@/contexts/ToastContext";
import { toUserMessage } from "@/lib/error-message";
import { ICON } from "@/lib/icon-size";
import {
  cedulaRule,
  isValidEmail,
  normalizePersonName,
  personNameRule,
  phoneRule,
  representativeBirthDateRule,
  toStoredPhone,
} from "@/lib/identity-validation";
import {
  aceptarInvitacionRecibida,
  fetchInvitacionesRecibidas,
  fetchMisMenoresConGuardianes,
  invitarCoRepresentante,
  quitarCoRepresentante,
} from "@/services/api";
import type { DatosInvitadoPayload, InvitacionRecibida, MenorConGuardianes } from "@/services/api";

export const MENSAJE_TOPE_DOS_REPRESENTANTES =
  "Tus hijos ya tienen dos representantes. Quita al segundo para invitar a otra persona.";

/** Same text whatever the backend decided: the card must not reveal whether the e-mail has an account. */
export const MENSAJE_INVITACION_NEUTRO = "Si el correo es válido, enviaremos la invitación.";

/** Field ids are `invitar-<campo>`, the same `idPrefix-field` shape the wizards use. */
const ID_PREFIX = "invitar";

export const MENSAJE_REVISA_CAMPOS = "Revisa los campos marcados.";

type CampoInvitacion = keyof PersonIdentityErrors | "correo";
type ErroresInvitacion = Partial<Record<CampoInvitacion, string>>;

const CAMPOS: CampoInvitacion[] = ["correo", "nombres", "apellidos", "fechaNacimiento", "cedula", "telefono"];

/**
 * The registration's own rules for a representative (`enroll-utils.ts`),
 * applied to the invitee: an invitation can create the same kind of account,
 * so it must accept and reject exactly what the registration does.
 */
function validarInvitacion(correo: string, datos: DatosInvitadoPayload): ErroresInvitacion {
  const errores: Record<CampoInvitacion, string | null> = {
    correo: !correo.trim()
      ? "Escribe el correo de la persona a invitar."
      : isValidEmail(correo)
        ? null
        : "El correo del representante no es válido. Revísalo; debe tener un formato como nombre@ejemplo.com.",
    nombres: personNameRule(datos.nombres, "Los nombres del representante"),
    apellidos: personNameRule(datos.apellidos, "Los apellidos del representante"),
    fechaNacimiento: representativeBirthDateRule(datos.fechaNacimiento),
    cedula: cedulaRule(datos.cedula, "La cédula del representante"),
    telefono: phoneRule(datos.telefono, "El teléfono del representante"),
  };
  return Object.fromEntries(
    Object.entries(errores).filter((entrada): entrada is [CampoInvitacion, string] => entrada[1] !== null),
  );
}

const DATOS_VACIOS: DatosInvitadoPayload = {
  nombres: "",
  apellidos: "",
  cedula: "",
  fechaNacimiento: "",
  telefono: "",
};

function nombreCompleto(persona: { nombres: string | null; apellidos: string | null }): string {
  return `${persona.nombres ?? ""} ${persona.apellidos ?? ""}`.trim();
}

interface InviteFormProps {
  /** Minors of the primary that still have room for a second guardian. */
  elegibles: MenorConGuardianes[];
  onCancel: () => void;
  onDone: () => void;
}

function InviteForm({ elegibles, onCancel, onDone }: InviteFormProps): React.ReactElement {
  const { showSuccess } = useToast();
  const formRef = useRef<HTMLDivElement>(null);
  const [correo, setCorreo] = useState("");
  const [seleccion, setSeleccion] = useState<number[]>(() => elegibles.map((m) => m.personaId));
  const [datos, setDatos] = useState<DatosInvitadoPayload>(DATOS_VACIOS);
  const [touched, setTouched] = useState<Set<CampoInvitacion>>(new Set());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const errores = validarInvitacion(correo, datos);
  // Same as the registration: a field's message appears once the visitor
  // has left it (or tried to send), and disappears as soon as it is fixed.
  const visibles: ErroresInvitacion = Object.fromEntries(
    Object.entries(errores).filter(([campo]) => touched.has(campo as CampoInvitacion)),
  );
  const marcar = (campo: CampoInvitacion): void => setTouched((actual) => new Set(actual).add(campo));
  const cambiar = (campo: keyof DatosInvitadoPayload) => (valor: string) => setDatos({ ...datos, [campo]: valor });

  const alternar = (personaId: number): void =>
    setSeleccion((actual) =>
      actual.includes(personaId) ? actual.filter((id) => id !== personaId) : [...actual, personaId],
    );

  async function handleSubmit(): Promise<void> {
    if (Object.keys(errores).length > 0) {
      setTouched(new Set(CAMPOS));
      setError(MENSAJE_REVISA_CAMPOS);
      // After the re-render that marks the fields, move focus to the first one.
      requestAnimationFrame(() => formRef.current?.querySelector<HTMLElement>("[aria-invalid='true']")?.focus());
      return;
    }
    if (seleccion.length === 0) {
      setError("Elige al menos un hijo.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      await invitarCoRepresentante({
        personaIds: seleccion,
        correo: correo.trim(),
        datos: {
          nombres: normalizePersonName(datos.nombres),
          apellidos: normalizePersonName(datos.apellidos),
          cedula: datos.cedula.trim(),
          fechaNacimiento: datos.fechaNacimiento,
          telefono: datos.telefono.trim(),
        },
      });
      showSuccess(MENSAJE_INVITACION_NEUTRO);
      onDone();
    } catch (err: unknown) {
      setError(toUserMessage(err, "No se pudo enviar la invitación."));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div ref={formRef} className="space-y-3 rounded-ctl border border-line bg-sunken p-3">
      <WizardInput
        idPrefix={ID_PREFIX}
        field="correo"
        label="Correo de la persona a invitar"
        value={correo}
        onChange={setCorreo}
        onBlur={() => marcar("correo")}
        error={visibles.correo}
        disabled={loading}
        type="email"
        required
        placeholder={example("correo@ejemplo.com")}
        icon={<Mail size={ICON.sm} strokeWidth={1.5} aria-hidden="true" />}
        autoComplete="off"
      />
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
      <p className="text-xs text-ink-3">
        Si todavía no tiene cuenta, la creamos con estos datos y le llega un enlace de un solo uso para
        elegir su contraseña.
      </p>
      <PersonIdentityFields
        idPrefix={ID_PREFIX}
        disabled={loading}
        nombres={datos.nombres}
        apellidos={datos.apellidos}
        fechaNacimiento={datos.fechaNacimiento}
        cedula={datos.cedula}
        // `PhoneField` speaks the local digits after +593; the payload keeps the stored `0…` form.
        telefono={datos.telefono.replace(/^0/, "")}
        onNombresChange={cambiar("nombres")}
        onApellidosChange={cambiar("apellidos")}
        onFechaNacimientoChange={cambiar("fechaNacimiento")}
        onCedulaChange={cambiar("cedula")}
        onTelefonoChange={(digitos) => cambiar("telefono")(toStoredPhone(digitos))}
        errors={visibles}
        onFieldBlur={marcar}
      />
      {error && !(error === MENSAJE_REVISA_CAMPOS && Object.keys(errores).length === 0) && (
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
          {loading ? "Enviando…" : "Enviar invitación"}
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
  const [recibidas, setRecibidas] = useState<InvitacionRecibida[]>([]);
  const [aceptando, setAceptando] = useState<number | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [confirmando, setConfirmando] = useState<number | null>(null);
  const [quitando, setQuitando] = useState(false);

  const cargar = useCallback(async (): Promise<void> => {
    // The card is supplementary: if either list cannot load, the portal stays
    // usable and the other list still shows.
    const [guardianes, invitaciones] = await Promise.allSettled([
      fetchMisMenoresConGuardianes(),
      fetchInvitacionesRecibidas(),
    ]);
    setMenores((actual) => (guardianes.status === "fulfilled" ? guardianes.value : (actual ?? [])));
    setRecibidas((actual) => (invitaciones.status === "fulfilled" ? invitaciones.value : actual));
  }, []);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  if (menores === null || (menores.length === 0 && recibidas.length === 0)) return null;

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

  async function aceptar(invitacion: InvitacionRecibida): Promise<void> {
    setAceptando(invitacion.id);
    try {
      await aceptarInvitacionRecibida(invitacion.id);
      showSuccess(`Aceptaste ser representante de ${invitacion.nombreMenor}.`);
      await cargar();
    } catch (err: unknown) {
      showError(toUserMessage(err, "No se pudo aceptar la invitación."));
    } finally {
      setAceptando(null);
    }
  }

  return (
    <section aria-label="Representantes" className="card flex flex-col overflow-hidden">
      <div className="border-b border-line px-5 py-3">
        <h2 className="font-display text-lg uppercase leading-tight tracking-flat text-ink">Representantes</h2>
      </div>
      <div className="flex flex-col gap-3 px-5 py-4">
        {recibidas.length > 0 && (
          <div className="flex flex-col gap-2 rounded-ctl border border-line bg-sunken p-3">
            <h3 className="text-sm font-semibold text-ink">Invitaciones recibidas</h3>
            <ul className="flex flex-col gap-2">
              {recibidas.map((invitacion) => (
                <li key={invitacion.id} className="flex flex-wrap items-center justify-between gap-2 text-sm text-ink-2">
                  <span>
                    {invitacion.nombreInvitante} te invitó a ser representante de {invitacion.nombreMenor}.
                  </span>
                  <button
                    type="button"
                    disabled={aceptando !== null}
                    onClick={() => void aceptar(invitacion)}
                    className={buttonClasses("primary", "sm")}
                    aria-label={`Aceptar invitación para ${invitacion.nombreMenor}`}
                  >
                    Aceptar
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
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
                    {menor.segundoGuardian.estado === "PENDIENTE"
                      ? `Invitación pendiente: ${menor.segundoGuardian.correo ?? ""}`
                      : `Segundo representante: ${nombreCompleto(menor.segundoGuardian)}${
                          menor.segundoGuardian.correo ? ` (${menor.segundoGuardian.correo})` : ""
                        }`}
                  </span>
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
