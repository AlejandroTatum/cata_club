/**
 * Add Dependent — authenticated self-service wizard.
 *
 * Short 3-step wizard (child data → medical record → summary/confirm) for a
 * logged-in representante, or a self-managed adult player adding their FIRST
 * dependent, to add a dependent from the portal. Unlike the public
 * `/student/enroll` wizard, this never creates a `Usuario` or assigns a role
 * to the dependent itself — it only creates a `Persona` (child) linked to
 * the caller's own persona via `representante_id`, plus its `FichaMedica`,
 * via `POST /personas/me/representados` (see `crearRepresentadoPropio`). The
 * identity the backend acts on comes from the caller's own access token,
 * never from a client-supplied id, so this page never resolves or sends a
 * `persona_id` of its own.
 *
 * Issue #1318: reachable by EVERY self-managed adult, not just an existing
 * representante. When the caller isn't REPRESENTANTE yet, the backend grants
 * it in the same request; the summary step says so before confirming. On
 * success the session is re-hydrated (`refreshSession`, since the account's
 * role may have just changed) before navigating back to `/student`, which
 * remounts and refetches the portal data (no optimistic client-side list
 * update). Issue #1340: that rehydration has its own error handling,
 * separate from the create call — a rejected `refreshSession` never turns a
 * successful alta into a reported failure.
 *
 * All labels and copy are in Spanish per app convention.
 */

"use client";

