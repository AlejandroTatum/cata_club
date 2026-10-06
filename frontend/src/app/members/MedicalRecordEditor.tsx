"use client";

import LinkifiedText from "@/components/LinkifiedText";
import { useState, useEffect, useRef, type ReactNode } from "react";
import { Loader2, Save, CheckCircle2, Stethoscope, Pencil, X } from "lucide-react";
import { ICON } from "@/lib/icon-size";
import { fetchFichaMedica, fetchFichaEmergencia, actualizarFichaMedica } from "@/services/api";
import { useToast } from "@/contexts/ToastContext";
import { Badge, Button, ErrorState, LoadingState, PAGE_RAIL, cn } from "@/components/ui";
import EmergencyCard, { type EmergencyCardValues } from "./EmergencyCard";
import type { FichaMedicaEditable, TipoSangre } from "@/types/domain";
import { toUserMessage, isNotFound } from "@/lib/error-message";
import { phoneFieldRule, toPhoneFieldDigits, toStoredPhone } from "@/lib/identity-validation";
import { PhoneField } from "@/components/wizard-fields";
import {
  ALERGIAS_REQUIRED,
  ENFERMEDADES_REQUIRED,
  NINGUNO_HELP,
  describeAlergias,
  describeEnfermedades,
  enfermedadesInputValue,
  hasEnfermedadesInput,
  requiredFichaTextError,
} from "@/lib/ficha-declaration";

/**
 * The blood types this editor OFFERS (issue #643).
 *
 * `DESCONOCIDO` is absent, and its absence is the change. It used to sit here
 * and be pre-selected, so a record could be written whose blood type was
 * literally "I don't know" — and every screen downstream read that as a
 * complete record. It remains a valid `TipoSangre` for DISPLAY, because rows
 * written before this rule still hold it and no migration invents a real value
 * for them; see `etiquetaTipoSangre`, which still labels it in read mode.
 */
const TIPOS_SANGRE: TipoSangre[] = [
  "A_POSITIVO",
  "A_NEGATIVO",
  "B_POSITIVO",
  "B_NEGATIVO",
  "AB_POSITIVO",
  "AB_NEGATIVO",
  "O_POSITIVO",
  "O_NEGATIVO",
];

/** What the select holds before a choice is made — never a stored value. */
type TipoSangreElegido = TipoSangre | "";

/**
 * El único lugar donde el enum del backend se vuelve texto legible.
 *
 * La fila de lectura y la opción del select nombran el mismo dato, así que si
 * cada una lo formatea por su cuenta la pantalla se contradice sola al pasar
 * de reposo a edición ("O POSITIVO" arriba, "O_POSITIVO" abajo).
 */
function etiquetaTipoSangre(tipo: TipoSangre): string {
  return tipo.replace("_", " ");
}

/**
 * La ficha guardada, traducida a los cinco valores que llevan los inputs.
 *
 * Vive fuera del componente porque es la ÚNICA traducción, y la usan dos
 * caminos que no se ven entre sí: la carga inicial y «Cancelar». Escrita
 * adentro de cada uno, el día que aparezca un sexto campo uno de los dos se
 * queda atrás — y el que se quedaría atrás es el de cancelar, que nadie mira
 * hasta que descarta un cambio y el valor viejo no vuelve.
 */
function camposDe(ficha: FichaMedicaEditable): {
  tipoSangre: TipoSangreElegido;
  enfermedades: string;
  alergias: string;
  contactoEmergencia: string;
  telefonoEmergencia: string;
} {
  return {
    // A stored `DESCONOCIDO` arrives here as "nothing chosen" (#643). Loading
    // it into the select would re-offer the club's own non-answer as though
    // someone had given it, and the next save would write it back unchanged —
    // the record would launder itself as complete forever. Blank instead: the
    // person editing knows the real value, and this is the only place it can
    // be backfilled without inventing it.
    tipoSangre: ficha.tipoSangre === "DESCONOCIDO" ? "" : ficha.tipoSangre,
    // #1574: a declared «none» (empty list + filled alergias) comes back as
    // «Ninguno», so re-saving it untouched is valid; a legacy row stays blank.
    enfermedades: enfermedadesInputValue(
      ficha.enfermedades.map((e) => e.nombreEnfermedad),
      ficha.alergias,
    ),
    alergias: ficha.alergias ?? "",
    contactoEmergencia: ficha.contactoEmergencia ?? "",
    // Issue #1296: the field now shows the local digits without the trunk 0 —
    // `toPhoneFieldDigits` is also what cleans a stored value that happens to
    // carry an international/duplicated-prefix shape.
    telefonoEmergencia: toPhoneFieldDigits(ficha.telefonoEmergencia),
  };
}

