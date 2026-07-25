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
} from "lucide-react";
import { fetchMembers, obtenerRolesDePersona, asignarRol, quitarRol, cambiarEstadoCuenta, actualizarPersona, fetchFichaMedica, actualizarFichaMedica, fetchTiposMembresia, crearMembresia } from "@/services/api";
import type { TipoMembresiaCatalogo } from "@/services/api";
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

const FILTER_CHIPS: { flag: MemberFilterFlag; label: string }[] = [
  { flag: "all", label: "Todos" },
  { flag: "vencida", label: "Membresía vencida" },
  { flag: "pendiente", label: "Pago pendiente" },
  { flag: "sin-grupo", label: "Sin grupo asignado" },
];

// The per-state `PaymentStatusIcon` that used to prefix the payment badge is
// gone: `Badge` already carries a `currentColor` dot, so the icon was a second
// status marker for one status.

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

function AccountRow({
  account,
  grupos,
  editModalOpen,
  onToggleEditModal,
  onMembershipCreated,
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
                <Badge tone={statusBadge.tone}>{statusBadge.label}</Badge>
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
          <Badge tone={statusBadge.tone}>
            {statusBadge.label}
          </Badge>
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
                  {/* Sets the expectation up front: this modal has no
                      commit step, so closing it never loses anything. */}
                  <p className="mt-1 text-xs text-cata-text/65">
                    Los cambios se guardan al instante.
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
                  onClick={onToggleEditModal}
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
                          className={`h-badge inline-flex cursor-pointer items-center gap-1.5 rounded-full px-[11px] text-[11.5px] font-bold disabled:opacity-50 ${
                            activo
                              ? "bg-state-ok-bg text-state-ok"
                              : "bg-state-bad-bg text-state-bad"
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
                      </dd>
                    </div>
                  </dl>
                  <div className="mt-3 flex items-center gap-3">
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
                      <StudentEditPanel
                        key={estudiante.id}
                        student={estudiante}
                        grupos={grupos}
                        onMembershipCreated={onMembershipCreated}
                      />
                    ))}
                  </div>
                </section>
              )}
            </div>

            {/* Footer — everything above already saves per-action (roles,
                estado, ficha médica, membresía each call their own endpoint
                immediately, and nombres/apellidos/teléfono have their own
                save button). There is nothing left for this footer to commit,
                so it offers only a dismiss action: a "Guardar cambios"
                primary here would promise a save it cannot perform, and a
                "Cancelar" beside it would imply the already-persisted changes
                could still be discarded. */}
            <div className="flex shrink-0 items-center justify-end gap-2 border-t border-cata-border px-5 py-3.5">
              <button type="button" onClick={onToggleEditModal} className="btn-secondary text-sm">
                Cerrar
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
  const { session, isLoading } = useAuth();
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
      const { accounts: membersData, niveles, personasCapped: upstreamPersonasCapped } = await fetchMembers();
      setAccounts(membersData);
      setGrupos(niveles.map(nivelToGrupo));
      setPersonasCapped(upstreamPersonasCapped);
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
              placeholder="Buscar por nombre o correo…"
              className="input-field pl-9"
              aria-label="Buscar miembros"
            />
          </div>
          <div className="flex flex-wrap gap-2" role="group" aria-label="Filtrar miembros">
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
                      onMembershipCreated={() => void loadMembers({ silent: true })}
                    />
                  ))}
                </tbody>
              </table>
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
      </AppShell>
    </ProtectedRoute>
  );
}
