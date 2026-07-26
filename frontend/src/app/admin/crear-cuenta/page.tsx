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
 *
 * For MENOR, the admin must also assign a representante legal via search.
 * All labels and copy are in Spanish per app convention.
 */

"use client";

import { Suspense, useCallback, useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { furthestReachableIndex, useWizardHistory } from "@/lib/wizard-history";
import ProtectedRoute from "@/components/ProtectedRoute";
import AppShell from "@/components/shell/AppShell";
import BackLink from "@/components/BackLink";
import { useToast } from "@/contexts/ToastContext";
import { WizardInput, WizardNavigation } from "@/components/wizard-fields";
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
} from "lucide-react";
import {
  CREAR_CUENTA_STEP_ORDER,
  CREAR_CUENTA_STEP_LABELS,
  BLOOD_TYPE_OPTIONS,
  initialCrearCuentaFormData,
  validateCrearCuentaStep,
  validateCrearCuentaForm,
  calculateAge,
  getCrearCuentaErrorMessage,
  type CrearCuentaFormData,
  type CrearCuentaStep,
  type AccountType,
} from "./crear-cuenta-utils";

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

function CrearCuentaContent(): React.ReactElement {
  const router = useRouter();
  const { showSuccess, showError } = useToast();

  const [formData, setFormData] = useState<CrearCuentaFormData>(initialCrearCuentaFormData);
  const [submitting, setSubmitting] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [summaryReviewed, setSummaryReviewed] = useState(false);
  const [formErrors, setFormErrors] = useState<string[]>([]);

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
  const progress = ((currentIndex + 1) / CREAR_CUENTA_STEP_ORDER.length) * 100;

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

  function updateField<K extends keyof CrearCuentaFormData>(
    key: K,
    value: CrearCuentaFormData[K],
  ): void {
    setFormData((prev) => ({ ...prev, [key]: value }));
    setFormErrors([]);
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
    } catch (error: unknown) {
      setSubmitting(false);
      const message = getCrearCuentaErrorMessage(error);
      setFormErrors([message]);
      showError(message);
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
    const age = formData.fechaNacimiento ? calculateAge(formData.fechaNacimiento) : null;
    return (
      <div className="space-y-4">
        <p className="text-sm leading-relaxed text-cata-text/65">
          Seleccione el tipo de cuenta que desea crear:
        </p>

        <div className="grid gap-4 sm:grid-cols-3">
          <button
            type="button"
            onClick={() => selectAccountType("JUGADOR")}
            className={`rounded-xl border-2 p-5 text-left transition-all duration-200 ${
              formData.accountType === "JUGADOR"
                ? "border-cata-red/40 bg-cata-red/10 ring-1 ring-cata-red/20"
                : "border-cata-border bg-cata-surface hover:border-cata-red/20 hover:shadow-soft"
            }`}
          >
            <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-xl bg-cata-red/15">
              <GraduationCap size={20} strokeWidth={1.5} className="text-cata-red" aria-hidden="true" />
            </div>
            <h3 className="mb-1 font-semibold text-cata-text">Jugador</h3>
            <p className="text-xs leading-relaxed text-cata-text/65">
              Mayor de 18 que entrena y paga su propia mensualidad.
            </p>
          </button>

          <button
            type="button"
            onClick={() => selectAccountType("REPRESENTANTE")}
            className={`rounded-xl border-2 p-5 text-left transition-all duration-200 ${
              formData.accountType === "REPRESENTANTE"
                ? "border-cata-red/40 bg-cata-red/10 ring-1 ring-cata-red/20"
                : "border-cata-border bg-cata-surface hover:border-cata-red/20 hover:shadow-soft"
            }`}
          >
            <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-xl bg-blue-50">
              <Building2 size={20} strokeWidth={1.5} className="text-blue-700" aria-hidden="true" />
            </div>
            <h3 className="mb-1 font-semibold text-cata-text">Representante</h3>
            <p className="text-xs leading-relaxed text-cata-text/65">
              Adulto que paga por sus hijos y también entrena.
            </p>
          </button>

          <button
            type="button"
            onClick={() => selectAccountType("MENOR")}
            className={`rounded-xl border-2 p-5 text-left transition-all duration-200 ${
              formData.accountType === "MENOR"
                ? "border-cata-red/40 bg-cata-red/10 ring-1 ring-cata-red/20"
                : "border-cata-border bg-cata-surface hover:border-cata-red/20 hover:shadow-soft"
            }`}
          >
            <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-xl bg-purple-50">
              <Baby size={20} strokeWidth={1.5} className="text-purple-700" aria-hidden="true" />
            </div>
            <h3 className="mb-1 font-semibold text-cata-text">Menor / Dependiente</h3>
            <p className="text-xs leading-relaxed text-cata-text/65">
              Menor de 18 a cargo de un representante que paga por él.
            </p>
          </button>
        </div>

        {formData.accountType === "MENOR" && age !== null && !isNaN(age) && age >= 18 && (
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
            <p className="flex items-center gap-1.5 font-medium">
              <AlertTriangle size={12} strokeWidth={2} aria-hidden="true" />
              La fecha de nacimiento indica una persona mayor de edad ({age} años). Seleccione Jugador o Representante.
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
          Ingrese los datos personales de la cuenta a crear:
        </p>

        <WizardInput
          idPrefix="crear-cuenta"
          label="Nombres"
          value={formData.nombres}
          onChange={(v) => updateField("nombres", v)}
          disabled={submitting}
          required
          pattern="[A-Za-z\u00C0-\u024F\s]+"
          maxLength={100}
          minLength={3}
          icon={<User size={16} strokeWidth={1.5} aria-hidden="true" />}
        />

        <WizardInput
          idPrefix="crear-cuenta"
          label="Apellidos"
          value={formData.apellidos}
          onChange={(v) => updateField("apellidos", v)}
          disabled={submitting}
          required
          pattern="[A-Za-z\u00C0-\u024F\s]+"
          maxLength={100}
          minLength={3}
          icon={<User size={16} strokeWidth={1.5} aria-hidden="true" />}
        />

        <WizardInput
          idPrefix="crear-cuenta"
          label="Cédula"
          value={formData.cedula}
          onChange={(v) => updateField("cedula", v)}
          disabled={submitting}
          required
          pattern="[0-9]{10}"
          maxLength={10}
          inputMode="numeric"
        />

        <WizardInput
          idPrefix="crear-cuenta"
          label="Fecha de Nacimiento"
          value={formData.fechaNacimiento}
          onChange={(v) => updateField("fechaNacimiento", v)}
          type="date"
          disabled={submitting}
          required
        />

        <WizardInput
          idPrefix="crear-cuenta"
          label="Teléfono"
          value={formData.telefono}
          onChange={(v) => updateField("telefono", v)}
          disabled={submitting}
          required
          pattern="[0-9]+"
          maxLength={10}
          minLength={7}
          inputMode="tel"
        />

        {/* School selector — only for MENOR type */}
        {formData.accountType === "MENOR" && instituciones.length > 0 && (
          <div className="mt-4">
            <label htmlFor="crear-cuenta-tipo-escuela" className="mb-1.5 block text-sm font-medium text-cata-text">
              Tipo de Escuela
            </label>
            <select
              id="crear-cuenta-tipo-escuela"
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

            <label htmlFor="crear-cuenta-institucion" className="mb-1.5 mt-3 block text-sm font-medium text-cata-text">
              Escuela / Institución
            </label>
            <p className="mb-2 text-xs text-cata-text/50">
              Seleccione la institución educativa del menor (opcional).
            </p>
            <select
              id="crear-cuenta-institucion"
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
          <div className="mt-4 rounded-xl border border-purple-200 bg-purple-50 p-4">
            <h3 className="mb-2 text-sm font-semibold text-purple-800">
              Representante Legal
            </h3>
            <p className="mb-3 text-xs text-purple-600">
              Busque y seleccione el representante legal para este menor:
            </p>
            <div className="relative">
              <Search
                size={14}
                strokeWidth={1.5}
                className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-cata-text/65"
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
              <p className="mt-2 text-xs text-purple-500">Buscando...</p>
            )}
            {representanteResults.length > 0 && (
              <ul className="mt-2 max-h-40 divide-y divide-purple-200 overflow-y-auto rounded-lg border border-purple-200 bg-white">
                {representanteResults.map((r) => (
                  <li key={r.id}>
                    <button
                      type="button"
                      onClick={() => selectRepresentante(r.id, `${r.nombres} ${r.apellidos}`)}
                      className="w-full px-3 py-2 text-left text-xs text-purple-800 hover:bg-purple-50"
                    >
                      {r.nombres} {r.apellidos}
                      <span className="ml-2 text-purple-400">ID: {r.id}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {representanteSelected && (
              <p className="mt-2 text-xs text-purple-700">
                Seleccionado: <strong>{representanteSelected.nombre}</strong> (ID: {representanteSelected.id})
              </p>
            )}
          </div>
        )}
      </div>
    );
  }

  function renderHealthStep(): React.ReactElement {
    return (
      <div className="space-y-4">
        <p className="text-sm leading-relaxed text-cata-text/65">
          Información médica del estudiante (opcional pero recomendada).
        </p>

        <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4">
          <div className="mb-3">
            <label htmlFor="crear-cuenta-tipo-sangre" className="mb-1.5 block text-sm font-medium text-cata-text">
              Tipo de Sangre
            </label>
            <select
              id="crear-cuenta-tipo-sangre"
              value={formData.tipoSangre}
              onChange={(e) => updateField("tipoSangre", e.target.value)}
              disabled={submitting}
              className="input-field"
            >
              <option value="">Seleccione tipo de sangre</option>
              {BLOOD_TYPE_OPTIONS.map((bt) => (
                <option key={bt} value={bt}>{bt.replace(/_/g, " ")}</option>
              ))}
            </select>
          </div>

          <WizardInput
            idPrefix="crear-cuenta"
            label="Condiciones de Salud"
            value={formData.condicionesSalud}
            onChange={(v) => updateField("condicionesSalud", v)}
            disabled={submitting}
            placeholder="p. ej. Asma, diabetes (separar con comas)"
          />

          <WizardInput
            idPrefix="crear-cuenta"
            label="Alergias"
            value={formData.alergias}
            onChange={(v) => updateField("alergias", v)}
            disabled={submitting}
            placeholder="p. ej. Penicilina, mariscos"
          />

          <WizardInput
            idPrefix="crear-cuenta"
            label="Contacto de Emergencia"
            value={formData.contactoEmergencia}
            onChange={(v) => updateField("contactoEmergencia", v)}
            disabled={submitting}
            placeholder="p. ej. Maria Lopez (madre)"
          />

          <WizardInput
            idPrefix="crear-cuenta"
            label="Telefono de Emergencia"
            value={formData.telefonoEmergencia}
            onChange={(v) => updateField("telefonoEmergencia", v)}
            disabled={submitting}
            pattern="[0-9]+"
            maxLength={10}
            minLength={7}
            inputMode="tel"
          />
        </div>
      </div>
    );
  }

  function renderCredentialsStep(): React.ReactElement {
    return (
      <div className="space-y-1">
        <p className="mb-4 text-sm leading-relaxed text-cata-text/65">
          Ingrese las credenciales de acceso para la cuenta:
        </p>

        <WizardInput
          idPrefix="crear-cuenta"
          label="Correo electrónico"
          value={formData.correo}
          onChange={(v) => updateField("correo", v)}
          type="email"
          disabled={submitting}
          required
          icon={<Mail size={16} strokeWidth={1.5} aria-hidden="true" />}
        />

        <WizardInput
          idPrefix="crear-cuenta"
          label="Contraseña"
          value={formData.contrasenia}
          onChange={(v) => updateField("contrasenia", v)}
          type="password"
          disabled={submitting}
          required
          icon={<Lock size={16} strokeWidth={1.5} aria-hidden="true" />}
        />
      </div>
    );
  }

  function renderSummary(): React.ReactElement {
    const age = formData.fechaNacimiento ? calculateAge(formData.fechaNacimiento) : null;
    const typeLabels: Record<AccountType, string> = {
      JUGADOR: "Jugador",
      REPRESENTANTE: "Representante que también entrena",
      MENOR: "Menor a cargo de un representante",
    };
    return (
      <div className="space-y-4">
        <p className="text-sm leading-relaxed text-cata-text/65">
          Revise la información antes de crear la cuenta:
        </p>

        <div className="card-hover p-4">
          <div className="mb-3 flex items-center gap-2">
            <FileText size={14} strokeWidth={1.5} className="text-cata-red" aria-hidden="true" />
            <h3 className="text-xs font-semibold uppercase tracking-wider text-cata-text/45">
              Tipo de Cuenta
            </h3>
          </div>
          <p className="text-sm font-medium text-cata-text">
            {typeLabels[formData.accountType as AccountType]}
          </p>
        </div>

        <div className="card-hover p-4">
          <div className="mb-3 flex items-center gap-2">
            <User size={14} strokeWidth={1.5} className="text-cata-red" aria-hidden="true" />
            <h3 className="text-xs font-semibold uppercase tracking-wider text-cata-text/45">
              Datos Personales
            </h3>
          </div>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
            <dt className="text-cata-text/65">Nombres</dt>
            <dd className="font-medium text-cata-text">{formData.nombres}</dd>
            <dt className="text-cata-text/65">Apellidos</dt>
            <dd className="font-medium text-cata-text">{formData.apellidos}</dd>
            <dt className="text-cata-text/65">Cédula</dt>
            <dd className="font-medium text-cata-text">{formData.cedula}</dd>
            <dt className="text-cata-text/65">Fecha de Nacimiento</dt>
            <dd className="font-medium text-cata-text">
              {formData.fechaNacimiento}
              {age !== null && !isNaN(age) && (
                <span className="ml-2 text-cata-text/45">({age} años)</span>
              )}
            </dd>
            <dt className="text-cata-text/65">Teléfono</dt>
            <dd className="font-medium text-cata-text">{formData.telefono}</dd>
            {formData.accountType === "MENOR" && representanteSelected && (
              <>
                <dt className="text-cata-text/65">Representante</dt>
                <dd className="font-medium text-cata-text">
                  {representanteSelected.nombre}
                </dd>
              </>
            )}
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
            <Mail size={14} strokeWidth={1.5} className="text-cata-red" aria-hidden="true" />
            <h3 className="text-xs font-semibold uppercase tracking-wider text-cata-text/45">
              Credenciales de Acceso
            </h3>
          </div>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
            <dt className="text-cata-text/65">Correo</dt>
            <dd className="font-medium text-cata-text">{formData.correo}</dd>
            <dt className="text-cata-text/65">Contraseña</dt>
            <dd className="font-medium text-cata-text">••••••••</dd>
          </dl>
        </div>

        {formData.tipoSangre && (
          <div className="card-hover p-4">
            <div className="mb-3 flex items-center gap-2">
              <FileText size={14} strokeWidth={1.5} className="text-cata-red" aria-hidden="true" />
              <h3 className="text-xs font-semibold uppercase tracking-wider text-cata-text/45">
                Ficha Medica
              </h3>
            </div>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
              <dt className="text-cata-text/65">Tipo de Sangre</dt>
              <dd className="font-medium text-cata-text">{formData.tipoSangre.replace(/_/g, " ")}</dd>
              {formData.condicionesSalud.trim() && (
                <>
                  <dt className="text-cata-text/65">Condiciones</dt>
                  <dd className="font-medium text-cata-text">{formData.condicionesSalud}</dd>
                </>
              )}
              {formData.alergias.trim() && (
                <>
                  <dt className="text-cata-text/65">Alergias</dt>
                  <dd className="font-medium text-cata-text">{formData.alergias}</dd>
                </>
              )}
              {formData.contactoEmergencia.trim() && (
                <>
                  <dt className="text-cata-text/65">Contacto Emergencia</dt>
                  <dd className="font-medium text-cata-text">{formData.contactoEmergencia}</dd>
                </>
              )}
              {formData.telefonoEmergencia.trim() && (
                <>
                  <dt className="text-cata-text/65">Telefono Emergencia</dt>
                  <dd className="font-medium text-cata-text">{formData.telefonoEmergencia}</dd>
                </>
              )}
            </dl>
          </div>
        )}

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
              Esto evita crear la cuenta por accidente al llegar al último paso.
            </span>
          </span>
        </label>
      </div>
    );
  }

  // ---- Render ----

  return (
    <AppShell eyebrow="Administración" title="Crear Cuenta">
      {confirmed ? (
        <div className="flex min-h-[75vh] items-center justify-center py-12">
          <div className="w-full max-w-lg text-center">
            <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-full bg-cata-state-ok/10">
              <CheckCircle size={32} className="text-cata-state-ok" strokeWidth={1.5} aria-hidden="true" />
            </div>
            <h1 className="mb-3 text-2xl font-bold tracking-tight text-cata-text">
              Cuenta Creada
            </h1>
            <p className="mb-2 text-sm leading-relaxed text-cata-text/65">
              <strong className="text-cata-text">
                {formData.nombres} {formData.apellidos}
              </strong>{" "}
              ha sido registrado exitosamente.
            </p>
            <p className="mb-8 text-xs leading-relaxed text-cata-text/40">
              Las credenciales de acceso fueron creadas de forma segura.
            </p>
            <div className="flex flex-col gap-3 sm:flex-row sm:justify-center">
              <button type="button" onClick={() => router.push("/members")} className="btn-primary">
                Volver a Miembros
              </button>
              <button
                type="button"
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
                className="btn-secondary"
              >
                Crear Otra Cuenta
              </button>
            </div>
          </div>
        </div>
      ) : (
        <div>
          <BackLink href="/members" label="Volver a Miembros" />

          {/* Progress bar */}
          <div className="mb-8">
            <div className="mb-2 flex items-center justify-between text-xs text-cata-text/45">
              <span>
                Paso {currentIndex + 1} de {CREAR_CUENTA_STEP_ORDER.length}
              </span>
              <span>{CREAR_CUENTA_STEP_LABELS[step]}</span>
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
              {step === "type" && <GraduationCap size={16} strokeWidth={1.5} className="text-cata-red" aria-hidden="true" />}
              {step === "personal" && <User size={16} strokeWidth={1.5} className="text-cata-red" aria-hidden="true" />}
              {step === "health" && <Heart size={16} strokeWidth={1.5} className="text-cata-red" aria-hidden="true" />}
              {step === "credentials" && <Lock size={16} strokeWidth={1.5} className="text-cata-red" aria-hidden="true" />}
              {step === "summary" && <FileText size={16} strokeWidth={1.5} className="text-cata-red" aria-hidden="true" />}
              <h2 className="text-lg font-semibold text-cata-text">
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
                      "Creando cuenta..."
                    ) : (
                      <>
                        <CheckCircle size={14} strokeWidth={2} aria-hidden="true" />
                        Crear Cuenta
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
