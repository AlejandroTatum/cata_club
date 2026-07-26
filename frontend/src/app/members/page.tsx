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
import {
  Badge,
  Button,
  buttonClasses,
  EmptyState,
  ErrorState,
  FilterPill,
  LoadingState,
  Pagination,
  SearchInput,
  StatCard,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableNameCell,
  TableRow,
} from "@/components/ui";
import { useToast } from "@/contexts/ToastContext";
import { useAuth } from "@/contexts/AuthContext";
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
  Building2,
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
  MEMBERS_PAGE_SIZE,
  MEMBERS_AGGREGATE_LIMIT,
  MEMBERSHIP_STATUS_LABELS,
  MEMBERSHIP_STATUS_TONE,
  PAYMENT_STATUS_LABELS,
  PAYMENT_STATUS_TONE,
  getPayerTypeLabel,
  type MemberAccount,
  type MemberStudentSummary,
  type MemberFilterFlag,
} from "./members-utils";
import type { Grupo, BackendTipoRol, FichaMedicaEditable, TipoSangre } from "@/types/domain";
import { formatCurrency, formatDate } from "@/lib/format-utils";
import MedicalRecordEditor from "./MedicalRecordEditor";
import { calendarIsoDate, clubIsoDate, clubToday } from "@/lib/club-date";

const FILTER_CHIPS: { flag: MemberFilterFlag; label: string }[] = [
  { flag: "all", label: "Todos" },
  { flag: "vencida", label: "Membresía vencida" },
  { flag: "pendiente", label: "Pago pendiente" },
  { flag: "sin-grupo", label: "Sin grupo asignado" },
];

// The per-state `PaymentStatusIcon` that used to prefix the payment badge is
// gone: `Badge` already carries a `currentColor` dot, so the icon was a second
// status marker for one status.

/**
 * How a group of controls inside the edit dialog persists itself.
 *
 * The audit's cognitive-load finding was about this dialog: it holds identity
 * editing with its own save button, role switches that auto-save, an account
 * state toggle that auto-saves, per-student membership creation with its own
 * save, and the medical-record editor — five different save semantics, with
 * nothing on screen saying which was which. The header's blanket "Los cambios
 * se guardan al instante" was true of three of them and false of the other two.
 *
 * So every group now declares its own contract, in its own header.
 */
type SaveMode = "instant" | "manual";

const SAVE_MODE_LABEL: Record<SaveMode, string> = {
  instant: "Se guarda al instante",
  manual: "Requiere guardar",
};