/** Required-field rejections shown after a save attempt. */
interface FichaFieldErrors {
  tipoSangre?: string;
  alergias?: string;
  enfermedades?: string;
  telefonoEmergencia?: string;
}

/**
 * One field in read mode (#1619): the same label, grid cell and spacing as the
 * control it stands in for, with the value in place of the box. A `<dt>`/`<dd>`
 * pair so a screen reader announces label and value together, with no input to
 * type in. No asterisk and no helper hint: those belong to editing.
 *
 * The dash is not decorative: an optional field left empty must say "nothing
 * here" instead of leaving a gap that reads like data that failed to load.
 */
function CampoLectura({
  label,
  value,
  wide = false,
}: {
  label: string;
  value: string;
  wide?: boolean;
}): React.ReactElement {
  return (
    <div className={wide ? "sm:col-span-2" : undefined}>
      <dt className="mb-1 text-xs font-semibold text-ink-2">{label}</dt>
      <dd className="min-h-10 py-2 text-sm font-semibold text-ink">{value || "—"}</dd>
    </div>
  );
}

/** One group of the page-mode form: a card with the health blue on its top edge. */
function RecordSection({ title, children }: { title: string; children: ReactNode }): React.ReactElement {
  return (
    <section className="rounded-2xl border border-line border-t-[3px] border-t-cuenta-representante bg-paper">
      <h4 className="border-b border-line px-4 py-3 text-sm font-bold text-ink">{title}</h4>
      <div className="p-4">{children}</div>
    </section>
  );
}

interface MedicalRecordEditorProps {
  personaId: number;
  /**
   * The student this record belongs to. Rendered INSIDE the heading of a
   * header band that stays pinned (`sticky top-0`) while the fields below
   * scroll — this is medical data, and on a narrow screen the identity above
   * this editor (owned by the caller, e.g. `StudentEditPanel`) scrolls out of
   * view long before the form does. Optional so a caller with no name in
   * scope still renders; the heading then names the section alone.
   */
  studentName?: string;
  /**
   * Page mode (`/student/medical-record`): groups the fields under "Salud" and
   * "Contacto de emergencia" and draws the live emergency card in a rail beside
   * the form. Off for the admin dialog, which is a narrow modal.
   */
  withEmergencyCard?: boolean;
  /** Whose record this is relative to the reader; only read with `withEmergencyCard`. */
  viewerIsOwner?: boolean;
  /** The caller already announces "no record yet"; skip the editor's own notice. */
  hideNewNotice?: boolean;
  /** Extra block under the form's cards (e.g. a collapsed guide); only read with `withEmergencyCard`. */
  formFooter?: ReactNode;
  /**
   * The representative, when the caller already knows them (the representative's
   * own page: they ARE the contact, and `/emergencia` is admin/trainer-only so
   * the lookup would 403). Skips that lookup.
   */
  representanteContacto?: { nombre: string; telefono: string } | null;
}

