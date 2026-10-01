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
  fetchTarifas,
  type TarifaPublica,
} from "@/services/api";
import { useAuth } from "@/contexts/AuthContext";
import type { AuthSession, SessionOutcome } from "@/services/auth";
import { backHrefForRole } from "@/lib/auth-utils";
import { isActivationComplete, routeForSession } from "@/lib/activation-reasons";
import { toUserMessage } from "@/lib/error-message";
import { formatCurrency } from "@/lib/format-utils";
import { clearLegacyEnrollmentSession } from "@/lib/enrollment-session";
import { furthestReachableIndex, useWizardHistory } from "@/lib/wizard-history";
import { DuplicateIdentityHelp } from "@/components/DuplicateIdentityHelp";
import LegalReviewDialog, { type LegalReviewDocumentId } from "@/components/legal/LegalReviewDialog";
import {
  WizardInput,
  BirthDateField,
  WizardTextarea,
  PhoneField,
  EmergencyContactFields,
  birthDatePartIds,
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
  Stepper,
  buttonClasses,
} from "@/components/ui";
import PasswordStrengthMeter from "@/components/ui/PasswordStrengthMeter";
import { BLOOD_TYPES, BLOOD_TYPE_LABELS, SELECTABLE_BLOOD_TYPES } from "@/types/enrollment";
import {
  User,
  UserPlus,
  Heart,
  CheckCircle,
  AlertTriangle,
  Hash,
  FileText,
  Mail,
  Calendar,
} from "lucide-react";
import { ICON } from "@/lib/icon-size";
import {
  calculatePersonAge,
  EDAD_MAXIMA_ALUMNO,
  EDAD_MAYORIA_EDAD,
  isPlausibleHumanAge,
  studentBirthDateBounds,
  toStoredPhone,
} from "@/lib/identity-validation";
import type { NumericFieldMode } from "@/lib/numeric-input";
import { isDuplicateIdentityError } from "@/lib/duplicate-identity";
import {
  buildEnrollmentRequest,
  clearEnrollDraft,
  ENROLLMENT_TYPES,
  digitsOf,
  fieldsForStep,
  getEnrollmentErrorMessage,
  isDemoQuickFillEnabled,
  loadEnrollDraft,
  saveEnrollDraft,
  shouldFocusStepHeadingOnJump,
  validateEnrollFields,
  validateEnrollStep,
  validateEnrollment,
  ENROLL_ID_PREFIX,
  enrollFieldId,
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
import FieldSlot, { EnrollFieldGrid } from "./EnrollFieldSlot";
import { cn } from "@/components/ui/cn";
import EnrollFrame from "./EnrollFrame";
import EnrollNav from "./EnrollNav";
import EnrollSteps from "./EnrollSteps";
import useWideLayout from "./useWideLayout";
import EnrollSummary from "./EnrollSummary";

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

// ---------------------------------------------------------------------------
// Confirmation copy when the auto-login could not be confirmed (issue #717)
// ---------------------------------------------------------------------------

/**
 * What the confirmation screen says when the session round trip did not come
 * back `authenticated`.
 *
 * Every sentence here opens by stating that the enrolment is REGISTERED and
 * the account EXISTS, because at this point both are facts — the backend
 * answered 201 and the student row is written. The only thing that failed is
 * the session, and a message that let that read as "the enrolment failed"
 * would push a parent to enrol the same child twice. That is the one risk
 * this screen carries that the login screen does not, so "no repita la
 * inscripción" is stated outright rather than implied.
 *
 * The two kinds are kept apart for the same reason #712 kept them apart on
 * `/login`: a 503 says nothing about the browser's cookie jar, and telling
 * someone to go change a cookie setting during a backend outage sends them
 * to fix something that was never broken.
 */
function unconfirmedSessionNotice(kind: "unauthenticated" | "outage"): string {
  if (kind === "outage") {
    return (
      "Su inscripción quedó registrada y su cuenta ya está creada, pero no pudimos confirmar el inicio " +
      "de sesión porque el servicio no está disponible en este momento. No repita la inscripción: " +
      "espere unos minutos e inicie sesión con su correo y su contraseña."
    );
  }
  return (
    "Su inscripción quedó registrada y su cuenta ya está creada, pero este navegador no guardó la sesión. " +
    "Suele ocurrir cuando las cookies están bloqueadas o la ventana es de navegación privada. No repita la " +
    "inscripción: habilite las cookies para este sitio e inicie sesión con su correo y su contraseña."
  );
}

// ---------------------------------------------------------------------------
// The account-area button, once the session round trip is confirmed
// ---------------------------------------------------------------------------

/**
 * Where the "Ir a mi cuenta" button points once the auto-login is confirmed,
 * and what it says — issue #1055.
 *
 * A CONFIRMED session is not necessarily an ACTIVATED one: `/student` sits
 * behind `middleware.ts`'s activation gate, and offering it to an account
 * still stuck there is the same silent bounce #717 already fixed for an
 * unconfirmed session — just one gate further in. `routeForSession` is the
 * same gate `/login` already obeys (issue #940); this screen had never asked
 * it and pointed at a hardcoded `/student` regardless.
 */
function accountAreaLinkFor(session: AuthSession): { href: string; label: string } {
  const href = routeForSession(session);
  return isActivationComplete(session)
    ? { href, label: "Ir a mi cuenta" }
    : { href, label: "Completar mi activación" };
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
  /**
   * Whether the auto-login that /api/enrollment performs actually took, as
   * answered by the session round trip in `handleConfirm` (issue #717).
   *
   * `null` until an enrolment completes. The three states are the three the
   * login screen already distinguishes since #711, for the same reasons:
   * · `authenticated`   — the browser kept the cookies. Nothing changes.
   * · `unauthenticated` — it did not (cookies blocked, private window,
   *   Safari's ITP, a proxy stripping Set-Cookie, a `Secure` cookie over
   *   plain http). The account EXISTS; only the session does not.
   * · `outage`          — a 503 or a network failure on the confirmation,
   *   which says nothing about the cookies and must not be blamed on the
   *   browser. Same distinction #712 drew, and it has to survive here.
   *
   * The enrolment itself succeeded in all three: the 201 is already in
   * hand when this is written. That is the one thing this screen must not
   * get wrong — a message that reads as "it failed" would send someone to
   * enrol their child a second time.
   */
  const [sessionOutcome, setSessionOutcome] = useState<SessionOutcome["kind"] | null>(null);
  /**
   * Deliberately `=== "authenticated"` and not `!== "unauthenticated"`: an
   * `outage` is not a confirmation either. The screen may only claim a
   * session it has an answer for.
   */
  const sessionConfirmed = sessionOutcome === "authenticated";
  const [summaryReviewed, setSummaryReviewed] = useState(false);
  // The missing-checkbox error is shown only after confirming was attempted
  // (or the box was ticked and then cleared), never on arrival at the step.
  const [confirmAttempted, setConfirmAttempted] = useState(false);
  // #1368 — which grouped legal document is under review, or none. Reviewing
  // is an overlay on the summary step: it must never unmount this component,
  // because everything the visitor entered (and the consent decision itself)
  // lives here.
  const [legalReviewDoc, setLegalReviewDoc] = useState<LegalReviewDocumentId | null>(null);
  const [formErrors, setFormErrors] = useState<string[]>([]);
  const [touched, setTouched] = useState<Set<EnrollField>>(new Set());
  /**
   * How many times "Siguiente" has been pressed on an incomplete step. Only
   * the effect below reads it: it needs the errors of THIS attempt to be on
   * screen before it can find the first `aria-invalid` field, so the focus
   * move rides the commit instead of racing it.
   */
  const [attemptCount, setAttemptCount] = useState(0);
  const [attemptedStep, setAttemptedStep] = useState<WizardStep | null>(null);
  const formRef = useRef<HTMLFormElement>(null);
  /**
   * Issue #331: the public tariff catalog shown on step 1, BEFORE the
   * visitor's first field. A failure here gets its own visible `ErrorState`
   * with retry — a price is what this block exists to show, so its absence
   * must be loud, not silently empty.
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
  const wide = useWideLayout();
  const isLast = currentIndex === effectiveSteps.length - 1;

  /**
   * #1332 (R3-001, review advisory de #1331): a completed `Stepper` pill or
   * compact dot turns into a `<span>` the instant it becomes the active
   * step, so the element that had focus is unmounted — the browser then
   * drops focus to `<body>`, silently, for mouse and screen-reader users
   * alike. This is the destination step's own `<h2>{STEP_LABELS[step]}</h2>`
   * below — already the one heading that names every step correctly, the
   * same one N01-N03 assert on in the Playwright suite — made a
   * programmatic focus target (`tabIndex={-1}`: never in the Tab order,
   * only reachable via `.focus()`).
   *
   * `stepHeadingRef` is the target; `focusStepHeadingOnNextStepChange` is a
   * one-shot flag so ordinary forward/back navigation (`handleNext`,
   * `handleBack`), which already lands focus sensibly via the button that
   * was clicked, is left alone — only a Stepper-originated jump steals
   * focus. The move happens in an effect keyed on `step`, not inline in the
   * click handler, so it runs AFTER the heading's text has already
   * re-rendered for the destination step.
   *
   * Its real lifetime, spelled out by its name: it is consumed the next time
   * `step` actually changes, not "on the next render". `handleStepperJump`
   * only arms it when the jump changes the step
   * (`shouldFocusStepHeadingOnJump`, issue #1347 item 1) — `goToStep`
   * already no-ops on a same-step jump (`wizard-history.ts`), so arming it
   * unconditionally would leave it armed for nothing to consume, and the
   * NEXT ordinary "Siguiente"/"Atrás" would steal focus to the heading in
   * the jump's place.
   */
  const stepHeadingRef = useRef<HTMLHeadingElement>(null);
  const focusStepHeadingOnNextStepChange = useRef(false);

  useEffect(() => {
    if (!focusStepHeadingOnNextStepChange.current) return;
    focusStepHeadingOnNextStepChange.current = false;
    stepHeadingRef.current?.focus();
  }, [step]);

  useEffect(() => {
    if (attemptCount === 0) return;
    const firstInvalid = formRef.current?.querySelector<HTMLElement>("[aria-invalid='true']");
    if (!firstInvalid) return;
    // The birth date is a `<fieldset>`; the control to focus is its first part.
    const target =
      firstInvalid.tagName === "FIELDSET"
        ? document.getElementById(birthDatePartIds(firstInvalid.id).day)
        : firstInvalid;
    target?.focus();
  }, [attemptCount]);

  function handleStepperJump(index: number): void {
    const destination = effectiveSteps[index];
    if (shouldFocusStepHeadingOnJump(destination, step)) {
      focusStepHeadingOnNextStepChange.current = true;
    }
    goToStep(destination);
  }

  // Live validation: recomputed on every keystroke, but only SHOWN for a field
  // the visitor has already left, so a pristine form is never a wall of red.
  const fieldErrors = useMemo(() => validateEnrollFields(step, formData), [step, formData]);
  const invalidCount = Object.keys(fieldErrors).length;

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
    // The whole step at once: every field is marked, so every message shows
    // under its own control, and from here on each one re-validates as the
    // visitor corrects it.
    if (validateEnrollStep(step, formData).length > 0) {
      const stepFields = fieldsForStep(step, formData.enrollmentType);
      setTouched((prev) => new Set([...prev, ...stepFields]));
      setAttemptedStep(step);
      setAttemptCount((n) => n + 1);
      return;
    }
    setFormErrors([]);
    setAttemptedStep(null);
    const nextIdx = currentIndex + 1;
    if (nextIdx < effectiveSteps.length) {
      const nextStep = effectiveSteps[nextIdx];
      if (nextStep === "summary") {
        setSummaryReviewed(false);
        setConfirmAttempted(false);
      }
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
      setConfirmAttempted(true);
      return;
    }
    const errors = validateEnrollment(formData);
    if (errors.length > 0) {
      setFormErrors(errors);
      return;
    }
    setSubmitting(true);
    try {
      const response = await enrollStudent(buildEnrollmentRequest(formData, summaryReviewed));
      if (!response.enrolled) {
        throw new Error("No se pudo completar la inscripción.");
      }
      // The backend auto-logs the new user in (HttpOnly cookies set by
      // /api/enrollment); re-hydrate AuthContext now so "Ir a mi cuenta"
      // below lands on an already-authenticated /student instead of bouncing
      // through /login — AuthProvider otherwise only hydrates once on mount.
      //
      // Issue #717: the ANSWER to that round trip is the only proof the
      // browser kept the cookies, and this used to be thrown away. A 201
      // from /api/enrollment carries `Set-Cookie`, but those cookies are
      // `HttpOnly` and no code here can see whether the browser honoured
      // it — so the confirmation announced "la sesión, iniciada" and sent
      // people to a /student that bounced them straight back to /login.
      // Same defect and same fix as #711 on the login screen.
      const outcome = await refreshSession();
      setSessionOutcome(outcome.kind);
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
    setSessionOutcome(null);
    setSubmitting(false);
    setSummaryReviewed(false);
    setConfirmAttempted(false);
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
      // Issue #1296: the local digits without the trunk 0, same shape as `telefono`.
      telefonoEmergencia: "998765432",
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
          telefono: "991234567",
          correo: "sofia@example.com",
          contrasenia: "password8",
          contraseniaConfirmacion: "password8",
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
          telefono: "991234567",
          nombreRepresentante: "Sofia",
          apellidosRepresentante: "Martinez",
          cedulaRepresentante: "0998765432",
          fechaNacimientoRepresentante: "1990-05-20",
          telefonoRepresentante: "0991234567",
          correoRepresentante: "sofia@example.com",
          contraseniaRepresentante: "password8",
          contraseniaRepresentanteConfirmacion: "password8",
          ...base,
        });
        break;
    }
    resetToFirstStep();
    setFormErrors([]);
    setConfirmed(false);
    setSummaryReviewed(false);
    setConfirmAttempted(false);
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
      minLength?: number;
      inputMode?: string;
      hint?: string;
      describedBy?: string;
      numericMode?: NumericFieldMode;
      autoComplete?: string;
    },
  ): React.ReactElement {
    return (
      <FieldSlot>
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
      </FieldSlot>
    );
  }

  /**
   * `BirthDateField`'s guided Día/Mes/Año replacement for the representative's
   * birth date (issue #853) — a twin of `renderField` above, kept separate
   * because `BirthDateField`'s props are not `WizardInput`'s (no `type`,
   * `pattern`, `numericMode`, …).
   */
  function renderBirthDateField(
    field: EnrollField,
    opts: {
      label: string;
      value: string;
      onChange: (v: string) => void;
      required?: boolean;
      min?: string;
      max?: string;
      hint?: string;
      hintTone?: "neutral" | "warn";
    },
  ): React.ReactElement {
    return (
      <FieldSlot>
        {/* Día/Mes/Año keep their `<label>`s as accessible names but drop the
            visible captions (the placeholders say the same), so the three
            controls sit on the same top line as the cédula input beside them. */}
        <div className="[&_label]:sr-only">
          <BirthDateField
            idPrefix={ENROLL_ID_PREFIX}
            field={ENROLL_FIELD_TOKEN[field]}
            icon={<Calendar size={ICON.sm} strokeWidth={1.5} aria-hidden="true" />}
            {...opts}
            disabled={submitting}
            error={shownError(field)}
            onBlur={() => markTouched(field)}
          />
        </div>
      </FieldSlot>
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

  /**
   * The public tariff catalog (issue #331, consumes the public BFF/backend
   * contract of #394), under the type choices on step 1 — visible before the
   * visitor picks a type, so anyone knows the price before they start. Public
   * and harmless data: NOT gated on auth or environment, and a failure gets its
   * own loud `ErrorState` with retry — this block exists to show a price, so its
   * absence must say so. One tile per plan, in the same two columns as the
   * choices above it.
   */
  function renderTariffs(): React.ReactElement {
    return (
      <section data-enroll-tariffs aria-label="Tarifas vigentes">
        <h3 className="mb-field text-xs font-semibold text-ink-3-strong">Tarifas vigentes</h3>
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
          <ul className="grid gap-section sm:grid-cols-2">
            {tarifas.map((tarifa) => (
              <li key={tarifa.categoria} className="rounded-ctl bg-sunken p-page">
                <p className="text-sm text-ink-2">{tarifa.categoria}</p>
                <p className="mt-field text-xl font-bold tabular-nums text-ink">
                  {formatCurrency(tarifa.precio)}
                </p>
                <p className="text-xs text-ink-3-strong">por mes</p>
              </li>
            ))}
          </ul>
        )}
      </section>
    );
  }

  function renderTypeStep(): React.ReactElement {
    return (
      <div className="space-y-section">
        <p className="text-sm text-ink-2">
          Seleccione el tipo de inscripción que desea realizar:
        </p>

        {/* `.choice` (_sistema.css:323-328). Even height via `items-stretch` +
            `h-full`, so the two cards never step on each other.

            Issue #874 reserves `cata-red` for this ONE selected-state border,
            the enrollment wizard's own carve-out from "la regla del rojo
            único" (DESIGN.md) — every other selected state in the product
            still draws coal plus the yellow ball dot. The badge below is that
            same non-colour marker: `aria-pressed`, the "Seleccionado" text and
            the ball dot are what make the state readable without colour, the
            border is only the accent on top of that. */}
        <div data-enroll-choices className="grid items-stretch gap-section sm:grid-cols-2">
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
                    ? "border-cata-red bg-paper ring-1 ring-cata-red"
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
        <div data-testid="enroll-info-panel" className="rounded-ctl bg-sunken p-page">
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

        {renderTariffs()}
      </div>
    );
  }

  /**
   * The computed age, as the birth-date column's own hint line — it replaces
   * the generic format hint once a date exists, so it never spans the row.
   */
  function birthDateHint(): { hint: string; hintTone?: "warn" } {
    const generic = "Día, mes y año de cuatro dígitos (por ejemplo, 15 marzo 2015).";
    if (!formData.fechaNacimiento) return { hint: generic };
    const age = calculatePersonAge(formData.fechaNacimiento);
    if (isNaN(age)) return { hint: generic };
    if (!isPlausibleHumanAge(age)) return { hint: "Revise el año." };
    if (age < 18) {
      return {
        hint:
          formData.enrollmentType === ENROLLMENT_TYPES.SELF
            ? `${age} años · menor de edad: requiere un representante.`
            : `${age} años · menor de edad.`,
        hintTone: "warn",
      };
    }
    return { hint: `${age} años` };
  }

  function renderPersonalStep(): React.ReactElement {
    const isSelf = formData.enrollmentType === ENROLLMENT_TYPES.SELF;
    const birthDateBounds = studentBirthDateBounds();
    const cedulaTyped = digitsOf(formData.cedula).length;
    return (
      <div>
        <p className="mb-page text-sm text-ink-2">
          {isSelf
            ? "Ingrese sus datos personales y credenciales de acceso:"
            : "Ingrese los datos personales del estudiante a inscribir:"}
        </p>

        {/* Two columns from `md`, in reading order: name, birth date and
            cédula, then — for a player only — phone and the account
            credentials. Issue #1197: a represented minor has no phone or
            credentials of their own (the emergency contact derives from the
            representative, #1138), so that branch simply ends after the age. */}
        <EnrollFieldGrid>
          {renderField("nombres", {
            label: "Nombres",
            value: formData.nombres,
            onChange: (v) => updateField("nombres", v),
            placeholder: example("Juan Carlos"),
            required: true,
            icon: <User size={ICON.sm} strokeWidth={1.5} aria-hidden="true" />,
            pattern: "[A-Za-zÀ-ɏ\\s]+",
            maxLength: 100,
            minLength: 3,
            autoComplete: "given-name",
          })}
          {renderField("apellidos", {
            label: "Apellidos",
            value: formData.apellidos,
            onChange: (v) => updateField("apellidos", v),
            placeholder: example("Rodríguez López"),
            required: true,
            icon: <User size={ICON.sm} strokeWidth={1.5} aria-hidden="true" />,
            pattern: "[A-Za-zÀ-ɏ\\s]+",
            maxLength: 100,
            minLength: 3,
            autoComplete: "family-name",
          })}
          {renderBirthDateField("fechaNacimiento", {
            label: "Fecha de nacimiento",
            value: formData.fechaNacimiento,
            onChange: (v) => updateField("fechaNacimiento", v),
            required: true,
            min: birthDateBounds.min,
            max: birthDateBounds.max,
            ...birthDateHint(),
          })}
          {renderField("cedula", {
            label: "Cédula de identidad",
            value: formData.cedula,
            onChange: (v) => updateField("cedula", v),
            placeholder: example("1712345678"),
            required: true,
            icon: <Hash size={ICON.sm} strokeWidth={1.5} aria-hidden="true" />,
            pattern: "[0-9]{10}",
            inputMode: "numeric",
            numericMode: "cedula",
            hint:
              cedulaTyped > 0 && cedulaTyped < 10
                ? `Lleva ${cedulaTyped} de 10 dígitos.`
                : CEDULA_HINT,
          })}

          {/* Student credentials — self enrollment only (issue #1137,
              invariante B: un menor representado nunca tiene Usuario propio). */}
          {isSelf && (
            <>
              {/* Issue #1296 — the shared `PhoneField`: fixed +593, local
                  digits, no leading 0. */}
              <FieldSlot>
                <PhoneField
                  idPrefix={ENROLL_ID_PREFIX}
                  field={ENROLL_FIELD_TOKEN.telefono}
                  label="Teléfono"
                  required
                  disabled={submitting}
                  value={formData.telefono}
                  onChange={(v) => updateField("telefono", v)}
                  error={shownError("telefono")}
                  onBlur={() => markTouched("telefono")}
                />
              </FieldSlot>
              {renderField("correo", {
                label: "Correo electrónico",
                value: formData.correo,
                onChange: (v) => updateField("correo", v),
                type: "email",
                required: true,
                placeholder: example("correo@ejemplo.com"),
                icon: <Mail size={ICON.sm} strokeWidth={1.5} aria-hidden="true" />,
                autoComplete: "email",
              })}
              <div>
                {renderField("contrasenia", {
                  label: "Contraseña",
                  value: formData.contrasenia,
                  onChange: (v) => updateField("contrasenia", v),
                  type: "password",
                  required: true,
                  autoComplete: "new-password",
                  describedBy: `${enrollFieldId("contrasenia")}-strength`,
                })}
                {/* Issue #1395 — the advisory layer, LIVE under the field it
                    reads. Information only: the hard policy (floor + common
                    list) stays the only gate. */}
                <PasswordStrengthMeter
                  id={`${enrollFieldId("contrasenia")}-strength`}
                  value={formData.contrasenia}
                />
              </div>
              {renderField("contraseniaConfirmacion", {
                label: "Confirmar contraseña",
                value: formData.contraseniaConfirmacion,
                onChange: (v) => updateField("contraseniaConfirmacion", v),
                type: "password",
                required: true,
                autoComplete: "new-password",
              })}
            </>
          )}
        </EnrollFieldGrid>
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
      <div>
        <p className="mb-page text-sm text-ink-2">
          Complete los datos del representante legal y sus credenciales de acceso:
        </p>
        <EnrollFieldGrid>
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
          {renderBirthDateField("fechaNacimientoRepresentante", {
            label: "Fecha de nacimiento",
            value: formData.fechaNacimientoRepresentante,
            onChange: (v) => updateField("fechaNacimientoRepresentante", v),
            required: true,
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
          {renderField("correoRepresentante", {
            label: "Correo electrónico",
            value: formData.correoRepresentante,
            onChange: (v) => updateField("correoRepresentante", v),
            type: "email",
            placeholder: example("correo@ejemplo.com"),
            required: true,
            autoComplete: "email",
          })}
          <div>
            {renderField("contraseniaRepresentante", {
              label: "Contraseña",
              value: formData.contraseniaRepresentante,
              onChange: (v) => updateField("contraseniaRepresentante", v),
              type: "password",
              required: true,
              autoComplete: "new-password",
              describedBy: `${enrollFieldId("contraseniaRepresentante")}-strength`,
            })}
            {/** Same advisory layer as the self flow (#1395): informs, never gates. */}
            <PasswordStrengthMeter
              id={`${enrollFieldId("contraseniaRepresentante")}-strength`}
              value={formData.contraseniaRepresentante}
            />
          </div>
          {renderField("contraseniaRepresentanteConfirmacion", {
            label: "Confirmar contraseña",
            value: formData.contraseniaRepresentanteConfirmacion,
            onChange: (v) => updateField("contraseniaRepresentanteConfirmacion", v),
            type: "password",
            required: true,
            autoComplete: "new-password",
          })}
        </EnrollFieldGrid>

        {/* #1320: this is an informational note, not an error, so it carries
            the same weight as every other field hint in the wizard
            (FieldHintMessage in wizard-fields.tsx) instead of the warning
            card. The warning card stays reserved for an actual out-of-range
            date, which the birth-date field's own validator already reports
            inline (see fechaNacimientoRepresentante in enroll-utils.ts). */}
        <p className="mt-field text-xs text-ink-3">
          El representante debe ser mayor de edad ({EDAD_MAYORIA_EDAD} a{" "}
          {EDAD_MAXIMA_ALUMNO} años). Al inscribir a un dependiente, confirma
          ser su responsable legal.
        </p>
      </div>
    );
  }

  function renderHealthStep(): React.ReactElement {
    return (
      <div className="space-y-1">
        <p className="mb-page text-sm text-ink-2">
          Información que el club necesita conocer para la seguridad del estudiante:
        </p>

        <EnrollFieldGrid>
        <FieldSlot>
        <div className="mb-4">
          <label htmlFor="enroll-tipo-sangre" className="mb-field block text-sm font-semibold text-ink">
            Tipo de sangre <span aria-hidden="true" className="text-state-bad">*</span>
          </label>
          <select
            id="enroll-tipo-sangre"
            value={formData.tipoSangre}
            onChange={(e) => updateField("tipoSangre", e.target.value as EnrollFormData["tipoSangre"])}
            onBlur={() => markTouched("tipoSangre")}
            required
            disabled={submitting}
            aria-invalid={shownError("tipoSangre") ? true : undefined}
            aria-describedby={shownError("tipoSangre") ? "enroll-tipo-sangre-message" : undefined}
            className={`input-field ${shownError("tipoSangre") ? "border-state-bad" : ""}`}
          >
            <option value="">Seleccione una opción</option>
            {/* The enum with its underscore swapped for a space produced "O
                POSITIVO" here and again in the summary. `BLOOD_TYPE_LABELS` is
                the only spelling a person reads now. */}
            {/* `SELECTABLE_BLOOD_TYPES`, not the whole enum (#643): "No lo sé"
                is no longer on offer, because the record this wizard creates
                has to be a complete one. */}
            {SELECTABLE_BLOOD_TYPES.map((bloodType) => (
              <option key={bloodType} value={bloodType}>
                {BLOOD_TYPE_LABELS[bloodType]}
              </option>
            ))}
          </select>
          {shownError("tipoSangre") && (
            <p
              id="enroll-tipo-sangre-message"
              className="mt-field flex items-center gap-1.5 text-xs font-semibold text-state-bad"
            >
              <AlertTriangle size={ICON.sm} strokeWidth={2} className="shrink-0" aria-hidden="true" />
              {shownError("tipoSangre")}
            </p>
          )}
        </div>
        </FieldSlot>
        <div className="hidden md:block 2xl:hidden" aria-hidden="true" />

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
        </EnrollFieldGrid>

        {/*
         * Issue #1138: un menor representado no tiene contacto de
         * emergencia propio -- se deriva del representante (nombre y
         * teléfono actuales), así que este paso solo pide los dos campos
         * en la inscripción de un adulto (jugador). El camino "child" ya
         * cargó los datos del representante en el paso anterior.
         */}
        {formData.enrollmentType === ENROLLMENT_TYPES.SELF ? (
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
            wide
          />
        ) : (
          <div className="rounded-ctl border border-line-2 bg-canvas p-page text-xs text-ink-2">
            En caso de emergencia, el club lo contactará a usted con el
            nombre y teléfono de representante que ya indicó.
          </div>
        )}

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
   * duplicate-identity 400 could not tell apart (issue #233, revisited in
   * #999): student cédula, student/representative correo. When the backend
   * answers with that error, EVERY candidate row gets the SAME "Revisar"
   * marker — never just one — so the visitor's eye lands on the right
   * "Corregir" button without the app ever singling out which field was
   * actually the duplicate. The alert itself (`MENSAJE_IDENTIDAD_DUPLICADA`)
   * may now name the SET of fields that can collide ("cédula o correo") —
   * that does not narrow anything an attacker doesn't already know — but it
   * never says WHICH one matched; that is still what these two rows are for.
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
        {/* Label above the datum: the review is two columns now, and a fixed
            label column would leave the value half a card to wrap in. */}
        <span className="min-w-0 flex-1">
          <span className="block text-2xs font-bold uppercase text-ink-3">{label}</span>
          <span className="block break-words text-sm font-semibold text-ink">{value}</span>
        </span>
        {/* The flag is a STATUS, so it is the badge the system already has —
            not a second uppercase micro-label invented for this one row. */}
        {flagged && <Badge tone="warn">Revisar</Badge>}
        <Button
          variant="secondary"
          size="sm"
          className="flex-none"
          aria-label={`Editar ${label}`}
          onClick={() => goToStep(correctStep)}
        >
          Editar
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
            see the note in the comparison.

            `bg-sunken` on the caller, not on `DataRowList` itself (#874):
            the primitive is shared by five other screens and its own default
            has no background at all — this list is the one that sits inside
            a summary card and needs to read as an inset panel instead of a
            second `paper` surface stacked on the first. */}
        <div className="grid gap-page md:grid-cols-2 md:items-start">
        <DataRowList className="bg-sunken">
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
          {/* Issue #1197: a represented minor has no phone of their own —
              this row only applies to the self (adult) path. The
              representative's own cédula and phone appear below instead. */}
          {isChild
            ? null
            : summaryRow("Teléfono", formData.telefono ? toStoredPhone(formData.telefono) : "—", "personal")}
          {isChild
            ? summaryRow(
                "Representante",
                `${formData.nombreRepresentante} ${formData.apellidosRepresentante}`.trim() || "—",
                "representative",
              )
            : null}
          {isChild
            ? summaryRow(
                "Cédula del representante", formData.cedulaRepresentante || "—", "representative",
                { duplicateCandidate: true },
              )
            : null}
          {isChild
            ? summaryRow(
                "Teléfono del representante", formData.telefonoRepresentante || "—", "representative",
              )
            : null}
          {summaryRow(
            isChild ? "Correo del representante" : "Correo",
            (isChild ? formData.correoRepresentante : formData.correo) || "—",
            isChild ? "representative" : "personal",
            // Both branches validate this exact correo for uniqueness
            // (`enrollment_servicio.py`: representante.correo in the child
            // flow, credenciales_alumno.correo in the self flow) — flagging
            // it only for `isChild` left a self-enrolled visitor correcting
            // their cédula while the real collision was on this row (#999).
            { duplicateCandidate: true },
          )}
        </DataRowList>
        <DataRowList className="bg-sunken">
          {summaryRow(
            "Tipo de sangre",
            formData.tipoSangre ? BLOOD_TYPE_LABELS[formData.tipoSangre] : "—",
            "health",
          )}
          {isChild
            ? summaryRow(
                "Contacto de emergencia",
                "Se deriva del representante indicado arriba",
                "representative",
              )
            : summaryRow(
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
        </div>

        <p className="text-sm text-ink-2">
          {/* #1398: «le enviamos» afirmaba una entrega que al confirmar todavía
              no existe — el correo de verificación queda ENCOLADO en el outbox
              commiteado con la inscripción (`enrollment_servicio.py`) y lo
              entrega después el beat `despachar-inscripcion-notificaciones`
              (~2 minutos, #1295), con reintentos at-least-once (#839). Lo que
              SÍ es hecho en el momento en que este párrafo se lee: la
              solicitud de envío quedó registrada. La demora posible y la
              salida si no llega (#1245: reenviar desde la pantalla de
              activación, donde también puede corregir el correo) van en la
              misma oración para que «no llegó» tenga adónde ir — y ninguna
              superficie promete ni anuncia un resultado de entrega que no
              puede conocer. */}
          Al confirmar creamos {isChild ? "su cuenta de representante y el perfil del estudiante" : "su cuenta de estudiante"} y registramos el envío de un correo para verificarla: puede tardar unos minutos en llegar. Si no llega, reenvíelo desde la pantalla de activación, donde también puede corregir el correo.
          Luego, acérquese al club o escríbanos por WhatsApp para registrar la inscripción y el primer pago:{" "}
          <b className="font-semibold text-ink">el club lo valida y ahí se activa la membresía</b>.
        </p>

        {/* `sunken`, not `canvas` — the same inverted ladder as the age well:
            this box is recessed INSIDE the paper card, and `canvas` is the
            surface the page itself stands on. */}
        <label
          htmlFor="enroll-consentimiento"
          className="flex cursor-pointer items-start gap-3 rounded-ctl border border-line-2 bg-sunken p-page text-sm text-ink-2"
        >
          <input
            id="enroll-consentimiento"
            type="checkbox"
            checked={summaryReviewed}
            onChange={(e) => {
              setSummaryReviewed(e.target.checked);
              if (!e.target.checked) setConfirmAttempted(true);
              setFormErrors([]);
            }}
            /* #763: the rule was enforced and never declared — the audit read
               `semanticRequired=false`, so the browser and every assistive
               technology were told this box was optional while the wizard
               refused to submit without it. `required` is the same attribute
               the "Tipo de sangre" select already carries, and on a native
               checkbox it is what maps to the accessibility tree's required
               state; no `aria-required` on top, which would only restate it.
               It does not become a second voice either: the form is
               `noValidate`, so the browser's own bubble never fires; the
               message people read is the inline one below, and the block is
               still `handleConfirm`. */
            required
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
          <span>
                {/* #1368: the three grouped documents are triggers for the
                    in-flow review dialog below, NOT links — a link navigated
                    away and discarded everything the visitor entered. Buttons
                    inside a label would steal the labeled-control identity
                    from the checkbox, so the label carries an explicit
                    `htmlFor` and the input its matching `id` above. */}
                Acepto los <button type="button" className="underline" onClick={() => setLegalReviewDoc("terminos")}>Términos de uso</button>, el {" "}
                <button type="button" className="underline" onClick={() => setLegalReviewDoc("privacidad")}>Aviso de privacidad</button>, el tratamiento
                de datos médicos y la difusión pública de imagen conforme al {" "}
                <button type="button" className="underline" onClick={() => setLegalReviewDoc("permiso-imagen-fetm")}>Permiso de imagen FETM</button>.
              </span>
        </label>
      </div>
    );
  }

  // ---- Render ----

  // #1055: `null` while unconfirmed (the honest destination is /login below)
  // or if a session round trip claimed "authenticated" without ever handing
  // back a session — that combination has not been observed, but a button
  // must never be built from a session it does not have.
  const accountAreaLink = sessionConfirmed && session ? accountAreaLinkFor(session) : null;

  /**
   * The live summary. `dark` restyles it for the coal brand panel.
   */
  function renderSummaryRail(dark: boolean): React.ReactElement {
    return (
      <EnrollSummary formData={formData} steps={effectiveSteps} currentStep={step} dark={dark} />
    );
  }

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
                ¡Le damos la bienvenida a Cata Club!
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
                {/* #877: a contained emotional line, not a second claim — it
                    says nothing about membership, payment or session, so it
                    stays true regardless of `sessionConfirmed`. */}
                <p className="max-w-[44ch] text-sm text-ink-2">
                  Su camino en el tenis de mesa comienza aquí.
                </p>
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

              {/* The session that never was (issue #717). `role="alert"`, and
                  on the CARD rather than in a toast, for the same reason the
                  login screen holds its own copy of this message there: the
                  remedy is in a browser settings panel, and a notice that
                  fades cannot survive the trip. It sits ABOVE "Qué sigue"
                  because it changes what the first of those steps is. */}
              {sessionOutcome !== null && sessionOutcome !== "authenticated" && (
                <p
                  role="alert"
                  data-testid="enroll-session-not-confirmed"
                  className="rounded-ctl border border-state-bad bg-canvas px-3.5 py-2.5 text-sm text-ink-2"
                >
                  {unconfirmedSessionNotice(sessionOutcome)}
                </p>
              )}

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
                    /* #717: the session half of this line is a CLAIM, and it
                       is only true when the round trip above confirmed it.
                       Unconfirmed, the account is still created — that half
                       is a fact — and the next step is signing in, not
                       enrolling again. */
                    sessionConfirmed
                      ? "Su cuenta ya está creada y la sesión, iniciada."
                      : "Su cuenta ya está creada. Inicie sesión con su correo y su contraseña.",
                    /* #1196: la historia completa empieza acá -- antes la
                       confirmación no mencionaba la verificación de correo.
                       #1398: «le enviamos» afirmaba la entrega como hecho
                       consumado, pero el enlace no «viaja apenas se crea la
                       cuenta»: la solicitud queda registrada en el outbox y
                       la entrega la hace después el beat (~2 minutos, #1295,
                       reintentos at-least-once, #839). Esta línea dice la
                       solicitud registrada, la demora posible y la salida si
                       no llega (#1245) — nunca la entrega misma. */
                    "Verifique su correo: registramos el envío de un enlace de confirmación; puede tardar unos minutos en llegar. Si no llega, reenvíelo desde la pantalla de activación, donde también puede corregir el correo.",
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
                    "Acérquese a administración o escríbanos por WhatsApp para registrar la inscripción y el primer pago.",
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
                {/* #717: `/student` is a protected route. Offering it without
                    a confirmed session is offering a button whose only
                    outcome is a silent bounce to /login — which is exactly
                    what the reproduction produced. Unconfirmed, the honest
                    destination IS /login.
                    #1055: a CONFIRMED session can still be stuck at the
                    activation gate — `accountAreaLink` is `null` for both
                    cases, so this stays the same fallback either way. */}
                {accountAreaLink ? (
                  <Link href={accountAreaLink.href} className={buttonClasses("primary")}>
                    {accountAreaLink.label}
                  </Link>
                ) : (
                  <Link href="/login" className={buttonClasses("primary")}>
                    Iniciar sesión
                  </Link>
                )}
                <Button variant="secondary" onClick={handleReset}>
                  Nueva inscripción
                </Button>
              </div>
            </div>
          </div>
        </div>
      ) : (

        /* A full-height split (see `EnrollFrame`): the brand panel carries the
           way out, the title, the vertical steps and the live summary; the form
           gets the rest. The review step lays its own summary out in two
           columns, so the panel drops the mirror there. Still no `AppShell`
           here, so the rhythm lock never looked at this screen; the doctrine
           (`gap-page` on the column, distances owned by the container) applies
           all the same.

           One back-navigation rule: a sub-page carries a `BackLink` at the TOP,
           where back navigation lives everywhere else in the product. The
           destination is conditional because this wizard is public (see
           PUBLIC_EXCEPTIONS in src/lib/middleware-utils.ts): most visitors
           arrive from the landing with no account, and sending them to
           `/student` would bounce them straight to /login. While the session
           hydrates nobody knows who is asking, so no destination is offered —
           the placeholder reserves the control's height so the row never jumps.
           `backHrefForRole` is the same resolver /ayuda uses.

           The count in the subtitle is read from `effectiveSteps`, not written
           out. #317 / hallazgo #31: on step 1 itself the count is not yet a
           COMMITTED fact — the visitor can still swap Jugador/Representante on
           the very card in front of them — so step 1 states both possibilities
           and the resolved count is deferred to the step that depends on it. */
        <EnrollFrame
          back={
            isLoading ? (
              <span className="h-ctl-sm" aria-hidden="true" />
            ) : (
              <BackLink href={backHrefForRole(session?.user.role)} tone="coal" />
            )
          }
          eyebrow={isFirst ? "Paso 1" : `Paso ${currentIndex + 1} de ${effectiveSteps.length}`}
          title="Inscripción de estudiante"
          subtitle={
            isFirst
              ? "4 o 5 pasos y queda dentro del club, según quién se inscriba."
              : `${effectiveSteps.length} pasos y queda dentro del club.` +
                (formData.enrollmentType === "self"
                  ? " Se inscribe usted como jugador."
                  : " Usted actúa como representante.")
          }
          steps={
            wide && (
              <EnrollSteps
                label="Pasos de la inscripción"
                steps={effectiveSteps.map((s) => STEP_SHORT_LABELS[s])}
                current={currentIndex + 1}
                onStepClick={handleStepperJump}
              />
            )
          }
          summary={wide && renderSummaryRail(true)}
        >
          {/* One form around the navigation row and both columns, so the
              top-bar "Siguiente" is the form's submit control and Enter inside
              a field advances. `noValidate`: the messages are ours, printed
              under each field, not the browser's one-at-a-time bubble. */}
          {/* Narrow layouts only: the summary sits ABOVE the card. From `lg` the
              same block lives in the brand panel instead. */}
          {!wide && !isLast && renderSummaryRail(false)}

          <form
            ref={formRef}
            noValidate
            onSubmit={handleConfirm}
            data-testid="enroll-wizard-card"
            data-enroll-card
            className="card flex w-full flex-1 flex-col p-page lg:p-10"
          >
            {/* #1321: `goToStep` already jumps to an arbitrary step from the
                review's "Editar" buttons without losing anything —
                `formData` lives in this component, not per step — so a
                completed pill needs no extra guard to reuse it. */}
            <EnrollNav
              isFirst={isFirst}
              isLast={isLast}
              submitting={submitting}
              onBack={handleBack}
              stepper={
                wide ? null : (
                  <Stepper
                    label="Pasos de la inscripción"
                    current={currentIndex + 1}
                    steps={effectiveSteps.map((s) => STEP_SHORT_LABELS[s])}
                    onStepClick={handleStepperJump}
                    showCount={!isFirst}
                  />
                )
              }
            />

            <div data-enroll-body className="flex flex-1 flex-col justify-center">
            {/* Issue #317 / hallazgo #62: recuperado de `sessionStorage`, no del
                servidor — nada de esto se envió todavía. El rótulo lo dice para
                que un dato restaurado nunca se confunda con uno ya guardado, la
                misma distinción que #310 (K3) cerró del lado de asistencias. */}
            {restoredFromDraft && (
              <p className="mb-page rounded-ctl border border-line bg-canvas px-3.5 py-2.5 text-xs text-ink-2">
                Recuperamos los datos que ya había completado. Todavía no se han
                enviado — revíselos antes de continuar.
              </p>
            )}

            {/* Demo helper — quick-fill for testing convenience. The "(solo
                desarrollo)" label used to be the ONLY thing stopping this from
                reaching real visitors; `isDemoQuickFillEnabled` is the actual
                guard. See its doc comment for why it reads NODE_ENV. It is one
                compact row: it never reaches a visitor, so it should not cost
                them (or a developer's screenshot) a card of height. */}
            {demoQuickFillEnabled && (
              <div className="mb-page flex flex-wrap items-center gap-x-4 gap-y-field rounded-card border border-dashed border-line-2 bg-sunken px-page py-2">
                <AlertTriangle size={ICON.sm} strokeWidth={1.5} className="text-state-warn" aria-hidden="true" />
                {/* `ink-3-strong`, not translucent ink: the old `/45` and `/40`
                    pairs measured 2.61:1 and 2.31:1 on `sunken`. */}
                <p
                  className="text-2xs font-semibold uppercase tracking-wider text-ink-3-strong"
                  title="Llena los campos automáticamente pero no salta la validación — los pasos deben completarse uno por uno."
                >
                  Rellenar datos de prueba (solo desarrollo)
                </p>
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


                {/* The card title was `text-sm font-bold` — 13.5px of Barlow,
                    the DENSE step, smaller than the labels inside it. It takes
                    the `title` step now: Graduate, 20px, uppercase, flat
                    tracking, no weight class — the face has a single 400 cut. */}
                <h2
                  ref={stepHeadingRef}
                  tabIndex={-1}
                  className="mb-page font-display text-lg uppercase tracking-flat text-ink"
                >
                  {STEP_LABELS[step]}
                </h2>

                {step === "type" && renderTypeStep()}
                {step === "personal" && renderPersonalStep()}
                {step === "representative" && renderRepresentativeStep()}
                {step === "health" && renderHealthStep()}
                {step === "summary" && renderSummary()}

                {/* Screen readers hear how many fields the last "Siguiente"
                    flagged; sighted visitors see the messages themselves, so
                    there is no red paragraph listing them a second time. */}
                {attemptedStep === step && invalidCount > 0 && (
                  <p role="status" className="sr-only">
                    {invalidCount === 1
                      ? "Hay 1 campo por corregir en este paso."
                      : `Hay ${invalidCount} campos por corregir en este paso.`}
                  </p>
                )}

                {formErrors.length > 0 && (
                  <div className="alert-error mt-section items-start" role="alert">
                    <AlertTriangle size={ICON.sm} strokeWidth={1.5} className="mt-0.5 shrink-0" aria-hidden="true" />
                    <div className="space-y-2">
                      <ul className="list-inside list-disc space-y-1">
                        {formErrors.map((err, i) => (
                          <li key={i}>{err}</li>
                        ))}
                      </ul>
                      {formErrors.some(isDuplicateIdentityError) && (
                        <DuplicateIdentityHelp audience="self-service" />
                      )}
                    </div>
                  </div>
                )}

                {isLast && (
                  <div className="mt-page flex flex-col items-end gap-section">
                    {/* Same pattern as "Siguiente": the button stays enabled and
                        the missing box is named inline once confirming was
                        attempted, not before the visitor has touched anything. */}
                    {!submitting && confirmAttempted && !summaryReviewed && (
                      <p role="alert" className="text-base font-semibold text-cata-red-dark [text-wrap:pretty]">
                        Para continuar, marque la casilla de confirmación.
                      </p>
                    )}
                    <Button
                      type="submit"
                      variant="primary"
                      disabled={submitting}
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
                  </div>
                )}
            </div>
          </form>
        </EnrollFrame>
      )}

      {/* #1368 — one shared review for all three grouped documents. Opening
          one overlays the summary step and nothing behind it is reachable;
          closing lands the visitor exactly where the decision is made, with
          every entered field and the consent state untouched. */}
      <LegalReviewDialog documentId={legalReviewDoc} onClose={() => setLegalReviewDoc(null)} />
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