function ModalSection({
  title,
  icon,
  saveMode,
  children,
}: {
  title: string;
  icon?: React.ReactNode;
  saveMode: SaveMode;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <section className="rounded-ctl border border-line bg-paper">
      <header className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-3">
        <h3 className="flex flex-1 items-center gap-1.5 text-[13px] font-bold text-ink">
          {icon}
          {title}
        </h3>
        <Badge tone="neutral">{SAVE_MODE_LABEL[saveMode]}</Badge>
      </header>
      <div className="p-4">{children}</div>
    </section>
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
  /**
   * Called after a membership is successfully created so the page can refetch
   * and show the new row. The panel used to tell the user "Recarga para
   * verla." instead — the system should refresh its own data rather than
   * delegate that to the user.
   */
  onMembershipCreated: () => void;
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

function StudentEditPanel({ student, grupos, onMembershipCreated }: StudentRowProps): React.ReactElement {
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
  const [paymentFechaInicio, setPaymentFechaInicio] = useState<string>(() => clubIsoDate());
  const [paymentFechaFin, setPaymentFechaFin] = useState<string>("");
  const [paymentLoading, setPaymentLoading] = useState(false);
  const [paymentError, setPaymentError] = useState<string | null>(null);
  const [paymentSuccess, setPaymentSuccess] = useState(false);
  const paymentFileInputRef = useRef<HTMLInputElement>(null);
  const [paymentVoucherFile, setPaymentVoucherFile] = useState<File | null>(null);

  const membershipLabel = student.membresia
    ? MEMBERSHIP_STATUS_LABELS[student.membresia.estado]
    : "Sin membresía";
  const membershipTone = student.membresia
    ? MEMBERSHIP_STATUS_TONE[student.membresia.estado]
    : "neutral";

  const paymentLabel = student.ultimoPago
    ? PAYMENT_STATUS_LABELS[student.ultimoPago.estado]
    : "Sin pagos";
  const paymentTone = student.ultimoPago
    ? PAYMENT_STATUS_TONE[student.ultimoPago.estado]
    : "neutral";

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
      // Refresh the list so the new membership appears in place, instead of
      // asking the user to reload the page themselves.
      onMembershipCreated();
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
    return calendarIsoDate(fin);
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
    // A calendar date, so `calcPaymentEndDate` adds months to a day rather
    // than to an instant.
    const hoy = clubToday();
    setPaymentFechaInicio(calendarIsoDate(hoy));
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
            <Badge tone={student.activo ? "ok" : "bad"}>
              {student.activo ? "Activo" : "Inactivo"}
            </Badge>
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
              <Badge tone={membershipTone}>{membershipLabel}</Badge>
            ) : (
              <span className="text-cata-text/40">Sin membresía</span>
            )}
          </dd>
        </div>
        <div>
          <dt className="text-cata-text/50">Último pago</dt>
          <dd className="mt-1">
            {student.ultimoPago ? (
              <Badge tone={paymentTone}>{paymentLabel}</Badge>
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
            Membresía creada.
          </p>
        ) : showCreateMembership ? (
          <div className="mt-2.5 space-y-2 rounded-lg bg-cata-bg/60 p-2.5">
            <select
              value={selectedTipoId}
              onChange={(e) => setSelectedTipoId(e.target.value ? Number(e.target.value) : "")}
              className="w-full rounded-lg border border-cata-border bg-cata-surface px-2.5 py-1.5 text-xs text-cata-text"
            >
              <option value="">Seleccionar tipo…</option>
              {tiposMembresia.map((tipo) => (
                <option key={tipo.id} value={tipo.id}>
                  {tipo.categoria} — {formatCurrency(tipo.precio)} ({tipo.modalidad})
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
// Account list — a table row from `sm` up, a card below it. All editing
// (roles, estado, per-student ficha médica/membresía) happens in the edit
// dialog, which is rendered ONCE by the page rather than once per row: two
// renderings of the same account both exist in the DOM (only one is visible),
// so a dialog owned by the row would portal itself into the document twice.
// ---------------------------------------------------------------------------

interface AccountListItemProps {
  account: MemberAccount;
  onEdit: () => void;
}

interface MemberEditDialogProps {
  account: MemberAccount;
  grupos: Grupo[];
  onClose: () => void;
  /** Refetch the member list — forwarded to each student's edit panel. */
  onMembershipCreated: () => void;
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

/** One account as a table row (`sm` and up). */
function AccountRow({ account, onEdit }: AccountListItemProps): React.ReactElement {
  const statusBadge = getAccountStatusBadge(account);

  return (
    <TableRow>
      <TableNameCell
        name={`${account.nombres} ${account.apellidos}`}
        sub={getPayerTypeLabel(account.role)}
      />
      <TableCell>
        <span className="block">{account.telefono}</span>
        {account.email ? (
          <span className="mt-px block truncate text-[11.5px] text-ink-3">{account.email}</span>
        ) : null}
      </TableCell>
      <TableCell align="right" className="tabular-nums">
        {account.estudiantes.length}
      </TableCell>
      <TableCell>
        <Badge tone={statusBadge.tone}>{statusBadge.label}</Badge>
      </TableCell>
      <TableCell align="right">
        <Button
          size="sm"
          // Focus the trigger explicitly: the dialog restores focus to
          // whatever was focused at mount, and a mouse click does not reliably
          // move focus to a <button> on its own.
          onClick={(event) => {
            event.currentTarget.focus();
            onEdit();
          }}
          aria-label={`Editar ${account.nombres} ${account.apellidos}`}
        >
          Editar
        </Button>
      </TableCell>
    </TableRow>
  );
}

/** The same account below `sm`, where a five-column table cannot fit. */
function AccountCard({ account, onEdit }: AccountListItemProps): React.ReactElement {
  const statusBadge = getAccountStatusBadge(account);

  return (
    <li className="flex flex-col gap-2 border-b border-line px-4 py-3.5 last:border-b-0">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-ink">
            {account.nombres} {account.apellidos}
          </p>
          <p className="text-[11.5px] text-ink-3">{getPayerTypeLabel(account.role)}</p>
        </div>
        <Button
          size="sm"
          className="flex-none"
          onClick={(event) => {
            event.currentTarget.focus();
            onEdit();
          }}
          aria-label={`Editar ${account.nombres} ${account.apellidos}`}
        >
          Editar
        </Button>
      </div>
      <dl className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[12.5px] text-ink-2">
        <div className="flex items-center gap-1.5">
          <dt className="sr-only">Teléfono</dt>
          <Phone size={11} strokeWidth={1.5} aria-hidden="true" />
          <dd>{account.telefono}</dd>
        </div>
        {account.email ? (
          <div className="flex min-w-0 items-center gap-1.5">
            <dt className="sr-only">Correo</dt>
            <Mail size={11} strokeWidth={1.5} className="flex-none" aria-hidden="true" />
            <dd className="truncate">{account.email}</dd>
          </div>
        ) : null}
        <div className="flex items-center gap-1.5">
          <dt className="sr-only">Estudiantes</dt>
          <GraduationCap size={11} strokeWidth={1.5} aria-hidden="true" />
          <dd className="tabular-nums">{account.estudiantes.length}</dd>
        </div>
      </dl>
      <Badge tone={statusBadge.tone} className="self-start">
        {statusBadge.label}
      </Badge>
    </li>
  );
}

function MemberEditDialog({
  account,
  grupos,
  onClose,
  onMembershipCreated,
}: MemberEditDialogProps): React.ReactElement {
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

  // Native <dialog> shown via showModal(): the browser traps Tab focus and
  // renders the ::backdrop for us, so no manual focus trap is needed (unlike
  // ConfirmDialog.tsx's older role="dialog" div convention). Escape is still
  // wired manually (rather than relying solely on the dialog's native
  // "cancel" event) so open/closed stays driven by the page's
  // `editingAccountId` alone — the dialog is conditionally rendered, not
  // toggled via its `open` attribute, so the JSX onCancel handler only
  // preventDefaults the native auto-close to avoid it and this listener
  // double-toggling React state. The backdrop-click listener is attached
  // imperatively (not as a JSX onClick on the <dialog>) since the element
  // itself is non-interactive. Focus restoration captures whichever trigger
  // was focused when the dialog mounted — row or card.
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    const previouslyFocused = document.activeElement as HTMLElement | null;

    setRoleError(null);
    setStateError(null);
    if (!dialog.open) dialog.showModal();
    closeButtonRef.current?.focus();

    function handleKeyDown(event: KeyboardEvent): void {
      if (event.key === "Escape") onClose();
    }
    function handleBackdropClick(event: MouseEvent): void {
      if (event.target === dialog) onClose();
    }

    document.addEventListener("keydown", handleKeyDown);
    dialog.addEventListener("click", handleBackdropClick);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      dialog.removeEventListener("click", handleBackdropClick);
      previouslyFocused?.focus();
    };
  }, [onClose]);

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
  }, [personaId]);

  return (
    <>
      {createPortal(
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
                  {/* This used to read "Los cambios se guardan al instante",
                      which was true of roles and estado and false of the
                      identity fields and the membership form. Each group now
                      states its own contract in its own header, so the header
                      only says where to look. */}
                  <p className="mt-1 text-xs text-cata-text/65">
                    Cada bloque indica si se guarda solo o si necesita un botón.
                  </p>
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <Badge tone={activo ? "ok" : "bad"}>
                  {activo ? "Activo" : "Inactivo"}
                </Badge>
                <button
                  ref={closeButtonRef}
                  type="button"
                  onClick={onClose}
                  // Distinct from the footer's "Cerrar": two identically
                  // named buttons in one dialog give screen-reader users no
                  // way to tell them apart in a controls list.
                  aria-label="Cerrar ventana"
                  className="rounded-lg p-1.5 text-cata-text/50 transition-colors hover:bg-cata-bg hover:text-cata-text"
                >
                  <X size={16} strokeWidth={1.5} aria-hidden="true" />
                </button>
              </div>
            </div>

            {/* Scrollable body. Four groups, each declaring how it persists:
                identity needs a button, roles and estado save themselves, and
                each student's membership/ficha médica has its own save. */}
            <div className="flex-1 space-y-3.5 overflow-y-auto bg-canvas px-5 py-4">
              <ModalSection title="Datos de la cuenta" saveMode="manual">
                <dl className="space-y-2 text-sm">
                  <div className="flex items-center justify-between gap-3">
                    <dt className="shrink-0 text-ink-3" id={`nombres-label-${account.id}`}>Nombres</dt>
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
                    <dt className="shrink-0 text-ink-3" id={`apellidos-label-${account.id}`}>Apellidos</dt>
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
                    <dt className="shrink-0 text-ink-3" id={`telefono-label-${account.id}`}>Teléfono</dt>
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
                      <dt className="text-ink-3">Correo</dt>
                      <dd className="flex min-w-0 items-center gap-1.5 truncate font-medium text-ink">
                        <Mail size={11} strokeWidth={1.5} aria-hidden="true" />
                        <span className="truncate">{account.email}</span>
                      </dd>
                    </div>
                  )}
                </dl>
                <div className="mt-3 flex flex-wrap items-center gap-3">
                  <button
                    type="button"
                    onClick={() => void handleSaveInfo()}
                    disabled={infoSaving}
                    className={buttonClasses("primary", "sm")}
                  >
                    {infoSaving ? (
                      <Loader2 size={12} className="animate-spin" aria-hidden="true" />
                    ) : (
                      <Save size={12} strokeWidth={1.5} aria-hidden="true" />
                    )}
                    {/* Explicit scope: this button only PATCHes
                        nombres/apellidos/teléfono. Roles, estado, ficha
                        médica and membresía each save themselves. */}
                    {infoSaving ? "Guardando…" : "Guardar nombre, apellido y teléfono"}
                  </button>
                  {infoSuccess && (
                    <p className="flex items-center gap-1 text-xs text-state-ok" role="status">
                      <CheckCircle2 size={12} strokeWidth={2} aria-hidden="true" />
                      Guardado.
                    </p>
                  )}
                </div>
                {infoError && (
                  <p className="mt-2 text-xs text-state-bad" role="alert">
                    {infoError}
                  </p>
                )}
              </ModalSection>

              <ModalSection title="Estado de la cuenta" saveMode="instant">
                <div className="flex flex-wrap items-center gap-3">
                  <button
                    type="button"
                    onClick={() => void toggleEstado()}
                    disabled={stateLoading || !rolesReady}
                    className={`h-badge inline-flex cursor-pointer items-center gap-1.5 rounded-full px-[11px] text-[11.5px] font-bold disabled:opacity-50 ${
                      activo ? "bg-state-ok-bg text-state-ok" : "bg-state-bad-bg text-state-bad"
                    }`}
                    aria-pressed={activo}
                  >
                    {stateLoading || rolesLoading ? (
                      <Loader2 size={11} className="animate-spin" aria-hidden="true" />
                    ) : activo ? (
                      <ToggleRight size={12} aria-hidden="true" />
                    ) : (
                      <ToggleLeft size={12} aria-hidden="true" />
                    )}
                    {stateLoading ? "Actualizando…" : rolesLoading ? "Cargando…" : activo ? "Activa" : "Inactiva"}
                  </button>
                  <p className="text-xs text-ink-3">
                    Una cuenta inactiva no puede iniciar sesión.
                  </p>
                </div>
                {stateError && (
                  <p className="mt-2 text-xs text-state-bad" role="alert">
                    {stateError}
                  </p>
                )}
              </ModalSection>

              <ModalSection
                title="Roles"
                saveMode="instant"
                icon={
                  <ShieldCheck size={14} strokeWidth={1.5} className="text-ink-3" aria-hidden="true" />
                }
              >
                <>
                  {rolesLoading && (
                    <p className="mb-2 flex items-center gap-1.5 text-xs text-ink-3" role="status">
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
                        // The audit found keyboard focus landing on nothing
                        // here: the real checkbox was `sr-only`, the visible
                        // switch was `aria-hidden`, and the wrapping <label>
                        // carried no focus style — so tabbing through the
                        // dialog moved an invisible cursor. `focus-within`
                        // puts the ring on the box the user can actually see,
                        // around the control that actually has focus.
                        //
                        // A <label> is not in the `:is(…)` list of the system
                        // focus rule in globals.css, so this ring is drawn by
                        // hand — and it drew a bare `outline-ball`, which is
                        // 1.41:1 on the chip fill, the exact failure that rule
                        // exists to correct. It now carries the same two-band
                        // pair the rule paints: the ball hugging the chip at
                        // offset 0, and a coal band around it (the shadow's
                        // 4px spread, of which the outline covers the inner
                        // 2px). Coal is 18.54:1 on paper, and the two bands
                        // are 13.13:1 apart. Total footprint is still 4px, so
                        // adjacent chips in the `gap-2` grid do not collide.
                        <label
                          key={role}
                          className={`flex cursor-pointer items-center gap-2 rounded-lg border px-2.5 py-2 text-xs font-medium transition-colors ${
                            "focus-within:outline focus-within:outline-2 focus-within:outline-offset-0 focus-within:outline-ball focus-within:shadow-[0_0_0_4px_#131316] "
                          }${
                            selected
                              ? "border-coal bg-coal/[0.04] text-ink"
                              : "border-line-2 bg-paper text-ink-2 hover:bg-canvas"
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
                          {/* Selection is coal + the yellow ball knob, never
                              red — red is the primary CTA and destructive
                              actions only. */}
                          <span
                            aria-hidden="true"
                            className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors ${
                              selected ? "bg-coal" : "bg-line-2"
                            }`}
                          >
                            <span
                              className={`inline-block h-3.5 w-3.5 transform rounded-full shadow-sm transition-transform ${
                                selected ? "translate-x-5 bg-ball" : "translate-x-1 bg-white"
                              }`}
                            />
                          </span>
                        </label>
                      );
                    })}
                  </div>
                  {roleError && (
                    <p className="mt-2 text-xs text-state-bad" role="alert">
                      {roleError}
                    </p>
                  )}
                </>
              </ModalSection>

              {account.estudiantes.length > 0 && (
                <ModalSection title="Estudiantes a cargo" saveMode="manual">
                  <div className="space-y-3">
                    {account.estudiantes.map((estudiante) => (
                      <StudentEditPanel
                        key={estudiante.id}
                        student={estudiante}
                        grupos={grupos}
                        onMembershipCreated={onMembershipCreated}
                      />
                    ))}
                  </div>
                </ModalSection>
              )}
            </div>

            {/* Footer — every group above persists itself, either instantly
                or through its own labelled button, so there is nothing left
                for this footer to commit: a "Guardar cambios" primary here
                would promise a save it cannot perform, and a "Cancelar"
                beside it would imply the already-persisted changes could
                still be discarded. */}
            <div className="flex shrink-0 items-center justify-end gap-2 border-t border-line px-5 py-3.5">
              <Button onClick={onClose}>Cerrar</Button>
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
  const { session, isLoading } = useAuth();
  const [searchTerm, setSearchTerm] = useState("");
  const [activeFlag, setActiveFlag] = useState<MemberFilterFlag>("all");
  const [accounts, setAccounts] = useState<MemberAccount[]>([]);
  const [grupos, setGrupos] = useState<Grupo[]>([]);
  const [personasCapped, setPersonasCapped] = useState(false);
  /** At least one membership could not be read upstream — see `MembersResponse`. */
  const [membresiasDegraded, setMembresiasDegraded] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editingAccountId, setEditingAccountId] = useState<string | null>(null);
  const [page, setPage] = useState(1);

  const toggleEditModal = useCallback((accountId: string) => {
    setEditingAccountId((prev) => (prev === accountId ? null : accountId));
  }, []);

  // `silent` refreshes the data WITHOUT flipping the page-level `loading` flag.
  // That flag gates the whole account list (see the `loading ? ... : ...` split
  // below), so raising it while the edit dialog is open unmounts the dialog and
  // discards every unsaved field in it. A refresh triggered from inside the
  // dialog — creating a membership — must never do that.
  const loadMembers = useCallback(async ({ silent = false } = {}): Promise<void> => {
    if (!silent) setLoading(true);
    setError(null);
    setPersonasCapped(false);
    try {
      const {
        accounts: membersData,
        niveles,
        personasCapped: upstreamPersonasCapped,
        membresiasDegraded: upstreamMembresiasDegraded = false,
      } = await fetchMembers();
      setAccounts(membersData);
      setGrupos(niveles.map(nivelToGrupo));
      setPersonasCapped(upstreamPersonasCapped);
      setMembresiasDegraded(upstreamMembresiasDegraded);
    } catch {
      // A failed silent refresh must not contradict the success the user just
      // saw: the write itself succeeded, only the re-read did not.
      setError(
        silent
          ? "La membresía se creó, pero no se pudo actualizar la lista. Recargue para verla."
          : "No se pudieron cargar los miembros. Intente nuevamente.",
      );
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  // Gate the fetch on the RESOLVED role. `ProtectedRoute` redirects a
  // non-admin away, but its redirect runs in an effect — a bare mount effect
  // here fired GET /api/members first and logged a 403 before the redirect
  // landed. Waiting for `isLoading` to settle and for the role to actually be
  // "admin" means the request is only ever made by someone allowed to make it.
  const isAdmin = !isLoading && session?.user?.role === "admin";

  useEffect(() => {
    if (!isAdmin) return;
    void loadMembers();
  }, [isAdmin, loadMembers]);

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

  const editingAccount = accounts.find((account) => account.id === editingAccountId) ?? null;

  return (
    <ProtectedRoute allowedRoles={["admin"]}>
      <AppShell
        eyebrow="Comunidad del club"
        title="Miembros"
      >
        <BackLink href="/dashboard" label="Volver al Panel" />

        {error && (
          <ErrorState
            className="mb-6"
            title="No se pudieron cargar los miembros"
            message={error}
            onRetry={() => void loadMembers()}
          />
        )}

        {/* Stats row — `07-miembros.html`'s four tiles. Figures are ink; the
            old version put a red icon disc beside every one of them, which
            made four neutral counts read as four alerts. */}
        <div className="mb-6 grid gap-3.5 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard label="Cuentas" value={stats.totalAccounts} hint="responsables de pago" />
          <StatCard label="Estudiantes" value={stats.totalStudents} hint="perfiles registrados" />
          {/*
              The label names the POPULATION this counts, because it is not the
              same population `/dashboard` counts. Here the numerator walks the
              account tree and counts STUDENTS with an active membership, so the
              denominator has to be students too — it used to read "de 44
              cuentas" beside a count of students, which is two different things
              in one sentence. `/dashboard` counts membership rows over all 86
              personas, staff included; both are true, and now both say so.

              When the upstream membership lookup degraded, this shows an em
              dash instead of a hard "0": an unreadable count is not a count of
              zero, and it is what made this tile contradict the dashboard and
              the student portals.
          */}
          <StatCard
            label="Con membresía activa"
            value={membresiasDegraded ? "—" : stats.activeMemberships}
            hint={
              membresiasDegraded
                ? "No disponible ahora mismo"
                : `de ${stats.totalStudents} estudiantes`
            }
          />
          <StatCard label="Pagos pendientes" value={stats.pendingPayments} hint="por validar" />
        </div>

        {/* Search + filter chips */}
        <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
          <div className="max-w-xs flex-1">
            <SearchInput
              label="Buscar miembros"
              placeholder="Buscar por nombre o correo…"
              value={searchTerm}
              onChange={setSearchTerm}
            />
          </div>
          <Link href="/admin/crear-cuenta" className={buttonClasses("primary", "sm")}>
            <UserPlus size={14} strokeWidth={2} aria-hidden="true" />
            Crear cuenta
          </Link>
        </div>
        <div className="mb-5 flex flex-wrap gap-2" role="group" aria-label="Filtrar miembros">
          {FILTER_CHIPS.map((chip) => (
            <FilterPill
              key={chip.flag}
              label={chip.label}
              count={countAccountsMatchingFlag(accounts, chip.flag)}
              active={activeFlag === chip.flag}
              onClick={() => setActiveFlag(chip.flag)}
            />
          ))}
        </div>

        {/* Members table */}
        {!loading && (
          <ContextualHelp title="Ayuda sobre límite de resultados">
            <p>Este listado puede incluir hasta {MEMBERS_AGGREGATE_LIMIT} registros y no confirma que se hayan cargado todos los miembros.</p>
          </ContextualHelp>
        )}
        {loading ? (
          <div className="card">
            <LoadingState label="Cargando miembros…" />
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
            {/* Below `sm` the table used to hide Contacto/Estudiantes/Estado
                /Editar behind `hidden sm:table-cell`, leaving a one-column
                list with a second, duplicated edit button crammed under each
                name. A phone gets a real card per account instead — same data,
                one edit trigger, nothing hidden. */}
            <ul className="sm:hidden">
              {paginatedAccounts.map((account) => (
                <AccountCard
                  key={account.id}
                  account={account}
                  onEdit={() => toggleEditModal(account.id)}
                />
              ))}
            </ul>

            <div className="hidden overflow-x-auto sm:block">
              <Table>
                <TableHead>
                  <TableRow>
                    <TableHeaderCell>Responsable de pago</TableHeaderCell>
                    <TableHeaderCell>Contacto</TableHeaderCell>
                    <TableHeaderCell align="right">Estudiantes</TableHeaderCell>
                    <TableHeaderCell>Membresía</TableHeaderCell>
                    <TableHeaderCell align="right">
                      <span className="sr-only">Editar</span>
                    </TableHeaderCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {paginatedAccounts.map((account) => (
                    <AccountRow
                      key={account.id}
                      account={account}
                      onEdit={() => toggleEditModal(account.id)}
                    />
                  ))}
                </TableBody>
              </Table>
            </div>
          </div>
        ) : null}

        {!loading && filteredAccounts.length > 0 && totalPages > 1 && (
          <Pagination
            page={page}
            totalPages={totalPages}
            onPageChange={setPage}
            totalItems={filteredAccounts.length}
            pageSize={MEMBERS_PAGE_SIZE}
            itemNoun="miembro"
          />
        )}

        {!loading && filteredAccounts.length === 0 && (
          <div className="card">
            <EmptyState
              icon={<Users size={21} strokeWidth={1.5} aria-hidden="true" />}
              title={
                searchTerm || activeFlag !== "all"
                  ? "No se encontraron miembros"
                  : "Aún no hay miembros registrados"
              }
              description={
                searchTerm || activeFlag !== "all"
                  ? "Ningún miembro coincide con la búsqueda y los filtros activos."
                  : "Cuando se registre la primera cuenta, aparecerá en este listado."
              }
              action={
                searchTerm || activeFlag !== "all" ? (
                  <Button
                    onClick={() => {
                      setSearchTerm("");
                      setActiveFlag("all");
                    }}
                  >
                    Limpiar búsqueda
                  </Button>
                ) : undefined
              }
            />
          </div>
        )}

        {/* One dialog for the whole page, keyed so switching accounts remounts
            it with fresh state. Rendering it per row would portal two copies
            into the document, since each account exists twice in the DOM (a
            table row and a mobile card). */}
        {editingAccount && (
          <MemberEditDialog
            key={editingAccount.id}
            account={editingAccount}
            grupos={grupos}
            onClose={() => setEditingAccountId(null)}
            onMembershipCreated={() => void loadMembers({ silent: true })}
          />
        )}
      </AppShell>
    </ProtectedRoute>
  );
}
