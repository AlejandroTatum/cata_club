/**
 * Student Enrollment — public self-service wizard.
 *
 * Multi-step wizard for enrolling a student at Cata Club:
 *   - Enrollment type (self vs. child/dependent)
 *   - Student personal data
 *   - Account credentials / representative data
 *   - Health/medical notes & emergency contact
 *   - Summary & confirmation
 *
 * Submits to the backend's public POST /enrollment (via /api/enrollment —
 * see src/app/api/enrollment/route.ts), which persists Persona/Usuario(/
 * FichaMedica/AntecedentesClub) and auto-logs the new user in.
 * All labels and copy are in Spanish per app convention.
 */

"use client";

import { Suspense, useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import {
  enrollStudent,
  fetchInstituciones,
  fetchTarifas,
  type Institucion,
  type TarifaPublica,
} from "@/services/api";
import { useAuth } from "@/contexts/AuthContext";
import { backHrefForRole } from "@/lib/auth-utils";
import { toUserMessage } from "@/lib/error-message";
import { formatCurrency } from "@/lib/format-utils";
import { clearLegacyEnrollmentSession } from "@/lib/enrollment-session";
import { furthestReachableIndex, useWizardHistory } from "@/lib/wizard-history";
import HelpChatLauncher from "@/components/chatbot/HelpChatLauncher";
import {
  WizardInput,
  WizardTextarea,
  PersonIdentityFields,
  EmergencyContactFields,
  WizardNavigation,
  example,
  CEDULA_HINT,
  PHONE_HINT,
} from "@/components/wizard-fields";
import {
  Badge,
  BackLink,
  Button,
  DataRowList,
  EmptyState,
  ErrorState,
  LoadingState,
  PageHeader,
  Stepper,
  buttonClasses,
} from "@/components/ui";
import ContextualHelp from "@/components/ContextualHelp";
import { BLOOD_TYPES, BLOOD_TYPE_LABELS } from "@/types/enrollment";
import {
  UserPlus,
  Heart,
  CheckCircle,
  AlertTriangle,
  Hash,
  FileText,
  Mail,
} from "lucide-react";
import { ICON } from "@/lib/icon-size";
import { calculatePersonAge } from "@/lib/identity-validation";
import type { NumericFieldMode } from "@/lib/numeric-input";
import { isDuplicateIdentityError } from "@/lib/duplicate-identity";
import {
  buildEnrollmentRequest,
  clearEnrollDraft,
  describeStepBlocker,
  ENROLLMENT_TYPES,
  getEnrollmentErrorMessage,
  isDemoQuickFillEnabled,
  loadEnrollDraft,
  saveEnrollDraft,
  validateEnrollFields,
  validateEnrollStep,
  validateEnrollment,
  ENROLL_ID_PREFIX,
  ENROLL_FIELD_TOKEN,
  STEP_ORDER,
  isStepComplete,
  STEP_LABELS,
  STEP_SHORT_LABELS,
  initialFormData,
  type EnrollField,
  type EnrollFormData,
  type EnrollmentType,
  type WizardStep,
} from "./enroll-utils";

// ---------------------------------------------------------------------------
// Step 1 — the two ways into the club. Transcribed from
// `docs/archive/prototypes/prototipos/05-inscripcion.html:57-67`.
// ---------------------------------------------------------------------------

const ENROLLMENT_CHOICES: { value: EnrollmentType; title: string; description: string }[] = [
  {
    value: ENROLLMENT_TYPES.SELF,
    title: "Jugador",
    description:
      "Me inscribo yo al club. Soy mayor de edad y gestiono mi propia cuenta como estudiante.",
  },
  {
    value: ENROLLMENT_TYPES.CHILD,
    title: "Representante",
    description:
      "Gestiono la inscripción de un hijo o dependiente. El estudiante es distinto de mi cuenta.",
  },
];

/**
 * What each `tipoEscuela` is CALLED, as opposed to how it is stored.
 *
 * The institution list printed the raw enum in the option text —
 * "Unidad Educativa Anexa · (FISCOMISIONAL)" — which is the backend's spelling
 * shouted at a family filling in a form. The filter right above it already
 * spelled the same four values properly; this is that list, reused instead of
 * re-derived.
 */
const SCHOOL_TYPES: { value: string; label: string }[] = [
  { value: "PARTICULAR", label: "Particular" },
  { value: "FISCAL", label: "Fiscal" },
  { value: "FISCOMISIONAL", label: "Fiscomisional" },
  { value: "MUNICIPAL", label: "Municipal" },
];

function schoolTypeLabel(value: string): string {
  return SCHOOL_TYPES.find((type) => type.value === value)?.label ?? value;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

function EnrollWizard(): React.ReactElement {
  const { refreshSession, isAuthenticated, isLoading, session } = useAuth();
  const demoQuickFillEnabled = isDemoQuickFillEnabled();
  const [formData, setFormData] = useState<EnrollFormData>(initialFormData);
  const [submitting, setSubmitting] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [summaryReviewed, setSummaryReviewed] = useState(false);
  const [formErrors, setFormErrors] = useState<string[]>([]);
  const [touched, setTouched] = useState<Set<EnrollField>>(new Set());
  const [instituciones, setInstituciones] = useState<Institucion[]>([]);
  /**
   * The school catalogue is optional data, but its ABSENCE was not being
   * distinguished from its failure: `fetchInstituciones().catch(() => {})` left
   * the list empty, and the two selects — which only render when the list has
   * entries — vanished without a word. A visitor who came to pick their child's
   * school saw a step that simply never offered it.
   */
  const [institucionesFailed, setInstitucionesFailed] = useState(false);
  const [tipoEscuelaFilter, setTipoEscuelaFilter] = useState<string>("");
  /**
   * Issue #331: the public tariff catalog shown on step 1, BEFORE the
   * visitor's first field. Unlike `instituciones`, a failure here gets its
   * own visible `ErrorState` with retry rather than a silently empty list —
   * a price is what this block exists to show, so its absence must be loud,
   * not swallowed the way `institucionesFailed` swallows the school catalog.
   */
  const [tarifas, setTarifas] = useState<TarifaPublica[]>([]);
  const [tarifasLoading, setTarifasLoading] = useState(true);
  const [tarifasError, setTarifasError] = useState<string | null>(null);
  const queryAppliedRef = useRef(false);
  /**
   * Whether `formData` currently holds a draft recovered from `sessionStorage`
   * rather than what the visitor just typed this load — see `enroll-utils.ts`'s
   * draft-persistence block for why this is safe to keep (issue #317 / #62),
   * unlike the draft issue #310 removed. Shown on screen so a restored,
   * NEVER-SENT form is never mistaken for something already on file.
   */
  const [restoredFromDraft, setRestoredFromDraft] = useState(false);
  /**
   * Gates the auto-save effect until the draft-restore effect below has had
   * its one chance to run first. Without this, both effects fire in the same
   * commit and the auto-save effect — reading `formData` as it was BEFORE the
   * restore — would immediately overwrite a good draft with the empty
   * `initialFormData` it started from.
   */
  const [draftHydrated, setDraftHydrated] = useState(false);

  // For self-enrollment, skip the representative step entirely.
  const effectiveSteps = STEP_ORDER.filter(
    (s) => s !== "representative" || formData.enrollmentType === ENROLLMENT_TYPES.CHILD,
  );
  /**
   * A URL may address any step the visitor could have walked to on their own,
   * and not one further — otherwise a shared or reloaded link would land them
   * on the summary of a form they never filled, skipping the validation the
   * wizard exists to enforce.
   *
   * Until the draft-restore effect above has had its one chance to run,
   * `formData` is still `initialFormData` even when a real draft is about to
   * land — `useWizardHistory`'s own repair effect runs in that SAME first
   * commit and would otherwise read the not-yet-restored ceiling as final and
   * permanently rewrite `?paso=3` down to `?paso=1` before the draft ever
   * gets a chance to justify it (issue #317 / #62). Staying fully permissive
   * for that one commit only matters for a URL that already names a step, and
   * self-corrects one render later once the real data (restored or not) is
   * known — a first-time visitor with no `?paso=` param is unaffected, since
   * `resolveStepFromParam` returns step 1 for a missing param regardless of
   * the ceiling.
   */
  const maxReachableStep = draftHydrated
    ? furthestReachableIndex(effectiveSteps, (s) => isStepComplete(s, formData))
    : effectiveSteps.length - 1;
  const { step, goToStep, goBack, resetToFirstStep } = useWizardHistory(
    effectiveSteps,
    maxReachableStep,
  );

  const currentIndex = effectiveSteps.indexOf(step);
  const isFirst = currentIndex === 0;
  const isLast = currentIndex === effectiveSteps.length - 1;

  // Live validation: recomputed on every keystroke, but only SHOWN for a field
  // the visitor has already left, so a pristine form is never a wall of red.
  const fieldErrors = useMemo(() => validateEnrollFields(step, formData), [step, formData]);
  const stepComplete = Object.keys(fieldErrors).length === 0;
  const blockedReason = describeStepBlocker(fieldErrors);

  function shownError(field: EnrollField): string | undefined {
    return touched.has(field) ? fieldErrors[field] : undefined;
  }

  function markTouched(field: EnrollField): void {
    setTouched((prev) => (prev.has(field) ? prev : new Set(prev).add(field)));
  }

  // Support ?type=self/?type=player or ?type=child/?type=representative
  // to preselect the enrollment flow from external CTAs.
  useEffect(() => {
    if (queryAppliedRef.current) return;
    queryAppliedRef.current = true;
    const params = new URLSearchParams(window.location.search);
    const type = params.get("type");
    if (type === "self" || type === "player") {
      setFormData((prev) => ({ ...prev, enrollmentType: ENROLLMENT_TYPES.SELF }));
    } else if (type === "child" || type === "representative") {
      setFormData((prev) => ({ ...prev, enrollmentType: ENROLLMENT_TYPES.CHILD }));
    }
  }, []);

  useEffect(() => {
    clearLegacyEnrollmentSession();
  }, []);

  // Restore a draft left by a previous load of this same tab (issue #317 /
  // #62), then let the auto-save effect below take over. Runs once — a
  // browser reload always remounts the wizard, so "once per mount" IS "once
  // per reload".
  useEffect(() => {
    const draft = loadEnrollDraft();
    if (draft) {
      setFormData(draft);
      setRestoredFromDraft(true);
    }
    setDraftHydrated(true);
  }, []);

  useEffect(() => {
    if (!draftHydrated) return;
    saveEnrollDraft(formData);
  }, [formData, draftHydrated]);

  useEffect(() => {
    fetchInstituciones()
      .then(setInstituciones)
      .catch(() => setInstitucionesFailed(true));
  }, []);

  const loadTarifas = useCallback(async (): Promise<void> => {
    setTarifasLoading(true);
    setTarifasError(null);
    try {
      setTarifas(await fetchTarifas());
    } catch (err) {
      setTarifasError(toUserMessage(err, "No se pudieron cargar las tarifas vigentes."));
    } finally {
      setTarifasLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadTarifas();
  }, [loadTarifas]);

  // ---- Helpers ----

  function updateField<K extends keyof EnrollFormData>(
    key: K,
    value: EnrollFormData[K],
  ): void {
    setFormData((prev) => ({ ...prev, [key]: value }));
    setFormErrors([]);
    // The visitor is now actively working the form again — same moment the
    // attendance wizard's own "Recuperamos las marcas…" banner drops on the
    // first action after a restore.
    setRestoredFromDraft(false);
  }

  function handleNext(): void {
    const errors = validateEnrollStep(step, formData);
    if (errors.length > 0) {
      setFormErrors(errors);
      return;
    }
    setFormErrors([]);
    const nextIdx = currentIndex + 1;
    if (nextIdx < effectiveSteps.length) {
      const nextStep = effectiveSteps[nextIdx];
      if (nextStep === "summary") setSummaryReviewed(false);
      goToStep(nextStep);
    }
  }

  /**
   * "Atrás" IS the browser's Back. A wizard with two different ways to go back
   * is a wizard where one of them throws the form away — which is exactly what
   * Back did here before the step lived in the URL.
   */
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
      setFormErrors(["Revise y confirme el resumen antes de finalizar la inscripción."]);
      return;
    }
    const errors = validateEnrollment(formData);
    if (errors.length > 0) {
      setFormErrors(errors);
      return;
    }
    setSubmitting(true);
    try {
      const response = await enrollStudent(buildEnrollmentRequest(formData));
      if (!response.enrolled) {
        throw new Error("No se pudo completar la inscripción.");
      }
      // The backend auto-logs the new user in (HttpOnly cookies set by
      // /api/enrollment); re-hydrate AuthContext now so "Ir a Mi Cuenta"
      // below lands on an already-authenticated /student instead of bouncing
      // through /login — AuthProvider otherwise only hydrates once on mount.
      await refreshSession();
      setSubmitting(false);
      setConfirmed(true);
      // The draft did its job — the data it held is now the server's record,
      // not an unsent attempt. Keeping it around would let a later reload of
      // this same tab resurrect a stale form behind the confirmation screen.
      clearEnrollDraft();
    } catch (error: unknown) {
      setSubmitting(false);
      const message = getEnrollmentErrorMessage(error);
      setFormErrors([message]);
    }
  }

  function handleReset(): void {
    setFormData(initialFormData);
    resetToFirstStep();
    setConfirmed(false);
    setSubmitting(false);
    setSummaryReviewed(false);
    setFormErrors([]);
    setTouched(new Set());
    setRestoredFromDraft(false);
    // A deliberate restart: nothing left to resurrect on the next reload.
    clearEnrollDraft();
  }

  // ---- Demo helper — quick-fill for testing convenience ----

  function fillDemoData(type: EnrollmentType): void {
    const base: Partial<EnrollFormData> = {
      contactoEmergencia: "Carlos Martinez",
      telefonoEmergencia: "0998765432",
      tipoSangre: BLOOD_TYPES.O_POSITIVO,
    };

    switch (type) {
      case "self":
        setFormData({
          ...initialFormData,
          enrollmentType: ENROLLMENT_TYPES.SELF,
          nombres: "Sofia",
          apellidos: "Martinez",
          fechaNacimiento: "1990-05-20",
          cedula: "1798765432",
          telefono: "0991234567",
          correo: "sofia@example.com",
          contrasenia: "password8",
          ...base,
        });
        break;
      case "child":
        setFormData({
          ...initialFormData,
          enrollmentType: ENROLLMENT_TYPES.CHILD,
          nombres: "Lucas",
          apellidos: "Martinez",
          fechaNacimiento: "2015-06-15",
          cedula: "1723456719",
          telefono: "0991234567",
          nombreRepresentante: "Sofia",
          apellidosRepresentante: "Martinez",
          cedulaRepresentante: "0998765432",
          fechaNacimientoRepresentante: "1990-05-20",
          telefonoRepresentante: "0991234567",
          correoRepresentante: "sofia@example.com",
          contraseniaRepresentante: "password8",
          ...base,
        });
        break;
    }
    resetToFirstStep();
    setFormErrors([]);
    setConfirmed(false);
    setSummaryReviewed(false);
    setSubmitting(false);
    setTouched(new Set());
  }

  // ---- Render helpers ----

  /** A wizard input already wired to the live per-field validation for `field`. */
  function renderField(
    field: EnrollField,
    opts: {
      label: string;
      value: string;
      onChange: (v: string) => void;
      placeholder?: string;
      type?: string;
      required?: boolean;
      icon?: React.ReactNode;
      pattern?: string;
      maxLength?: number;
      inputMode?: string;
      hint?: string;
      numericMode?: NumericFieldMode;
      autoComplete?: string;
    },
  ): React.ReactElement {
    return (
      <WizardInput
        idPrefix={ENROLL_ID_PREFIX}
        // The id is the FIELD's, not the label's — see `ENROLL_FIELD_TOKEN`.
        // This is what lets the seven "… del Representante" labels lose those
        // two words without moving forty end-to-end selectors underneath them.
        field={ENROLL_FIELD_TOKEN[field]}
        {...opts}
        disabled={submitting}
        error={shownError(field)}
        onBlur={() => markTouched(field)}
      />
    );
  }

  function renderTextarea(field: EnrollField, opts: {
    label: string;
    value: string;
    onChange: (v: string) => void;
    placeholder?: string;
    required?: boolean;
    icon?: React.ReactNode;
    rows?: number;
  }): React.ReactElement {
    return (
      <WizardTextarea
        idPrefix={ENROLL_ID_PREFIX}
        field={ENROLL_FIELD_TOKEN[field]}
        disabled={submitting}
        {...opts}
      />
    );
  }

  // ---- Step renderers ----

  function renderTypeStep(): React.ReactElement {
    return (
      <div className="space-y-section">
        <p className="text-sm text-ink-2">
          Seleccione el tipo de inscripción que desea realizar:
        </p>

        {/* `.choice` (_sistema.css:323-328). Even height via `items-stretch` +
            `h-full`, so the two cards never step on each other. Selection is
            coal plus the yellow ball dot — NEVER red: red belongs to the
            primary CTA and to destructive actions only. */}
        <div className="grid items-stretch gap-section sm:grid-cols-2">
          {ENROLLMENT_CHOICES.map((choice) => {
            const selected = formData.enrollmentType === choice.value;
            return (
              <button
                key={choice.value}
                type="button"
                aria-pressed={selected}
                onClick={() => updateField("enrollmentType", choice.value)}
                className={`flex h-full flex-col gap-field rounded-card border p-page text-left transition-colors duration-150 ${
                  selected
                    ? "border-coal bg-paper ring-1 ring-coal"
                    : "border-line-2 bg-paper hover:bg-sunken"
                }`}
              >
                <b className="text-base font-bold text-ink">{choice.title}</b>
                <p className="text-sm text-ink-2">{choice.description}</p>
                {/* Coal fill plus the yellow ball dot — the system's ONE way of
                    drawing a selected state, the same one `FilterPill` draws.
                    Not a `Badge`: the four badge tones are STATUSES, and a
                    fifth "coal" tone would be the parallel vocabulary
                    `DESIGN.md` closes the badge section by forbidding. */}
                {selected && (
                  <span className="h-badge mt-field inline-flex items-center gap-1.5 self-start rounded-full bg-coal px-[11px] text-2xs tracking-flat font-bold text-white">
                    <span aria-hidden="true" className="h-1.5 w-1.5 flex-none rounded-full bg-ball" />
                    Seleccionado
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* The consequence of the choice, on the recessed surface rather than
            on a second card: a card inside a card is a border and a shadow the
            system never asks for, and this block is a footnote to the two
            above it, not a sibling of them. */}
        <div className="rounded-ctl bg-sunken p-page">
          <p className="text-sm font-bold text-ink">
            {formData.enrollmentType === "self"
              ? "Inscripción como jugador"
              : "Inscripción de dependiente"}
          </p>
          <p className="mt-field text-sm text-ink-3-strong">
            {formData.enrollmentType === "self"
              ? "Usted será el estudiante titular de la cuenta. No se requieren datos de representante."
              : "Usted será el responsable de pago de este estudiante. Los datos del estudiante se registran por separado de su cuenta."}
          </p>
        </div>
      </div>
    );
  }

  function renderPersonalStep(): React.ReactElement {
    const isSelf = formData.enrollmentType === ENROLLMENT_TYPES.SELF;
    return (
      <div className="space-y-1">
        <p className="mb-page text-sm text-ink-2">
          {isSelf
            ? "Ingrese sus datos personales y credenciales de acceso:"
            : "Ingrese los datos personales del estudiante a inscribir:"}
        </p>

        <PersonIdentityFields
          idPrefix="enroll"
          disabled={submitting}
          nombres={formData.nombres}
          apellidos={formData.apellidos}
          fechaNacimiento={formData.fechaNacimiento}
          cedula={formData.cedula}
          telefono={formData.telefono}
          onNombresChange={(v) => updateField("nombres", v)}
          onApellidosChange={(v) => updateField("apellidos", v)}
          onFechaNacimientoChange={(v) => updateField("fechaNacimiento", v)}
          onCedulaChange={(v) => updateField("cedula", v)}
          onTelefonoChange={(v) => updateField("telefono", v)}
          errors={{
            nombres: shownError("nombres"),
            apellidos: shownError("apellidos"),
            fechaNacimiento: shownError("fechaNacimiento"),
            cedula: shownError("cedula"),
            telefono: shownError("telefono"),
          }}
          onFieldBlur={(field) => markTouched(field)}
          renderAgeWarning={(age) =>
            age < 18 && isSelf && (
              <span className="ml-1 text-state-warn">
                — Los menores de edad requieren un representante.
              </span>
            )
          }
        />

        {/* The school block — child enrolment only.
            It used to render on exactly one condition (`instituciones.length >
            0`) and therefore had exactly one failure mode: silence. A catalogue
            that could not be fetched and a club with no schools on file looked
            identical, and both looked like a step that simply does not ask. */}
        {!isSelf && institucionesFailed && (
          <div className="mt-page rounded-ctl bg-sunken p-page text-sm text-ink-3-strong">
            No pudimos cargar la lista de escuelas. Puede continuar sin
            seleccionarla: la institución es opcional y el club la registra
            después.
          </div>
        )}
        {!isSelf && instituciones.length > 0 && (
          <div className="mt-page">
            <label htmlFor="enroll-tipo-escuela" className="mb-field block text-sm font-semibold text-ink">
              Tipo de escuela
              <span className="ml-1 font-normal text-ink-3">(opcional)</span>
            </label>
            <select
              id="enroll-tipo-escuela"
              value={tipoEscuelaFilter}
              onChange={(e) => {
                setTipoEscuelaFilter(e.target.value);
                updateField("institucionId", "");
              }}
              disabled={submitting}
              className="input-field"
            >
              <option value="">Todos los tipos</option>
              {SCHOOL_TYPES.map((type) => (
                <option key={type.value} value={type.value}>
                  {type.label}
                </option>
              ))}
            </select>

            {/* The paragraph that used to sit here — "Seleccione la institución
                educativa del estudiante (opcional)" — said the label's own
                words back plus the marker the label now carries. D11c: no help
                repeats the thing it explains. */}
            <label htmlFor="enroll-institucion" className="mb-field mt-section block text-sm font-semibold text-ink">
              Escuela o institución
              <span className="ml-1 font-normal text-ink-3">(opcional)</span>
            </label>
            <select
              id="enroll-institucion"
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
                    {inst.nombre} · {schoolTypeLabel(inst.tipoEscuela)}
                  </option>
                ))}
            </select>
          </div>
        )}

        {/* Student credentials */}
        <div className="my-page h-px bg-line" />
        <div>
          {/* The icon lost its red. A decorative glyph beside a section heading
              is not the primary action and not a destructive one, which are the
              only two jobs the red has. */}
          <div className="mb-section flex items-center gap-2">
            <Mail size={ICON.sm} strokeWidth={1.5} className="text-ink-3" aria-hidden="true" />
            <h3 className="text-2xs font-bold uppercase text-ink-3">
              {isSelf ? "Credenciales de acceso" : "Cuenta del estudiante"}
            </h3>
          </div>
          {/* "(Opcional)" used to live in this heading AND in both placeholders
              below. It is stated once now, by the two labels themselves. What
              is left here is the part that explains HOW it works, which D11c
              puts behind "Ver ayuda". */}
          {!isSelf && (
            <div className="mb-section">
              <ContextualHelp title="Cuenta del estudiante">
                El menor puede tener su propio acceso, o no tenerlo. Si ingresa
                un correo y una contraseña, creamos también su cuenta; si deja
                los dos campos vacíos, la inscripción se completa igual y usted
                gestiona todo desde la suya.
              </ContextualHelp>
            </div>
          )}
          {renderField("correo", {
            label: "Correo electrónico",
            value: formData.correo,
            onChange: (v) => updateField("correo", v),
            type: "email",
            required: isSelf,
            placeholder: example("correo@ejemplo.com"),
            autoComplete: "email",
          })}
          {renderField("contrasenia", {
            label: "Contraseña",
            value: formData.contrasenia,
            onChange: (v) => updateField("contrasenia", v),
            type: "password",
            required: isSelf,
            hint: "Al menos 8 caracteres.",
            autoComplete: "new-password",
          })}
        </div>
      </div>
    );
  }

  function renderRepresentativeStep(): React.ReactElement {
    return (
      // Seven labels used to end in "del Representante" INSIDE a card titled
      // "Datos del representante" — the rule of the words again: *"ninguna
      // etiqueta que se deduzca de otra"*. The card says whose data this is;
      // the fields say which datum. What made the repetition load-bearing was
      // that the ids were slugged from those labels, which is the coupling
      // `ENROLL_FIELD_TOKEN` breaks.
      <div className="space-y-1">
        <p className="mb-page text-sm text-ink-2">
          Complete los datos del representante legal y sus credenciales de acceso:
        </p>
        {renderField("nombreRepresentante", {
          label: "Nombres",
          value: formData.nombreRepresentante,
          onChange: (v) => updateField("nombreRepresentante", v),
          placeholder: example("María Fernanda"),
          required: true,
          icon: <UserPlus size={ICON.sm} strokeWidth={1.5} aria-hidden="true" />,
          autoComplete: "given-name",
        })}

        {renderField("apellidosRepresentante", {
          label: "Apellidos",
          value: formData.apellidosRepresentante,
          onChange: (v) => updateField("apellidosRepresentante", v),
          placeholder: example("Mora Salas"),
          required: true,
          icon: <UserPlus size={ICON.sm} strokeWidth={1.5} aria-hidden="true" />,
          autoComplete: "family-name",
        })}

        {renderField("cedulaRepresentante", {
          label: "Cédula de identidad",
          value: formData.cedulaRepresentante,
          onChange: (v) => updateField("cedulaRepresentante", v),
          placeholder: example("1712345678"),
          required: true,
          icon: <Hash size={ICON.sm} strokeWidth={1.5} aria-hidden="true" />,
          pattern: "[0-9]{10}",
          inputMode: "numeric",
          numericMode: "cedula",
          hint: CEDULA_HINT,
        })}

        {renderField("fechaNacimientoRepresentante", {
          label: "Fecha de nacimiento",
          value: formData.fechaNacimientoRepresentante,
          onChange: (v) => updateField("fechaNacimientoRepresentante", v),
          type: "date",
          required: true,
          autoComplete: "bday",
        })}

        {renderField("telefonoRepresentante", {
          label: "Teléfono",
          value: formData.telefonoRepresentante,
          onChange: (v) => updateField("telefonoRepresentante", v),
          placeholder: example("0991234567"),
          inputMode: "tel",
          numericMode: "phone",
          required: true,
          hint: PHONE_HINT,
          autoComplete: "tel",
        })}

        <div className="my-page h-px bg-line" />

        {renderField("correoRepresentante", {
          label: "Correo electrónico",
          value: formData.correoRepresentante,
          onChange: (v) => updateField("correoRepresentante", v),
          type: "email",
          placeholder: example("correo@ejemplo.com"),
          required: true,
          autoComplete: "email",
        })}

        {renderField("contraseniaRepresentante", {
          label: "Contraseña",
          value: formData.contraseniaRepresentante,
          onChange: (v) => updateField("contraseniaRepresentante", v),
          type: "password",
          required: true,
          hint: "Al menos 8 caracteres.",
          autoComplete: "new-password",
        })}

        <div className="rounded-ctl border border-state-warn/25 bg-state-warn-bg p-page text-xs text-state-warn">
          <p className="flex items-center gap-1.5 font-semibold">
            <AlertTriangle size={ICON.sm} strokeWidth={2} aria-hidden="true" />
            Representante mayor de edad
          </p>
          <p className="mt-field">
            El representante debe tener entre 18 y 74 años. Al inscribir a un
            dependiente, usted confirma que es legalmente responsable del menor.
          </p>
        </div>
      </div>
    );
  }

  function renderHealthStep(): React.ReactElement {
    return (
      <div className="space-y-1">
        <p className="mb-page text-sm text-ink-2">
          Información que el club necesita conocer para la seguridad del estudiante:
        </p>

        <div className="mb-4">
          <label htmlFor="enroll-tipo-sangre" className="mb-field block text-sm font-semibold text-ink">
            Tipo de sangre
          </label>
          <select
            id="enroll-tipo-sangre"
            value={formData.tipoSangre}
            onChange={(e) => updateField("tipoSangre", e.target.value as EnrollFormData["tipoSangre"])}
            onBlur={() => markTouched("tipoSangre")}
            required
            disabled={submitting}
            aria-invalid={shownError("tipoSangre") ? true : undefined}
            className={`input-field ${shownError("tipoSangre") ? "border-state-bad" : ""}`}
          >
            <option value="">Seleccione una opción</option>
            {/* The enum with its underscore swapped for a space produced "O
                POSITIVO" here and again in the summary. `BLOOD_TYPE_LABELS` is
                the only spelling a person reads now. */}
            {Object.values(BLOOD_TYPES).map((bloodType) => (
              <option key={bloodType} value={bloodType}>
                {BLOOD_TYPE_LABELS[bloodType]}
              </option>
            ))}
          </select>
          {shownError("tipoSangre") && (
            <p className="mt-field flex items-center gap-1.5 text-xs font-semibold text-state-bad">
              <AlertTriangle size={ICON.sm} strokeWidth={2} className="shrink-0" aria-hidden="true" />
              {shownError("tipoSangre")}
            </p>
          )}
        </div>

        {renderTextarea("condicionesSalud", {
          label: "Condiciones de salud",
          value: formData.condicionesSalud,
          onChange: (v) => updateField("condicionesSalud", v),
          placeholder: example("asma, diabetes, lesiones previas"),
          icon: <Heart size={ICON.sm} strokeWidth={1.5} aria-hidden="true" />,
          rows: 2,
        })}

        {renderTextarea("alergias", {
          label: "Alergias",
          value: formData.alergias,
          onChange: (v) => updateField("alergias", v),
          placeholder: example("polvo, látex, picaduras de insectos"),
          icon: <AlertTriangle size={ICON.sm} strokeWidth={1.5} aria-hidden="true" />,
          rows: 2,
        })}

        <EmergencyContactFields
          idPrefix="enroll"
          disabled={submitting}
          contacto={formData.contactoEmergencia}
          telefono={formData.telefonoEmergencia}
          onContactoChange={(v) => updateField("contactoEmergencia", v)}
          onTelefonoChange={(v) => updateField("telefonoEmergencia", v)}
          contactoError={shownError("contactoEmergencia")}
          telefonoError={shownError("telefonoEmergencia")}
          onContactoBlur={() => markTouched("contactoEmergencia")}
          onTelefonoBlur={() => markTouched("telefonoEmergencia")}
        />

        {renderTextarea("observaciones", {
          label: "Observaciones adicionales",
          value: formData.observaciones,
          onChange: (v) => updateField("observaciones", v),
          placeholder:
            "Cualquier otra información relevante que el club deba conocer",
          icon: <FileText size={ICON.sm} strokeWidth={1.5} aria-hidden="true" />,
          rows: 2,
        })}

        {/* `rounded-xl` (12px) was a third radius on a screen that already had
            two, and the second line was `text-blue-700` — a raw Tailwind blue,
            a colour that exists nowhere in the palette, inside an amber box.
            One tone, one radius: this is a `warn` notice and it says so all the
            way through. */}
        <div className="rounded-ctl border border-state-warn/25 bg-state-warn-bg p-page text-xs text-state-warn">
          <p className="flex items-center gap-1.5 font-semibold">
            <AlertTriangle size={ICON.sm} strokeWidth={2} aria-hidden="true" />
            Datos sensibles
          </p>
          <p className="mt-field">
            Esta información se maneja de forma segura conforme a la normativa
            de protección de datos.
          </p>
        </div>
      </div>
    );
  }

  /**
   * One 56px detail row with the step it came from — `.drow`
   * (_sistema.css:247-250).
   *
   * `duplicateCandidate: true` flags a row as one of the fields a
   * duplicate-identity 400 could not tell apart (issue #233): student
   * cédula, representative cédula, representative correo. When the backend
   * answers with that error, EVERY candidate row gets the SAME "Revisar"
   * marker — never just one — so the visitor's eye lands on the right
   * "Corregir" button without the app ever singling out which field was
   * actually the duplicate. The marker lives here, outside `WizardNavigation`'s
   * alert box: `enroll-qa.spec.ts`'s S09 pins the alert itself to never
   * mention "cédula" or "correo" at all, so any field-naming guidance has to
   * live somewhere else on the page.
   */
  function summaryRow(
    label: string,
    value: React.ReactNode,
    correctStep: WizardStep,
    opts: { duplicateCandidate?: boolean } = {},
  ): React.ReactElement {
    const flagged = Boolean(opts.duplicateCandidate) && formErrors.some(isDuplicateIdentityError);
    return (
      <li
        key={label}
        className={`flex min-h-drow flex-wrap items-center gap-x-4 gap-y-field px-4 py-2 ${
          flagged ? "bg-state-warn-bg" : ""
        }`}
      >
        <span className="w-[150px] flex-none text-2xs font-bold uppercase text-ink-3">
          {label}
        </span>
        <span className="min-w-0 flex-1 text-sm font-semibold text-ink">{value}</span>
        {/* The flag is a STATUS, so it is the badge the system already has —
            not a second uppercase micro-label invented for this one row. */}
        {flagged && <Badge tone="warn">Revisar</Badge>}
        <Button variant="secondary" size="sm" className="flex-none" onClick={() => goToStep(correctStep)}>
          Corregir
        </Button>
      </li>
    );
  }

  function renderSummary(): React.ReactElement {
    const age = formData.fechaNacimiento ? calculatePersonAge(formData.fechaNacimiento) : null;
    const ageLabel = age !== null && !Number.isNaN(age) ? ` · ${age} años` : "";
    const isChild = formData.enrollmentType === ENROLLMENT_TYPES.CHILD;
    return (
      <div className="space-y-section">
        <p className="text-sm text-ink-2">
          Esto es lo que vamos a crear. Corrija cualquier bloque antes de confirmar:
        </p>

        {/* One list of 56px rows, one datum per row — replaces four cramped
            two-column grids. Each row links back to the step that owns it.
            The frame is `DataRowList`, which is where the border, the radius
            and the hairlines between rows already live; this screen used to
            redraw all three by hand. The ROW is still local: `DataRow` leads
            with a `flex-1` name and this list leads with a fixed 150px label
            column, so it is a different row, not the same row spelled twice —
            see the note in the comparison. */}
        <DataRowList>
          {summaryRow(
            "Tipo",
            isChild ? "Representante — inscribe a un dependiente" : "Jugador — titular de su propia cuenta",
            "type",
          )}
          {summaryRow(
            "Estudiante",
            `${formData.nombres} ${formData.apellidos}`.trim() + ageLabel,
            "personal",
          )}
          {summaryRow("Cédula", formData.cedula || "—", "personal", { duplicateCandidate: true })}
          {summaryRow("Teléfono", formData.telefono || "—", "personal")}
          {isChild
            ? summaryRow(
                "Institución",
                instituciones.find((inst) => String(inst.id) === formData.institucionId)?.nombre
                  ?? "Sin institución asignada",
                "personal",
              )
            : null}
          {isChild
            ? summaryRow(
                "Representante",
                `${formData.nombreRepresentante} ${formData.apellidosRepresentante}`.trim() || "—",
                "representative",
              )
            : null}
          {summaryRow(
            isChild ? "Correo del representante" : "Correo",
            (isChild ? formData.correoRepresentante : formData.correo) || "—",
            isChild ? "representative" : "personal",
            { duplicateCandidate: isChild },
          )}
          {isChild && formData.correo.trim()
            ? summaryRow("Cuenta del estudiante", formData.correo, "personal")
            : null}
          {summaryRow(
            "Tipo de sangre",
            formData.tipoSangre ? BLOOD_TYPE_LABELS[formData.tipoSangre] : "—",
            "health",
          )}
          {summaryRow(
            "Contacto de emergencia",
            `${formData.contactoEmergencia} · ${formData.telefonoEmergencia}`.trim(),
            "health",
          )}
          {summaryRow("Condiciones de salud", formData.condicionesSalud || "Ninguna reportada", "health")}
          {summaryRow("Alergias", formData.alergias || "Ninguna reportada", "health")}
          {formData.observaciones
            ? summaryRow("Observaciones", formData.observaciones, "health")
            : null}
        </DataRowList>

        <p className="text-sm text-ink-2">
          Al confirmar creamos {isChild ? "su cuenta de representante y el perfil del estudiante" : "su cuenta de estudiante"}.
          Después podrá subir el comprobante:{" "}
          <b className="font-semibold text-ink">el club lo valida y recién ahí se activa la membresía</b>.
        </p>

        {/* `sunken`, not `canvas` — the same inverted ladder as the age well:
            this box is recessed INSIDE the paper card, and `canvas` is the
            surface the page itself stands on. */}
        <label className="flex cursor-pointer items-start gap-3 rounded-ctl border border-line-2 bg-sunken p-page text-sm text-ink-2">
          <input
            type="checkbox"
            checked={summaryReviewed}
            onChange={(e) => {
              setSummaryReviewed(e.target.checked);
              setFormErrors([]);
            }}
            /* `focus:ring-ball` was inert twice over: it names a colour with
               no ring width, and `@tailwindcss/forms` (which is what would
               give a checkbox a ring at all) is not installed. Focus is marked
               by the system indicator in `globals.css`.
               `h-4 w-4` (16px) was hallazgo #9 (#312): the one control that
               unlocks the whole form, and the smallest target on the screen —
               under WCAG 2.2 SC 2.5.8's 24x24px floor. `h-6 w-6` clears it;
               the enclosing `<label>` already makes the whole row clickable. */
            className="mt-0.5 h-6 w-6 rounded border-line-2 text-coal"
          />
          {/* The second line under this one — "Esto evita finalizar la
              inscripción por accidente al llegar al último paso" — was the
              product explaining its own defensive design to the person using
              it. The sentence above already says what to do and what it means;
              D11c's rule is that no help repeats the thing it explains. */}
          <span>Revisé el resumen y confirmo que la información está correcta.</span>
        </label>
      </div>
    );
  }

  // ---- Render ----

  return (
    // The public enrolment wizard reaches the user through no shell, so the
    // landmark is declared here — around BOTH branches, so the confirmation
    // screen is as much "principal" as the form it replaces. It used to borrow
    // the root layout's, which is the wrapper that stopped being one.
    <main>
      {confirmed ? (
        /* The confirmation used to declare its own emptiness: `min-h-[75vh]`
           reserved for a ~300px box, and the box was pinned to the TOP of that
           reservation — 44% dead air at 1440×900, the worst number on the
           wizard and more than half the window under the last button.
           Two things changed, and only one of them is layout.
           · The surplus is SPLIT, not dumped at the bottom. That is the answer
             `EmptyState` already wrote down for itself: *"half the air at each
             end reads as margin; all of it at one end reads as a mistake."*
             A block centred on the page is the same shape the login settled on
             for the same reason.
           · The screen says what happens next. It used to end at "ha sido
             registrado" plus two buttons, which is a confirmation that answers
             none of the three questions an end state owes (D11: what happened,
             why, what to do). The three lines below are the club's real
             process — the summary step already promises them in writing — and
             not one of them invents a datum: no plan, no amount, no date.
           A `<h1>` and not `EmptyState`'s `<b>`: this is the page's title, two
           end-to-end cases pin it as a heading, and a confirmation is not an
           empty state — see "Lo que falta" in the comparison. */
        /* `100vh` minus the 5rem that `app-main` (`src/app/layout.tsx`) puts
           above and below every route as `py-10`. `min-h-screen` here measured
           right but overflowed the window by exactly those 80px, which turned
           a confirmation into a page that scrolls to show nothing. */
        <div className="flex min-h-[calc(100vh-5rem)] items-center justify-center px-4">
          <div className="card w-full max-w-[560px] overflow-hidden">
            {/* The coal shoulder (D7): the one card on this screen that asks
                for something, and the only one — the rule caps it at one per
                row, and here there is one card. It is also the only moment in
                the wizard where the club gets to speak in its own colours. */}
            <div className="flex justify-end bg-coal px-page py-2">
              <span className="text-2xs font-bold uppercase text-ball">
                Bienvenido al club
              </span>
            </div>

            {/* One alignment for the whole card. A centred statement above a
                left-aligned list is two axes in one box — literally the
                "cosas desalineadas" the client named — and the list is the
                part that has to be read, so the axis is the list's. */}
            <div className="flex flex-col gap-page p-page">
              <div className="flex flex-col items-start gap-section">
                <span
                  aria-hidden="true"
                  className="flex h-12 w-12 items-center justify-center rounded-full bg-state-ok-bg"
                >
                  <CheckCircle size={ICON.lg} className="text-state-ok" strokeWidth={1.5} />
                </span>
                {/* Graduate at the headline step, with no weight class: the
                    face ships a single 400 cut, so the `font-bold` this line
                    used to carry could only ask the browser to fake one. And
                    `state-ok`, not `cata-state-ok` (#15803D) — the ramp's green
                    is #137739, and the disc was tinted at 10% opacity where the
                    ramp already has an opaque `state-ok-bg`. */}
                <h1 className="font-display text-xl uppercase tracking-flat text-ink">
                  Inscripción completada
                </h1>
                <p className="max-w-[44ch] text-sm text-ink-2">
                  <b className="font-semibold text-ink">
                    {formData.nombres} {formData.apellidos}
                  </b>{" "}
                  ha sido registrado como estudiante de Cata Club.{" "}
                  {formData.enrollmentType === "self"
                    ? "Usted es el titular de la cuenta y el estudiante."
                    : "Usted es el representante y responsable de pago de este estudiante."}
                </p>
              </div>

              <div>
                <p className="mb-section text-2xs font-bold uppercase text-ink-3">
                  Qué sigue
                </p>
                {/* No `01/02/03`: the sequence is real, but the numbering is
                    the landing's device and `DESIGN.md` keeps it out of the
                    product. The dot marks the item; the order does the rest.
                    It is `ink-3` and not red: red is the action and this is a
                    bullet, which is the exact substitution — decoration
                    wearing the one colour that means "press me" — that this
                    screen spent seven asterisks on. */}
                <ol className="space-y-section">
                  {[
                    "Su cuenta ya está creada y la sesión, iniciada.",
                    /* #348: "Mis pagos" no tiene ningún botón para el primer
                       pago -- registrarlo requiere una membresía que todavía
                       no existe, y crearla es una acción exclusiva del
                       administrador (ver membresia_pago_servicio.
                       registrar_pago, que exige una membresia_id ya
                       existente, y crear_membresia, ROL_ADMIN). La
                       confirmación no puede mandar al socio recién creado a
                       una pantalla sin la acción que promete: la verdad es
                       la misma que ya dice student-utils.ts para ese estado
                       ("El club crea la membresía al registrar el primer
                       pago. Acérquese a administración..."). */
                    "Acérquese a administración o escríbanos por WhatsApp para registrar su primer pago.",
                    "El club lo valida y ahí se activa la membresía.",
                  ].map((linea) => (
                    <li key={linea} className="flex items-start gap-3 text-sm text-ink-2">
                      <span
                        aria-hidden="true"
                        className="mt-2 h-1.5 w-1.5 flex-none rounded-full bg-ink-3"
                      />
                      {linea}
                    </li>
                  ))}
                </ol>
              </div>

              <div className="flex flex-col gap-3 sm:flex-row">
                <Link href="/student" className={buttonClasses("primary")}>
                  Ir a mi cuenta
                </Link>
                <Button variant="secondary" onClick={handleReset}>
                  Nueva inscripción
                </Button>
              </div>
            </div>
          </div>
        </div>
      ) : (

        /* One column, three levels of rhythm and no fourth. The page step is a
           `gap` on this column instead of an `mb-*` written seven times by
           hand — the wizard had seven first-level distances (24px, 24px, 32px,
           24px, 16px…) and separated the same kind of work with 16px on one
           step and 32px on the next. This screen renders no `AppShell`, so the
           rhythm lock in `page-rhythm-wrapper.test.ts` never looked at it; the
           doctrine still applies. */
        <div className="mx-auto flex w-full max-w-[760px] flex-col gap-page px-4 py-page">
          {/* One back-navigation rule: a sub-page carries a `BackLink` at the
              TOP, where back navigation lives everywhere else in the product.
              This used to be a centred text link at the very bottom of a
              five-step wizard — the one place a visitor who wants out is not
              looking.

              The destination is conditional because this wizard is public
              (see PUBLIC_EXCEPTIONS in src/lib/middleware-utils.ts): most
              visitors arrive from the landing with no account, and sending
              them to `/student` would bounce them straight to /login, which
              is the wall the landing funnel exists to route around.

              Dos cosas que la primera pasada del #295 dio por buenas y no lo
              eran, porque la condición se LEE bien:

              1. Decidía sin saber. `isAuthenticated` es false mientras la
                 sesión se hidrata — `AuthContext` arranca en `session: null,
                 isLoading: true` y recién resuelve tras un round trip — así
                 que un usuario logueado veía "Volver al Inicio" en esa ventana
                 y, si tocaba ahí, la promesa se cumplía: salía a la landing.
                 Mientras no se sabe, no se ofrece destino; el hueco reserva la
                 altura del control para que la fila no salte cuando aparece.
              2. `/student` no es la casa de todos. Un admin o un entrenador
                 logueado no vuelve al portal del alumno. `backHrefForRole`
                 resuelve la casa de cada rol, y es la MISMA función que usa
                 /ayuda: la regla se escribió dos veces y la segunda salió
                 mal. */}
          {/* Back on the left, help on the right — the two things a visitor
              reaches for when a five-step form stops making sense. The
              assistant is public (`POST /chatbot` needs no session), which is
              the point: most people filling this in have no account yet. */}
          {/* The two elements no longer carry margins of their own: the column
              above puts the page step between blocks, which is the whole point
              of the doctrine — a distance belongs to the container, not to
              each thing inside it. */}
          <div className="flex flex-wrap items-center justify-between gap-3">
            {isLoading ? (
              <span className="h-ctl-sm" aria-hidden="true" />
            ) : (
              <BackLink href={backHrefForRole(session?.user.role)} />
            )}
            <HelpChatLauncher
              variant="quiet"
              label="¿Tiene dudas? Pregunte al asistente"
            />
          </div>

          {/* Step header + the NAMED stepper. The five steps are named from
              step one: "Paso 2 de 5" anticipates nothing, "Contacto" does.

              The title is `PageHeader`'s now, and that is the point: the `<h1>`
              was `text-xl font-extrabold`, which resolves to Barlow — the same
              defect `PageHeader` was fixed for one level up, drawn by hand
              here so the fix never reached it. `PageHeader` owns the face
              (Graduate), the case, the flat tracking and the absent weight
              class; this screen owns only the eyebrow above it, which the
              primitive has no slot for. */}
          <div>
            {/* `ink-3-strong`, not `ink-3`: this block sits on the PAGE
                surface (#F4F4F7, the body fill), not inside a card, and
                `ink-3` only clears AA on `paper` — it measures 4.21:1 here.
                Same reason `PageHeader` uses the companion token. */}
            <p className="mb-field text-2xs font-bold uppercase text-ink-3-strong">
              {isFirst ? "Paso 1" : `Paso ${currentIndex + 1} de ${effectiveSteps.length}`}
            </p>
            {/* The count is read from `effectiveSteps`, not written out: this
                copy said "Cinco pasos" while the line directly above it said
                "Paso 1 de 4", because arriving from the landing with
                `?type=self` already answers the first step and drops it.
                #317 / hallazgo #31: on step 1 itself, `effectiveSteps.length`
                is not yet a COMMITTED fact — the visitor can still swap
                Jugador/Representante on the very card in front of them, and
                doing so used to flip "Paso 1 de 4" to "Paso 1 de 5" mid-decision.
                A promise that changes in response to the click that made it is
                worse than a vague one, so step 1 states both possibilities and
                the resolved count is deferred to the step that actually
                depends on it — the same alternative the finding names. */}
            <PageHeader
              title="Inscripción de estudiante"
              subtitle={
                isFirst
                  ? "4 o 5 pasos y queda dentro del club, según quién se inscriba."
                  : `${effectiveSteps.length} pasos y queda dentro del club.` +
                    (formData.enrollmentType === "self"
                      ? " Se inscribe usted como jugador."
                      : " Usted actúa como representante.")
              }
            />
          </div>

          <Stepper
            label="Pasos de la inscripción"
            current={currentIndex + 1}
            steps={effectiveSteps.map((s) => STEP_SHORT_LABELS[s])}
          />

          {/* Issue #317 / hallazgo #62: recuperado de `sessionStorage`, no del
              servidor — nada de esto se envió todavía. El rótulo lo dice para
              que un dato restaurado nunca se confunda con uno ya guardado, la
              misma distinción que #310 (K3) cerró del lado de asistencias. */}
          {restoredFromDraft && (
            <p className="rounded-ctl border border-line bg-canvas px-3.5 py-2.5 text-xs text-ink-2">
              Recuperamos los datos que ya había completado. Todavía no se han
              enviado — revíselos antes de continuar.
            </p>
          )}

          {/* Demo helper — quick-fill for testing convenience. The "(solo
              desarrollo)" label used to be the ONLY thing stopping this from
              reaching real visitors; `isDemoQuickFillEnabled` is the actual
              guard. See its doc comment for why it reads NODE_ENV. */}
          {demoQuickFillEnabled && (
            <div className="rounded-card border border-dashed border-line-2 bg-sunken p-page">
              <div className="mb-field flex items-center gap-2">
                <AlertTriangle size={ICON.sm} strokeWidth={1.5} className="text-state-warn" aria-hidden="true" />
                {/* Both lines were translucent ink over the `sunken` panel:
                    `/45` composited to #9499A1 (2.61:1) and `/40` to #9FA3AA
                    (2.31:1), the two worst pairs in the product. The panel is
                    dev-only (`isDemoQuickFillEnabled` gates it on NODE_ENV) so
                    it never reaches a visitor — but a token swap costs nothing
                    and the panel is unreadable to the developers who DO see it. */}
                <p className="text-2xs font-semibold uppercase tracking-wider text-ink-3-strong">
                  Rellenar datos de prueba (solo desarrollo)
                </p>
              </div>
              <p className="mb-section text-2xs tracking-flat leading-relaxed text-ink-3-strong">
                Llena los campos automáticamente pero no salta la validación — los pasos deben completarse uno por uno.
              </p>
              {/* Two hand-rolled buttons with their own border, their own
                  radius and their own hover became the `secondary` skin at the
                  compact size — the same control the "Corregir" rows use. */}
              <div className="flex flex-wrap gap-2">
                <Button variant="secondary" size="sm" onClick={() => fillDemoData("self")}>
                  Jugador
                </Button>
                <Button variant="secondary" size="sm" onClick={() => fillDemoData("child")}>
                  Representante
                </Button>
              </div>
            </div>
          )}

          {/* Public tariff catalog (issue #331, consumes the public BFF/
              backend contract of #394) — shown ONLY on step 1, before the
              visitor's first field, so anyone knows the price before they
              start. Public and harmless data: unlike the demo panel above,
              this is NOT gated on auth or environment, and unlike
              `institucionesFailed` (a silently-empty auxiliary list), a
              failure here gets its own loud `ErrorState` with retry — the
              whole point of this block is showing a price, so its absence
              must say so. */}
          {step === "type" && (
            <div className="card p-page">
              <h2 className="mb-page font-display text-lg uppercase tracking-flat text-ink">
                Tarifas vigentes
              </h2>
              {tarifasLoading ? (
                <LoadingState label="Cargando tarifas…" />
              ) : tarifasError ? (
                <ErrorState message={tarifasError} onRetry={() => void loadTarifas()} />
              ) : tarifas.length === 0 ? (
                <EmptyState
                  surface="inset"
                  title="Sin tarifas publicadas"
                  description="Todavía no hay categorías de membresía configuradas."
                />
              ) : (
                <ul className="space-y-field">
                  {tarifas.map((tarifa) => (
                    <li
                      key={tarifa.categoria}
                      className="flex items-center justify-between gap-3 text-sm"
                    >
                      <span className="text-ink-2">{tarifa.categoria}</span>
                      <b className="text-ink">{formatCurrency(tarifa.precio)}</b>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {/* Form card */}
          <div className="card p-page">
            {/* The card title was `text-sm font-bold` — 13.5px of Barlow, the
                DENSE step, which is the size of a table cell. It was smaller
                than the labels of the fields inside it, so the title of the
                block and the contents of the block were told apart by weight
                alone. It takes the `title` step now: Graduate, 20px, uppercase,
                flat tracking, and no weight class — the face has a single 400
                cut. Same correction `PageHeader` and `StatCard` already had. */}
            <h2 className="mb-page font-display text-lg uppercase tracking-flat text-ink">
              {STEP_LABELS[step]}
            </h2>

            <form onSubmit={handleConfirm}>
              {/* Step content */}
              {step === "type" && renderTypeStep()}
              {step === "personal" && renderPersonalStep()}
              {step === "representative" && renderRepresentativeStep()}
              {step === "health" && renderHealthStep()}
              {step === "summary" && renderSummary()}

              <WizardNavigation
                formErrors={formErrors}
                duplicateIdentityAudience="self-service"
                isFirst={isFirst}
                isLast={isLast}
                submitting={submitting}
                onBack={handleBack}
                onNext={handleNext}
                nextDisabled={!stepComplete}
                nextBlockedReason={blockedReason ?? undefined}
                submitButton={
                  <Button
                    type="submit"
                    variant="primary"
                    disabled={submitting || !summaryReviewed}
                    className="disabled:cursor-not-allowed"
                  >
                    {submitting ? (
                      "Inscribiendo…"
                    ) : (
                      <>
                        <CheckCircle size={ICON.sm} strokeWidth={2} aria-hidden="true" />
                        Confirmar inscripción
                      </>
                    )}
                  </Button>
                }
                // #312 / hallazgo #2: el paso 5 apagaba este botón sin decir
                // por qué — la MISMA falla de mensaje que `nextBlockedReason`
                // ya arregla en los pasos 2-4, así que reusa el mismo prop.
                submitBlocked={!submitting && !summaryReviewed}
                submitBlockedReason="Para continuar, marque la casilla de confirmación."
              />
            </form>
          </div>

        </div>
      )}
    </main>
  );
}

export default function EnrollPage(): React.ReactElement {
  // The wizard keeps its step in the query string, and `useSearchParams` needs
  // a boundary to fall back to during prerender.
  return (
    <Suspense>
      <EnrollWizard />
    </Suspense>
  );
}
