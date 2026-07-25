/**
 * Add Dependent — authenticated self-service wizard.
 *
 * Short 3-step wizard (child data → medical record → summary/confirm) for a
 * logged-in representante to add a second/third dependent from the portal.
 * Unlike the public `/student/enroll` wizard, this never creates a `Usuario`
 * or assigns a role — it only creates a `Persona` (child) linked to the
 * caller's own persona via `representante_id`, plus its `FichaMedica`, via
 * `POST /personas/{persona_id}/representados` (see `crearRepresentado`).
 *
 * The representante's own persona id is sourced from the portal summary
 * (`data.self.personaId`, via `fetchStudentPortal`) — never decoded from the
 * JWT client-side. On success, navigates back to `/student`, which remounts
 * and refetches the portal data (no optimistic client-side list update).
 *
 * All labels and copy are in Spanish per app convention.
 */

"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import ProtectedRoute from "@/components/ProtectedRoute";
import BackLink from "@/components/BackLink";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/contexts/ToastContext";
import { fetchStudentPortal, crearRepresentado, fetchInstituciones, type Institucion } from "@/services/api";
import { calculateAge } from "@/app/student/enroll/enroll-utils";
import { WizardTextarea, WizardInput, PersonIdentityFields, EmergencyContactFields, WizardNavigation } from "@/components/wizard-fields";
import { BLOOD_TYPES } from "@/types/enrollment";
import type { TipoSangre } from "@/types/domain";
import {
  User,
  UserPlus,
  Heart,
  CheckCircle,
  AlertTriangle,
  FileText,
  Mail,
  Lock,
} from "lucide-react";
import {
  ADD_DEPENDENT_STEP_ORDER,
  ADD_DEPENDENT_STEP_LABELS,
  initialAddDependentFormData,
  validateAddDependentStep,
  validateAddDependentForm,
  buildRepresentadoPayload,
  getAddDependentErrorMessage,
  type AddDependentFormData,
  type AddDependentStep,
} from "./add-dependent-utils";

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

