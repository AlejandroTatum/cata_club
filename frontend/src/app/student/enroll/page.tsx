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

import { useEffect, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { enrollStudent } from "@/services/api";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/contexts/ToastContext";
import { clearLegacyEnrollmentSession } from "@/lib/enrollment-session";
import BackLink from "@/components/BackLink";
import { WizardInput, WizardTextarea, PersonIdentityFields, EmergencyContactFields, WizardNavigation } from "@/components/wizard-fields";
import { BLOOD_TYPES } from "@/types/enrollment";
import {
  User,
  UserPlus,
  Calendar,
  Heart,
  CheckCircle,
  AlertTriangle,
  GraduationCap,
  Baby,
  Hash,
  FileText,
} from "lucide-react";
import {
  calculateAge,
  buildEnrollmentRequest,
  ENROLLMENT_TYPES,
  getEnrollmentErrorMessage,
  isDemoQuickFillEnabled,
  validateEnrollStep,
  validateEnrollment,
  STEP_ORDER,
  STEP_LABELS,
  initialFormData,
  type EnrollFormData,
  type EnrollmentType,
  type WizardStep,
} from "./enroll-utils";

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
  const queryAppliedRef = useRef(false);

  const currentIndex = STEP_ORDER.indexOf(step);
  const isFirst = currentIndex === 0;
  const isLast = currentIndex === STEP_ORDER.length - 1;
  const progress = ((currentIndex + 1) / STEP_ORDER.length) * 100;

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
    if (nextIdx < STEP_ORDER.length) {
      const nextStep = STEP_ORDER[nextIdx];
      if (nextStep === "summary") setSummaryReviewed(false);
      setStep(nextStep);
    }
  }

  function handleBack(): void {
    setFormErrors([]);
    const prevIdx = currentIndex - 1;
    if (prevIdx >= 0) {
      setStep(STEP_ORDER[prevIdx]);
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
  }

  // ---- Render helpers ----

  function renderInput(opts: {
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
    disabled?: boolean;
  }): React.ReactElement {
    return <WizardInput idPrefix="enroll" {...opts} disabled={opts.disabled ?? submitting} />;
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

        <div className="grid gap-4 sm:grid-cols-2">
          {/* Self enrollment — Jugador */}
          <button
            type="button"
            onClick={() => updateField("enrollmentType", "self")}
            className={`rounded-xl border-2 p-5 text-left transition-all duration-200 ${
              formData.enrollmentType === "self"
                ? "border-cata-red/40 bg-cata-red/10 ring-1 ring-cata-red/20"
                : "border-cata-border bg-cata-surface hover:border-cata-red/20 hover:shadow-soft"
            }`}
          >
            <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-xl bg-cata-red/15">
              <GraduationCap size={20} strokeWidth={1.5} className="text-cata-red" aria-hidden="true" />
            </div>
            <h3 className="mb-1 font-semibold text-cata-text">
              Jugador
            </h3>
            <p className="text-xs leading-relaxed text-cata-text/65">
              Quiero inscribirme yo al club. Soy mayor de edad y gestiono mi
              propia cuenta como estudiante.
            </p>
            {formData.enrollmentType === "self" && (
              <span className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-cata-red">
                <CheckCircle size={12} strokeWidth={2} aria-hidden="true" />
                Seleccionado
              </span>
            )}
          </button>

          {/* Child / dependent enrollment */}
          <button
            type="button"
            onClick={() => updateField("enrollmentType", "child")}
            className={`rounded-xl border-2 p-5 text-left transition-all duration-200 ${
              formData.enrollmentType === "child"
                ? "border-cata-red/40 bg-cata-red/10 ring-1 ring-cata-red/20"
                : "border-cata-border bg-cata-surface hover:border-cata-red/20 hover:shadow-soft"
            }`}
          >
            <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-xl bg-blue-50">
              <Baby size={20} strokeWidth={1.5} className="text-blue-700" aria-hidden="true" />
            </div>
            <h3 className="mb-1 font-semibold text-cata-text">
              Representante
            </h3>
            <p className="text-xs leading-relaxed text-cata-text/65">
              Quiero gestionar la inscripción de un hijo/dependiente.
              El estudiante es distinto de mi cuenta.
            </p>
            {formData.enrollmentType === "child" && (
              <span className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-cata-red">
                <CheckCircle size={12} strokeWidth={2} aria-hidden="true" />
                Seleccionado
              </span>
            )}
          </button>

        </div>

        {formData.enrollmentType === "child" && (
          <div className="rounded-xl border border-state-warn/25 bg-state-warn-bg p-3 text-xs text-state-warn">
            <p className="flex items-center gap-1.5 font-medium">
              <AlertTriangle size={12} strokeWidth={2} aria-hidden="true" />
              Inscripción de dependiente
            </p>
            <p className="mt-1 text-amber-700/80">
              Como representante, usted será el responsable de pago de este estudiante.
              Los datos del estudiante se registrarán por separado de su cuenta.
              Complete los datos del representante para identificar al adulto
              responsable.
            </p>
          </div>
        )}

        {formData.enrollmentType === "self" && (
          <div className="rounded-xl border border-emerald-500/30 bg-emerald-900/20 p-3 text-xs text-emerald-400">
            <p className="flex items-center gap-1.5 font-medium">
              <CheckCircle size={12} strokeWidth={2} aria-hidden="true" />
              Inscripción como jugador
            </p>
            <p className="mt-1 text-emerald-700/80">
              Usted será el estudiante titular de la cuenta. No se requieren datos
              de representante.
            </p>
          </div>
        )}
      </div>
    );
  }

  function renderPersonalStep(): React.ReactElement {
    return (
      <div className="space-y-1">
        <p className="mb-4 text-sm leading-relaxed text-cata-text/65">
          {formData.enrollmentType === "self" &&
            "Ingrese sus datos personales:"}
          {formData.enrollmentType === "child" &&
            "Ingrese los datos personales del estudiante a inscribir:"}
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
          renderAgeWarning={(age) =>
            age < 18 && formData.enrollmentType === "self" && (
              <span className="ml-1 text-amber-700">
                — Los menores de edad requieren un representante.
              </span>
            )
          }
        />

        {/* Representante fields — shown for child enrollment */}
        {formData.enrollmentType === "child" && (
          <>
            <div className="my-8 h-px bg-cata-border" />

            <div>
              <div className="mb-4 flex items-center gap-2">
                <UserPlus size={16} strokeWidth={1.5} className="text-cata-red" aria-hidden="true" />
                <h3 className="text-sm font-semibold text-cata-text">
                  Datos del Representante
                </h3>
              </div>
              <p className="mb-4 text-xs leading-relaxed text-cata-text/65">
                Identifique al adulto responsable de pago y representante legal
                del estudiante:
              </p>

              {renderInput({
                label: "Nombres del Representante",
                value: formData.nombreRepresentante,
                onChange: (v) => updateField("nombreRepresentante", v),
                placeholder: "p. ej. María Fernanda",
                required: true,
                icon: <UserPlus size={16} strokeWidth={1.5} aria-hidden="true" />,
              })}

              {renderInput({
                label: "Cédula del Representante",
                value: formData.cedulaRepresentante,
                onChange: (v) => updateField("cedulaRepresentante", v),
                placeholder: "p. ej. 1712345678",
                required: true,
                icon: <Hash size={16} strokeWidth={1.5} aria-hidden="true" />,
                pattern: "[0-9]{10}",
                maxLength: 10,
                inputMode: "numeric",
              })}

              <div className="rounded-xl border border-purple-200 bg-purple-50 p-3 text-xs text-purple-700">
                <p className="flex items-center gap-1.5 font-medium">
                  <AlertTriangle size={12} strokeWidth={2} aria-hidden="true" />
                  Representante mayor de edad
                </p>
                <p className="mt-1 text-purple-700/80">
                  El representante debe ser mayor de edad (18+). Al inscribir a
                  un dependiente, usted confirma que es legalmente responsable
                  del menor.
                </p>
              </div>
            </div>
          </>
        )}
      </div>
    );
  }

  function renderClubStep(): React.ReactElement {
    const isSelfEnrollment = formData.enrollmentType === ENROLLMENT_TYPES.SELF;
    return (
      <div className="space-y-1">
        <p className="mb-4 text-sm leading-relaxed text-cata-text/65">
          {isSelfEnrollment
            ? "Cree las credenciales para acceder a su cuenta de estudiante:"
            : "Complete los datos de contacto y acceso del representante:"}
        </p>
        {isSelfEnrollment ? (
          <>
            {renderInput({ label: "Correo electrónico", value: formData.correo, onChange: (v) => updateField("correo", v), type: "email", required: true })}
            {renderInput({ label: "Contraseña", value: formData.contrasenia, onChange: (v) => updateField("contrasenia", v), type: "password", required: true })}
          </>
        ) : (
          <>
            {renderInput({ label: "Apellidos del Representante", value: formData.apellidosRepresentante, onChange: (v) => updateField("apellidosRepresentante", v), required: true })}
            {renderInput({ label: "Fecha de Nacimiento del Representante", value: formData.fechaNacimientoRepresentante, onChange: (v) => updateField("fechaNacimientoRepresentante", v), type: "date", required: true })}
            {renderInput({ label: "Teléfono del Representante", value: formData.telefonoRepresentante, onChange: (v) => updateField("telefonoRepresentante", v), inputMode: "tel", required: true })}
            {renderInput({ label: "Correo electrónico del Representante", value: formData.correoRepresentante, onChange: (v) => updateField("correoRepresentante", v), type: "email", required: true })}
            {renderInput({ label: "Contraseña del Representante", value: formData.contraseniaRepresentante, onChange: (v) => updateField("contraseniaRepresentante", v), type: "password", required: true })}
          </>
        )}
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
            required
            disabled={submitting}
            className="input-field"
          >
            <option value="">Seleccione una opción</option>
            {Object.values(BLOOD_TYPES).map((bloodType) => <option key={bloodType} value={bloodType}>{bloodType.replace("_", " ")}</option>)}
          </select>
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
          <p className="mt-1 text-amber-700/80">
            Esta información se maneja de forma segura conforme a la normativa
            de protección de datos.
          </p>
        </div>
      </div>
    );
  }

  function renderSummary(): React.ReactElement {
    const age = formData.fechaNacimiento
      ? calculateAge(formData.fechaNacimiento)
      : null;
    return (
      <div className="space-y-4">
        <p className="text-sm leading-relaxed text-cata-text/65">
          Revise la información antes de confirmar la inscripción:
        </p>

        {/* Enrollment type */}
        <div className="card-hover p-4">
          <div className="mb-3 flex items-center gap-2">
            <GraduationCap size={14} strokeWidth={1.5} className="text-cata-red" aria-hidden="true" />
            <h3 className="text-xs font-semibold uppercase tracking-wider text-cata-text/45">
              Tipo de Inscripción
            </h3>
          </div>
          <div className="flex items-center gap-2 text-sm">
            {formData.enrollmentType === "self" && (
              <>
                <GraduationCap size={16} strokeWidth={1.5} className="text-cata-red" aria-hidden="true" />
                <span>Jugador — El estudiante es el titular de la cuenta</span>
              </>
            )}
            {formData.enrollmentType === "child" && (
              <>
                <Baby size={16} strokeWidth={1.5} className="text-blue-700" aria-hidden="true" />
                <span>Representante — Inscripción de dependiente gestionada por un adulto</span>
              </>
            )}
          </div>
        </div>

        {/* Student data */}
        <div className="card-hover p-4">
          <div className="mb-3 flex items-center gap-2">
            <User size={14} strokeWidth={1.5} className="text-cata-red" aria-hidden="true" />
            <h3 className="text-xs font-semibold uppercase tracking-wider text-cata-text/45">
              Datos del Estudiante
            </h3>
          </div>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
            <dt className="text-cata-text/65">Nombres</dt>
            <dd className="font-medium text-cata-text">{formData.nombres}</dd>
            <dt className="text-cata-text/65">Apellidos</dt>
            <dd className="font-medium text-cata-text">{formData.apellidos}</dd>
            <dt className="text-cata-text/65">Fecha de Nacimiento</dt>
            <dd className="font-medium text-cata-text">
              {formData.fechaNacimiento}
              {age !== null && (
                <span className="ml-2 text-cata-text/45">({age} años)</span>
              )}
            </dd>
            <dt className="text-cata-text/65">Cédula</dt>
            <dd className="font-medium text-cata-text">{formData.cedula}</dd>
            <dt className="text-cata-text/65">Teléfono</dt>
            <dd className="font-medium text-cata-text">{formData.telefono}</dd>
          </dl>
        </div>

        {/* Representante data — for child enrollment */}
        {formData.enrollmentType === "child" && (
          <div className="card-hover p-4">
            <div className="mb-3 flex items-center gap-2">
              <UserPlus size={14} strokeWidth={1.5} className="text-cata-red" aria-hidden="true" />
              <h3 className="text-xs font-semibold uppercase tracking-wider text-cata-text/45">
                Datos del Representante
              </h3>
            </div>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
              <dt className="text-cata-text/65">Nombres</dt>
              <dd className="font-medium text-cata-text">
                {formData.nombreRepresentante || (
                  <span className="text-cata-text/45">—</span>
                )}
              </dd>
              <dt className="text-cata-text/65">Cédula</dt>
              <dd className="font-medium text-cata-text">
                {formData.cedulaRepresentante || (
                  <span className="text-cata-text/45">—</span>
                )}
              </dd>
              <dt className="text-cata-text/65">Contacto</dt>
              <dd className="font-medium text-cata-text">{formData.telefonoRepresentante}</dd>
              <dt className="text-cata-text/65">Correo</dt>
              <dd className="font-medium text-cata-text">{formData.correoRepresentante}</dd>
            </dl>
          </div>
        )}

        {/* Health */}
        <div className="card-hover p-4">
          <div className="mb-3 flex items-center gap-2">
            <Heart size={14} strokeWidth={1.5} className="text-cata-red" aria-hidden="true" />
            <h3 className="text-xs font-semibold uppercase tracking-wider text-cata-text/45">
              Salud y Emergencia
            </h3>
          </div>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
            <dt className="text-cata-text/65">Condiciones de Salud</dt>
            <dd className="font-medium text-cata-text">
              {formData.condicionesSalud || (
                <span className="text-cata-text/45">Ninguna reportada</span>
              )}
            </dd>
            <dt className="text-cata-text/65">Alergias</dt>
            <dd className="font-medium text-cata-text">
              {formData.alergias || (
                <span className="text-cata-text/45">Ninguna reportada</span>
              )}
            </dd>
            <dt className="text-cata-text/65">Tipo de Sangre</dt>
            <dd className="font-medium text-cata-text">{formData.tipoSangre.replace("_", " ")}</dd>
            <dt className="text-cata-text/65">Contacto de Emergencia</dt>
            <dd className="font-medium text-cata-text">
              {formData.contactoEmergencia}
            </dd>
            <dt className="text-cata-text/65">Teléfono de Emergencia</dt>
            <dd className="font-medium text-cata-text">
              {formData.telefonoEmergencia}
            </dd>
            {formData.observaciones && (
              <>
                <dt className="text-cata-text/65">Observaciones</dt>
                <dd className="font-medium text-cata-text">
                  {formData.observaciones}
                </dd>
              </>
            )}
          </dl>
        </div>

        <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-700">
          <input
            type="checkbox"
            checked={summaryReviewed}
            onChange={(e) => {
              setSummaryReviewed(e.target.checked);
              setFormErrors([]);
            }}
            className="mt-0.5 h-4 w-4 rounded border-emerald-200 text-emerald-700 focus:ring-emerald-200"
          />
          <span>
            Revisé el resumen y confirmo que la información está correcta.
            <span className="mt-1 block text-xs text-emerald-400/75">
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

        <div className="py-8">
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
          <BackLink
            href={isAuthenticated ? "/student" : "/"}
            label={isAuthenticated ? "Volver a Mi Cuenta" : "Volver al inicio"}
          />

          {/* Hero Banner */}
          <div className="relative mb-10 overflow-hidden rounded-3xl border border-cata-border bg-cata-surface px-6 py-10 shadow-elevated sm:px-10 sm:py-12">
            <div className="absolute inset-0 bg-logo-glow" />
            <div className="relative z-10 flex items-start justify-between">
              <div>
                <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.25em] text-cata-red">
                  <UserPlus size={14} strokeWidth={2} aria-hidden="true" />
                  Inscripción
                </div>
                <h1 className="mt-2 text-3xl font-extrabold tracking-tight text-cata-text sm:text-4xl">
                  Inscripción de Estudiante
                </h1>
                <p className="mt-2 max-w-lg text-sm leading-relaxed text-cata-text/60">
                  Complete los pasos para inscribir a un estudiante en Cata Club.
                  {formData.enrollmentType === "self" && " Inscripción como jugador."}
                  {formData.enrollmentType === "child" && " Usted actúa como representante."}
                </p>
              </div>
            </div>
          </div>

          {/* Progress bar */}
          <div className="mb-8">
            <div className="mb-2 flex items-center justify-between text-xs text-cata-text/45">
              <span>
                Paso {currentIndex + 1} de {STEP_ORDER.length}
              </span>
              <span>{STEP_LABELS[step]}</span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-cata-border">
              <div
                className="h-full rounded-full bg-cata-red transition-all duration-400 ease-out"
                style={{ width: `${progress}%` }}
              />
            </div>
          </div>

          {/* Demo helper — quick-fill for testing convenience. The "(solo
              desarrollo)" label used to be the ONLY thing stopping this from
              reaching real visitors; `isDemoQuickFillEnabled` is the actual
              guard. See its doc comment for why it reads NODE_ENV. */}
          {demoQuickFillEnabled && (
            <div className="mb-6 rounded-xl border border-dashed border-cata-border bg-cata-bg p-3">
              <div className="mb-2 flex items-center gap-2">
                <AlertTriangle size={14} strokeWidth={1.5} className="text-amber-700" aria-hidden="true" />
                <p className="text-[10px] font-semibold uppercase tracking-wider text-cata-text/45">
                  Rellenar datos de prueba (solo desarrollo)
                </p>
              </div>
              <p className="mb-2 text-[10px] leading-relaxed text-cata-text/40">
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
          <div className="card mx-auto max-w-2xl p-6 sm:p-8">
            <div className="mb-6 flex items-center gap-2">
              {step === "type" && <GraduationCap size={16} strokeWidth={1.5} className="text-cata-red" aria-hidden="true" />}
              {step === "personal" && <User size={16} strokeWidth={1.5} className="text-cata-red" aria-hidden="true" />}
              {step === "club" && <Calendar size={16} strokeWidth={1.5} className="text-cata-red" aria-hidden="true" />}
              {step === "health" && <Heart size={16} strokeWidth={1.5} className="text-cata-red" aria-hidden="true" />}
              {step === "summary" && <FileText size={16} strokeWidth={1.5} className="text-cata-red" aria-hidden="true" />}
              <h2 className="text-lg font-semibold text-cata-text">
                {STEP_LABELS[step]}
              </h2>
            </div>

            <form onSubmit={handleConfirm}>
              {/* Step content */}
              {step === "type" && renderTypeStep()}
              {step === "personal" && renderPersonalStep()}
              {step === "club" && renderClubStep()}
              {step === "health" && renderHealthStep()}
              {step === "summary" && renderSummary()}

              <WizardNavigation
                formErrors={formErrors}
                isFirst={isFirst}
                isLast={isLast}
                submitting={submitting}
                onBack={handleBack}
                onNext={handleNext}
                submitButton={
                  <button
                    type="submit"
                    disabled={submitting || !summaryReviewed}
                    className="btn-primary shadow-soft disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {submitting ? (
                      "Inscribiendo…"
                    ) : (
                      <>
                        <CheckCircle size={14} strokeWidth={2} aria-hidden="true" />
                        Confirmar Inscripción
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
