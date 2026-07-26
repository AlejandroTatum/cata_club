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

import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { enrollStudent, fetchInstituciones, type Institucion } from "@/services/api";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/contexts/ToastContext";
import { clearLegacyEnrollmentSession } from "@/lib/enrollment-session";
import BackLink from "@/components/BackLink";
import HelpChatLauncher from "@/components/chatbot/HelpChatLauncher";
import { WizardInput, WizardTextarea, PersonIdentityFields, EmergencyContactFields, WizardNavigation } from "@/components/wizard-fields";
import { Stepper, buttonClasses } from "@/components/ui";
import { BLOOD_TYPES } from "@/types/enrollment";
import {
  UserPlus,
  Heart,
  CheckCircle,
  AlertTriangle,
  Hash,
  FileText,
  Mail,
} from "lucide-react";
import {
  calculateAge,
  buildEnrollmentRequest,
  describeStepBlocker,
  ENROLLMENT_TYPES,
  getEnrollmentErrorMessage,
  isDemoQuickFillEnabled,
  validateEnrollFields,
  validateEnrollStep,
  validateEnrollment,
  STEP_ORDER,
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
// `docs/ux/prototipos/05-inscripcion.html:57-67`.
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
// Component
// ---------------------------------------------------------------------------

export default function EnrollPage(): React.ReactElement {
  const { refreshSession, isAuthenticated } = useAuth();
  const { showError } = useToast();
  const demoQuickFillEnabled = isDemoQuickFillEnabled();
  const [step, setStep] = useState<WizardStep>("type");
  const [formData, setFormData] = useState<EnrollFormData>(initialFormData);
  const [submitting, setSubmitting] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [summaryReviewed, setSummaryReviewed] = useState(false);
  const [formErrors, setFormErrors] = useState<string[]>([]);
  const [touched, setTouched] = useState<Set<EnrollField>>(new Set());
  const [instituciones, setInstituciones] = useState<Institucion[]>([]);
  const [tipoEscuelaFilter, setTipoEscuelaFilter] = useState<string>("");
  const queryAppliedRef = useRef(false);

  // For self-enrollment, skip the representative step entirely.
  const effectiveSteps = STEP_ORDER.filter(
    (s) => s !== "representative" || formData.enrollmentType === ENROLLMENT_TYPES.CHILD,
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

  useEffect(() => {
    fetchInstituciones().then(setInstituciones).catch(() => {});
  }, []);

  // ---- Helpers ----

  function updateField<K extends keyof EnrollFormData>(
    key: K,
    value: EnrollFormData[K],
  ): void {
    setFormData((prev) => ({ ...prev, [key]: value }));
    setFormErrors([]);
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
      setStep(nextStep);
    }
  }

  function handleBack(): void {
    setFormErrors([]);
    const prevIdx = currentIndex - 1;
    if (prevIdx >= 0) {
      setStep(effectiveSteps[prevIdx]);
    }
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
    } catch (error: unknown) {
      setSubmitting(false);
      const message = getEnrollmentErrorMessage(error);
      setFormErrors([message]);
      showError(message);
    }
  }

  function handleReset(): void {
    setFormData(initialFormData);
    setStep("type");
    setConfirmed(false);
    setSubmitting(false);
    setSummaryReviewed(false);
    setFormErrors([]);
    setTouched(new Set());
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
          cedula: "1712345678",
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
          cedula: "1723456789",
          telefono: "0991234567",
          nombreRepresentante: "Sofia",
          apellidosRepresentante: "Martinez",
          cedulaRepresentante: "1712345678",
          fechaNacimientoRepresentante: "1990-05-20",
          telefonoRepresentante: "0991234567",
          correoRepresentante: "sofia@example.com",
          contraseniaRepresentante: "password8",
          ...base,
        });
        break;
    }
    setStep("type");
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
    },
  ): React.ReactElement {
    return (
      <WizardInput
        idPrefix="enroll"
        {...opts}
        disabled={submitting}
        error={shownError(field)}
        onBlur={() => markTouched(field)}
      />
    );
  }

  function renderTextarea(opts: {
    label: string;
    value: string;
    onChange: (v: string) => void;
    placeholder?: string;
    required?: boolean;
    icon?: React.ReactNode;
    rows?: number;
  }): React.ReactElement {
    return <WizardTextarea idPrefix="enroll" disabled={submitting} {...opts} />;
  }

  // ---- Step renderers ----

  function renderTypeStep(): React.ReactElement {
    return (
      <div className="space-y-4">
        <p className="text-sm leading-relaxed text-cata-text/65">
          Seleccione el tipo de inscripción que desea realizar:
        </p>

        {/* `.choice` (_sistema.css:323-328). Even height via `items-stretch` +
            `h-full`, so the two cards never step on each other. Selection is
            coal plus the yellow ball dot — NEVER red: red belongs to the
            primary CTA and to destructive actions only. */}
        <div className="grid items-stretch gap-4 sm:grid-cols-2">
          {ENROLLMENT_CHOICES.map((choice) => {
            const selected = formData.enrollmentType === choice.value;
            return (
              <button
                key={choice.value}
                type="button"
                aria-pressed={selected}
                onClick={() => updateField("enrollmentType", choice.value)}
                className={`flex h-full flex-col gap-[7px] rounded-card border p-[17px_18px] text-left transition-colors duration-150 ${
                  selected
                    ? "border-coal bg-paper ring-1 ring-coal"
                    : "border-line-2 bg-paper hover:bg-canvas"
                }`}
              >
                <b className="text-[14.5px] font-bold text-ink">{choice.title}</b>
                <p className="text-[13px] leading-relaxed text-ink-3">{choice.description}</p>
                {selected && (
                  <span className="h-badge mt-1 inline-flex items-center gap-1.5 self-start rounded-full bg-coal px-[11px] text-[11.5px] font-bold text-white">
                    <span aria-hidden="true" className="h-1.5 w-1.5 flex-none rounded-full bg-ball" />
                    Seleccionado
                  </span>
                )}
              </button>
            );
          })}
        </div>

        <div className="card p-4">
          <p className="text-[13px] font-bold text-ink">
            {formData.enrollmentType === "self"
              ? "Inscripción como jugador"
              : "Inscripción de dependiente"}
          </p>
          <p className="mt-1.5 text-[13px] leading-relaxed text-ink-3">
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
        <p className="mb-4 text-sm leading-relaxed text-cata-text/65">
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

        {/* School selector — only for minors (child enrollment) */}
        {!isSelf && instituciones.length > 0 && (
          <div className="mt-4">
            <label htmlFor="enroll-tipo-escuela" className="mb-1.5 block text-sm font-medium text-cata-text">
              Tipo de Escuela
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
              <option value="PARTICULAR">Particular</option>
              <option value="FISCAL">Fiscal</option>
              <option value="FISCOMISIONAL">Fiscomisional</option>
              <option value="MUNICIPAL">Municipal</option>
            </select>

            <label htmlFor="enroll-institucion" className="mb-1.5 mt-3 block text-sm font-medium text-cata-text">
              Escuela / Institución
            </label>
            <p className="mb-2 text-xs text-cata-text/50">
              Seleccione la institución educativa del estudiante (opcional).
            </p>
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
                    {inst.nombre} ({inst.tipoEscuela})
                  </option>
                ))}
            </select>
          </div>
        )}

        {/* Student credentials */}
        <div className="my-4 h-px bg-cata-border" />
        <div>
          <div className="mb-4 flex items-center gap-2">
            <Mail size={16} strokeWidth={1.5} className="text-cata-red" aria-hidden="true" />
            <h3 className="text-sm font-semibold text-cata-text">
              {isSelf ? "Credenciales de Acceso" : "Cuenta del Estudiante (Opcional)"}
            </h3>
          </div>
          {!isSelf && (
            <p className="mb-3 text-xs leading-relaxed text-cata-text/65">
              Si desea que el menor tenga su propia cuenta de acceso, ingrese
              las credenciales. Deje vacío si no requiere cuenta para el estudiante.
            </p>
          )}
          {renderField("correo", {
            label: isSelf ? "Correo electrónico" : "Correo electrónico del Estudiante",
            value: formData.correo,
            onChange: (v) => updateField("correo", v),
            type: "email",
            required: isSelf,
            placeholder: isSelf ? undefined : "Opcional: correo@ejemplo.com",
          })}
          {renderField("contrasenia", {
            label: isSelf ? "Contraseña" : "Contraseña del Estudiante",
            value: formData.contrasenia,
            onChange: (v) => updateField("contrasenia", v),
            type: "password",
            required: isSelf,
            placeholder: isSelf ? undefined : "Opcional: mínimo 8 caracteres",
            hint: isSelf ? "Al menos 8 caracteres." : undefined,
          })}
        </div>
      </div>
    );
  }

  function renderRepresentativeStep(): React.ReactElement {
    return (
      <div className="space-y-1">
        <p className="mb-4 text-sm leading-relaxed text-cata-text/65">
          Complete los datos del representante legal y sus credenciales de acceso:
        </p>
        {renderField("nombreRepresentante", {
          label: "Nombres del Representante",
          value: formData.nombreRepresentante,
          onChange: (v) => updateField("nombreRepresentante", v),
          placeholder: "p. ej. María Fernanda",
          required: true,
          icon: <UserPlus size={16} strokeWidth={1.5} aria-hidden="true" />,
        })}

        {renderField("apellidosRepresentante", {
          label: "Apellidos del Representante",
          value: formData.apellidosRepresentante,
          onChange: (v) => updateField("apellidosRepresentante", v),
          required: true,
        })}

        {renderField("cedulaRepresentante", {
          label: "Cédula del Representante",
          value: formData.cedulaRepresentante,
          onChange: (v) => updateField("cedulaRepresentante", v),
          placeholder: "p. ej. 1712345678",
          required: true,
          icon: <Hash size={16} strokeWidth={1.5} aria-hidden="true" />,
          pattern: "[0-9]{10}",
          maxLength: 10,
          inputMode: "numeric",
          hint: "10 dígitos, sin guiones.",
        })}

        {renderField("fechaNacimientoRepresentante", {
          label: "Fecha de Nacimiento del Representante",
          value: formData.fechaNacimientoRepresentante,
          onChange: (v) => updateField("fechaNacimientoRepresentante", v),
          type: "date",
          required: true,
        })}

        {renderField("telefonoRepresentante", {
          label: "Teléfono del Representante",
          value: formData.telefonoRepresentante,
          onChange: (v) => updateField("telefonoRepresentante", v),
          inputMode: "tel",
          required: true,
          hint: "Entre siete y diez dígitos, con o sin espacios.",
        })}

        <div className="my-4 h-px bg-line" />

        {renderField("correoRepresentante", {
          label: "Correo electrónico del Representante",
          value: formData.correoRepresentante,
          onChange: (v) => updateField("correoRepresentante", v),
          type: "email",
          required: true,
        })}

        {renderField("contraseniaRepresentante", {
          label: "Contraseña del Representante",
          value: formData.contraseniaRepresentante,
          onChange: (v) => updateField("contraseniaRepresentante", v),
          type: "password",
          required: true,
          hint: "Al menos 8 caracteres.",
        })}

        <div className="rounded-ctl border border-state-warn/25 bg-state-warn-bg p-3 text-xs text-state-warn">
          <p className="flex items-center gap-1.5 font-semibold">
            <AlertTriangle size={12} strokeWidth={2} aria-hidden="true" />
            Representante mayor de edad
          </p>
          <p className="mt-1">
            El representante debe ser mayor de edad (18+). Al inscribir a un
            dependiente, usted confirma que es legalmente responsable del menor.
          </p>
        </div>
      </div>
    );
  }

  function renderHealthStep(): React.ReactElement {
    return (
      <div className="space-y-1">
        <p className="mb-4 text-sm leading-relaxed text-cata-text/65">
          Información que el club necesita conocer para la seguridad del estudiante:
        </p>

        <div className="mb-4">
          <label htmlFor="enroll-tipo-de-sangre" className="mb-1.5 block text-sm font-medium text-cata-text">
            Tipo de Sangre <span className="ml-0.5 text-cata-red">*</span>
          </label>
          <select
            id="enroll-tipo-de-sangre"
            value={formData.tipoSangre}
            onChange={(e) => updateField("tipoSangre", e.target.value as EnrollFormData["tipoSangre"])}
            onBlur={() => markTouched("tipoSangre")}
            required
            disabled={submitting}
            aria-invalid={shownError("tipoSangre") ? true : undefined}
            className={`input-field ${shownError("tipoSangre") ? "border-cata-red ring-[3px] ring-cata-red/10" : ""}`}
          >
            <option value="">Seleccione una opción</option>
            {Object.values(BLOOD_TYPES).map((bloodType) => <option key={bloodType} value={bloodType}>{bloodType.replace("_", " ")}</option>)}
          </select>
          {shownError("tipoSangre") && (
            <p className="mt-1.5 flex items-center gap-1.5 text-xs font-semibold text-cata-red">
              <AlertTriangle size={13} strokeWidth={2} className="shrink-0" aria-hidden="true" />
              {shownError("tipoSangre")}
            </p>
          )}
        </div>

        {renderTextarea({
          label: "Condiciones de Salud",
          value: formData.condicionesSalud,
          onChange: (v) => updateField("condicionesSalud", v),
          placeholder:
            "p. ej. Asma, diabetes, problemas cardíacos, lesiones previas…",
          icon: <Heart size={16} strokeWidth={1.5} aria-hidden="true" />,
          rows: 2,
        })}

        {renderTextarea({
          label: "Alergias",
          value: formData.alergias,
          onChange: (v) => updateField("alergias", v),
          placeholder:
            "p. ej. Alergia al polvo, al látex, a picaduras de insectos…",
          icon: <AlertTriangle size={16} strokeWidth={1.5} aria-hidden="true" />,
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

        {renderTextarea({
          label: "Observaciones Adicionales",
          value: formData.observaciones,
          onChange: (v) => updateField("observaciones", v),
          placeholder:
            "Cualquier otra información relevante que el club deba conocer…",
          icon: <FileText size={16} strokeWidth={1.5} aria-hidden="true" />,
          rows: 2,
        })}

        <div className="rounded-xl border border-state-warn/25 bg-state-warn-bg p-3 text-xs text-state-warn">
          <p className="flex items-center gap-1.5 font-medium">
            <AlertTriangle size={12} strokeWidth={2} aria-hidden="true" />
            Datos sensibles
          </p>
          <p className="mt-1 text-blue-700">
            Esta información se maneja de forma segura conforme a la normativa
            de protección de datos.
          </p>
        </div>
      </div>
    );
  }

  /** One 56px detail row with the step it came from — `.drow` (_sistema.css:247-250). */
  function summaryRow(
    label: string,
    value: React.ReactNode,
    correctStep: WizardStep,
  ): React.ReactElement {
    return (
      <div key={label} className="flex min-h-drow items-center gap-4 border-b border-line px-5 py-2 last:border-b-0">
        <span className="w-[150px] flex-none text-[10.5px] font-bold uppercase tracking-[0.1em] text-ink-3">
          {label}
        </span>
        <span className="flex-1 text-sm font-semibold text-ink">{value}</span>
        <button
          type="button"
          onClick={() => setStep(correctStep)}
          className={buttonClasses("secondary", "sm", "flex-none")}
        >
          Corregir
        </button>
      </div>
    );
  }

  function renderSummary(): React.ReactElement {
    const age = formData.fechaNacimiento ? calculateAge(formData.fechaNacimiento) : null;
    const ageLabel = age !== null && !Number.isNaN(age) ? ` · ${age} años` : "";
    const isChild = formData.enrollmentType === ENROLLMENT_TYPES.CHILD;
    return (
      <div className="space-y-4">
        <p className="text-sm leading-relaxed text-cata-text/65">
          Esto es lo que vamos a crear. Corrija cualquier bloque antes de confirmar:
        </p>

        {/* One list of 56px rows, one datum per row — replaces four cramped
            two-column grids. Each row links back to the step that owns it. */}
        <div className="overflow-hidden rounded-card border border-line">
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
          {summaryRow("Cédula", formData.cedula || "—", "personal")}
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
          )}
          {isChild && formData.correo.trim()
            ? summaryRow("Cuenta del estudiante", formData.correo, "personal")
            : null}
          {summaryRow("Tipo de sangre", formData.tipoSangre.replace("_", " ") || "—", "health")}
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
        </div>

        <p className="text-[13px] leading-relaxed text-ink-3">
          Al confirmar creamos {isChild ? "su cuenta de representante y el perfil del estudiante" : "su cuenta de estudiante"}.
          Después podrá subir el comprobante:{" "}
          <b className="font-semibold text-ink">el club lo valida y recién ahí se activa la membresía</b>.
        </p>

        <label className="flex cursor-pointer items-start gap-3 rounded-ctl border border-line-2 bg-canvas p-4 text-sm text-ink-2">
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
               by the system indicator in `globals.css`. */
            className="mt-0.5 h-4 w-4 rounded border-line-2 text-coal"
          />
          <span>
            Revisé el resumen y confirmo que la información está correcta.
            <span className="mt-1 block text-xs text-ink-3">
              Esto evita finalizar la inscripción por accidente al llegar al último paso.
            </span>
          </span>
        </label>
      </div>
    );
  }

  // ---- Render ----

  return (
    <>
      {confirmed ? (
        <div className="flex min-h-[75vh] items-center justify-center py-12">
          <div className="w-full max-w-lg text-center">
            <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-full bg-cata-state-ok/10">
              <CheckCircle size={32} className="text-cata-state-ok" strokeWidth={1.5} aria-hidden="true" />
            </div>
            <h1 className="mb-3 text-2xl font-bold tracking-tight text-cata-text">
              Inscripción Completada
            </h1>
            <p className="mb-2 text-sm leading-relaxed text-cata-text/65">
              <strong className="text-cata-text">
                {formData.nombres} {formData.apellidos}
              </strong>{" "}
              ha sido registrado como estudiante de Cata Club.
            </p>
            <p className="mb-8 text-xs leading-relaxed text-cata-text/40">
              {formData.enrollmentType === "self" &&
                "Usted es el titular de la cuenta y el estudiante."}
              {formData.enrollmentType === "child" &&
                "Usted es el representante / responsable de pago de este estudiante."}{" "}
               Sus credenciales fueron creadas de forma segura.
            </p>
            <div className="flex flex-col gap-3 sm:flex-row sm:justify-center">
              <Link href="/student" className="btn-primary">
                Ir a Mi Cuenta
              </Link>
              <button type="button" onClick={handleReset} className="btn-secondary">
                Nueva Inscripción
              </button>
            </div>
          </div>
        </div>
      ) : (

        <div className="mx-auto w-full max-w-[760px] px-4 py-8">
          {/* One back-navigation rule: a sub-page carries a `BackLink` at the
              TOP, where back navigation lives everywhere else in the product.
              This used to be a centred text link at the very bottom of a
              five-step wizard — the one place a visitor who wants out is not
              looking.

              The destination is conditional because this wizard is public
              (see PUBLIC_EXCEPTIONS in src/lib/middleware-utils.ts): most
              visitors arrive from the landing with no account, and sending
              them to `/student` would bounce them straight to /login, which
              is the wall the landing funnel exists to route around. */}
          {/* Back on the left, help on the right — the two things a visitor
              reaches for when a five-step form stops making sense. The
              assistant is public (`POST /chatbot` needs no session), which is
              the point: most people filling this in have no account yet. */}
          {/* `items-baseline`, not `items-center`: `BackLink` carries its own
              `mb-6`, so centring the two margin boxes dropped the help link
              half a line below the back link it sits beside. */}
          <div className="flex flex-wrap items-baseline justify-between gap-3">
            <BackLink
              href={isAuthenticated ? "/student" : "/"}
              label={isAuthenticated ? "Volver a Mi Cuenta" : "Volver al inicio"}
            />
            {/* Carries `BackLink`'s own `mb-6` so that when the row wraps on a
                phone the help link keeps its distance from the step eyebrow
                below, instead of sitting on top of it. */}
            <HelpChatLauncher
              variant="quiet"
              label="¿Tiene dudas? Pregunte al asistente"
              className="mb-6"
            />
          </div>

          {/* Step header + the NAMED stepper. The five steps are named from
              step one: "Paso 2 de 5" anticipates nothing, "Contacto" does. */}
          <div className="mb-6">
            {/* `ink-3-strong`, not `ink-3`: this block sits on the PAGE
                surface (#F4F4F7, the body fill), not inside a card, and
                `ink-3` only clears AA on `paper` — it measures 4.21:1 here.
                Same reason `PageHeader` uses the companion token. */}
            <p className="text-[10.5px] font-bold uppercase tracking-[0.13em] text-ink-3-strong">
              Paso {currentIndex + 1} de {effectiveSteps.length}
            </p>
            <h1 className="mt-1 text-[26px] font-extrabold tracking-[-0.03em] text-ink">
              Inscripción de estudiante
            </h1>
            {/* The count is read from `effectiveSteps`, not written out: this
                copy said "Cinco pasos" while the line directly above it said
                "Paso 1 de 4", because arriving from the landing with
                `?type=self` already answers the first step and drops it. */}
            <p className="mt-1.5 text-[13px] leading-relaxed text-ink-3-strong">
              {effectiveSteps.length} pasos y queda dentro del club.
              {formData.enrollmentType === "self" && " Se inscribe usted como jugador."}
              {formData.enrollmentType === "child" && " Usted actúa como representante."}
            </p>
          </div>

          <Stepper
            className="mb-8"
            label="Pasos de la inscripción"
            current={currentIndex + 1}
            steps={effectiveSteps.map((s) => STEP_SHORT_LABELS[s])}
          />

          {/* Demo helper — quick-fill for testing convenience. The "(solo
              desarrollo)" label used to be the ONLY thing stopping this from
              reaching real visitors; `isDemoQuickFillEnabled` is the actual
              guard. See its doc comment for why it reads NODE_ENV. */}
          {demoQuickFillEnabled && (
            <div className="mb-6 rounded-xl border border-dashed border-cata-border bg-cata-bg p-3">
              <div className="mb-2 flex items-center gap-2">
                <AlertTriangle size={14} strokeWidth={1.5} className="text-amber-700" aria-hidden="true" />
                {/* Both lines were translucent ink over the `sunken` panel:
                    `/45` composited to #9499A1 (2.61:1) and `/40` to #9FA3AA
                    (2.31:1), the two worst pairs in the product. The panel is
                    dev-only (`isDemoQuickFillEnabled` gates it on NODE_ENV) so
                    it never reaches a visitor — but a token swap costs nothing
                    and the panel is unreadable to the developers who DO see it. */}
                <p className="text-[10px] font-semibold uppercase tracking-wider text-ink-3-strong">
                  Rellenar datos de prueba (solo desarrollo)
                </p>
              </div>
              <p className="mb-2 text-[10px] leading-relaxed text-ink-3-strong">
                Llena los campos automáticamente pero no salta la validación — los pasos deben completarse uno por uno.
              </p>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => fillDemoData("self")}
                  className="rounded-lg border border-cata-border bg-cata-surface px-3 py-1.5 text-xs font-medium text-cata-text transition-all hover:border-cata-red/20 hover:shadow-soft"
                >
                  Jugador
                </button>
                <button
                  type="button"
                  onClick={() => fillDemoData("child")}
                  className="rounded-lg border border-cata-border bg-cata-surface px-3 py-1.5 text-xs font-medium text-cata-text transition-all hover:border-cata-red/20 hover:shadow-soft"
                >
                  Representante
                </button>
              </div>
            </div>
          )}

          {/* Form card */}
          <div className="card p-6 sm:p-8">
            <h2 className="mb-6 text-[13px] font-bold text-ink">{STEP_LABELS[step]}</h2>

            <form onSubmit={handleConfirm}>
              {/* Step content */}
              {step === "type" && renderTypeStep()}
              {step === "personal" && renderPersonalStep()}
              {step === "representative" && renderRepresentativeStep()}
              {step === "health" && renderHealthStep()}
              {step === "summary" && renderSummary()}

              <WizardNavigation
                formErrors={formErrors}
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
                      "Inscribiendo…"
                    ) : (
                      <>
                        <CheckCircle size={14} strokeWidth={2} aria-hidden="true" />
                        Confirmar inscripción
                      </>
                    )}
                  </button>
                }
              />
            </form>
          </div>

        </div>
      )}
    </>
  );
}