import { Suspense, useEffect, useMemo, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { furthestReachableIndex, useWizardHistory } from "@/lib/wizard-history";
import ProtectedRoute from "@/components/ProtectedRoute";
import AppShell from "@/components/shell/AppShell";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/contexts/ToastContext";
import {
  crearRepresentadoPropio, fetchInstituciones, fetchTiposMembresia,
  inscribirRepresentadoConPago, subirVoucherPago,
  type Institucion, type TipoMembresiaCatalogo,
} from "@/services/api";
import { calculatePersonAge, isPlausibleHumanAge, studentBirthDateBounds } from "@/lib/identity-validation";
import { isDuplicateIdentityError } from "@/lib/duplicate-identity";
import {
  WizardTextarea,
  WizardInput,
  BirthDateField,
  WizardNavigation,
  example,
  CEDULA_DIGITS,
  CEDULA_HINT,
} from "@/components/wizard-fields";
import { BackLink, Stepper, buttonClasses, PAGE_RAIL } from "@/components/ui";
import { SELECTABLE_BLOOD_TYPES } from "@/types/enrollment";
import type { TipoSangre } from "@/types/domain";
import {
  Calendar,
  Hash,
  Heart,
  CheckCircle,
  AlertTriangle,
  User,
} from "lucide-react";
import { ICON } from "@/lib/icon-size";
import {
  ADD_DEPENDENT_FIELD_TOKEN,
  ADD_DEPENDENT_ID_PREFIX,
  ADD_DEPENDENT_SCHOOL_TYPE_ID,
  ADD_DEPENDENT_STEP_ORDER,
  addDependentFieldId,
  isAddDependentStepComplete,
  ADD_DEPENDENT_STEP_LABELS,
  ADD_DEPENDENT_SHORT_LABELS,
  describeAddDependentBlocker,
  initialAddDependentFormData,
  validateAddDependentFields,
  validateAddDependentStep,
  validateAddDependentForm,
  buildRepresentadoPayload,
  getAddDependentErrorMessage,
  validateDependentPayment,
  type AddDependentField,
  type AddDependentFormData,
  type AddDependentStep,
} from "./add-dependent-utils";

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

function AddDependentContent(): React.ReactElement {
  const { session, refreshSession } = useAuth();
  const router = useRouter();
  const { showSuccess } = useToast();

  const [formData, setFormData] = useState<AddDependentFormData>(initialAddDependentFormData);
  const [submitting, setSubmitting] = useState(false);
  const [summaryReviewed, setSummaryReviewed] = useState(false);
  const [formErrors, setFormErrors] = useState<string[]>([]);
  const [touched, setTouched] = useState<Set<AddDependentField>>(new Set());
  const [instituciones, setInstituciones] = useState<Institucion[]>([]);
  const [tipoEscuelaFilter, setTipoEscuelaFilter] = useState<string>("");
  const [payNow, setPayNow] = useState(false);
  const [createdDependentId, setCreatedDependentId] = useState<number | null>(null);
  const [pendingPaymentId, setPendingPaymentId] = useState<number | null>(null);
  const [plans, setPlans] = useState<TipoMembresiaCatalogo[]>([]);
  const [planId, setPlanId] = useState("");
  const [months, setMonths] = useState(1);
  const [method, setMethod] = useState<"EFECTIVO" | "TRANSFERENCIA">("TRANSFERENCIA");
  const [voucher, setVoucher] = useState<File | null>(null);

  // Issue #1318: read straight from the session's own backend-role list —
  // no portal fetch needed just to know whether saving will also switch the
  // caller's role. `session.roles` are the raw backend strings (`AuthSession`
  // in `src/services/auth.ts`), not the derived `UserRole` this page is
  // gated on.
  const isRepresentative = session?.roles.includes("REPRESENTANTE") ?? false;

  /**
   * A URL may address any step the guardian could have walked to on their own,
   * and no further — a reloaded or shared link must not open the summary of a
   * dependent nobody described.
   */
  const maxReachableStep = furthestReachableIndex(ADD_DEPENDENT_STEP_ORDER, (s) =>
    isAddDependentStepComplete(s, formData),
  );
  const { step, goToStep, goBack } = useWizardHistory(
    ADD_DEPENDENT_STEP_ORDER,
    maxReachableStep,
  );

  const currentIndex = ADD_DEPENDENT_STEP_ORDER.indexOf(step);
  const isFirst = currentIndex === 0;
  const isLast = currentIndex === ADD_DEPENDENT_STEP_ORDER.length - 1;

  // Same live-validation contract as the public wizard: recomputed on every
  // keystroke, shown only for fields the visitor has already left.
  const fieldErrors = useMemo(() => validateAddDependentFields(step, formData), [step, formData]);
  const stepComplete = Object.keys(fieldErrors).length === 0;
  const blockedReason = describeAddDependentBlocker(fieldErrors);

  function shownError(field: AddDependentField): string | undefined {
    return touched.has(field) ? fieldErrors[field] : undefined;
  }

  function markTouched(field: AddDependentField): void {
    setTouched((prev) => (prev.has(field) ? prev : new Set(prev).add(field)));
  }

  useEffect(() => {
    fetchInstituciones().then(setInstituciones).catch(() => {});
    fetchTiposMembresia().then(setPlans).catch(() => {});
  }, []);

  // ---- Helpers ----

  function updateField<K extends keyof AddDependentFormData>(
    key: K,
    value: AddDependentFormData[K],
  ): void {
    setFormData((prev) => ({ ...prev, [key]: value }));
    setFormErrors([]);
  }

  function handleNext(): void {
    const errors = validateAddDependentStep(step, formData);
    if (errors.length > 0) {
      setFormErrors(errors);
      return;
    }
    setFormErrors([]);
    const nextIdx = currentIndex + 1;
    if (nextIdx < ADD_DEPENDENT_STEP_ORDER.length) {
      const nextStep = ADD_DEPENDENT_STEP_ORDER[nextIdx];
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
    if (submitting) return;
    if (createdDependentId !== null) {
      const errors = validateDependentPayment(planId, months, method, voucher);
      if (errors.length) { setFormErrors(errors); return; }
      setSubmitting(true);
      try {
        const paymentId = pendingPaymentId ?? (await inscribirRepresentadoConPago({
          personaId: createdDependentId, tipoMembresiaId: Number(planId),
          tipoPago: method, meses: months,
        })).id;
        setPendingPaymentId(paymentId);
        if (method === "TRANSFERENCIA" && voucher) await subirVoucherPago(paymentId, voucher);
        showSuccess("Pago registrado. Queda pendiente de validación por administración.");
        router.push("/student");
      } catch (error: unknown) {
        setFormErrors([getAddDependentErrorMessage(error)]);
      } finally {
        setSubmitting(false);
      }
      return;
    }
    if (step !== "summary") {
      handleNext();
      return;
    }
    if (!summaryReviewed) {
      setFormErrors(["Revise y confirme el resumen antes de agregar el dependiente."]);
      return;
    }
    const errors = validateAddDependentForm(formData);
    if (errors.length > 0) {
      setFormErrors(errors);
      return;
    }
    setSubmitting(true);
    try {
      const created = await crearRepresentadoPropio(buildRepresentadoPayload(formData));
      setCreatedDependentId(created.representado.id);
    } catch (error: unknown) {
      setSubmitting(false);
      const message = getAddDependentErrorMessage(error);
      setFormErrors([message]);
      return;
    }
    // Issue #1340: the alta already succeeded by this point — everything
    // below is a side effect of that success, not a condition of it. A
    // rejected `refreshSession` used to fall into the `catch` above and
    // report a failure for something that had already worked.
    showSuccess("Dependiente agregado correctamente.");
    try {
      // Issue #1318: the account may have just become REPRESENTANTE — the
      // cached session still reads the old role until re-hydrated. Awaited
      // before navigating so `/student`'s own ProtectedRoute (and its
      // profile picker) sees the fresh role on first render instead of
      // bouncing on a stale one.
      await refreshSession();
    } catch (error: unknown) {
      // Soft failure: the dependent is already created and the visitor is
      // already told so. Losing the rehydration only means `/student`'s
      // first render may show the stale role for one extra refresh — not
      // worth turning a completed alta into an error screen.
      console.error("[add-dependent] refreshSession failed", error);
    }
    // Navigation-remount: /student refetches the portal summary on mount,
    // so the new dependent appears without any optimistic client state.
    if (!payNow) router.push("/student");
    else setSubmitting(false);
  }

  // ---- Render helpers ----

  /**
   * `field` is required here, not optional.
   *
   * `WizardTextarea` falls back to slugifying the label when it is omitted,
   * and both call sites omitted it — so "Enfermedades" and "Alergias" WERE
   * the ids. Making the token a required argument of this local helper is
   * what stops the next textarea from being added the old way.
   */
  function renderTextarea(opts: {
    field: keyof typeof ADD_DEPENDENT_FIELD_TOKEN;
    label: string;
    value: string;
    onChange: (v: string) => void;
    placeholder?: string;
    required?: boolean;
    icon?: React.ReactNode;
    rows?: number;
  }): React.ReactElement {
    const { field, ...rest } = opts;
    return (
      <WizardTextarea
        idPrefix={ADD_DEPENDENT_ID_PREFIX}
        field={ADD_DEPENDENT_FIELD_TOKEN[field]}
        disabled={submitting}
        {...rest}
        rows={opts.rows ?? 2}
      />
    );
  }

  // ---- Step renderers ----

  function renderChildStep(): React.ReactElement {
    // A represented minor has no phone of their own (issue #1197, already
    // the public wizard's child branch): the emergency contact derives from
    // the representante (#1138), so this step hand-renders the same four
    // identity fields `PersonIdentityFields` would, in the same order,
    // minus the phone. `PersonIdentityFields` itself stays untouched —
    // other screens still use it as-is.
    const age = formData.fechaNacimiento ? calculatePersonAge(formData.fechaNacimiento) : null;
    const ageValid = age !== null && !Number.isNaN(age);
    const agePlausible = age !== null && !Number.isNaN(age) && isPlausibleHumanAge(age);
    const birthDateBounds = studentBirthDateBounds();
    const cedulaTyped = formData.cedula.replace(/\D/g, "").length;
    return (
      <div className="space-y-field">
        <p className="mb-4 text-sm leading-relaxed text-ink-2">
          Ingrese los datos personales del hijo/dependiente a agregar:
        </p>

        <WizardInput
          idPrefix={ADD_DEPENDENT_ID_PREFIX}
          field={ADD_DEPENDENT_FIELD_TOKEN.nombres}
          disabled={submitting}
          label="Nombres"
          value={formData.nombres}
          onChange={(v) => updateField("nombres", v)}
          placeholder={example("Juan Carlos")}
          required
          icon={<User size={ICON.sm} strokeWidth={1.5} aria-hidden="true" />}
          error={shownError("nombres")}
          onBlur={() => markTouched("nombres")}
          autoComplete="given-name"
          pattern="[A-Za-z\u00C0-\u024F\s]+"
          maxLength={100}
          minLength={3}
        />
        <WizardInput
          idPrefix={ADD_DEPENDENT_ID_PREFIX}
          field={ADD_DEPENDENT_FIELD_TOKEN.apellidos}
          disabled={submitting}
          label="Apellidos"
          value={formData.apellidos}
          onChange={(v) => updateField("apellidos", v)}
          placeholder={example("Rodríguez López")}
          required
          icon={<User size={ICON.sm} strokeWidth={1.5} aria-hidden="true" />}
          error={shownError("apellidos")}
          onBlur={() => markTouched("apellidos")}
          autoComplete="family-name"
          pattern="[A-Za-z\u00C0-\u024F\s]+"
          maxLength={100}
          minLength={3}
        />
        <div className="grid gap-4 sm:grid-cols-2">
          <BirthDateField
            idPrefix={ADD_DEPENDENT_ID_PREFIX}
            field={ADD_DEPENDENT_FIELD_TOKEN.fechaNacimiento}
            disabled={submitting}
            label="Fecha de nacimiento"
            value={formData.fechaNacimiento}
            onChange={(v) => updateField("fechaNacimiento", v)}
            required
            icon={<Calendar size={ICON.sm} strokeWidth={1.5} aria-hidden="true" />}
            min={birthDateBounds.min}
            max={birthDateBounds.max}
            error={shownError("fechaNacimiento")}
            onBlur={() => markTouched("fechaNacimiento")}
            hint="Día, mes y año de cuatro dígitos (por ejemplo, 15 marzo 2015)."
          />
          <WizardInput
            idPrefix={ADD_DEPENDENT_ID_PREFIX}
            field={ADD_DEPENDENT_FIELD_TOKEN.cedula}
            disabled={submitting}
            label="Cédula de identidad"
            value={formData.cedula}
            onChange={(v) => updateField("cedula", v)}
            placeholder={example("1712345678")}
            required
            icon={<Hash size={ICON.sm} strokeWidth={1.5} aria-hidden="true" />}
            pattern="[0-9]{10}"
            inputMode="numeric"
            numericMode="cedula"
            error={shownError("cedula")}
            onBlur={() => markTouched("cedula")}
            hint={
              cedulaTyped > 0 && cedulaTyped < CEDULA_DIGITS
                ? `Lleva ${cedulaTyped} de ${CEDULA_DIGITS} dígitos.`
                : CEDULA_HINT
            }
          />
        </div>
        {/* `sunken`, not `canvas` — the same recessed well and the same
            plausibility gate `PersonIdentityFields` renders for its callers. */}
        {formData.fechaNacimiento && (
          <div className="rounded-ctl bg-sunken p-3 text-xs text-ink-3-strong">
            Edad calculada: {" "}
            <span className="font-semibold text-ink">
              {agePlausible ? `${age} años` : ageValid ? "Revise el año." : "—"}
            </span>
          </div>
        )}

        {/* School selector */}
        {instituciones.length > 0 && (
          <div className="mt-4">
            {/* Sentence case, like every other label on this wizard. The
                interface writes "Nombre del contacto", not "Nombre Del
                Contacto"; three labels on this screen were the exception. */}
            <label
              htmlFor={ADD_DEPENDENT_SCHOOL_TYPE_ID}
              className="mb-1.5 block text-sm font-semibold text-ink"
            >
              Tipo de escuela
            </label>
            <select
              id={ADD_DEPENDENT_SCHOOL_TYPE_ID}
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
              htmlFor={addDependentFieldId("institucionId")}
              className="mb-1.5 mt-3 block text-sm font-semibold text-ink"
            >
              Escuela o institución
            </label>
            <p className="mb-2 text-xs text-ink-3">
              Seleccione la institución educativa del estudiante (opcional).
            </p>
            <select
              id={addDependentFieldId("institucionId")}
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
      </div>
    );
  }

  function renderHealthStep(): React.ReactElement {
    return (
      <div className="space-y-field">
        <p className="mb-4 text-sm leading-relaxed text-ink-2">
          Información que el club necesita conocer para la seguridad del dependiente:
        </p>

        <div className="mb-4">
          {/*
           * NO asterisk. `wizard-fields.tsx` retired the red required-marker
           * with its reason written down — it spent the system's one action
           * colour on decoration and it marked the MAJORITY, which is a
           * texture rather than information — and replaced it with "(opcional)"
           * on the minority. This select kept the asterisk, so the step marked
           * its required field one way and its optional fields the other, in
           * the same eighty pixels. `required` stays on the control, which is
           * the attribute assistive technology actually reads.
           */}
          <label
            htmlFor={addDependentFieldId("tipoSangre")}
            className="mb-1.5 block text-sm font-semibold text-ink"
          >
            Tipo de sangre <span aria-hidden="true" className="text-state-bad">*</span>
          </label>
          <select
            id={addDependentFieldId("tipoSangre")}
            value={formData.tipoSangre}
            onChange={(e) => updateField("tipoSangre", e.target.value as TipoSangre)}
            onBlur={() => markTouched("tipoSangre")}
            required
            disabled={submitting}
            aria-invalid={shownError("tipoSangre") ? true : undefined}
            /* `state-bad` is the error ink; `cata-red` is the ACTION colour and
               as a border it says "press me" on the field the visitor got
               wrong. The 3px halo went with it — a translucent red composites
               to 1.27–1.96:1, decoration rather than an indicator. Both moves
               are `WizardInput`'s, made one batch earlier. */
            className={`input-field ${shownError("tipoSangre") ? "border-state-bad" : ""}`}
          >
            <option value="">Seleccione una opción</option>
            {/* `SELECTABLE_BLOOD_TYPES`, not the whole enum (#643): "No lo sé"
                is no longer on offer, because the record this wizard creates
                has to be a complete one. */}
            {SELECTABLE_BLOOD_TYPES.map((bloodType) => (
              <option key={bloodType} value={bloodType}>
                {bloodType.replace("_", " ")}
              </option>
            ))}
          </select>
          {shownError("tipoSangre") && (
            <p className="mt-1.5 flex items-center gap-1.5 text-xs font-semibold text-state-bad">
              <AlertTriangle size={ICON.sm} strokeWidth={2} className="shrink-0" aria-hidden="true" />
              {shownError("tipoSangre")}
            </p>
          )}
        </div>

        {/* `example()`, not "p. ej." — the abbreviation is the one thing "la
            regla de las palabras" forbids outright, and the two fields eighty
            pixels below already said "Por ejemplo:". */}
        {renderTextarea({
          field: "enfermedades",
          label: "Enfermedades",
          value: formData.enfermedades,
          onChange: (v) => updateField("enfermedades", v),
          placeholder: example("Asma, diabetes (separadas por comas)"),
          icon: <Heart size={ICON.sm} strokeWidth={1.5} aria-hidden="true" />,
        })}

        {renderTextarea({
          field: "alergias",
          label: "Alergias",
          value: formData.alergias,
          onChange: (v) => updateField("alergias", v),
          placeholder: example("Alergia al polvo, al látex, a picaduras de insectos"),
          icon: <AlertTriangle size={ICON.sm} strokeWidth={1.5} aria-hidden="true" />,
        })}

        {/*
         * Issue #1138: sin campos de contacto de emergencia propios -- este
         * wizard siempre crea un menor representado, y su contacto de
         * emergencia se deriva del representante (nombre y teléfono
         * actuales), no de un texto libre que haya que mantener acá.
         */}
        <div className="rounded-ctl border border-line-2 bg-canvas p-3 text-xs text-ink-2">
          En caso de emergencia, el club lo contactará a usted con el nombre y
          teléfono de su cuenta.
        </div>

        {/* `rounded-ctl`, and the ramp's own ink instead of `amber-700/80` —
            which is Tailwind's default palette, and measures 3.25:1 on this
            tint. `state-warn` on `state-warn-bg` is the pair the system
            measured for exactly this box. */}
        <div className="rounded-ctl border border-state-warn/25 bg-state-warn-bg p-3 text-xs text-state-warn">
          <p className="flex items-center gap-1.5 font-semibold">
            <AlertTriangle size={ICON.sm} strokeWidth={2} aria-hidden="true" />
            Datos sensibles
          </p>
          <p className="mt-1">
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
   * duplicate-identity 400 could not tell apart (issue #233): here, the
   * dependent's cédula — the only identity field this wizard collects since
   * issue #1137 retired the dependent's own correo. The marker lives
   * outside `WizardNavigation`'s alert box on purpose: that alert must
   * never name a field either.
   */
  function summaryRow(
    label: string,
    value: React.ReactNode,
    correctStep: AddDependentStep,
    opts: { duplicateCandidate?: boolean } = {},
  ): React.ReactElement {
    const flagged = Boolean(opts.duplicateCandidate) && formErrors.some(isDuplicateIdentityError);
    return (
      <div
        className={`flex min-h-drow items-center gap-4 border-b border-line px-5 py-2 last:border-b-0 ${
          flagged ? "bg-state-warn-bg" : ""
        }`}
      >
        <span className="w-[150px] flex-none text-2xs font-bold uppercase text-ink-3">
          {label}
        </span>
        <span className="flex-1 text-sm font-semibold text-ink">{value}</span>
        {flagged && (
          <span className="flex-none text-2xs font-bold uppercase text-state-warn">Revisar</span>
        )}
        <button
          type="button"
          onClick={() => goToStep(correctStep)}
          className={buttonClasses("secondary", "sm", "flex-none")}
        >
          Corregir
        </button>
      </div>
    );
  }

  function renderSummary(): React.ReactElement {
    const age = formData.fechaNacimiento ? calculatePersonAge(formData.fechaNacimiento) : null;
    const ageLabel = age !== null && !Number.isNaN(age) ? ` · ${age} años` : "";
    return (
      <div className="space-y-section">
        <p className="text-sm leading-relaxed text-ink-2">
          Esto es lo que vamos a crear. Corrija cualquier bloque antes de confirmar:
        </p>

        <div className="overflow-hidden rounded-card border border-line">
          {summaryRow(
            "Dependiente",
            `${formData.nombres} ${formData.apellidos}`.trim() + ageLabel,
            "child",
          )}
          {summaryRow("Cédula", formData.cedula || "—", "child", { duplicateCandidate: true })}
          {summaryRow(
            "Institución",
            instituciones.find((inst) => String(inst.id) === formData.institucionId)?.nombre
              ?? "Sin institución asignada",
            "child",
          )}
          {summaryRow(
            "Tipo de sangre",
            formData.tipoSangre ? formData.tipoSangre.replace("_", " ") : "—",
            "health",
          )}
          {summaryRow("Enfermedades", formData.enfermedades || "Ninguna reportada", "health")}
          {summaryRow("Alergias", formData.alergias || "Ninguna reportada", "health")}
        </div>

        {/* Issue #1318: only for a caller who isn't REPRESENTANTE yet — an
            existing representante adding a second/third dependent skips the
            role switch server-side, so nothing here would be true for them. */}
        {!isRepresentative && (
          <div className="rounded-ctl border border-line-2 bg-canvas p-3 text-xs text-ink-2">
            Al guardar, su cuenta pasa a ser de representante. Sigue jugando
            con su membresía actual y podrá gestionar a este perfil.
          </div>
        )}

        <div className="rounded-ctl border border-line-2 bg-canvas p-4 text-sm text-ink-2">
          <label htmlFor="dependent-pay-choice">¿Cuándo desea pagar?</label>
          <select id="dependent-pay-choice" className="input-field mt-2" value={payNow ? "now" : "later"} onChange={(e) => setPayNow(e.target.value === "now")}>
            <option value="later">Agregar dependiente y pagar más tarde</option>
            <option value="now">Agregar dependiente y registrar el pago ahora</option>
          </select>
        </div>

        <label className="flex cursor-pointer items-start gap-3 rounded-ctl border border-line-2 bg-canvas p-4 text-sm text-ink-2">
          <input
            type="checkbox"
            checked={summaryReviewed}
            onChange={(e) => {
              setSummaryReviewed(e.target.checked);
              setFormErrors([]);
            }}
            className="mt-0.5 h-4 w-4 rounded border-line-2 text-coal focus:ring-ball"
          />
          <span>
            Revisé el resumen y confirmo que la información está correcta.
            <span className="mt-1 block text-xs text-ink-3">
              Esto evita agregar el dependiente por accidente al llegar al último paso.
            </span>
          </span>
        </label>
      </div>
    );
  }

  function renderPaymentStep(): React.ReactElement {
    return (
      <div className="space-y-section">
        <p className="text-sm text-ink-2">El dependiente ya fue agregado. Seleccione el plan y registre su primer pago. Administración lo validará antes de activar la membresía.</p>
        <label className="block text-sm text-ink-2" htmlFor="dependent-plan">Plan de membresía</label>
        <select id="dependent-plan" className="input-field" value={planId} onChange={(e) => setPlanId(e.target.value)} disabled={submitting}>
          <option value="">Seleccione un plan</option>
          {plans.map((plan) => <option key={plan.id} value={plan.id}>{plan.categoria} — ${plan.precio}</option>)}
        </select>
        <label className="block text-sm text-ink-2" htmlFor="dependent-months">Meses a pagar</label>
        <input id="dependent-months" type="number" className="input-field" min={1} max={12} value={months} onChange={(e) => setMonths(Number(e.target.value))} disabled={submitting} />
        <label className="block text-sm text-ink-2" htmlFor="dependent-method">Medio de pago</label>
        <select id="dependent-method" className="input-field" value={method} onChange={(e) => { setMethod(e.target.value as typeof method); setPendingPaymentId(null); }} disabled={submitting || pendingPaymentId !== null}>
          <option value="TRANSFERENCIA">Transferencia</option>
          <option value="EFECTIVO">Efectivo</option>
        </select>
        {method === "TRANSFERENCIA" && <>
          <label className="block text-sm text-ink-2" htmlFor="dependent-voucher">Comprobante de transferencia (JPG, PNG o PDF; máximo 5 MB)</label>
          <input id="dependent-voucher" type="file" accept="image/jpeg,image/png,application/pdf" onChange={(e) => setVoucher(e.target.files?.[0] ?? null)} disabled={submitting} />
        </>}
        {formErrors.length > 0 && <div role="alert" className="text-sm text-state-bad">{formErrors.join(" ")}</div>}
        <div className="flex flex-wrap gap-3">
          <button type="submit" disabled={submitting} className={buttonClasses("primary", "md")}>
            {submitting ? "Registrando…" : pendingPaymentId ? "Reintentar comprobante" : "Registrar pago"}
          </button>
          <button type="button" className={buttonClasses("secondary", "md")} onClick={() => router.push("/student")}>Pagar más tarde</button>
        </div>
      </div>
    );
  }

  // ---- Render ----

  return (
    // This wizard is reached from a button on `/student`, so it keeps
    // `/student`'s chrome instead of falling back to the dark top nav. The
    // page's own hero banner is gone: it repeated the title and
    // subtitle that `AppShell`'s header row now renders once, above `<main>`.
    <AppShell
      title="Agregar dependiente"
      subtitle="Complete los pasos para agregar un nuevo dependiente a su cuenta de representante."
      // Issue #1396: through the shell's `back` slot, so the control precedes
      // the title in document order — `PageHeader` is drawn above `<main>`,
      // so a back control among the children lands after the title by
      // construction.
      back={<BackLink href="/student" />}
    >
      {/* Full dashboard measure: the form card keeps a readable column and a
          rail carries the "what you need" help instead of stretching inputs. */}
      <div className={PAGE_RAIL}>
      <div className="flex min-w-0 flex-col gap-page">

      {/* Named stepper — the same contract as the other two wizards. The
          counter's wrapper `<div>` is gone: it carried nothing and made the
          `gap-page` column count a block where there was only a line. */}
      <p className="text-2xs font-bold uppercase tracking-caps text-ink-3-strong">
        Paso {createdDependentId !== null ? 4 : currentIndex + 1} de {payNow ? 4 : ADD_DEPENDENT_STEP_ORDER.length}
      </p>

      <Stepper
        label="Pasos para agregar un dependiente"
        current={createdDependentId !== null ? 4 : currentIndex + 1}
        steps={[...ADD_DEPENDENT_STEP_ORDER.map((s) => ADD_DEPENDENT_SHORT_LABELS[s]), ...(payNow ? ["Pago"] : [])]}
      />

      {/* Form card */}
      <div className="card p-6 sm:p-8">
        {/* The `title` step: 20px Graduate, uppercase, weight 400. It used to
            be `text-sm font-bold` — 13.5px, the DENSE step, SMALLER than the
            14px labels of the fields inside the card it names. No weight
            class: Graduate has one 400 cut, and a CSS bold on top of it asks
            the browser to synthesise a stroke the face cannot draw. */}
        <h2 className="mb-6 font-display text-lg uppercase leading-tight tracking-flat text-ink">
          {createdDependentId !== null ? "Primer pago" : ADD_DEPENDENT_STEP_LABELS[step]}
        </h2>

        <form onSubmit={handleConfirm}>
          {createdDependentId !== null ? renderPaymentStep() : <>
          {/* Step content */}
          {step === "child" && renderChildStep()}
          {step === "health" && renderHealthStep()}
          {step === "summary" && renderSummary()}

          <WizardNavigation
            formErrors={formErrors}
            duplicateIdentityAudience="representative"
            isFirst={isFirst}
            isLast={isLast}
            submitting={submitting}
            onBack={handleBack}
            onNext={handleNext}
            nextDisabled={!stepComplete}
            nextBlockedReason={blockedReason ?? undefined}
            submitButton={
              <button
                type="submit"
                disabled={submitting || !summaryReviewed}
                className={buttonClasses("primary", "md", "disabled:cursor-not-allowed")}
              >
                {submitting ? (
                  "Agregando…"
                ) : (
                  <>
                    <CheckCircle size={ICON.sm} strokeWidth={2} aria-hidden="true" />
                    Agregar dependiente
                  </>
                )}
              </button>
            }
          />
          </>}
        </form>
      </div>
      </div>
      <aside aria-label="Antes de empezar" className="card flex flex-col gap-3 p-5 lg:sticky lg:top-4">
        <h2 className="text-2xs font-bold uppercase tracking-caps text-ink-3-strong">Antes de empezar</h2>
        <ul className="flex flex-col gap-2.5 text-sm leading-relaxed text-ink-2">
          <li>Tenga a mano el nombre completo, la fecha de nacimiento y el documento del dependiente.</li>
          <li>La ficha médica puede completarse ahora o más tarde desde “Ficha médica”.</li>
          <li>Si el dependiente ya está registrado, el sistema se lo indicará sin duplicar datos.</li>
        </ul>
      </aside>
      </div>
    </AppShell>
  );
}

export default function AddDependentPage(): React.ReactElement {
  return (
    // Issue #1318: reachable by an existing representante AND by a
    // self-managed player ("estudiante") adding their first dependent — the
    // backend grants REPRESENTANTE in the same request for the latter.
    <ProtectedRoute allowedRoles={["representante", "estudiante"]}>
      {/* The wizard reads its step from the query string; `useSearchParams`
          needs a boundary to fall back to during prerender. */}
      <Suspense>
        <AddDependentContent />
      </Suspense>
    </ProtectedRoute>
  );
}
