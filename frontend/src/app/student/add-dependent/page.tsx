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

import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import ProtectedRoute from "@/components/ProtectedRoute";
import AppShell from "@/components/shell/AppShell";
import BackLink from "@/components/BackLink";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/contexts/ToastContext";
import { fetchStudentPortal, crearRepresentado, fetchInstituciones, type Institucion } from "@/services/api";
import { calculateAge } from "@/app/student/enroll/enroll-utils";
import { WizardTextarea, WizardInput, PersonIdentityFields, EmergencyContactFields, WizardNavigation } from "@/components/wizard-fields";
import { Stepper, buttonClasses } from "@/components/ui";
import { BLOOD_TYPES } from "@/types/enrollment";
import type { TipoSangre } from "@/types/domain";
import {
  Heart,
  CheckCircle,
  AlertTriangle,
  Mail,
  Lock,
} from "lucide-react";
import {
  ADD_DEPENDENT_STEP_ORDER,
  ADD_DEPENDENT_STEP_LABELS,
  ADD_DEPENDENT_SHORT_LABELS,
  describeAddDependentBlocker,
  initialAddDependentFormData,
  validateAddDependentFields,
  validateAddDependentStep,
  validateAddDependentForm,
  buildRepresentadoPayload,
  getAddDependentErrorMessage,
  type AddDependentField,
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
  const [touched, setTouched] = useState<Set<AddDependentField>>(new Set());
  const [instituciones, setInstituciones] = useState<Institucion[]>([]);
  const [tipoEscuelaFilter, setTipoEscuelaFilter] = useState<string>("");

  const [representanteId, setRepresentanteId] = useState<number | null>(null);
  const [loadingRepresentante, setLoadingRepresentante] = useState(true);
  const [representanteLoadError, setRepresentanteLoadError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

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
          errors={{
            nombres: shownError("nombres"),
            apellidos: shownError("apellidos"),
            fechaNacimiento: shownError("fechaNacimiento"),
            cedula: shownError("cedula"),
            telefono: shownError("telefono"),
          }}
          onFieldBlur={(field) => markTouched(field)}
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
          error={shownError("correo")}
          onBlur={() => markTouched("correo")}
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
          error={shownError("contrasenia")}
          onBlur={() => markTouched("contrasenia")}
        />

        <div className="rounded-ctl border border-line-2 bg-canvas p-3 text-xs text-ink-2">
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
            onBlur={() => markTouched("tipoSangre")}
            required
            disabled={submitting}
            aria-invalid={shownError("tipoSangre") ? true : undefined}
            className={`input-field ${shownError("tipoSangre") ? "border-cata-red ring-[3px] ring-cata-red/10" : ""}`}
          >
            <option value="">Seleccione una opción</option>
            {Object.values(BLOOD_TYPES).map((bloodType) => (
              <option key={bloodType} value={bloodType}>
                {bloodType.replace("_", " ")}
              </option>
            ))}
          </select>
          {shownError("tipoSangre") && (
            <p className="mt-1.5 flex items-center gap-1.5 text-xs font-semibold text-cata-red">
              <AlertTriangle size={13} strokeWidth={2} className="shrink-0" aria-hidden="true" />
              {shownError("tipoSangre")}
            </p>
          )}
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
          placeholder: "p. ej. Alergia al polvo, al látex, a picaduras de insectos…",
          icon: <AlertTriangle size={16} strokeWidth={1.5} aria-hidden="true" />,
        })}

        <EmergencyContactFields
          idPrefix="add-dependent"
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

  /** One 56px detail row with the step it came from — `.drow` (_sistema.css:247-250). */
  function summaryRow(
    label: string,
    value: React.ReactNode,
    correctStep: AddDependentStep,
  ): React.ReactElement {
    return (
      <div className="flex min-h-drow items-center gap-4 border-b border-line px-5 py-2 last:border-b-0">
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
    return (
      <div className="space-y-4">
        <p className="text-sm leading-relaxed text-cata-text/65">
          Esto es lo que vamos a crear. Corrija cualquier bloque antes de confirmar:
        </p>

        <div className="overflow-hidden rounded-card border border-line">
          {summaryRow(
            "Dependiente",
            `${formData.nombres} ${formData.apellidos}`.trim() + ageLabel,
            "child",
          )}
          {summaryRow("Cédula", formData.cedula || "—", "child")}
          {summaryRow("Teléfono", formData.telefono || "—", "child")}
          {summaryRow(
            "Institución",
            instituciones.find((inst) => String(inst.id) === formData.institucionId)?.nombre
              ?? "Sin institución asignada",
            "child",
          )}
          {summaryRow(
            "Cuenta de acceso",
            formData.correo.trim() || "Sin cuenta propia",
            "credentials",
          )}
          {summaryRow(
            "Tipo de sangre",
            formData.tipoSangre ? formData.tipoSangre.replace("_", " ") : "—",
            "health",
          )}
          {summaryRow(
            "Contacto de emergencia",
            `${formData.contactoEmergencia} · ${formData.telefonoEmergencia}`.trim(),
            "health",
          )}
          {summaryRow("Enfermedades", formData.enfermedades || "Ninguna reportada", "health")}
          {summaryRow("Alergias", formData.alergias || "Ninguna reportada", "health")}
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

  // ---- Render ----

  return (
    // This wizard is reached from a button on `/student`, so it keeps
    // `/student`'s chrome instead of falling back to the dark top nav. The
    // page's own hero banner is gone: it repeated the eyebrow, title and
    // subtitle that `AppShell`'s header row now renders once, above `<main>`.
    <AppShell
      eyebrow="Cuenta del representante"
      title="Agregar dependiente"
      subtitle="Complete los pasos para agregar un nuevo dependiente a su cuenta de representante."
    >
      <div className="w-full max-w-[760px]">
      <BackLink href="/student" label="Volver" />

      {/* Named stepper — the same contract as the public wizard. */}
      <div className="mb-6">
        <p className="text-[10.5px] font-bold uppercase tracking-[0.13em] text-ink-3">
          Paso {currentIndex + 1} de {ADD_DEPENDENT_STEP_ORDER.length}
        </p>
      </div>

      <Stepper
        className="mb-8"
        label="Pasos para agregar un dependiente"
        current={currentIndex + 1}
        steps={ADD_DEPENDENT_STEP_ORDER.map((s) => ADD_DEPENDENT_SHORT_LABELS[s])}
      />

      {/* Form card */}
      <div className="card p-6 sm:p-8">
        <h2 className="mb-6 text-[13px] font-bold text-ink">
          {ADD_DEPENDENT_STEP_LABELS[step]}
        </h2>

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
            nextDisabled={!stepComplete}
            nextBlockedReason={blockedReason ?? undefined}
            submitButton={
              <button
                type="submit"
                disabled={submitting || !summaryReviewed || loadingRepresentante}
                className={buttonClasses("primary", "md", "disabled:cursor-not-allowed")}
              >
                {submitting ? (
                  "Agregando…"
                ) : (
                  <>
                    <CheckCircle size={14} strokeWidth={2} aria-hidden="true" />
                    Agregar dependiente
                  </>
                )}
              </button>
            }
          />
        </form>
      </div>
      </div>
    </AppShell>
  );
}

export default function AddDependentPage(): React.ReactElement {
  return (
    <ProtectedRoute allowedRoles={["representante"]}>
      <AddDependentContent />
    </ProtectedRoute>
  );
}