function AddDependentContent(): React.ReactElement {
  const { session } = useAuth();
  const router = useRouter();
  const { showSuccess, showError } = useToast();

  const [step, setStep] = useState<AddDependentStep>("child");
  const [formData, setFormData] = useState<AddDependentFormData>(initialAddDependentFormData);
  const [submitting, setSubmitting] = useState(false);
  const [summaryReviewed, setSummaryReviewed] = useState(false);
  const [formErrors, setFormErrors] = useState<string[]>([]);
  const [instituciones, setInstituciones] = useState<Institucion[]>([]);
  const [tipoEscuelaFilter, setTipoEscuelaFilter] = useState<string>("");

  const [representanteId, setRepresentanteId] = useState<number | null>(null);
  const [loadingRepresentante, setLoadingRepresentante] = useState(true);
  const [representanteLoadError, setRepresentanteLoadError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  const currentIndex = ADD_DEPENDENT_STEP_ORDER.indexOf(step);
  const isFirst = currentIndex === 0;
  const isLast = currentIndex === ADD_DEPENDENT_STEP_ORDER.length - 1;
  const progress = ((currentIndex + 1) / ADD_DEPENDENT_STEP_ORDER.length) * 100;

  // Source the representante's own persona_id from the portal summary —
  // never decoded from the JWT client-side (see module docstring).
  useEffect(() => {
    const userId = session?.user.id;
    if (!userId) return;
    let cancelled = false;
    setLoadingRepresentante(true);
    fetchStudentPortal(userId)
      .then((data) => {
        if (cancelled) return;
        if (data.self) {
          setRepresentanteId(Number(data.self.personaId));
          setRepresentanteLoadError(null);
        } else {
          setRepresentanteLoadError("No se pudo identificar su perfil de representante.");
        }
      })
      .catch(() => {
        if (!cancelled) {
          setRepresentanteLoadError("No se pudo cargar su información. Intente nuevamente.");
        }
      })
      .finally(() => {
        if (!cancelled) setLoadingRepresentante(false);
      });
    return () => {
      cancelled = true;
    };
  }, [session?.user.id, reloadToken]);

  useEffect(() => {
    fetchInstituciones().then(setInstituciones).catch(() => {});
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
      setStep(nextStep);
    }
  }

  function handleBack(): void {
    setFormErrors([]);
    const prevIdx = currentIndex - 1;
    if (prevIdx >= 0) {
      setStep(ADD_DEPENDENT_STEP_ORDER[prevIdx]);
    }
  }

  async function handleConfirm(e: FormEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault();
    if (submitting) return;
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
    if (representanteId === null) {
      setFormErrors([
        representanteLoadError ??
          "No se pudo identificar su cuenta de representante. Intente nuevamente.",
      ]);
      return;
    }
    setSubmitting(true);
    try {
      await crearRepresentado(representanteId, buildRepresentadoPayload(formData));
      showSuccess("Dependiente agregado correctamente.");
      // Navigation-remount: /student refetches the portal summary on mount,
      // so the new dependent appears without any optimistic client state.
      router.push("/student");
    } catch (error: unknown) {
      setSubmitting(false);
      const message = getAddDependentErrorMessage(error);
      setFormErrors([message]);
      showError(message);
    }
  }

  // ---- Render helpers ----

  function renderTextarea(opts: {
    label: string;
    value: string;
    onChange: (v: string) => void;
    placeholder?: string;
    required?: boolean;
    icon?: React.ReactNode;
    rows?: number;
  }): React.ReactElement {
    return <WizardTextarea idPrefix="add-dependent" disabled={submitting} {...opts} rows={opts.rows ?? 2} />;
  }

  // ---- Step renderers ----

  function renderChildStep(): React.ReactElement {
    return (
      <div className="space-y-1">
        <p className="mb-4 text-sm leading-relaxed text-cata-text/65">
          Ingrese los datos personales del hijo/dependiente a agregar:
        </p>

        <PersonIdentityFields
          idPrefix="add-dependent"
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
        />

        {/* School selector */}
        {instituciones.length > 0 && (
          <div className="mt-4">
            <label htmlFor="add-dependent-tipo-escuela" className="mb-1.5 block text-sm font-medium text-cata-text">
              Tipo de Escuela
            </label>
            <select
              id="add-dependent-tipo-escuela"
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

            <label htmlFor="add-dependent-institucion" className="mb-1.5 mt-3 block text-sm font-medium text-cata-text">
              Escuela / Institución
            </label>
            <p className="mb-2 text-xs text-cata-text/50">
              Seleccione la institución educativa del estudiante (opcional).
            </p>
            <select
              id="add-dependent-institucion"
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

  function renderCredentialsStep(): React.ReactElement {
    return (
      <div className="space-y-4">
        <p className="mb-4 text-sm leading-relaxed text-cata-text/65">
          Si desea que el dependiente tenga su propia cuenta de acceso, ingrese
          las credenciales. Deje estos campos vacíos si no requiere cuenta para el menor.
        </p>

        <WizardInput
          idPrefix="add-dependent"
          label="Correo electrónico (opcional)"
          value={formData.correo}
          onChange={(v) => updateField("correo", v)}
          type="email"
          placeholder="correo@ejemplo.com"
          disabled={submitting}
          icon={<Mail size={16} strokeWidth={1.5} aria-hidden="true" />}
        />

        <WizardInput
          idPrefix="add-dependent"
          label="Contraseña (opcional)"
          value={formData.contrasenia}
          onChange={(v) => updateField("contrasenia", v)}
          type="password"
          placeholder="Mínimo 8 caracteres"
          disabled={submitting}
          icon={<Lock size={16} strokeWidth={1.5} aria-hidden="true" />}
        />

        <div className="rounded-xl border border-blue-500/30 bg-blue-900/20 p-3 text-xs text-blue-400">
          <p className="flex items-center gap-1.5 font-medium">
            <AlertTriangle size={12} strokeWidth={2} aria-hidden="true" />
            Cuenta de acceso del menor
          </p>
          <p className="mt-1 text-blue-700/80">
            Si crea estas credenciales, el menor podrá iniciar sesión de forma
            independiente. Si las deja vacías, solo el representante tendrá acceso
            a la cuenta.
          </p>
        </div>
      </div>
    );
  }

  function renderHealthStep(): React.ReactElement {
    return (
      <div className="space-y-1">
        <p className="mb-4 text-sm leading-relaxed text-cata-text/65">
          Información que el club necesita conocer para la seguridad del dependiente:
        </p>

        <div className="mb-4">
          <label htmlFor="add-dependent-tipo-de-sangre" className="mb-1.5 block text-sm font-medium text-cata-text">
            Tipo de Sangre <span className="ml-0.5 text-cata-red">*</span>
          </label>
          <select
            id="add-dependent-tipo-de-sangre"
            value={formData.tipoSangre}
            onChange={(e) => updateField("tipoSangre", e.target.value as TipoSangre)}
            required
            disabled={submitting}
            className="input-field"
          >
            <option value="">Seleccione una opción</option>
            {Object.values(BLOOD_TYPES).map((bloodType) => (
              <option key={bloodType} value={bloodType}>
                {bloodType.replace("_", " ")}
              </option>
            ))}
          </select>
        </div>

        {renderTextarea({
          label: "Enfermedades",
          value: formData.enfermedades,
          onChange: (v) => updateField("enfermedades", v),
          placeholder: "p. ej. Asma, diabetes (separadas por comas)",
          icon: <Heart size={16} strokeWidth={1.5} aria-hidden="true" />,
        })}

        {renderTextarea({
          label: "Alergias",
          value: formData.alergias,
          onChange: (v) => updateField("alergias", v),
          placeholder: "p. ej. Alergia al polvo, al látex, a picaduras de insectos...",
          icon: <AlertTriangle size={16} strokeWidth={1.5} aria-hidden="true" />,
        })}

        <EmergencyContactFields
          idPrefix="add-dependent"
          disabled={submitting}
          contacto={formData.contactoEmergencia}
          telefono={formData.telefonoEmergencia}
          onContactoChange={(v) => updateField("contactoEmergencia", v)}
          onTelefonoChange={(v) => updateField("telefonoEmergencia", v)}
        />

        <div className="rounded-xl border border-amber-500/30 bg-amber-900/20 p-3 text-xs text-amber-400">
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
    const age = formData.fechaNacimiento ? calculateAge(formData.fechaNacimiento) : null;
    return (
      <div className="space-y-4">
        <p className="text-sm leading-relaxed text-cata-text/65">
          Revise la información antes de agregar al dependiente:
        </p>

        <div className="card-hover p-4">
          <div className="mb-3 flex items-center gap-2">
            <User size={14} strokeWidth={1.5} className="text-cata-red" aria-hidden="true" />
            <h3 className="text-xs font-semibold uppercase tracking-wider text-cata-text/45">
              Datos del Dependiente
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
              {age !== null && !isNaN(age) && (
                <span className="ml-2 text-cata-text/45">({age} años)</span>
              )}
            </dd>
            <dt className="text-cata-text/65">Cédula</dt>
            <dd className="font-medium text-cata-text">{formData.cedula}</dd>
            <dt className="text-cata-text/65">Teléfono</dt>
            <dd className="font-medium text-cata-text">{formData.telefono}</dd>
            {formData.institucionId && (
              <>
                <dt className="text-cata-text/65">Institución</dt>
                <dd className="font-medium text-cata-text">
                  {instituciones.find((i) => String(i.id) === formData.institucionId)?.nombre || "—"}
                </dd>
              </>
            )}
          </dl>
        </div>

        <div className="card-hover p-4">
          <div className="mb-3 flex items-center gap-2">
            <Heart size={14} strokeWidth={1.5} className="text-cata-red" aria-hidden="true" />
            <h3 className="text-xs font-semibold uppercase tracking-wider text-cata-text/45">
              Salud y Emergencia
            </h3>
          </div>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
            <dt className="text-cata-text/65">Enfermedades</dt>
            <dd className="font-medium text-cata-text">
              {formData.enfermedades || <span className="text-cata-text/45">Ninguna reportada</span>}
            </dd>
            <dt className="text-cata-text/65">Alergias</dt>
            <dd className="font-medium text-cata-text">
              {formData.alergias || <span className="text-cata-text/45">Ninguna reportada</span>}
            </dd>
            <dt className="text-cata-text/65">Tipo de Sangre</dt>
            <dd className="font-medium text-cata-text">
              {formData.tipoSangre ? formData.tipoSangre.replace("_", " ") : "—"}
            </dd>
            <dt className="text-cata-text/65">Contacto de Emergencia</dt>
            <dd className="font-medium text-cata-text">{formData.contactoEmergencia}</dd>
            <dt className="text-cata-text/65">Teléfono de Emergencia</dt>
            <dd className="font-medium text-cata-text">{formData.telefonoEmergencia}</dd>
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
              Esto evita agregar el dependiente por accidente al llegar al último paso.
            </span>
          </span>
        </label>
      </div>
    );
  }

  // ---- Render ----

  return (
    <div className="py-8">
      <BackLink href="/student" label="Volver" />

      {/* Hero Banner */}
      <div className="relative mb-10 overflow-hidden rounded-3xl border border-cata-border bg-cata-surface px-6 py-10 shadow-elevated sm:px-10 sm:py-12">
        <div className="absolute inset-0 bg-logo-glow" />
        <div className="relative z-10 flex items-start justify-between">
          <div>
            <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.25em] text-cata-red">
              <UserPlus size={14} strokeWidth={2} aria-hidden="true" />
              Agregar Dependiente
            </div>
            <h1 className="mt-2 text-3xl font-extrabold tracking-tight text-cata-text sm:text-4xl">
              Agregar Hijo/Dependiente
            </h1>
            <p className="mt-2 max-w-lg text-sm leading-relaxed text-cata-text/60">
              Complete los pasos para agregar un nuevo dependiente a su cuenta de representante.
            </p>
          </div>
        </div>
      </div>

      {/* Progress bar */}
      <div className="mb-8">
        <div className="mb-2 flex items-center justify-between text-xs text-cata-text/45">
          <span>
            Paso {currentIndex + 1} de {ADD_DEPENDENT_STEP_ORDER.length}
          </span>
          <span>{ADD_DEPENDENT_STEP_LABELS[step]}</span>
        </div>
        <div className="h-1.5 overflow-hidden rounded-full bg-cata-border">
          <div
            className="h-full rounded-full bg-cata-red transition-all duration-400 ease-out"
            style={{ width: `${progress}%` }}
          />
        </div>
      </div>

      {/* Form card */}
      <div className="card mx-auto max-w-2xl p-6 sm:p-8">
        <div className="mb-6 flex items-center gap-2">
            {step === "child" && <User size={16} strokeWidth={1.5} className="text-cata-red" aria-hidden="true" />}
            {step === "credentials" && <Lock size={16} strokeWidth={1.5} className="text-cata-red" aria-hidden="true" />}
            {step === "health" && <Heart size={16} strokeWidth={1.5} className="text-cata-red" aria-hidden="true" />}
            {step === "summary" && <FileText size={16} strokeWidth={1.5} className="text-cata-red" aria-hidden="true" />}
          <h2 className="text-lg font-semibold text-cata-text">
            {ADD_DEPENDENT_STEP_LABELS[step]}
          </h2>
        </div>

        {representanteLoadError && (
          <div className="alert-error mb-6 items-start" role="alert">
            <AlertTriangle size={14} strokeWidth={1.5} className="mt-0.5 shrink-0" aria-hidden="true" />
            <span className="flex-1">{representanteLoadError}</span>
            <button
              type="button"
              onClick={() => setReloadToken((n) => n + 1)}
              disabled={loadingRepresentante}
              className="shrink-0 font-medium underline disabled:cursor-not-allowed disabled:opacity-50"
            >
              Reintentar
            </button>
          </div>
        )}

        <form onSubmit={handleConfirm}>
          {/* Step content */}
          {step === "child" && renderChildStep()}
          {step === "credentials" && renderCredentialsStep()}
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
                disabled={submitting || !summaryReviewed || loadingRepresentante}
                className="btn-primary shadow-soft disabled:cursor-not-allowed disabled:opacity-50"
              >
                {submitting ? (
                  "Agregando..."
                ) : (
                  <>
                    <CheckCircle size={14} strokeWidth={2} aria-hidden="true" />
                    Agregar Dependiente
                  </>
                )}
              </button>
            }
          />
        </form>
      </div>
    </div>
  );
}

export default function AddDependentPage(): React.ReactElement {
  return (
    <ProtectedRoute allowedRoles={["representante"]}>
      <AddDependentContent />
    </ProtectedRoute>
  );
}
