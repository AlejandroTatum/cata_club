/**
 * Admin Create Account — admin wizard for creating complete accounts.
 *
 * 4-step wizard (type → personal → credentials → summary/confirm) for an
 * authenticated admin to create a full account (Persona + Usuario + Rol)
 * in one request via POST /personas/admin/cuentas.
 *
 * Account types:
 *   - JUGADOR: adult player (rol ALUMNO)
 *   - REPRESENTANTE: adult who represents a minor (rol REPRESENTANTE + ALUMNO)
 *   - MENOR: dependent minor with optional own login (rol ALUMNO)
 *   - ENTRENADOR: adult who runs the sessions (rol ENTRENADOR only — a coach
 *     trains the club, they are not enrolled in it)
 *
 * For MENOR, the admin must also assign a representante legal via search.
 * All labels and copy are in Spanish per app convention.
 */

"use client";

import { Suspense, useCallback, useEffect, useState, type FormEvent } from "react";
import { furthestReachableIndex, useWizardHistory } from "@/lib/wizard-history";
import ProtectedRoute from "@/components/ProtectedRoute";
import AppShell from "@/components/shell/AppShell";
import { BackLink, Button, Stepper, buttonClasses, cn } from "@/components/ui";
import Link from "next/link";
import { useToast } from "@/contexts/ToastContext";
import { WizardInput, WizardNavigation, example, PHONE_HINT } from "@/components/wizard-fields";
import { crearCuentaAdmin, searchStudents, fetchInstituciones, type Institucion } from "@/services/api";
import {
  GraduationCap,
  Building2,
  Baby,
  User,
  Mail,
  Lock,
  CheckCircle,
  AlertTriangle,
  FileText,
  Search,
  Heart,
  Dumbbell,
} from "lucide-react";
import { ICON } from "@/lib/icon-size";
import { calculatePersonAge } from "@/lib/identity-validation";
import { formatDate } from "@/lib/format-utils";
import {
  CREAR_CUENTA_ID_PREFIX,
  CREAR_CUENTA_SCHOOL_TYPE_ID,
  CREAR_CUENTA_SHORT_LABELS,
  CREAR_CUENTA_STEP_ORDER,
  CREAR_CUENTA_STEP_LABELS,
  BLOOD_TYPE_OPTIONS,
  crearCuentaFieldId,
  initialCrearCuentaFormData,
  hasCrearCuentaMedicalData,
  requiresMedicalRecord,
  validateCrearCuentaStep,
  validateCrearCuentaForm,
  getCrearCuentaErrorMessage,
  clearCrearCuentaDraft,
  loadCrearCuentaDraft,
  saveCrearCuentaDraft,
  type CrearCuentaFormData,
  type CrearCuentaStep,
  type AccountType,
} from "./crear-cuenta-utils";

/**
 * The four kinds of account, and the hue each one carries.
 *
 * Written as a table instead of four near-identical `<button>` blocks: the old
 * markup repeated the same forty-character class string four times, which is
 * how the selected-state skin came to be red in four places at once and why
 * changing it meant changing it four times.
 *
 * The hues themselves are unchanged and stay declared where they were
 * (`tailwind.config.ts`, `cuenta.*`): they are the one place in this product
 * where colour carries CATEGORY rather than status, they are measured as
 * pairs, and "Jugador" wearing the system accent at `/15` is deliberate and
 * documented there. What changes is the SELECTED state, which was also red —
 * so choosing "Jugador" painted red over red, one for identity and one for
 * selection, and neither could be told from the other.
 */
const ACCOUNT_TYPES: {
  type: AccountType;
  icon: typeof GraduationCap;
  iconBg: string;
  iconFg: string;
  title: string;
  description: string;
}[] = [
  {
    type: "JUGADOR",
    icon: GraduationCap,
    iconBg: "bg-cata-red/15",
    iconFg: "text-cata-red-dark",
    title: "Jugador",
    description: "Mayor de 18 que entrena y paga su propia mensualidad.",
  },
  {
    type: "REPRESENTANTE",
    icon: Building2,
    iconBg: "bg-cuenta-representante-bg",
    iconFg: "text-cuenta-representante",
    title: "Representante",
    description: "Adulto que paga por sus hijos y también entrena.",
  },
  {
    type: "MENOR",
    icon: Baby,
    iconBg: "bg-cuenta-menor-bg",
    iconFg: "text-cuenta-menor",
    title: "Menor o dependiente",
    description: "Menor de 18 a cargo de un representante que paga por él.",
  },
  {
    type: "ENTRENADOR",
    icon: Dumbbell,
    iconBg: "bg-cuenta-entrenador-bg",
    iconFg: "text-cuenta-entrenador",
    title: "Entrenador",
    description: "Mayor de 18 que dicta los entrenamientos. No paga mensualidad.",
  },
];

/**
 * One block of the summary — the four used to be four copies of the same
 * eleven lines, which is how they came to share a red icon and a label the
 * reader could not see.
 *
 * The icon is `ink-3`, not `cata-red`. Ten decorative red icons on a wizard
 * with one red button is "el rojo como decoración", and the rule is explicit
 * that the colour is the primary action and the destructive state, and nothing
 * else.
 *
 * The heading is the LABEL step of the type scale — 10.5px, weight 800,
 * `tracking-caps` — spelled with tokens instead of `text-xs font-semibold
 * tracking-wider`. Its ink was `cata-text/45`: 2.67:1 on paper, so the six
 * words naming the six blocks of the account about to be created were the
 * least legible strings on the screen. `ink-3-strong` reads 5.24:1 on the
 * sunken surface these blocks stand on.
 */
