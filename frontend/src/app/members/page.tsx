/**
 * Gestionar Miembros — Admin overview of responsible payers and their students.
 *
 * Displays all MemberAccount records (account owners / responsible payers)
 * with their associated students. Shows membership status, payment summary,
 * and contact/identity information for each.
 *
 * Connected to the real backend (Fase 4): `GET /api/members` aggregates
 * `/personas`, `/membresias/pagos*` and `/ranking/niveles*` server-side —
 * see src/lib/server/members-adapter.ts for the DTO translation and the
 * backend gaps found while building it (no `email`/`roles`/account-active
 * flag exposed on Persona).
 */

"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { createPortal } from "react-dom";
import ProtectedRoute from "@/components/ProtectedRoute";
import AppShell from "@/components/shell/AppShell";
import ContextualHelp from "@/components/ContextualHelp";
import BackLink from "@/components/BackLink";
import PaginationControls from "@/components/PaginationControls";
import { useToast } from "@/contexts/ToastContext";
import {
  Users,
  UserCheck,
  Clock,
  ShieldCheck,
  Search,
  User,
  Phone,
  Mail,
  GraduationCap,
  CheckCircle2,
  XCircle,
  Building2,
  AlertTriangle,
  Stethoscope,
  Loader2,
  Plus,
  Save,
  ToggleLeft,
  ToggleRight,
  Pencil,
  X,
  Upload,
  UserPlus,
} from "lucide-react";
import { fetchMembers, obtenerRolesDePersona, asignarRol, quitarRol, cambiarEstadoCuenta, actualizarPersona, fetchFichaMedica, actualizarFichaMedica, fetchTiposMembresia, crearMembresia, registrarPago } from "@/services/api";
import type { TipoMembresiaCatalogo, RegistrarPagoInput } from "@/services/api";
import { nivelToGrupo } from "@/app/groups/groups-page-utils";
import { getUserInitials } from "@/lib/auth-utils";
import {
  buildMemberStats,
  formatMembershipPeriod,
  filterAccounts,
  accountMatchesFlag,
  countAccountsMatchingFlag,
  getAccountStatusBadge,
  getNivelLabelFromGrupo,
  paginateAccounts,
  getTotalPages,
  MEMBERS_AGGREGATE_LIMIT,
  MEMBERSHIP_STATUS_LABELS,
  MEMBERSHIP_STATUS_BADGE,
  PAYMENT_STATUS_LABELS,
  PAYMENT_STATUS_BADGE,
  getPayerTypeLabel,
  type MemberAccount,
  type MemberStudentSummary,
  type MemberFilterFlag,
  type PaymentStatus,
} from "./members-utils";
import type { Grupo, BackendTipoRol, FichaMedicaEditable, TipoSangre } from "@/types/domain";
import { formatCurrency, formatDate } from "@/lib/format-utils";
import MedicalRecordEditor from "./MedicalRecordEditor";

const FILTER_CHIPS: { flag: MemberFilterFlag; label: string }[] = [
  { flag: "all", label: "Todos" },
  { flag: "vencida", label: "Membresía vencida" },
  { flag: "pendiente", label: "Pago pendiente" },
  { flag: "sin-grupo", label: "Sin grupo asignado" },
];

// ---------------------------------------------------------------------------
// Payment status icon helper
// ---------------------------------------------------------------------------

interface PaymentStatusIconProps {
  estado: PaymentStatus;
}