export default function MedicalRecordEditor({
  personaId,
  studentName,
  withEmergencyCard = false,
  viewerIsOwner = true,
  hideNewNotice = false,
  formFooter,
  representanteContacto: representanteConocido = null,
}: MedicalRecordEditorProps): React.ReactElement {
  const { showSuccess, showError } = useToast();
  const [state, setState] = useState<
    | { status: "loading" }
    | { status: "error"; message: string }
    | { status: "ready"; ficha: FichaMedicaEditable; isNew: boolean }
  >({ status: "loading" });
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [reloadToken, setReloadToken] = useState(0);

  /**
   * Reposo o edición. Lo decide la CARGA, no el usuario: una ficha que ya
   * existe abre en reposo, una que no existe abre en edición.
   *
   * El reclamo que esto contesta: «parece que hay que llenar eso siempre». La
   * ficha existente siempre se cargó — `fetchFichaMedica` está en el efecto de
   * abajo desde el primer día — pero se dibujaba con los mismos cinco inputs
   * llenos existiera o no, y cinco inputs llenos no dicen "esto ya está
   * guardado", dicen "esto es un formulario". Sobre datos médicos esa
   * diferencia importa: el que abre la pantalla tiene que poder LEER lo que
   * el club sabe de esa persona sin tocar nada.
   */
  const [editing, setEditing] = useState(false);

  // No pre-selection (#643). This used to default to `DESCONOCIDO` so that the
  // backend's "no blood type" 400 could never be reached from the UI — which
  // silenced the error by answering the question on the user's behalf, with a
  // non-answer. The gate below reaches the same end honestly: nothing is sent
  // until a real value is chosen.
  const [tipoSangre, setTipoSangre] = useState<TipoSangreElegido>("");
  const [enfermedadesInput, setEnfermedadesInput] = useState("");
  const [alergias, setAlergias] = useState("");
  const [contactoEmergencia, setContactoEmergencia] = useState("");
  // Issue #1296: the same `PhoneField` every other phone field on the app
  // shares (fixed +593, local digits, no trunk 0) — retired the field's own
  // `useNumericFieldMasking("phone", …)` copy (#667's parity fix), which
  // masked to the WIDER local-with-0 shape this field no longer shows.
  const [telefonoEmergencia, setTelefonoEmergencia] = useState("");
  /**
   * Field-level rejections, shown only after a save was attempted.
   *
   * Not computed on every keystroke like the enrollment wizards do: this editor
   * opens on data that is ALREADY stored and may already be incomplete (a
   * pre-#643 row), so validating on sight would greet whoever opened it with
   * errors about someone else's omission. The complaint belongs to the moment
   * they try to save.
   */
  const [fieldErrors, setFieldErrors] = useState<FichaFieldErrors>({});
  /** #1667: the representative standing in as emergency contact; null when the person has their own or none. */
  const [representanteBuscado, setRepresentanteBuscado] = useState<{ nombre: string; telefono: string } | null>(null);
  const representante = representanteConocido ?? representanteBuscado;
  /** Set once the user types in either contact field: the default never overwrites a choice. */
  const contactoTocado = useRef(false);
  const tieneRepresentanteConocido = representanteConocido !== null;

  useEffect(() => {
    let cancelled = false;
    setRepresentanteBuscado(null);
    if (tieneRepresentanteConocido) return;
    // Best effort: a failed lookup only means the card keeps saying «Sin registrar».
    Promise.resolve()
      .then(() => fetchFichaEmergencia(personaId))
      .then((emergencia) => {
        const efectivo = emergencia?.contactoEfectivo;
        if (cancelled || !efectivo?.esRepresentante) return;
        setRepresentanteBuscado({ nombre: efectivo.nombre ?? "", telefono: efectivo.telefono ?? "" });
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [personaId, reloadToken, tieneRepresentanteConocido]);

  useEffect(() => {
    let cancelled = false;
    setState({ status: "loading" });
    contactoTocado.current = false;
    setSaveError(null);
    setSaveSuccess(false);

    fetchFichaMedica(personaId)
      .then((ficha) => {
        if (cancelled) return;
        const campos = camposDe(ficha);
        setTipoSangre(campos.tipoSangre);
        setEnfermedadesInput(campos.enfermedades);
        setAlergias(campos.alergias);
        setContactoEmergencia(campos.contactoEmergencia);
        setTelefonoEmergencia(campos.telefonoEmergencia);
        // Reposo. Este efecto también corre después de guardar (`reloadToken`),
        // así que es el mismo renglón el que cierra la edición y muestra lo
        // recién guardado: no hay un segundo camino que pueda olvidarse.
        setEditing(false);
        setState({ status: "ready", ficha, isNew: false });
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        // "No hay ficha todavía" is a 404, and that is the only thing that
        // reliably says so. This used to sniff the message for "not found" —
        // an ENGLISH substring, in a product that speaks Spanish, coming from
        // a sentence the backend was free to reword at any time. Now that the
        // translator refuses English text on principle, that check could not
        // have survived anyway; the status was always the real signal.
        if (isNotFound(error)) {
          // No medical record yet — allow creation of a new one. Arranca en
          // edición porque no hay nada que leer: un reposo vacío con un botón
          // «Editar» sería un paso de más para llegar al mismo formulario.
          setEditing(true);
          setState({ status: "ready", ficha: undefined as unknown as FichaMedicaEditable, isNew: true });
        } else {
          setState({ status: "error", message: toUserMessage(error, "No se pudo cargar la ficha médica.") });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [personaId, reloadToken]);

  // The representative is the default contact of a ficha that has none: the
  // fields open filled (and editable) instead of empty. Runs whenever either
  // side (the ficha or the representative) arrives last.
  const sinContactoPropio =
    state.status === "ready" &&
    !state.ficha?.contactoEmergencia?.trim() &&
    !state.ficha?.telefonoEmergencia?.trim();
  useEffect(() => {
    if (!representante || !sinContactoPropio || contactoTocado.current) return;
    setContactoEmergencia(representante.nombre);
    setTelefonoEmergencia(toPhoneFieldDigits(representante.telefono));
  }, [representante, sinContactoPropio]);

  function empezarEdicion(): void {
    setSaveError(null);
    setSaveSuccess(false);
    setFieldErrors({});
    setEditing(true);
  }

  /**
   * Cancelar RESTAURA, no oculta.
   *
   * Sin este `camposDe`, salir de la edición dejaría los inputs con lo
   * tipeado: el reposo mostraría el valor guardado — que se lee de
   * `state.ficha` — pero el próximo «Editar» abriría el formulario sucio, con
   * un cambio que el usuario ya descartó y que un guardado posterior mandaría
   * igual. Es el modo silencioso de escribir un dato médico que nadie pidió.
   */
  function cancelarEdicion(): void {
    if (state.status === "ready" && !state.isNew) {
      const campos = camposDe(state.ficha);
      setTipoSangre(campos.tipoSangre);
      setEnfermedadesInput(campos.enfermedades);
      setAlergias(campos.alergias);
      setContactoEmergencia(campos.contactoEmergencia);
      setTelefonoEmergencia(campos.telefonoEmergencia);
    }
    setSaveError(null);
    setSaveSuccess(false);
    setFieldErrors({});
    setEditing(false);
  }

  /**
   * The two rules a persisted medical record must satisfy (#643).
   *
   * The phone is checked with `phoneFieldRule` from `@/lib/identity-validation`
   * — the project's one phone validator, the same one the enrollment wizards
   * call, applied to this field's own digits-without-0 shape (issue #1296).
   * A second copy written here would be a second definition of "valid
   * Ecuadorian phone", and the two would drift.
   */
  function validar(): FichaFieldErrors {
    const errores: FichaFieldErrors = {};
    if (!tipoSangre) errores.tipoSangre = "El tipo de sangre es obligatorio.";
    // #1574: «Ninguno» is the answer for "none"; blank is never one.
    const alergiasError = requiredFichaTextError(alergias, ALERGIAS_REQUIRED);
    if (alergiasError) errores.alergias = alergiasError;
    if (!hasEnfermedadesInput(enfermedadesInput)) errores.enfermedades = ENFERMEDADES_REQUIRED;
    const telefonoError = phoneFieldRule(telefonoEmergencia, "El teléfono de emergencia", { guided: true });
    if (telefonoError) errores.telefonoEmergencia = telefonoError;
    return errores;
  }

  async function handleSave(): Promise<void> {
    const errores = validar();
    setFieldErrors(errores);
    if (Object.keys(errores).length > 0) {
      // Nothing is sent. The record on the server keeps whatever it had —
      // including, for a legacy row, its incompleteness — which is strictly
      // better than a PATCH that overwrites part of it and leaves it invalid.
      setSaveError(null);
      setSaveSuccess(false);
      return;
    }

    setSaving(true);
    setSaveError(null);
    setSaveSuccess(false);

    try {
      const enfermedades = enfermedadesInput
        .split(",")
        .map((e) => e.trim())
        .filter((e) => e.length > 0);

      await actualizarFichaMedica(personaId, {
        // `validar()` above proved this is a real TipoSangre, not "".
        tipoSangre: tipoSangre as TipoSangre,
        enfermedades,
        // FIC-5: `|| undefined` used to mean "field omitted", which the
        // backend's partial PATCH reads as "leave the stored value alone" —
        // so clearing the field and saving reported success but never erased
        // it. `null` is the explicit "erase this" signal (see
        // FichaMedicaUpdatePayload's doc comment).
        //
        // The emergency contact NAME stays erasable. Alergias (#1574) and the
        // emergency PHONE (#643) do not: both are required, so the guard above
        // returns before either could reach `null`.
        alergias: alergias.trim(),
        contactoEmergencia: contactoEmergencia.trim() || null,
        telefonoEmergencia: toStoredPhone(telefonoEmergencia),
      });
      setSaveSuccess(true);
      setReloadToken((n) => n + 1);
      showSuccess("Ficha médica guardada correctamente.");
    } catch (error: unknown) {
      const message = toUserMessage(error, "No se pudo guardar la ficha médica.");
      setSaveError(message);
      showError(message);
    } finally {
      setSaving(false);
    }
  }

  if (state.status === "loading") {
    return <LoadingState className="mt-4" label="Cargando ficha médica…" />;
  }

  if (state.status === "error") {
    return (
      <ErrorState
        className="mt-4"
        title="No se pudo cargar la ficha médica"
        message={state.message}
        onRetry={() => setReloadToken((n) => n + 1)}
      />
    );
  }

  const representanteContacto = representante?.nombre ? `Representante: ${representante.nombre}` : "";
  const mostrarPorDefecto = editing && !!representante?.nombre && sinContactoPropio;

  // Live values for the emergency card: what the form holds while editing (or
  // creating), the stored record otherwise.
  const cardValues: EmergencyCardValues =
    editing || state.isNew
      ? {
          tipoSangre: tipoSangre ? etiquetaTipoSangre(tipoSangre) : "",
          alergias: alergias.trim(),
          enfermedades: enfermedadesInput
            .split(",")
            .map((e) => e.trim())
            .filter(Boolean)
            .join(", "),
          // The pre-filled default keeps its «Representante:» label until it is changed.
          contactoEmergencia:
            !contactoEmergencia.trim() || contactoEmergencia.trim() === representante?.nombre
              ? representanteContacto
              : contactoEmergencia.trim(),
          telefonoEmergencia: telefonoEmergencia.trim()
            ? `+593 ${telefonoEmergencia.trim()}`
            : (representante?.telefono ?? ""),
        }
      : {
          tipoSangre: state.ficha.tipoSangre === "DESCONOCIDO" ? "" : etiquetaTipoSangre(state.ficha.tipoSangre),
          alergias: state.ficha.alergias ?? "",
          // Empty (not «Sin declarar») so the card counts it as missing; the
          // card words that gap itself.
          enfermedades: state.ficha.enfermedades.length > 0 || state.ficha.alergias?.trim()
            ? describeEnfermedades(
                state.ficha.enfermedades.map((e) => e.nombreEnfermedad),
                state.ficha.alergias,
              )
            : "",
          contactoEmergencia: state.ficha.contactoEmergencia?.trim() || representanteContacto,
          telefonoEmergencia: state.ficha.telefonoEmergencia?.trim() || (representante?.telefono ?? ""),
        };

  const recordReadMode = !editing && state.status === "ready" && !state.isNew;

  // The five fields as two groups. Page mode draws each group in its own card
  // so the form fills its column with cards, not with stretched inputs; the
  // dialog draws both groups in one grid. The controls are the same either way.
  const saludFields = (
    <>
      <div>
        {/* The asterisk sits OUTSIDE the `<label>` on purpose: inside, it
            becomes part of the control's accessible name, so the field a
            screen reader announces stops being called "Tipo de sangre".
            `aria-required` carries the meaning; this only carries the look. */}
        <div className="mb-1 flex items-center gap-1">
          <label htmlFor={`tipo-sangre-${personaId}`} className="block text-xs font-semibold text-ink-2">
            Tipo de sangre
          </label>
          <span className="text-xs font-semibold text-state-bad" aria-hidden="true">*</span>
        </div>
        <select
          id={`tipo-sangre-${personaId}`}
          value={tipoSangre}
          onChange={(e) => setTipoSangre(e.target.value as TipoSangreElegido)}
          aria-required="true"
          aria-invalid={fieldErrors.tipoSangre ? true : undefined}
          aria-describedby={fieldErrors.tipoSangre ? `tipo-sangre-error-${personaId}` : undefined}
          className={`input-field w-full ${fieldErrors.tipoSangre ? "border-state-bad" : ""}`}
        >
          <option value="">Selecciona una opción</option>
          {TIPOS_SANGRE.map((t) => (
            <option key={t} value={t}>
              {etiquetaTipoSangre(t)}
            </option>
          ))}
        </select>
        {fieldErrors.tipoSangre && (
          <p
            id={`tipo-sangre-error-${personaId}`}
            className="mt-1 text-xs font-semibold text-state-bad"
            role="alert"
          >
            {fieldErrors.tipoSangre}
          </p>
        )}
      </div>
      <div>
        {/* Same asterisk-outside-the-label rule as «Tipo de sangre» above. */}
        <div className="mb-1 flex items-center gap-1">
          <label htmlFor={`alergias-${personaId}`} className="block text-xs font-semibold text-ink-2">
            Alergias
          </label>
          <span className="text-xs font-semibold text-state-bad" aria-hidden="true">*</span>
        </div>
        <input
          id={`alergias-${personaId}`}
          type="text"
          value={alergias}
          onChange={(e) => setAlergias(e.target.value)}
          aria-required="true"
          aria-invalid={fieldErrors.alergias ? true : undefined}
          aria-describedby={`alergias-help-${personaId}`}
          className={`input-field w-full ${fieldErrors.alergias ? "border-state-bad" : ""}`}
        />
        {fieldErrors.alergias ? (
          <p
            id={`alergias-help-${personaId}`}
            className="mt-1 text-xs font-semibold text-state-bad"
            role="alert"
          >
            {fieldErrors.alergias}
          </p>
        ) : (
          <p id={`alergias-help-${personaId}`} className="mt-1 text-2xs tracking-flat text-ink-3">
            {NINGUNO_HELP}
          </p>
        )}
      </div>
      <div className="sm:col-span-2">
        <div className="mb-1 flex items-center gap-1">
          <label htmlFor={`enfermedades-${personaId}`} className="block text-xs font-semibold text-ink-2">
            Enfermedades (separadas por coma)
          </label>
          <span className="text-xs font-semibold text-state-bad" aria-hidden="true">*</span>
        </div>
        <input
          id={`enfermedades-${personaId}`}
          type="text"
          value={enfermedadesInput}
          onChange={(e) => setEnfermedadesInput(e.target.value)}
          placeholder="Ej: Asma, Diabetes"
          aria-required="true"
          aria-invalid={fieldErrors.enfermedades ? true : undefined}
          aria-describedby={`enfermedades-help-${personaId}`}
          className={`input-field w-full ${fieldErrors.enfermedades ? "border-state-bad" : ""}`}
        />
        {fieldErrors.enfermedades ? (
          <p
            id={`enfermedades-help-${personaId}`}
            className="mt-1 text-xs font-semibold text-state-bad"
            role="alert"
          >
            {fieldErrors.enfermedades}
          </p>
        ) : (
          <p id={`enfermedades-help-${personaId}`} className="mt-1 text-2xs tracking-flat text-ink-3">
            {NINGUNO_HELP} Al guardar se reemplaza la lista completa.
          </p>
        )}
      </div>
    </>
  );

  const contactoFields = (
    <>
      <div>
        <label htmlFor={`contacto-${personaId}`} className="mb-1 block text-xs font-semibold text-ink-2">
          Contacto de emergencia
        </label>
        <input
          id={`contacto-${personaId}`}
          type="text"
          value={contactoEmergencia}
          onChange={(e) => {
            contactoTocado.current = true;
            setContactoEmergencia(e.target.value);
          }}
          // 150 chars, same cap `EmergencyContactFields` (wizard-fields.tsx)
          // uses for the identical field on the enrollment wizards —
          // issue #667's emergency-contact parity gap.
          maxLength={150}
          className="input-field w-full"
        />
      </div>
      {/* Issue #1296: the same `PhoneField` every other phone field on the
          app shares (fixed +593, local digits, no trunk 0). `PhoneField`
          draws its label at `text-sm`; every other label in this form is
          `text-xs`, which left the two emergency-contact inputs 5px out of
          line side by side. Restyled from here because the field is shared
          with the wizards. */}
      <div className="[&_label]:mb-1 [&_label]:text-xs [&_label]:text-ink-2">
        <PhoneField
          idPrefix="telefono"
          field={String(personaId)}
          label="Teléfono de emergencia"
          value={telefonoEmergencia}
          onChange={(value) => {
            contactoTocado.current = true;
            setTelefonoEmergencia(value);
          }}
          required
          error={fieldErrors.telefonoEmergencia}
        />
      </div>
      {mostrarPorDefecto && (
        <p className="text-2xs tracking-flat text-ink-3 sm:col-span-2">
          Por defecto es el representante: {representante.nombre}
          {representante.telefono ? ` · ${representante.telefono}` : ""}. Puedes cambiarlo.
        </p>
      )}
    </>
  );

  // Read mode: the same grid cells as the fields above, values instead of
  // controls (#1619), so toggling Editar/Guardar never moves a datum. No date:
  // `FichaMedicaEditable` carries no timestamp, so an «updated on…» line would
  // be invented.
  const saludRead = recordReadMode ? (
    <>
      <CampoLectura label="Tipo de sangre" value={etiquetaTipoSangre(state.ficha.tipoSangre)} />
      <CampoLectura label="Alergias" value={describeAlergias(state.ficha.alergias)} />
      <CampoLectura
        wide
        label="Enfermedades"
        value={describeEnfermedades(
          state.ficha.enfermedades.map((e) => e.nombreEnfermedad),
          state.ficha.alergias,
        )}
      />
    </>
  ) : null;

  const contactoRead = recordReadMode ? (
    <>
      <CampoLectura
        label="Contacto de emergencia"
        value={state.ficha.contactoEmergencia?.trim() || representanteContacto}
      />
      <CampoLectura
        label="Teléfono de emergencia"
        value={state.ficha.telefonoEmergencia?.trim() || (representante?.telefono ?? "")}
      />
    </>
  ) : null;

  const newNotice =
    editing && state.isNew && !hideNewNotice ? (
      <p className="rounded-ctl border border-line bg-sunken px-3 py-2 text-xs text-ink-3-strong">
        Todavía no hay una ficha médica cargada para esta persona. Completa los datos y guárdalos.
      </p>
    ) : null;

  // The save button lives in the pinned header; only the outcome is read here,
  // AFTER pressing, so it does not need to be pinned. Two «Guardar» buttons
  // would be two affordances for one act.
  const resultMessages =
    editing && (saveError || saveSuccess) ? (
      <div className="flex items-center gap-3">
        {saveError && (
          <p className="text-sm text-state-bad" role="alert">
            <LinkifiedText text={saveError} />
          </p>
        )}
        {saveSuccess && (
          <p className="flex items-center gap-1 text-sm text-state-ok" role="status">
            <CheckCircle2 size={ICON.sm} strokeWidth={2} aria-hidden="true" />
            Ficha médica guardada.
          </p>
        )}
      </div>
    ) : null;

  // `sticky top-0`, not a plain header: on a narrow screen the fields can
  // outgrow the viewport and the student's identity — shown once, above this
  // editor, by the caller — scrolls out of view first. Pinning this band keeps
  // whoever is editing from losing sight of whose medical data they touch.
  // `bg-paper` keeps it opaque over the fields scrolling under it. The owner's
  // name sits IN the title: one heading says the whole thing (D11c).
  const headerBand = (
    <header
      className={
        withEmergencyCard
          ? "sticky top-0 z-10 flex flex-wrap items-center gap-2 rounded-2xl border border-line bg-paper px-3 py-2.5 sm:px-4"
          : "sticky top-0 z-10 flex flex-wrap items-center gap-2 rounded-t-2xl border-b border-line bg-paper px-3 py-2.5 sm:px-4"
      }
    >
      {/* Blue, the calm colour of health data; red stays for the required
          mark and for errors (EXTRA colour rule). */}
      <Stethoscope size={ICON.sm} strokeWidth={1.5} className="flex-none text-cuenta-representante" aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <h3 className="break-words text-base font-extrabold text-ink sm:truncate">
          {studentName ? `Ficha médica de ${studentName}` : "Ficha médica"}
        </h3>
      </div>
      {state.isNew && <Badge tone="neutral">Nueva</Badge>}

      {editing ? (
        <div className="flex flex-none items-center gap-2">
          {/* «Cancelar» only when there is something to go back to: a new
              record has no previous state. */}
          {!state.isNew && (
            <Button variant="tertiary" size="sm" onClick={cancelarEdicion} disabled={saving}>
              <X size={ICON.sm} strokeWidth={1.5} aria-hidden="true" />
              Cancelar
            </Button>
          )}
          <Button variant="primary" size="sm" onClick={() => void handleSave()} disabled={saving}>
            {saving ? (
              <Loader2 size={ICON.sm} className="animate-spin" aria-hidden="true" />
            ) : (
              <Save size={ICON.sm} strokeWidth={1.5} aria-hidden="true" />
            )}
            {saving ? "Guardando…" : "Guardar"}
          </Button>
        </div>
      ) : (
        <Button variant="secondary" size="sm" onClick={empezarEdicion} className="flex-none">
          <Pencil size={ICON.sm} strokeWidth={1.5} aria-hidden="true" />
          Editar
        </Button>
      )}
    </header>
  );

  if (!withEmergencyCard) {
    // The admin dialog: one card, sized to its content (#514).
    return (
      <div data-testid="medical-record-card" className="mt-3 rounded-2xl border border-line bg-paper">
        {headerBand}
        <div className="p-3 sm:p-4">
          {recordReadMode && (
            <dl data-testid="medical-record-rows" className="grid gap-3 sm:grid-cols-2">
              {saludRead}
              {contactoRead}
            </dl>
          )}
          {editing && (
            <div>
              {newNotice && <div className="mb-3">{newNotice}</div>}
              {/* Two columns above `sm`, never three: three put the five
                  controls into two rows of 40px — a strip, not a form (D11b).
                  Two is the honest shape too: blood type beside allergies, the
                  illness list at full width, the two contact fields adjacent. */}
              <div className="grid gap-3 sm:grid-cols-2">
                {saludFields}
                {contactoFields}
              </div>
              {resultMessages && <div className="mt-4">{resultMessages}</div>}
            </div>
          )}
        </div>
      </div>
    );
  }

  // Page mode: the form is two cards (health, emergency contact) in the left
  // column and the live emergency card in the right one, balanced so neither
  // leaves dead air under it. Fields keep their natural width; cards fill the
  // space (FAM-31). Each card wears the calm blue of health data.
  const recordCard = (
    <div data-testid="medical-record-card" className="mt-3 flex flex-col gap-section">
      {headerBand}
      {newNotice}
      <RecordSection title="Salud">
        {recordReadMode ? (
          <dl data-testid="medical-record-rows" className="grid gap-3 sm:grid-cols-2">{saludRead}</dl>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">{saludFields}</div>
        )}
      </RecordSection>
      <RecordSection title="Contacto de emergencia">
        {recordReadMode ? <dl className="grid gap-3 sm:grid-cols-2">{contactoRead}</dl> : (
          <div className="grid gap-3 sm:grid-cols-2">{contactoFields}</div>
        )}
      </RecordSection>
      {resultMessages}
      {formFooter}
    </div>
  );

  return (
    <div className={cn(PAGE_RAIL, "lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]")}>
      <div className="min-w-0 [&>[data-testid=medical-record-card]]:mt-0">{recordCard}</div>
      <EmergencyCard studentName={studentName} values={cardValues} ownerIsViewer={viewerIsOwner} />
    </div>
  );
}