function SummaryBlock({
  icon: Icon,
  title,
  children,
}: {
  icon: typeof FileText;
  title: string;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <div className="rounded-card border border-line bg-sunken p-page">
      <div className="mb-3 flex items-center gap-2">
        <Icon size={ICON.sm} strokeWidth={1.5} className="text-ink-3" aria-hidden="true" />
        <h3 className="text-2xs font-extrabold uppercase tracking-caps text-ink-3-strong">
          {title}
        </h3>
      </div>
      {children}
    </div>
  );
}

/** One fact of the summary — the `<dt>`/`<dd>` pair, spelled once. */
function SummaryRow({
  label,
  value,
}: {
  label: string;
  value: React.ReactNode;
}): React.ReactElement {
  return (
    <>
      <dt className="text-ink-2">{label}</dt>
      <dd className="font-semibold text-ink">{value}</dd>
    </>
  );
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

function CrearCuentaContent(): React.ReactElement {
  const { showSuccess } = useToast();

  const [formData, setFormData] = useState<CrearCuentaFormData>(initialCrearCuentaFormData);
  const [submitting, setSubmitting] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [summaryReviewed, setSummaryReviewed] = useState(false);
  const [formErrors, setFormErrors] = useState<string[]>([]);
  /**
   * Issue #353: restored from `sessionStorage`, not the server — nothing of
   * this was ever sent. Follows the exact rótulo/lifecycle
   * `student/enroll/page.tsx` already established for `restoredFromDraft`
   * (issue #317 / K8): set once on mount if a draft exists, dropped the first
   * time the admin touches the form again.
   */
  const [restoredFromDraft, setRestoredFromDraft] = useState(false);
  /** Guards the auto-save effect below from firing before the mount-time restore effect has had its turn — see that effect's own comment. */
  const [draftHydrated, setDraftHydrated] = useState(false);

  // Representante search state (for MENOR type)
  const [representanteSearch, setRepresentanteSearch] = useState("");
  const [representanteResults, setRepresentanteResults] = useState<{ id: number; nombres: string; apellidos: string }[]>([]);
  const [searchingRepresentante, setSearchingRepresentante] = useState(false);
  const [representanteSelected, setRepresentanteSelected] = useState<{ id: number; nombre: string } | null>(null);
  const [instituciones, setInstituciones] = useState<Institucion[]>([]);
  const [tipoEscuelaFilter, setTipoEscuelaFilter] = useState<string>("");

  /**
   * A URL may address any step the admin could have walked to on their own,
   * and no further — a reloaded link must not open the summary of an account
   * nobody described.
   */
  const maxReachableStep = furthestReachableIndex(
    CREAR_CUENTA_STEP_ORDER,
    (s) => validateCrearCuentaStep(s, formData).length === 0,
  );
  const { step, goToStep, goBack, resetToFirstStep } = useWizardHistory(
    CREAR_CUENTA_STEP_ORDER,
    maxReachableStep,
  );

  const currentIndex = CREAR_CUENTA_STEP_ORDER.indexOf(step);
  const isFirst = currentIndex === 0;
  const isLast = currentIndex === CREAR_CUENTA_STEP_ORDER.length - 1;

  const doSearchRepresentante = useCallback(async (query: string): Promise<void> => {
    if (query.trim().length < 2) {
      setRepresentanteResults([]);
      return;
    }
    setSearchingRepresentante(true);
    try {
      const results = await searchStudents(query.trim(), { limit: 10 });
      setRepresentanteResults(results.map((r) => ({ id: r.id, nombres: r.nombres, apellidos: r.apellidos })));
    } catch {
      setRepresentanteResults([]);
    } finally {
      setSearchingRepresentante(false);
    }
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => {
      void doSearchRepresentante(representanteSearch);
    }, 300);
    return () => clearTimeout(timer);
  }, [representanteSearch, doSearchRepresentante]);

  useEffect(() => {
    fetchInstituciones().then(setInstituciones).catch(() => {});
  }, []);

  // Restore a draft left by a previous mount of this same tab — the one a
  // session expiring mid-wizard (401 on the refresh) leaves behind when
  // ProtectedRoute bounces to /login and back (issue #353). Runs once; a
  // fresh mount after re-login IS "once per mount" for this purpose, same as
  // the reload case `student/enroll/page.tsx`'s twin effect handles.
  useEffect(() => {
    const draft = loadCrearCuentaDraft();
    if (draft) {
      setFormData(draft);
      setRestoredFromDraft(true);
    }
    setDraftHydrated(true);
  }, []);

  useEffect(() => {
    if (!draftHydrated) return;
    saveCrearCuentaDraft(formData);
  }, [formData, draftHydrated]);

  function updateField<K extends keyof CrearCuentaFormData>(
    key: K,
    value: CrearCuentaFormData[K],
  ): void {
    setFormData((prev) => ({ ...prev, [key]: value }));
    setFormErrors([]);
    // The admin is now actively working the form again — same moment the
    // enrollment wizard's own "Recuperamos los datos…" banner drops on the
    // first action after a restore.
    setRestoredFromDraft(false);
  }

  function handleNext(): void {
    const errors = validateCrearCuentaStep(step, formData);
    if (errors.length > 0) {
      setFormErrors(errors);
      return;
    }
    setFormErrors([]);
    const nextIdx = currentIndex + 1;
    if (nextIdx < CREAR_CUENTA_STEP_ORDER.length) {
      const nextStep = CREAR_CUENTA_STEP_ORDER[nextIdx];
      if (nextStep === "summary") setSummaryReviewed(false);
      goToStep(nextStep);
    }
  }

  /** "Atrás" IS the browser's Back — one way back, not two that disagree. */
  function handleBack(): void {
    setFormErrors([]);
    if (currentIndex > 0) goBack();
  }

  async function handleConfirm(e: FormEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault();
    if (submitting || confirmed) return;
    if (step !== "summary") {
      handleNext();
      return;
    }
    if (!summaryReviewed) {
      setFormErrors(["Revise y confirme el resumen antes de crear la cuenta."]);
      return;
    }
    const errors = validateCrearCuentaForm(formData);
    if (errors.length > 0) {
      setFormErrors(errors);
      return;
    }
    setSubmitting(true);
    try {
      await crearCuentaAdmin({
        tipoCuenta: formData.accountType as AccountType,
        nombres: formData.nombres.trim(),
        apellidos: formData.apellidos.trim(),
        cedula: formData.cedula.trim(),
        fechaNacimiento: formData.fechaNacimiento,
        telefono: formData.telefono.trim(),
        correo: formData.correo.trim(),
        contrasenia: formData.contrasenia,
        representanteId: formData.accountType === "MENOR" && formData.representanteId
          ? Number(formData.representanteId)
          : undefined,
        ...(formData.institucionId ? { institucionId: Number(formData.institucionId) } : {}),
        ...(formData.tipoSangre
          ? {
              fichaMedica: {
                tipoSangre: formData.tipoSangre,
                enfermedades: formData.condicionesSalud
                  .split(",").map((s) => s.trim()).filter(Boolean),
                ...(formData.alergias.trim() ? { alergias: formData.alergias.trim() } : {}),
                ...(formData.contactoEmergencia.trim() ? { contactoEmergencia: formData.contactoEmergencia.trim() } : {}),
                ...(formData.telefonoEmergencia.trim() ? { telefonoEmergencia: formData.telefonoEmergencia.trim() } : {}),
              },
            }
          : {}),
      });
      showSuccess("Cuenta creada correctamente.");
      setSubmitting(false);
      setConfirmed(true);
      // The draft did its job — the data it held is now the server's record,
      // not an unsent attempt. Keeping it around would let a later reload of
      // this same tab resurrect a stale form behind the confirmation screen.
      clearCrearCuentaDraft();
    } catch (error: unknown) {
      setSubmitting(false);
      const message = getCrearCuentaErrorMessage(error);
      setFormErrors([message]);
    }
  }

  function selectAccountType(type: AccountType): void {
    updateField("accountType", type);
    if (type !== "MENOR") {
      updateField("representanteId", "");
      setRepresentanteSelected(null);
      setRepresentanteSearch("");
    }
  }

  function selectRepresentante(id: number, nombre: string): void {
    updateField("representanteId", id);
    setRepresentanteSelected({ id, nombre });
    setRepresentanteSearch("");
    setRepresentanteResults([]);
  }

  // ---- Step renderers ----

  function renderTypeStep(): React.ReactElement {
    const age = formData.fechaNacimiento ? calculatePersonAge(formData.fechaNacimiento) : null;
    return (
      <div className="space-y-section">
        <p className="text-sm leading-relaxed text-ink-2">
          Seleccione el tipo de cuenta que desea crear:
        </p>

        {/*
         * Two up, not four.
         *
         * `lg:grid-cols-4` inside a capped form column gave each card 138px of
         * content box, so every description wrapped to four or five lines and
         * two of the four titles broke in the middle — the row read as four
         * leaflets rather than four choices. At two up each card gets 342px,
         * every description sets on two lines, and no title wraps.
         *
         * `items-stretch`: the four titles used to sit at four different
         * heights because each card was as tall as its own copy. They are one
         * row of equal boxes now, which is what makes them comparable.
         */}
        <div className="grid items-stretch gap-4 sm:grid-cols-2">
          {ACCOUNT_TYPES.map(({ type, icon: Icon, iconBg, iconFg, title, description }) => {
            const selected = formData.accountType === type;
            return (
              <button
                key={type}
                type="button"
                aria-pressed={selected}
                onClick={() => selectAccountType(type)}
                className={cn(
                  "flex flex-col rounded-card border bg-paper p-4 text-left transition-colors duration-150",
                  // "Un estado activo se dibuja con caucho más el punto
                  // amarillo" — `FilterPill`'s rule, which is the product's
                  // one answer for "this is the chosen one". The red it
                  // replaces was forbidden twice over: as a selected state at
                  // all, and here in particular, because "Jugador" already
                  // wears red as its category.
                  selected
                    ? "border-coal shadow-card"
                    : "border-line-2 hover:border-coal/30",
                )}
              >
                <span
                  aria-hidden="true"
                  className={`mb-section flex h-10 w-10 items-center justify-center rounded-ctl ${iconBg}`}
                >
                  <Icon size={ICON.base} strokeWidth={1.5} className={iconFg} />
                </span>
                <span className="mb-1 flex items-center gap-1.5 text-sm font-bold text-ink">
                  {title}
                  {selected && (
                    <span
                      data-testid={`account-type-mark-${type}`}
                      aria-hidden="true"
                      className="h-1.5 w-1.5 flex-none rounded-full bg-ball"
                    />
                  )}
                </span>
                <span className="text-xs leading-relaxed text-ink-2">{description}</span>
              </button>
            );
          })}
        </div>

        {formData.accountType === "MENOR" && age !== null && !isNaN(age) && age >= 18 && (
          <div className="rounded-ctl border border-state-warn/30 bg-state-warn-bg p-3 text-xs text-state-warn">
            <p className="flex items-center gap-1.5 font-semibold">
              <AlertTriangle size={ICON.sm} strokeWidth={2} aria-hidden="true" />
              La fecha de nacimiento indica una persona mayor de edad ({age} años). Seleccione Jugador o Representante.
            </p>
          </div>
        )}
      </div>
    );
  }

  function renderPersonalStep(): React.ReactElement {
    return (
      <div className="space-y-field">
        <p className="mb-4 text-sm leading-relaxed text-ink-2">
          Ingrese los datos personales de la cuenta a crear:
        </p>
        <div className="grid gap-x-4 sm:grid-cols-2">

        <WizardInput
          idPrefix={CREAR_CUENTA_ID_PREFIX}
          field="nombres"
          label="Nombres"
          value={formData.nombres}
          onChange={(v) => updateField("nombres", v)}
          disabled={submitting}
          required
          pattern="[A-Za-z\u00C0-\u024F\s]+"
          maxLength={100}
          minLength={3}
          icon={<User size={ICON.sm} strokeWidth={1.5} aria-hidden="true" />}
        />

        <WizardInput
          idPrefix={CREAR_CUENTA_ID_PREFIX}
          field="apellidos"
          label="Apellidos"
          value={formData.apellidos}
          onChange={(v) => updateField("apellidos", v)}
          disabled={submitting}
          required
          pattern="[A-Za-z\u00C0-\u024F\s]+"
          maxLength={100}
          minLength={3}
          icon={<User size={ICON.sm} strokeWidth={1.5} aria-hidden="true" />}
        />

        <WizardInput
          idPrefix={CREAR_CUENTA_ID_PREFIX}
          field="cedula"
          label="Cédula de identidad"
          value={formData.cedula}
          onChange={(v) => updateField("cedula", v)}
          disabled={submitting}
          required
          pattern="[0-9]{10}"
          inputMode="numeric"
          numericMode="cedula"
        />

        <WizardInput
          idPrefix={CREAR_CUENTA_ID_PREFIX}
          field="fecha-nacimiento"
          label="Fecha de nacimiento"
          value={formData.fechaNacimiento}
          onChange={(v) => updateField("fechaNacimiento", v)}
          type="date"
          disabled={submitting}
          required
        />

        <WizardInput
          idPrefix={CREAR_CUENTA_ID_PREFIX}
          field="telefono"
          label="Teléfono"
          value={formData.telefono}
          onChange={(v) => updateField("telefono", v)}
          disabled={submitting}
          required
          pattern="[0-9]+"
          minLength={7}
          inputMode="tel"
          numericMode="phone"
          hint={PHONE_HINT}
        />

        </div>
            {/* School selector — only for MENOR type */}
        {formData.accountType === "MENOR" && instituciones.length > 0 && (
          <div className="mt-4">
            <label
              htmlFor={CREAR_CUENTA_SCHOOL_TYPE_ID}
              className="mb-1.5 block text-sm font-semibold text-ink"
            >
              Tipo de escuela
            </label>
            <select
              id={CREAR_CUENTA_SCHOOL_TYPE_ID}
              value={tipoEscuelaFilter}
              onChange={(e) => {
                setTipoEscuelaFilter(e.target.value);
                updateField("institucionId", "");
              }}
              disabled={submitting}
              className="input-field"
            >
              <option value="">Todos los tipos</option>
              <option value="PARTICULAR">Particular</option>
              <option value="FISCAL">Fiscal</option>
              <option value="FISCOMISIONAL">Fiscomisional</option>
              <option value="MUNICIPAL">Municipal</option>
            </select>

            <label
              htmlFor={crearCuentaFieldId("institucionId")}
              className="mb-1.5 mt-3 block text-sm font-semibold text-ink"
            >
              Escuela o institución
            </label>
            {/* `ink-3` — 4.62:1 on paper. This line was `cata-text/50`, which
                measures 3.05:1 and is the hint nobody could read. */}
            <p className="mb-2 text-xs text-ink-3">
              Seleccione la institución educativa del menor (opcional).
            </p>
            <select
              id={crearCuentaFieldId("institucionId")}
              value={formData.institucionId}
              onChange={(e) => updateField("institucionId", e.target.value)}
              disabled={submitting}
              className="input-field"
            >
              <option value="">Sin institución asignada</option>
              {instituciones
                .filter((inst) => !tipoEscuelaFilter || inst.tipoEscuela === tipoEscuelaFilter)
                .map((inst) => (
                  <option key={inst.id} value={String(inst.id)}>
                    {inst.nombre} ({inst.tipoEscuela})
                  </option>
                ))}
            </select>
          </div>
        )}

        {formData.accountType === "MENOR" && (
          <fieldset aria-required="true" className="mt-4 rounded-card border border-cuenta-menor/25 bg-cuenta-menor-bg p-page">
            <legend className="mb-2 text-sm font-semibold text-cuenta-menor">
              Representante legal <span aria-hidden="true" className="text-state-bad">*</span>
            </legend>
            <p className="mb-3 text-xs text-cuenta-menor">
              Busque y seleccione el representante legal para este menor:
            </p>
            <div className="relative">
              <Search
                size={ICON.sm}
                strokeWidth={1.5}
                className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-ink-3"
                aria-hidden="true"
              />
              <input
                type="text"
                value={representanteSearch}
                onChange={(e) => setRepresentanteSearch(e.target.value)}
                placeholder="Buscar por nombre..."
                className="input-field w-full pl-9"
                disabled={submitting}
              />
            </div>
            {searchingRepresentante && (
              <p className="mt-2 text-xs text-cuenta-menor">Buscando...</p>
            )}
            {representanteResults.length > 0 && (
              <ul className="mt-2 max-h-40 divide-y divide-cuenta-menor/25 overflow-y-auto rounded-ctl border border-cuenta-menor/25 bg-paper">
                {representanteResults.map((r) => (
                  <li key={r.id}>
                    <button
                      type="button"
                      onClick={() => selectRepresentante(r.id, `${r.nombres} ${r.apellidos}`)}
                      className="w-full px-3 py-2 text-left text-xs text-cuenta-menor hover:bg-cuenta-menor-bg"
                    >
                      {r.nombres} {r.apellidos}
                      {/* Metadata, not category identity, so it leaves the hue:
                          `purple-400` on white measured 2.64:1 (#139). */}
                      <span className="ml-2 text-ink-3">ID: {r.id}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {representanteSelected && (
              <p className="mt-2 text-xs text-cuenta-menor">
                Seleccionado: <strong>{representanteSelected.nombre}</strong> (ID: {representanteSelected.id})
              </p>
            )}
          </fieldset>
        )}
      </div>
    );
  }

  function renderHealthStep(): React.ReactElement {
    // Issue #730: para un alumno la ficha ya no es opcional, así que los
    // controles se marcan obligatorios desde que se abre el paso, no recién
    // cuando el admin escribe algo. Para un entrenador o un representante
    // sigue valiendo la regla vieja: todo o nada.
    const alumnoRequiereFicha = requiresMedicalRecord(formData.accountType);
    const medicalDetailsRequired = alumnoRequiereFicha || hasCrearCuentaMedicalData(formData);
    return (
      <div className="space-y-section">
        <p className="text-sm leading-relaxed text-ink-2">
          {alumnoRequiereFicha
            ? "Información médica del alumno. El tipo de sangre y el contacto de emergencia son obligatorios: son los datos que el club necesita si pasa algo en un entrenamiento."
            : "Información médica de la persona. Si completa alguno de estos campos, el tipo de sangre y el contacto de emergencia pasan a ser obligatorios."}
        </p>

        {/*
         * A plain block, not a green one.
         *
         * The five medical fields used to sit inside `bg-state-ok-bg` with a
         * `state-ok` border — the SUCCESS tint of the state ramp, spent on a
         * form that has not succeeded at anything yet. "Cuatro estados y
         * ningún vocabulario paralelo": a state colour that describes no state
         * is the vocabulary leaking. What the block needed was a boundary, and
         * a hairline on the sunken step is what the system gives for that.
         */}
        <div className="grid gap-x-4 rounded-card border border-line bg-sunken p-page sm:grid-cols-2">
          <div className="mb-3 sm:col-span-2">
            <label
              htmlFor={crearCuentaFieldId("tipoSangre")}
              className="mb-1.5 block text-sm font-semibold text-ink"
            >
              Tipo de sangre
              {medicalDetailsRequired ? (
                <>
                  <span aria-hidden="true" className="ml-1 text-state-bad">*</span>
                  <span className="sr-only"> (obligatorio)</span>
                </>
              ) : <span className="ml-1 font-normal text-ink-3">(opcional)</span>}
            </label>
            <select
              id={crearCuentaFieldId("tipoSangre")}
              value={formData.tipoSangre}
              onChange={(e) => updateField("tipoSangre", e.target.value)}
              disabled={submitting}
              required={medicalDetailsRequired}
              className="input-field"
            >
              <option value="">Seleccione tipo de sangre</option>
              {BLOOD_TYPE_OPTIONS.map((bt) => (
                <option key={bt} value={bt}>{bt.replace(/_/g, " ")}</option>
              ))}
            </select>
          </div>

          {/* `example()`, not "p. ej." — four abbreviations in one step, on a
              wizard whose sibling screens already say the whole word. */}
          <WizardInput
            idPrefix={CREAR_CUENTA_ID_PREFIX}
            field="condiciones-salud"
            label="Condiciones de salud"
            value={formData.condicionesSalud}
            onChange={(v) => updateField("condicionesSalud", v)}
            disabled={submitting}
            placeholder={example("Asma, diabetes (separar con comas)")}
          />

          <WizardInput
            idPrefix={CREAR_CUENTA_ID_PREFIX}
            field="alergias"
            label="Alergias"
            value={formData.alergias}
            onChange={(v) => updateField("alergias", v)}
            disabled={submitting}
            placeholder={example("Penicilina, mariscos")}
          />

          <WizardInput
            idPrefix={CREAR_CUENTA_ID_PREFIX}
            field="contacto-emergencia"
            label="Nombre del contacto de emergencia"
            value={formData.contactoEmergencia}
            onChange={(v) => updateField("contactoEmergencia", v)}
            disabled={submitting}
            required={medicalDetailsRequired}
            placeholder={example("María Rodríguez")}
          />

          <WizardInput
            idPrefix={CREAR_CUENTA_ID_PREFIX}
            field="telefono-emergencia"
            label="Teléfono de emergencia"
            value={formData.telefonoEmergencia}
            onChange={(v) => updateField("telefonoEmergencia", v)}
            disabled={submitting}
            required={medicalDetailsRequired}
            pattern="[0-9]+"
            minLength={7}
            inputMode="tel"
            numericMode="phone"
            hint={PHONE_HINT}
          />
        </div>
      </div>
    );
  }

  function renderCredentialsStep(): React.ReactElement {
    return (
      <div className="space-y-field">
        <p className="mb-4 text-sm leading-relaxed text-ink-2">
          Ingrese las credenciales de acceso para la cuenta:
        </p>
        <div className="grid gap-x-4 sm:grid-cols-2">

        <WizardInput
          idPrefix={CREAR_CUENTA_ID_PREFIX}
          field="correo"
          label="Correo electrónico"
          value={formData.correo}
          onChange={(v) => updateField("correo", v)}
          type="email"
          disabled={submitting}
          required
          icon={<Mail size={ICON.sm} strokeWidth={1.5} aria-hidden="true" />}
        />

        <WizardInput
          idPrefix={CREAR_CUENTA_ID_PREFIX}
          field="contrasenia"
          label="Contraseña"
          value={formData.contrasenia}
          onChange={(v) => updateField("contrasenia", v)}
          type="password"
          disabled={submitting}
          required
          icon={<Lock size={ICON.sm} strokeWidth={1.5} aria-hidden="true" />}
        />
        </div>
      </div>
    );
  }

  function renderSummary(): React.ReactElement {
    const age = formData.fechaNacimiento ? calculatePersonAge(formData.fechaNacimiento) : null;
    const typeLabels: Record<AccountType, string> = {
      JUGADOR: "Jugador",
      REPRESENTANTE: "Representante que también entrena",
      MENOR: "Menor a cargo de un representante",
      ENTRENADOR: "Entrenador del club",
    };
    return (
      <div className="grid gap-section sm:grid-cols-2">
        <p className="text-sm leading-relaxed text-ink-2 sm:col-span-2">
          Revise la información antes de crear la cuenta:
        </p>

        <SummaryBlock icon={FileText} title="Tipo de cuenta">
          <p className="text-sm font-semibold text-ink">
            {typeLabels[formData.accountType as AccountType]}
          </p>
        </SummaryBlock>

        <SummaryBlock icon={User} title="Datos personales">
          <dl className="grid grid-cols-2 gap-x-4 gap-y-field text-sm">
            <SummaryRow label="Nombres" value={formData.nombres} />
            <SummaryRow label="Apellidos" value={formData.apellidos} />
            <SummaryRow label="Cédula" value={formData.cedula} />
            {/* `formatDate`, not the raw ISO string the field holds. "Una
                columna, un formato": every other date the product prints is
                `dd/mm/yyyy`, and this one was showing `1998-03-20` on the last
                screen before the account is created. */}
            <SummaryRow
              label="Fecha de nacimiento"
              value={
                <>
                  {formData.fechaNacimiento ? formatDate(formData.fechaNacimiento) : "—"}
                  {age !== null && !isNaN(age) && (
                    <span className="ml-2 font-normal text-ink-3">({age} años)</span>
                  )}
                </>
              }
            />
            <SummaryRow label="Teléfono" value={formData.telefono} />
            {formData.accountType === "MENOR" && representanteSelected && (
              <SummaryRow label="Representante" value={representanteSelected.nombre} />
            )}
            {formData.institucionId && (
              <SummaryRow
                label="Institución"
                value={
                  instituciones.find((i) => String(i.id) === formData.institucionId)?.nombre || "—"
                }
              />
            )}
          </dl>
        </SummaryBlock>

        <SummaryBlock icon={Mail} title="Credenciales de acceso">
          <dl className="grid grid-cols-2 gap-x-4 gap-y-field text-sm">
            <SummaryRow label="Correo" value={formData.correo} />
            <SummaryRow label="Contraseña" value="••••••••" />
          </dl>
        </SummaryBlock>

        {formData.tipoSangre && (
          <SummaryBlock icon={Heart} title="Salud y emergencia">
            <dl className="grid grid-cols-2 gap-x-4 gap-y-field text-sm">
              <SummaryRow label="Tipo de sangre" value={formData.tipoSangre.replace(/_/g, " ")} />
              {formData.condicionesSalud.trim() && (
                <SummaryRow label="Condiciones de salud" value={formData.condicionesSalud} />
              )}
              {formData.alergias.trim() && (
                <SummaryRow label="Alergias" value={formData.alergias} />
              )}
              {formData.contactoEmergencia.trim() && (
                <SummaryRow
                  label="Contacto de emergencia"
                  value={formData.contactoEmergencia}
                />
              )}
              {formData.telefonoEmergencia.trim() && (
                <SummaryRow label="Teléfono de emergencia" value={formData.telefonoEmergencia} />
              )}
            </dl>
          </SummaryBlock>
        )}

        <label className="flex cursor-pointer items-start gap-3 rounded-ctl border border-state-ok/30 bg-state-ok-bg p-page text-sm text-state-ok sm:col-span-2">
          <input
            type="checkbox"
            checked={summaryReviewed}
            onChange={(e) => {
              setSummaryReviewed(e.target.checked);
              setFormErrors([]);
            }}
            className="mt-0.5 h-4 w-4 rounded border-state-ok/30 text-state-ok focus:ring-state-ok/30"
          />
          <span>
            Revisé el resumen y confirmo que la información está correcta.
            {/* `emerald-400/75` on this tint measured 1.58:1 (#139): the hint
                was all but invisible. `ink-3-strong` is the muted ink meant for
                tinted surfaces, at 5.24:1 here. */}
            <span className="mt-1 block text-xs text-ink-3-strong">
              Esto evita crear la cuenta por accidente al llegar al último paso.
            </span>
          </span>
        </label>
      </div>
    );
  }

  // ---- Render ----

  return (
    <AppShell
      title="Crear cuenta"
      subtitle="Cree una cuenta completa desde el panel, con su rol y su ficha médica."
    >
      {confirmed ? (
        /*
         * The success screen no longer reserves three quarters of the window.
         *
         * `min-h-[75vh]` around four short lines is the shape the enrolment
         * batch already removed from its own success screen — a hole with the
         * message floating in the middle of it. It says what happened and what
         * comes next, at the top of the column, and stops.
         */
        <div className="card mx-auto w-full max-w-[1080px] p-page text-center">
          <span className="mx-auto mb-section flex h-12 w-12 items-center justify-center rounded-full bg-state-ok-bg">
            <CheckCircle size={ICON.lg} className="text-state-ok" strokeWidth={1.5} aria-hidden="true" />
          </span>
          <h2 className="mb-section font-display text-lg uppercase leading-tight tracking-flat text-ink">
            Cuenta creada
          </h2>
          <p className="mb-2 text-sm leading-relaxed text-ink-2">
            <strong className="font-semibold text-ink">
              {formData.nombres} {formData.apellidos}
            </strong>{" "}
            ya puede entrar con el correo y la contraseña que acaba de registrar.
          </p>
          {/* `ink-3`, 4.62:1. It was `cata-text/40` — 2.36:1, the least legible
              string this screen printed. */}
          <p className="mb-page text-xs leading-relaxed text-ink-3">
            Las credenciales de acceso fueron creadas de forma segura.
          </p>

          {/* #317 / hallazgo #36: los 5 pasos de este asistente son tipo,
              datos, salud, acceso y confirmar — ninguno de plan, horario ni
              cobro. Un admin que los completaba veía "Cuenta creada" y no
              tenía forma de saber que el socio todavía no está en ningún
              horario ni tiene un pago registrado. No es un paso nuevo del
              wizard (sigue en 5): es la misma información, adelantada al
              cierre en vez de callada. `text-left`, no el `text-center` del
              resto de la tarjeta — un párrafo centrado sobre una lista es dos
              ejes en una caja, el mismo defecto que el asistente de
              inscripción pública ya corrigió en su propia pantalla final. */}
          <div className="mb-page text-left">
            <p className="mb-section text-2xs font-bold uppercase text-ink-3">
              {formData.accountType === "ENTRENADOR" ? "Próximo paso" : "Qué falta para que quede activo"}
            </p>
            {formData.accountType === "ENTRENADOR" ? (
              <p className="text-sm text-ink-2">
                La cuenta ya tiene acceso de entrenador. Puede iniciar sesión y entrar a <Link href="/trainer" className="font-semibold text-ink underline">Mi día</Link> para gestionar sus entrenamientos.
              </p>
            ) : (
              <ol className="space-y-section">
                {[
                  <>
                    Asignar un horario: en <Link href="/groups" className="font-semibold text-ink underline">Horarios</Link>, abra el grupo del estudiante y use &quot;Ver alumnos&quot; para inscribirlo.
                  </>,
                  <>Registrar el primer pago: desde la ficha del socio en Miembros.</>,
                ].map((linea, i) => (
                  <li key={i} className="flex items-start gap-3 text-sm text-ink-2">
                    <span aria-hidden="true" className="mt-2 h-1.5 w-1.5 flex-none rounded-full bg-ink-3" />
                    {linea}
                  </li>
                ))}
              </ol>
            )}
          </div>

          <div className="flex flex-col gap-3 sm:flex-row sm:justify-center">
            {/* An `<a>`, not a `<button>` that calls `router.push`. "Lo que
                navega no es un botón": this control changed the address bar
                while wearing the one shape the system reserves for something
                that does not, so it could not be middle-clicked, opened in a
                tab, or read as a destination by anything. The skin is
                unchanged — `buttonClasses` is the same recipe the button
                spelled by hand — and the shape is now honest. */}
            <Link href="/members" className={buttonClasses("primary")}>
              Volver a Miembros
            </Link>
            <Button
              variant="secondary"
              onClick={() => {
                setFormData(initialCrearCuentaFormData);
                resetToFirstStep();
                setConfirmed(false);
                setSubmitting(false);
                setSummaryReviewed(false);
                setFormErrors([]);
                setRepresentanteSelected(null);
                setRepresentanteSearch("");
              }}
            >
              Crear otra cuenta
            </Button>
          </div>
        </div>
      ) : (
        <div data-testid="create-account-wizard-frame" className="mx-auto flex w-full max-w-[1080px] flex-col gap-section">
          <BackLink href="/members" />

          {/*
           * The named stepper, not an anonymous bar.
           *
           * `/student/enroll` and `/student/add-dependent` both draw `Stepper`
           * — five pills, each with the name of what it asks — while this one
           * drew a red fill and "Paso 1 de 5", which is the same fact as a
           * percentage and tells nobody what step four wants. Two vocabularies
           * for one job, and the one that carried less information was also
           * the one spending the action colour on a decoration.
           */}
          <p className="text-2xs font-bold uppercase tracking-caps text-ink-3-strong">
            Paso {currentIndex + 1} de {CREAR_CUENTA_STEP_ORDER.length}
          </p>

          <Stepper
            label="Pasos para crear una cuenta"
            current={currentIndex + 1}
            steps={CREAR_CUENTA_STEP_ORDER.map((s) => CREAR_CUENTA_SHORT_LABELS[s])}
          />

          {/* Issue #353: recuperado de `sessionStorage`, no del servidor —
              nada de esto se envió todavía. El rótulo lo dice para que un
              dato restaurado nunca se confunda con uno ya guardado, la misma
              distinción que #310 (K3) cerró del lado de asistencias y que
              #317 (K8) ya usa en `/student/enroll`. */}
          {restoredFromDraft && (
            <p className="rounded-ctl border border-line bg-canvas px-3.5 py-2.5 text-xs text-ink-2">
              Recuperamos los datos que ya había completado. Todavía no se han
              enviado — revíselos antes de continuar.
            </p>
          )}

          {/*
           * Left-aligned, not centred.
           *
           * `mx-auto` put the card's left edge at x=502 in a 1152px column
           * while the back control, the stepper and the page title all started
           * at x=262 — four pieces of one screen on two different left edges,
           * which is the client's "cosas desalineadas" in its plainest form.
           * The cap stays (a form is a reading column, and this one asks one
           * question per row) and matches the 760px its sibling wizard
           * `/student/add-dependent` already uses, so the two flows that
           * collect the same person are the same width.
           */}
          <div className="card w-full p-page">
            <div className="mb-page flex items-center gap-2">
              {/* `ink-3`. Five decorative red icons — one per step — on a
                  wizard whose single red control is the button that creates
                  the account. */}
              {step === "type" && <GraduationCap size={ICON.sm} strokeWidth={1.5} className="text-ink-3" aria-hidden="true" />}
              {step === "personal" && <User size={ICON.sm} strokeWidth={1.5} className="text-ink-3" aria-hidden="true" />}
              {step === "health" && <Heart size={ICON.sm} strokeWidth={1.5} className="text-ink-3" aria-hidden="true" />}
              {step === "credentials" && <Lock size={ICON.sm} strokeWidth={1.5} className="text-ink-3" aria-hidden="true" />}
              {step === "summary" && <FileText size={ICON.sm} strokeWidth={1.5} className="text-ink-3" aria-hidden="true" />}
              {/* DESIGN.md's `title` step: Graduate at 20px, uppercase, weight
                  400 — the title of the wizard's form card. The step labels are
                  short ("Datos personales" measures 195.8px uppercase, the
                  longest of the five 264.5px), the card is `max-w-2xl`, and the
                  heading never truncates, so the extra width this face costs
                  wraps at phone widths instead of overflowing. `tracking-flat`
                  cancels the -0.02em the size step carries for Barlow. */}
              <h2 className="font-display text-lg uppercase tracking-flat text-ink">
                {CREAR_CUENTA_STEP_LABELS[step]}
              </h2>
            </div>

            <form onSubmit={handleConfirm}>
              {step === "type" && renderTypeStep()}
              {step === "personal" && renderPersonalStep()}
              {step === "health" && renderHealthStep()}
              {step === "credentials" && renderCredentialsStep()}
              {step === "summary" && renderSummary()}

              <WizardNavigation
                formErrors={formErrors}
                duplicateIdentityAudience="admin"
                isFirst={isFirst}
                isLast={isLast}
                submitting={submitting}
                onBack={handleBack}
                onNext={handleNext}
                submitButton={
                  /* `buttonClasses`, like every other submit in the product —
                     `.btn-primary` is the global class the primitive replaced,
                     and it came with a `shadow-soft` no other button wears. */
                  <button
                    type="submit"
                    disabled={submitting || !summaryReviewed}
                    className={buttonClasses("primary", "md", "disabled:cursor-not-allowed")}
                  >
                    {submitting ? (
                      "Creando cuenta…"
                    ) : (
                      <>
                        <CheckCircle size={ICON.sm} strokeWidth={2} aria-hidden="true" />
                        Crear cuenta
                      </>
                    )}
                  </button>
                }
              />
            </form>
          </div>
        </div>
      )}
    </AppShell>
  );
}

export default function CrearCuentaPage(): React.ReactElement {
  return (
    <ProtectedRoute allowedRoles={["admin"]}>
      {/* The wizard reads its step from the query string; `useSearchParams`
          needs a boundary to fall back to during prerender. */}
      <Suspense>
        <CrearCuentaContent />
      </Suspense>
    </ProtectedRoute>
  );
}