function PaymentStatusIcon({ estado }: PaymentStatusIconProps): React.ReactElement | null {
  switch (estado) {
    case "aprobado":
      return <CheckCircle2 size={12} strokeWidth={2} aria-hidden="true" />;
    case "pendiente_validacion":
      return <Clock size={12} strokeWidth={2} aria-hidden="true" />;
    case "rechazado":
      return <XCircle size={12} strokeWidth={2} aria-hidden="true" />;
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// Stat Card
// ---------------------------------------------------------------------------

interface StatCardProps {
  icon: React.ReactNode;
  label: string;
  value: number;
}

function StatCard({ icon, label, value }: StatCardProps): React.ReactElement {
  return (
    <div className="card-hover flex items-center gap-3 p-4 sm:p-5">
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-cata-red/15">
        {icon}
      </div>
      <p className="min-w-0 flex-1 truncate text-xs font-medium uppercase tracking-wider text-cata-text/65">
        {label}
      </p>
      <p className="shrink-0 text-2xl font-bold tracking-tight text-cata-text">{value}</p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Medical record editor (expanded within a student row)
// ---------------------------------------------------------------------------


// ---------------------------------------------------------------------------
// Student edit panel — rendered inside the account's edit modal, one per
// `account.estudiantes` entry. Was previously a `<tr>` shown by expanding
// the account row; the row no longer expands, so all of this content
// (and its editing actions) now lives exclusively in the modal.
// ---------------------------------------------------------------------------

interface StudentRowProps {
  student: MemberStudentSummary;
  grupos: Grupo[];
}


function calculateAge(fechaNacimiento: string | undefined): number | null {
  if (!fechaNacimiento) return null;
  const birth = new Date(fechaNacimiento);
  const today = new Date();
  let age = today.getFullYear() - birth.getFullYear();
  const m = today.getMonth() - birth.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < birth.getDate())) age--;
  return age;
}

function StudentEditPanel({ student, grupos }: StudentRowProps): React.ReactElement {
  const { showSuccess, showError } = useToast();
  const [showMedical, setShowMedical] = useState(false);
  const [showCreateMembership, setShowCreateMembership] = useState(false);
  const [tiposMembresia, setTiposMembresia] = useState<TipoMembresiaCatalogo[]>([]);
  const [selectedTipoId, setSelectedTipoId] = useState<number | "">("");
  const [membershipLoading, setMembershipLoading] = useState(false);
  const [membershipError, setMembershipError] = useState<string | null>(null);
  const [membershipSuccess, setMembershipSuccess] = useState(false);

  // Payment registration state
  const [showPaymentForm, setShowPaymentForm] = useState(false);
  const [paymentMonto, setPaymentMonto] = useState<string>(student.membresia?.monto != null ? String(student.membresia.monto) : "");
  const [paymentTipoPago, setPaymentTipoPago] = useState<"EFECTIVO" | "TRANSFERENCIA">("TRANSFERENCIA");
  const [paymentFechaInicio, setPaymentFechaInicio] = useState<string>(() => {
    const hoy = new Date();
    return hoy.toISOString().slice(0, 10);
  });
  const [paymentFechaFin, setPaymentFechaFin] = useState<string>("");
  const [paymentLoading, setPaymentLoading] = useState(false);
  const [paymentError, setPaymentError] = useState<string | null>(null);
  const [paymentSuccess, setPaymentSuccess] = useState(false);
  const paymentFileInputRef = useRef<HTMLInputElement>(null);
  const [paymentVoucherFile, setPaymentVoucherFile] = useState<File | null>(null);

  const membershipLabel = student.membresia
    ? MEMBERSHIP_STATUS_LABELS[student.membresia.estado]
    : "Sin membresía";
  const membershipBadge = student.membresia
    ? MEMBERSHIP_STATUS_BADGE[student.membresia.estado]
    : "badge-neutral";

  const paymentLabel = student.ultimoPago
    ? PAYMENT_STATUS_LABELS[student.ultimoPago.estado]
    : "Sin pagos";
  const paymentBadge = student.ultimoPago
    ? PAYMENT_STATUS_BADGE[student.ultimoPago.estado]
    : "badge-neutral";

  const nivelDisplay = getNivelLabelFromGrupo(student.grupoId, grupos);
  const personaId = Number(student.id);
  const age = calculateAge(student.fechaNacimiento);
  const paymentMonthlyPrice = student.membresia?.monto != null ? Number(student.membresia.monto) : 0;

  async function handleOpenCreateMembership(): Promise<void> {
    setShowCreateMembership(true);
    setMembershipError(null);
    setMembershipSuccess(false);
    if (tiposMembresia.length === 0) {
      try {
        const tipos = await fetchTiposMembresia();
        setTiposMembresia(tipos);
      } catch {
        setMembershipError("No se pudieron cargar los tipos de membresía.");
      }
    }
  }

  async function handleCreateMembership(): Promise<void> {
    if (!selectedTipoId || !personaId) return;
    const tipo = tiposMembresia.find((t) => t.id === selectedTipoId);
    if (!tipo) return;

    setMembershipLoading(true);
    setMembershipError(null);
    try {
      await crearMembresia({
        personaId,
        tipoMembresiaId: selectedTipoId,
        montoAplicado: Number(tipo.precio),
      });
      setMembershipSuccess(true);
      setShowCreateMembership(false);
      showSuccess("Membresía creada correctamente.");
    } catch (err) {
      const message = err instanceof Error ? err.message : "Error al crear la membresía.";
      setMembershipError(message);
      showError(message);
    } finally {
      setMembershipLoading(false);
    }
  }

  function calcPaymentEndDate(baseDate: Date, amount: number): string {
    if (paymentMonthlyPrice <= 0 || amount <= 0) return "";
    const months = amount / paymentMonthlyPrice;
    const fin = new Date(baseDate);
    fin.setMonth(fin.getMonth() + months);
    return fin.toISOString().slice(0, 10);
  }

  function handlePaymentMontoChange(value: string): void {
    setPaymentMonto(value);
    if (!paymentFechaInicio) return;
    const amount = parseFloat(value.replace(/[^0-9.]/g, "")) || 0;
    setPaymentFechaFin(amount > 0 ? calcPaymentEndDate(new Date(paymentFechaInicio + "T12:00:00"), amount) : "");
  }

  function handleOpenPaymentForm(): void {
    setShowPaymentForm(true);
    setPaymentError(null);
    setPaymentSuccess(false);
    setPaymentVoucherFile(null);
    const hoy = new Date();
    setPaymentFechaInicio(hoy.toISOString().slice(0, 10));
    const amount = parseFloat(String(paymentMonto).replace(/[^0-9.]/g, "")) || 0;
    setPaymentFechaFin(amount > 0 ? calcPaymentEndDate(hoy, amount) : "");
  }

  async function handleSubmitPayment(): Promise<void> {
    const montoNum = Number(paymentMonto);
    if (!montoNum || montoNum <= 0) {
      setPaymentError("El monto debe ser mayor a 0.");
      return;
    }
    if (paymentMonthlyPrice > 0 && montoNum % paymentMonthlyPrice !== 0) {
      setPaymentError(`El monto debe ser múltiplo de $${paymentMonthlyPrice}.`);
      return;
    }
    if (!paymentFechaInicio || !paymentFechaFin) {
      setPaymentError("Las fechas son obligatorias.");
      return;
    }
    if (paymentFechaInicio >= paymentFechaFin) {
      setPaymentError("La fecha de inicio debe ser anterior a la fecha de fin.");
      return;
    }
    if (!student.membresia?.id) {
      setPaymentError("No se encontró la membresía.");
      return;
    }
    if (paymentTipoPago === "TRANSFERENCIA" && !paymentVoucherFile) {
      setPaymentError("El comprobante de transferencia es obligatorio.");
      return;
    }
    setPaymentLoading(true);
    setPaymentError(null);
    try {
      const input: RegistrarPagoInput = {
        monto: montoNum,
        tipoPago: paymentTipoPago,
        fechaInicio: paymentFechaInicio,
        fechaFin: paymentFechaFin,
        personaId,
        membresiaId: student.membresia.id,
      };
      const nuevoPago = await registrarPago(input);
      if (paymentVoucherFile && nuevoPago?.id) {
        const { subirVoucherPago } = await import("@/services/api");
        await subirVoucherPago(nuevoPago.id, paymentVoucherFile);
      }
      setPaymentSuccess(true);
      setShowPaymentForm(false);
      setPaymentVoucherFile(null);
      showSuccess("Pago registrado correctamente.");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "No se pudo registrar el pago.";
      setPaymentError(msg);
      showError(msg);
    } finally {
      setPaymentLoading(false);
    }
  }

  return (
    <div className="rounded-xl border border-cata-border bg-white p-4">
      {/* Identity */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-cata-bg text-sm font-bold text-cata-text/70">
            {getUserInitials(`${student.nombres} ${student.apellidos}`)}
          </div>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-cata-text">
              {student.nombres} {student.apellidos}
            </p>
            {age !== null && <p className="text-xs text-cata-text/55">{age} años</p>}
          </div>
        </div>
      </div>

      {/* Ficha — full-width row (card is now the modal's full content width,
          not squeezed into a half-width grid column), four stats side by
          side on larger screens instead of a cramped two-up layout. */}
      <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-3 border-t border-cata-border pt-3 text-xs sm:grid-cols-4">
        <div>
          <dt className="text-cata-text/50">Estado</dt>
          <dd className="mt-1">
            <span className={student.activo ? "badge-success" : "badge-error"}>
              {student.activo ? "Activo" : "Inactivo"}
            </span>
          </dd>
        </div>
        <div>
          <dt className="text-cata-text/50">Grupo</dt>
          <dd className="mt-1 font-medium text-cata-text">
            {nivelDisplay ?? "Sin grupo asignado"}
          </dd>
        </div>
        <div>
          <dt className="text-cata-text/50">Membresía</dt>
          <dd className="mt-1">
            {student.membresia ? (
              <span className={membershipBadge}>{membershipLabel}</span>
            ) : (
              <span className="text-cata-text/40">Sin membresía</span>
            )}
          </dd>
        </div>
        <div>
          <dt className="text-cata-text/50">Último pago</dt>
          <dd className="mt-1">
            {student.ultimoPago ? (
              <span className={paymentBadge}>
                <PaymentStatusIcon estado={student.ultimoPago.estado} />
                {paymentLabel}
              </span>
            ) : (
              <span className="text-cata-text/40">No registrado</span>
            )}
          </dd>
        </div>
      </dl>

      {student.membresia && (
        <p className="mt-1.5 text-[11px] text-cata-text/55">
          {student.membresia.tipo} &middot;{" "}
          {formatMembershipPeriod(student.membresia.fechaInicio, student.membresia.fechaFin)}
          {" "}&middot; {formatCurrency(student.membresia.monto)}
        </p>
      )}
      {student.ultimoPago && (
        <p className="mt-0.5 text-[11px] text-cata-text/55">
          {formatCurrency(student.ultimoPago.monto)} &middot; {student.ultimoPago.periodo}
        </p>
      )}

      {!student.membresia &&
        (membershipSuccess ? (
          <p className="mt-2 flex items-center gap-1 text-xs text-cata-state-ok">
            <CheckCircle2 size={11} strokeWidth={2} aria-hidden="true" />
            Membresía creada. Recarga para verla.
          </p>
        ) : showCreateMembership ? (
          <div className="mt-2.5 space-y-2 rounded-lg bg-cata-bg/60 p-2.5">
            <select
              value={selectedTipoId}
              onChange={(e) => setSelectedTipoId(e.target.value ? Number(e.target.value) : "")}
              className="w-full rounded-lg border border-cata-border bg-cata-surface px-2.5 py-1.5 text-xs text-cata-text"
            >
              <option value="">Seleccionar tipo...</option>
              {tiposMembresia.map((tipo) => (
                <option key={tipo.id} value={tipo.id}>
                  {tipo.categoria} — ${tipo.precio} ({tipo.modalidad})
                </option>
              ))}
            </select>
            {membershipError && <p className="text-xs text-cata-red">{membershipError}</p>}
            <div className="flex flex-wrap gap-1.5">
              <button
                type="button"
                onClick={() => handleCreateMembership()}
                disabled={!selectedTipoId || membershipLoading}
                className="inline-flex items-center gap-1 rounded-lg bg-cata-red px-2.5 py-1 text-xs font-medium text-white transition-colors hover:bg-cata-red/80 disabled:opacity-50"
              >
                {membershipLoading ? (
                  <Loader2 size={11} className="animate-spin" />
                ) : (
                  <Plus size={11} />
                )}
                Crear
              </button>
              <button
                type="button"
                onClick={() => setShowCreateMembership(false)}
                className="rounded-lg border border-cata-border px-2.5 py-1 text-xs text-cata-text/65 transition-colors hover:bg-cata-surface"
              >
                Cancelar
              </button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => handleOpenCreateMembership()}
            className="mt-2.5 inline-flex items-center gap-1 rounded-lg bg-cata-red/15 px-2.5 py-1 text-xs font-medium text-cata-red transition-colors hover:bg-cata-red/25"
          >
            <Plus size={11} strokeWidth={2} aria-hidden="true" />
            Crear membresía
          </button>
        ))}

      {/* Registrar pago — only when membership exists */}
      {student.membresia && (
        <div className="mt-2.5">
          {paymentSuccess ? (
            <p className="flex items-center gap-1 text-xs text-cata-state-ok">
              <CheckCircle2 size={11} strokeWidth={2} aria-hidden="true" />
              Pago registrado. Recarga para verlo.
            </p>
          ) : showPaymentForm ? (
            <div className="space-y-2 rounded-lg bg-cata-bg/60 p-2.5">
              <div className="grid grid-cols-2 gap-2">
                <label className="text-xs font-medium text-cata-text/65">
                  Monto
                  <input
                    type="number"
                    step={paymentMonthlyPrice > 0 ? paymentMonthlyPrice : "0.01"}
                    min="0"
                    value={paymentMonto}
                    onChange={(e) => handlePaymentMontoChange(e.target.value)}
                    className="mt-0.5 w-full rounded-lg border border-cata-border bg-cata-surface px-2.5 py-1.5 text-xs text-cata-text"
                    placeholder="0.00"
                  />
                </label>
                <label className="text-xs font-medium text-cata-text/65">
                  Método
                  <select
                    value={paymentTipoPago}
                    onChange={(e) => setPaymentTipoPago(e.target.value as "EFECTIVO" | "TRANSFERENCIA")}
                    className="mt-0.5 w-full rounded-lg border border-cata-border bg-cata-surface px-2.5 py-1.5 text-xs text-cata-text"
                  >
                    <option value="TRANSFERENCIA">Transferencia</option>
                    <option value="EFECTIVO">Efectivo</option>
                  </select>
                </label>
              </div>
              <div className="grid grid-cols-2 gap-2 rounded-lg border border-cata-border/50 bg-cata-surface/50 px-2.5 py-2">
                <div className="text-xs">
                  <span className="text-cata-text/45">Inicio: </span>
                  <span className="font-medium text-cata-text">{paymentFechaInicio || "—"}</span>
                </div>
                <div className="text-xs">
                  <span className="text-cata-text/45">Fin: </span>
                  <span className="font-medium text-cata-text">{paymentFechaFin || "—"}</span>
                </div>
              </div>
              {paymentMonthlyPrice > 0 && Number(paymentMonto) > 0 && (
                <p className="text-[10px] text-cata-text/45">
                  {Number(paymentMonto) / paymentMonthlyPrice} meses de vigencia (precio mensual: ${paymentMonthlyPrice})
                </p>
              )}
              {paymentTipoPago === "TRANSFERENCIA" && (
                <label className="block text-xs font-medium text-cata-text/65">
                  Comprobante
                  <div className="mt-0.5 flex items-center gap-2">
                    <input
                      ref={paymentFileInputRef}
                      type="file"
                      accept="image/jpeg,image/png,application/pdf"
                      onChange={(e) => setPaymentVoucherFile(e.target.files?.[0] ?? null)}
                      className="hidden"
                    />
                    <button
                      type="button"
                      onClick={() => paymentFileInputRef.current?.click()}
                      className="flex items-center gap-1.5 rounded-lg border border-dashed border-cata-border bg-cata-surface px-2.5 py-1.5 text-xs text-cata-text/65 transition-colors hover:border-cata-red/30 hover:text-cata-text"
                    >
                      <Upload size={12} strokeWidth={1.5} aria-hidden="true" />
                      {paymentVoucherFile ? paymentVoucherFile.name : "Seleccionar archivo"}
                    </button>
                    {paymentVoucherFile && (
                      <button
                        type="button"
                        onClick={() => setPaymentVoucherFile(null)}
                        className="text-[10px] text-cata-text/45 hover:text-cata-red"
                      >
                        Quitar
                      </button>
                    )}
                  </div>
                </label>
              )}
              {paymentError && <p className="text-xs text-cata-red">{paymentError}</p>}
              <div className="flex gap-1.5">
                <button
                  type="button"
                  onClick={() => void handleSubmitPayment()}
                  disabled={paymentLoading || !paymentMonto || !paymentFechaInicio || !paymentFechaFin}
                  className="inline-flex items-center gap-1 rounded-lg bg-cata-red px-2.5 py-1 text-xs font-medium text-white transition-colors hover:bg-cata-red/80 disabled:opacity-50"
                >
                  {paymentLoading ? <Loader2 size={11} className="animate-spin" /> : <Plus size={11} />}
                  Registrar pago
                </button>
                <button
                  type="button"
                  onClick={() => { setShowPaymentForm(false); setPaymentVoucherFile(null); }}
                  className="rounded-lg border border-cata-border px-2.5 py-1 text-xs text-cata-text/65 transition-colors hover:bg-cata-surface"
                >
                  Cancelar
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              onClick={handleOpenPaymentForm}
              className="inline-flex items-center gap-1 rounded-lg bg-cata-red/15 px-2.5 py-1 text-xs font-medium text-cata-red transition-colors hover:bg-cata-red/25"
            >
              <Plus size={11} strokeWidth={2} aria-hidden="true" />
              Registrar pago
            </button>
          )}
        </div>
      )}

      {/* Actions */}
      <div className="mt-3 flex flex-wrap gap-2 border-t border-cata-border pt-3">
        <button
          type="button"
          onClick={() => setShowMedical((v) => !v)}
          className="inline-flex items-center gap-1 rounded-lg bg-cata-red/15 px-2.5 py-1 text-[11px] font-medium text-cata-red transition-colors hover:bg-cata-red/25"
        >
          <Stethoscope size={11} strokeWidth={1.5} aria-hidden="true" />
          Ficha médica
        </button>
      </div>

      {showMedical && <MedicalRecordEditor personaId={personaId} />}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Account row — all editing (roles, estado, per-student etiquetas/ficha
// médica/membresía) happens in the edit modal; the row itself never expands.
// ---------------------------------------------------------------------------

interface AccountRowProps {
  account: MemberAccount;
  grupos: Grupo[];
  editModalOpen: boolean;
  onToggleEditModal: () => void;
}

const ALL_BACKEND_ROLES: BackendTipoRol[] = ["ADMINISTRADOR", "ENTRENADOR", "REPRESENTANTE", "ALUMNO"];

const ROLE_LABELS: Record<BackendTipoRol, string> = {
  ADMINISTRADOR: "Admin",
  ENTRENADOR: "Entrenador",
  REPRESENTANTE: "Representante",
  ALUMNO: "Alumno",
};

const ROLE_ICONS: Record<BackendTipoRol, typeof ShieldCheck> = {
  ADMINISTRADOR: ShieldCheck,
  ENTRENADOR: GraduationCap,
  REPRESENTANTE: Building2,
  ALUMNO: User,
};

function AccountRow({
  account,
  grupos,
  editModalOpen,
  onToggleEditModal,
}: AccountRowProps): React.ReactElement {
  const { showSuccess, showError } = useToast();
  // `roles`/`activo` start empty/true only as placeholders — they get
  // overwritten by `obtenerRolesDePersona` as soon as the edit modal opens
  // (see the `editModalOpen` effect below). Before that fetch resolves,
  // `rolesReady` is false and the roles/estado controls stay disabled, so
  // the checkboxes never render (or can be toggled) against a stale "no
  // roles yet" placeholder — that mismatch was the original bug.
  const [roles, setRoles] = useState<BackendTipoRol[]>([]);
  const [activo, setActivo] = useState(true);
  const [rolesLoading, setRolesLoading] = useState(false);
  const [rolesLoaded, setRolesLoaded] = useState(false);
  const [roleLoading, setRoleLoading] = useState<BackendTipoRol | null>(null);
  const [stateLoading, setStateLoading] = useState(false);
  const [roleError, setRoleError] = useState<string | null>(null);
  const [stateError, setStateError] = useState<string | null>(null);
  const rolesReady = rolesLoaded && !rolesLoading;
  const statusBadge = getAccountStatusBadge(account);
  const personaId = Number(account.id);

  // Nombre/Teléfono editing — `PATCH /personas/{id}` already exists in the
  // backend (via PersonaUpdateDTO) and `actualizarPersona` already wraps it
  // in the frontend (used by the student etiquetas editor elsewhere), it was
  // just never wired into this modal even though its trigger is labeled
  // "Editar". Same save-per-action pattern as roles/estado above, not a big
  // form. Local edits don't retroactively update the row's `account` prop
  // (same as `crearMembresia`'s "Recarga para verla." note) — a reload
  // reflects the change everywhere else.
  const [nombresInput, setNombresInput] = useState(account.nombres);
  const [apellidosInput, setApellidosInput] = useState(account.apellidos);
  const [telefonoInput, setTelefonoInput] = useState(account.telefono);
  const [infoSaving, setInfoSaving] = useState(false);
  const [infoError, setInfoError] = useState<string | null>(null);
  const [infoSuccess, setInfoSuccess] = useState(false);

  async function handleSaveInfo(): Promise<void> {
    setInfoSaving(true);
    setInfoError(null);
    setInfoSuccess(false);
    try {
      await actualizarPersona(personaId, {
        nombres: nombresInput.trim(),
        apellidos: apellidosInput.trim(),
        telefono: telefonoInput.trim(),
      });
      setInfoSuccess(true);
    } catch (error: unknown) {
      setInfoError(error instanceof Error ? error.message : "No se pudieron guardar los cambios.");
    } finally {
      setInfoSaving(false);
    }
  }

  async function toggleRole(role: BackendTipoRol): Promise<void> {
    setRoleLoading(role);
    setRoleError(null);
    const hasRole = roles.includes(role);

    try {
      if (hasRole) {
        await quitarRol(personaId, role);
        setRoles((prev) => prev.filter((r) => r !== role));
        showSuccess(`Rol ${ROLE_LABELS[role]} quitado correctamente.`);
      } else {
        await asignarRol(personaId, role);
        setRoles((prev) => [...prev, role]);
        showSuccess(`Rol ${ROLE_LABELS[role]} asignado correctamente.`);
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "No se pudo actualizar el rol.";
      // If the backend says the role is already present/absent, reconcile local state.
      if (message.toLowerCase().includes("ya tiene el rol")) {
        setRoles((prev) => (prev.includes(role) ? prev : [...prev, role]));
      } else if (message.toLowerCase().includes("no tiene el rol")) {
        setRoles((prev) => prev.filter((r) => r !== role));
      } else {
        setRoleError(message);
        showError(message);
      }
    } finally {
      setRoleLoading(null);
    }
  }

  async function toggleEstado(): Promise<void> {
    setStateLoading(true);
    setStateError(null);
    const next = !activo;

    try {
      await cambiarEstadoCuenta(personaId, next);
      setActivo(next);
      showSuccess(next ? "Cuenta activada correctamente." : "Cuenta desactivada correctamente.");
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "No se pudo cambiar el estado.";
      setStateError(message);
      showError(message);
    } finally {
      setStateLoading(false);
    }
  }

  const dialogRef = useRef<HTMLDialogElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  // Two "Editar" triggers exist per row — a desktop one (in the sm-only
  // contact/status column) and a mobile one (next to the status badge in
  // the always-visible name column), since the desktop column is entirely
  // CSS-hidden below `sm` and mobile would otherwise have no way to open
  // the modal at all. Neither needs its own ref: focus-restoration below
  // captures whichever element was actually focused (i.e. whichever
  // trigger the user actually clicked) right before the dialog opens.

  // Native <dialog> shown via showModal(): the browser traps Tab focus and
  // renders the ::backdrop for us, so no manual focus trap is needed (unlike
  // ConfirmDialog.tsx's older role="dialog" div convention). Escape is still
  // wired manually (rather than relying solely on the dialog's native
  // "cancel" event) so open/closed stays driven by `editModalOpen` alone —
  // the dialog is conditionally rendered, not toggled via its `open`
  // attribute, so the JSX onCancel handler only preventDefaults the native
  // auto-close to avoid it and this listener double-toggling React state.
  // The backdrop-click listener is attached imperatively (not as a JSX
  // onClick on the <dialog>) since the element itself is non-interactive.
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!editModalOpen || !dialog) return;

    const previouslyFocused = document.activeElement as HTMLElement | null;

    setRoleError(null);
    setStateError(null);
    if (!dialog.open) dialog.showModal();
    closeButtonRef.current?.focus();

    function handleKeyDown(event: KeyboardEvent): void {
      if (event.key === "Escape") onToggleEditModal();
    }
    function handleBackdropClick(event: MouseEvent): void {
      if (event.target === dialog) onToggleEditModal();
    }

    document.addEventListener("keydown", handleKeyDown);
    dialog.addEventListener("click", handleBackdropClick);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      dialog.removeEventListener("click", handleBackdropClick);
      previouslyFocused?.focus();
    };
  }, [editModalOpen, onToggleEditModal]);

  // Seed `roles`/`activo` from the persona's real current state every time
  // the modal opens — this is the actual bug fix. Before this fetch, both
  // stayed at their `[]`/`true` placeholders forever (no code seeded them),
  // so the role checkboxes always rendered as "nothing assigned" regardless
  // of reality: toggling a role the person already had looked like turning
  // it ON, then the backend correctly rejected it with 400 "ya tiene el rol
  // ...". `rolesReady` gates the roles/estado controls so nothing can be
  // toggled against that stale placeholder while the fetch is in flight or
  // failed — reusing `roleError`/`stateError` (rather than a new error
  // state) keeps the failure visible in the same spots those sections
  // already render errors in.
  useEffect(() => {
    if (!editModalOpen) return;
    let cancelled = false;

    setRolesLoading(true);
    setRolesLoaded(false);
    void obtenerRolesDePersona(personaId)
      .then((current) => {
        if (cancelled) return;
        setRoles(current.roles);
        setActivo(current.activo);
        setRolesLoaded(true);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        const message =
          error instanceof Error
            ? error.message
            : "No se pudieron cargar los roles y el estado actuales de esta cuenta.";
        setRoleError(message);
        setStateError(message);
      })
      .finally(() => {
        if (!cancelled) setRolesLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [editModalOpen, personaId]);

  return (
    <>
      <tr className="transition-colors hover:bg-cata-bg">
        <td className="px-4 py-3.5">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-cata-red/15">
              {account.role === "representante" ? (
                <Building2 size={14} strokeWidth={1.5} className="text-cata-red" aria-hidden="true" />
              ) : (
                <GraduationCap size={14} strokeWidth={1.5} className="text-cata-red" aria-hidden="true" />
              )}
            </div>
            <div>
              <p className="font-medium text-cata-text">
                {account.nombres} {account.apellidos}
              </p>
              <p className="text-xs text-cata-text/65">
                {getPayerTypeLabel(account.role)}
              </p>
              <div className="mt-1 flex items-center gap-2 sm:hidden">
                <span className={statusBadge.className}>{statusBadge.label}</span>
                <button
                  type="button"
                  onClick={(event) => {
                    event.currentTarget.focus();
                    onToggleEditModal();
                  }}
                  className="inline-flex items-center gap-1 rounded-lg border border-cata-border p-1.5 text-cata-text/50 transition-colors hover:bg-cata-red/10 hover:text-cata-red"
                  aria-label="Editar"
                  title="Editar miembro"
                >
                  <Pencil size={13} strokeWidth={1.5} aria-hidden="true" />
                </button>
              </div>
            </div>
          </div>
        </td>
        <td className="hidden px-4 py-3.5 text-xs text-cata-text/65 sm:table-cell">
          {account.email && (
            <div className="flex items-center gap-1.5">
              <Mail size={11} strokeWidth={1.5} aria-hidden="true" />
              {account.email}
            </div>
          )}
          <div className="mt-0.5 flex items-center gap-1.5">
            <Phone size={11} strokeWidth={1.5} aria-hidden="true" />
            {account.telefono}
          </div>
        </td>
        <td className="hidden px-4 py-3.5 text-center sm:table-cell">
          <span className="text-sm font-medium text-cata-text">
            {account.estudiantes.length}
          </span>
        </td>
        <td className="hidden px-4 py-3.5 sm:table-cell">
          <span className={`badge ${statusBadge.className}`}>
            {statusBadge.label}
          </span>
        </td>
        <td className="hidden px-4 py-3.5 text-right sm:table-cell">
          <button
            type="button"
            onClick={(event) => {
              event.currentTarget.focus();
              onToggleEditModal();
            }}
            className="inline-flex items-center gap-1 rounded-lg border border-cata-border p-1.5 text-cata-text/50 transition-colors hover:bg-cata-red/10 hover:text-cata-red"
            aria-label="Editar"
            title="Editar miembro"
          >
            <Pencil size={13} strokeWidth={1.5} aria-hidden="true" />
          </button>
        </td>
      </tr>
      {editModalOpen &&
        createPortal(
          <dialog
            ref={dialogRef}
            aria-modal="true"
            aria-labelledby={`edit-member-title-${account.id}`}
            onCancel={(event) => event.preventDefault()}
            className="fixed inset-0 z-50 m-auto flex h-fit max-h-[calc(100vh-2rem)] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-cata-border bg-white p-0 shadow-elevated backdrop:bg-cata-black/40"
          >
            {/* Header — avatar, name, phone, status badge, close */}
            <div className="flex shrink-0 items-start justify-between gap-3 border-b border-cata-border px-5 py-4">
              <div className="flex min-w-0 items-center gap-3">
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-cata-red/15 text-sm font-bold text-cata-red">
                  {getUserInitials(`${account.nombres} ${account.apellidos}`)}
                </div>
                <div className="min-w-0">
                  <h2
                    id={`edit-member-title-${account.id}`}
                    className="truncate text-lg font-bold leading-tight text-cata-text"
                  >
                    {account.nombres} {account.apellidos}
                  </h2>
                  <p className="text-sm text-cata-text/65">{account.telefono}</p>
                  <p className="mt-0.5 text-xs text-cata-text/50">{getPayerTypeLabel(account.role)}</p>
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <span className={activo ? "badge-success" : "badge-error"}>
                  {activo ? "Activo" : "Inactivo"}
                </span>
                <button
                  ref={closeButtonRef}
                  type="button"
                  onClick={onToggleEditModal}
                  aria-label="Cerrar"
                  className="rounded-lg p-1.5 text-cata-text/50 transition-colors hover:bg-cata-bg hover:text-cata-text"
                >
                  <X size={16} strokeWidth={1.5} aria-hidden="true" />
                </button>
              </div>
            </div>

            {/* Scrollable body */}
            <div className="flex-1 space-y-4 overflow-y-auto px-5 py-4">
              <div className="grid gap-4 sm:grid-cols-2">
                {/* Información general */}
                <section className="rounded-xl border border-cata-border bg-cata-bg/50 p-4">
                  <h3 className="mb-3 text-sm font-bold text-cata-text">Información general</h3>
                  <dl className="space-y-2 text-sm">
                    <div className="flex items-center justify-between gap-3">
                      <dt className="shrink-0 text-cata-text/55" id={`nombres-label-${account.id}`}>Nombres</dt>
                      <dd className="min-w-0 flex-1">
                        <input
                          type="text"
                          value={nombresInput}
                          onChange={(e) => setNombresInput(e.target.value)}
                          aria-labelledby={`nombres-label-${account.id}`}
                          className="input-field w-full py-1 text-right text-sm"
                        />
                      </dd>
                    </div>
                    <div className="flex items-center justify-between gap-3">
                      <dt className="shrink-0 text-cata-text/55" id={`apellidos-label-${account.id}`}>Apellidos</dt>
                      <dd className="min-w-0 flex-1">
                        <input
                          type="text"
                          value={apellidosInput}
                          onChange={(e) => setApellidosInput(e.target.value)}
                          aria-labelledby={`apellidos-label-${account.id}`}
                          className="input-field w-full py-1 text-right text-sm"
                        />
                      </dd>
                    </div>
                    <div className="flex items-center justify-between gap-3">
                      <dt className="shrink-0 text-cata-text/55" id={`telefono-label-${account.id}`}>Teléfono</dt>
                      <dd className="min-w-0 flex-1">
                        <input
                          type="text"
                          value={telefonoInput}
                          onChange={(e) => setTelefonoInput(e.target.value)}
                          aria-labelledby={`telefono-label-${account.id}`}
                          className="input-field w-full py-1 text-right text-sm"
                        />
                      </dd>
                    </div>
                    {/* Email deliberately read-only, no editable input: no
                        admin endpoint mutates it (email lives on Usuario,
                        not on the Persona that PATCH /personas/{id} edits). */}
                    {account.email && (
                      <div className="flex items-center justify-between gap-3">
                        <dt className="text-cata-text/55">Correo</dt>
                        <dd className="flex min-w-0 items-center gap-1.5 truncate font-medium text-cata-text">
                          <Mail size={11} strokeWidth={1.5} aria-hidden="true" />
                          <span className="truncate">{account.email}</span>
                        </dd>
                      </div>
                    )}
                    <div className="flex items-center justify-between gap-3">
                      <dt className="text-cata-text/55">Estado</dt>
                      <dd>
                        <button
                          type="button"
                          onClick={() => void toggleEstado()}
                          disabled={stateLoading || !rolesReady}
                          className={`${activo ? "badge-success" : "badge-error"} cursor-pointer disabled:opacity-50`}
                          aria-pressed={activo}
                        >
                          {stateLoading || rolesLoading ? (
                            <Loader2 size={11} className="animate-spin" aria-hidden="true" />
                          ) : activo ? (
                            <ToggleRight size={12} aria-hidden="true" />
                          ) : (
                            <ToggleLeft size={12} aria-hidden="true" />
                          )}
                          {stateLoading ? "Actualizando..." : rolesLoading ? "Cargando..." : activo ? "Activa" : "Inactiva"}
                        </button>
                      </dd>
                    </div>
                  </dl>
                  <div className="mt-3 flex items-center gap-3">
                    <button
                      type="button"
                      onClick={() => void handleSaveInfo()}
                      disabled={infoSaving}
                      className="btn-primary inline-flex items-center gap-1.5 py-1.5 text-xs disabled:opacity-50"
                    >
                      {infoSaving ? (
                        <Loader2 size={12} className="animate-spin" aria-hidden="true" />
                      ) : (
                        <Save size={12} strokeWidth={1.5} aria-hidden="true" />
                      )}
                      {infoSaving ? "Guardando..." : "Guardar datos"}
                    </button>
                    {infoSuccess && (
                      <p className="flex items-center gap-1 text-xs text-cata-state-ok" role="status">
                        <CheckCircle2 size={12} strokeWidth={2} aria-hidden="true" />
                        Guardado.
                      </p>
                    )}
                  </div>
                  {infoError && (
                    <p className="mt-2 text-xs text-cata-red" role="alert">
                      {infoError}
                    </p>
                  )}
                  {stateError && (
                    <p className="mt-2 text-xs text-cata-red" role="alert">
                      {stateError}
                    </p>
                  )}
                </section>

                {/* Roles — settings-style switches, two columns, one icon each */}
                <section className="rounded-xl border border-cata-border bg-cata-bg/50 p-4">
                  <h3 className="mb-3 flex items-center gap-1.5 text-sm font-bold text-cata-text">
                    <ShieldCheck size={14} strokeWidth={1.5} className="text-cata-text/50" aria-hidden="true" />
                    Roles
                  </h3>
                  {rolesLoading && (
                    <p className="mb-2 flex items-center gap-1.5 text-xs text-cata-text/50" role="status">
                      <Loader2 size={12} className="animate-spin" aria-hidden="true" />
                      Cargando roles actuales…
                    </p>
                  )}
                  <div className="grid grid-cols-2 gap-2">
                    {ALL_BACKEND_ROLES.map((role) => {
                      const selected = roles.includes(role);
                      const isLoading = roleLoading === role;
                      const RoleIcon = ROLE_ICONS[role];
                      return (
                        <label
                          key={role}
                          className={`flex cursor-pointer items-center gap-2 rounded-lg border px-2.5 py-2 text-xs font-medium transition-colors ${
                            selected
                              ? "border-cata-red/30 bg-cata-red/5 text-cata-red"
                              : "border-cata-border bg-white text-cata-text hover:bg-cata-bg"
                          }`}
                        >
                          <RoleIcon size={14} strokeWidth={1.5} className="shrink-0" aria-hidden="true" />
                          <span className="flex-1 truncate">{ROLE_LABELS[role]}</span>
                          {isLoading && (
                            <Loader2 size={12} className="shrink-0 animate-spin" aria-hidden="true" />
                          )}
                          <input
                            type="checkbox"
                            checked={selected}
                            onChange={() => void toggleRole(role)}
                            disabled={roleLoading !== null || !rolesReady}
                            className="sr-only"
                          />
                          <span
                            aria-hidden="true"
                            className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors ${
                              selected ? "bg-cata-red" : "bg-cata-border"
                            }`}
                          >
                            <span
                              className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow-sm transition-transform ${
                                selected ? "translate-x-5" : "translate-x-1"
                              }`}
                            />
                          </span>
                        </label>
                      );
                    })}
                  </div>
                  {roleError && (
                    <p className="mt-2 text-xs text-cata-red" role="alert">
                      {roleError}
                    </p>
                  )}
                </section>
              </div>

              {account.estudiantes.length > 0 && (
                <section>
                  <h3 className="mb-3 text-sm font-bold text-cata-text">Estudiantes a cargo</h3>
                  <div className="space-y-3">
                    {account.estudiantes.map((estudiante) => (
                      <StudentEditPanel key={estudiante.id} student={estudiante} grupos={grupos} />
                    ))}
                  </div>
                </section>
              )}
            </div>

            {/* Footer — everything above already saves per-action (roles,
                estado, etiquetas, ficha médica each call their own endpoint
                immediately); these two just dismiss the modal, matching the
                existing close behavior (X / Escape / backdrop). */}
            <div className="flex shrink-0 items-center justify-end gap-2 border-t border-cata-border px-5 py-3.5">
              <button type="button" onClick={onToggleEditModal} className="btn-ghost text-sm">
                Cancelar
              </button>
              <button type="button" onClick={onToggleEditModal} className="btn-primary text-sm">
                Guardar cambios
              </button>
            </div>
          </dialog>,
          document.body,
        )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Page component
// ---------------------------------------------------------------------------

export default function MembersPage(): React.ReactElement {
  const [searchTerm, setSearchTerm] = useState("");
  const [activeFlag, setActiveFlag] = useState<MemberFilterFlag>("all");
  const [accounts, setAccounts] = useState<MemberAccount[]>([]);
  const [grupos, setGrupos] = useState<Grupo[]>([]);
  const [personasCapped, setPersonasCapped] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editingAccountId, setEditingAccountId] = useState<string | null>(null);
  const [page, setPage] = useState(1);

  const toggleEditModal = useCallback((accountId: string) => {
    setEditingAccountId((prev) => (prev === accountId ? null : accountId));
  }, []);

  const loadMembers = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError(null);
    setPersonasCapped(false);
    try {
      const { accounts: membersData, niveles, personasCapped: upstreamPersonasCapped } = await fetchMembers();
      setAccounts(membersData);
      setGrupos(niveles.map(nivelToGrupo));
      setPersonasCapped(upstreamPersonasCapped);
    } catch {
      setError("No se pudieron cargar los miembros. Intente nuevamente.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadMembers();
  }, [loadMembers]);

  // Reset to page 1 whenever the search term or filter chip changes, so the
  // paginator never gets stuck on a stale/out-of-range page.
  useEffect(() => {
    setPage(1);
  }, [searchTerm, activeFlag]);

  const stats = buildMemberStats(accounts);
  const filteredAccounts = filterAccounts(accounts, searchTerm).filter((account) =>
    accountMatchesFlag(account, activeFlag),
  );
  const aggregateIsCapped = personasCapped;

  const totalPages = useMemo(() => getTotalPages(filteredAccounts.length), [filteredAccounts]);
  const paginatedAccounts = useMemo(
    () => paginateAccounts(filteredAccounts, page),
    [filteredAccounts, page],
  );

  return (
    <ProtectedRoute allowedRoles={["admin"]}>
      <AppShell
        eyebrow="Gestión de Miembros"
        title="Miembros del Club"
      >
        <BackLink href="/dashboard" label="Volver al Panel" />

        {error && (
          <div
            className="mb-6 flex items-center gap-2 rounded-xl border border-cata-red/30 bg-cata-red/10 px-4 py-3 text-sm text-cata-red"
            role="alert"
          >
            <AlertTriangle size={14} strokeWidth={2} aria-hidden="true" />
            {error}
            <button type="button" onClick={() => void loadMembers()} className="btn-ghost ml-auto text-xs">
              Reintentar
            </button>
          </div>
        )}

        {/* Stats grid */}
        <div className="mb-6 flex items-center gap-2">
          <ShieldCheck size={16} strokeWidth={1.5} className="text-cata-red" aria-hidden="true" />
          <h2 className="text-lg font-bold text-cata-text">Resumen</h2>
        </div>
        <div className="mb-8 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          <StatCard
            icon={<Users size={20} strokeWidth={1.5} className="text-cata-red" aria-hidden="true" />}
            label="Cuentas"
            value={stats.totalAccounts}
          />
          <StatCard
            icon={<UserCheck size={20} strokeWidth={1.5} className="text-cata-red" aria-hidden="true" />}
            label="Estudiantes"
            value={stats.totalStudents}
          />
          <StatCard
            icon={<ShieldCheck size={20} strokeWidth={1.5} className="text-cata-red" aria-hidden="true" />}
            label="Membresías activas"
            value={stats.activeMemberships}
          />
          <StatCard
            icon={<Clock size={20} strokeWidth={1.5} className="text-cata-red" aria-hidden="true" />}
            label="Pagos pendientes"
            value={stats.pendingPayments}
          />
        </div>

        {/* Search + filter chips */}
        <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="relative max-w-sm flex-1">
            <Search
              size={14}
              strokeWidth={1.5}
              className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-cata-text/65"
              aria-hidden="true"
            />
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Buscar por nombre o correo..."
              className="input-field pl-9"
              aria-label="Buscar miembros"
            />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Link
              href="/admin/crear-cuenta"
              className="inline-flex items-center gap-1.5 rounded-lg bg-cata-red px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-cata-red/80"
            >
              <UserPlus size={13} strokeWidth={2} aria-hidden="true" />
              Crear cuenta
            </Link>
            <div className="flex flex-wrap gap-2" role="group" aria-label="Filtrar miembros">
              {FILTER_CHIPS.map((chip) => {
              const isActive = activeFlag === chip.flag;
              const count = countAccountsMatchingFlag(accounts, chip.flag);
              return (
                <button
                  key={chip.flag}
                  type="button"
                  onClick={() => setActiveFlag(chip.flag)}
                  aria-pressed={isActive}
                  className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors ${
                    isActive
                      ? "border-cata-red bg-cata-red/10 text-cata-red"
                      : "border-cata-border text-cata-text/65 hover:bg-cata-bg"
                  }`}
                >
                  {chip.label}
                  <span
                    className={`rounded-full px-1.5 py-0.5 text-[10px] ${
                      isActive ? "bg-cata-red/20" : "bg-cata-bg"
                    }`}
                  >
                    {count}
                  </span>
                </button>
              );
            })}
            </div>
          </div>
        </div>

        {/* Members table */}
        {!loading && (
          <ContextualHelp title="Ayuda sobre límite de resultados">
            <p>Este listado puede incluir hasta {MEMBERS_AGGREGATE_LIMIT} registros y no confirma que se hayan cargado todos los miembros.</p>
          </ContextualHelp>
        )}
        {loading ? (
          <div className="card flex flex-col items-center py-16 text-center">
            <p className="text-sm text-cata-text/50">Cargando miembros…</p>
          </div>
        ) : filteredAccounts.length > 0 ? (
          <div className="card overflow-hidden">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-cata-border px-4 py-3 text-xs text-cata-text/65">
              <p role="status" aria-label="Resultados mostrados">
                {filteredAccounts.length} resultados mostrados
              </p>
              {aggregateIsCapped && (
                <p role="alert" className="max-w-md text-cata-red">
                  La fuente devuelve hasta {MEMBERS_AGGREGATE_LIMIT} registros; este listado puede estar incompleto.
                </p>
              )}
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-cata-border bg-cata-bg text-xs font-medium uppercase tracking-wider text-cata-text/65">
                    <th className="px-4 py-3 font-medium">Responsable de pago</th>
                    <th className="hidden px-4 py-3 font-medium sm:table-cell">Contacto</th>
                    <th className="hidden px-4 py-3 text-center font-medium sm:table-cell">Estudiantes</th>
                    <th className="hidden px-4 py-3 font-medium sm:table-cell">Estado de membresía</th>
                    <th className="hidden px-4 py-3 text-right font-medium sm:table-cell">
                      <span className="sr-only">Editar</span>
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-cata-border">
                  {paginatedAccounts.map((account) => (
                    <AccountRow
                      key={account.id}
                      account={account}
                      grupos={grupos}
                      editModalOpen={editingAccountId === account.id}
                      onToggleEditModal={() => toggleEditModal(account.id)}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ) : null}

        {!loading && filteredAccounts.length > 0 && totalPages > 1 && (
          <PaginationControls page={page} totalPages={totalPages} onPageChange={setPage} />
        )}

        {!loading && filteredAccounts.length === 0 && (
          /* Empty state */
          <div className="card flex flex-col items-center py-16 text-center">
            <Users
              size={32}
              strokeWidth={1.5}
              className="mb-3 text-cata-text/20"
              aria-hidden="true"
            />
            <p className="text-sm text-cata-text/50">
              {searchTerm || activeFlag !== "all"
                ? "No se encontraron miembros con ese criterio de búsqueda."
                : "Aún no hay miembros registrados."}
            </p>
            {(searchTerm || activeFlag !== "all") && (
              <button
                type="button"
                onClick={() => {
                  setSearchTerm("");
                  setActiveFlag("all");
                }}
                className="btn-ghost mt-3 text-xs"
              >
                Limpiar búsqueda
              </button>
            )}
          </div>
        )}
      </AppShell>
    </ProtectedRoute>
  );
}
