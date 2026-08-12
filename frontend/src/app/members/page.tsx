/**
 * Gestionar Miembros — Admin overview of responsible payers and their students.
 *
 * Displays all MemberAccount records (account owners / responsible payers)
 * with their associated students. Shows membership status, payment summary,
 * and contact/identity information for each.
 *
 * Connected to the real backend (Fase 4): `GET /api/members` aggregates
 * `/personas` and `/membresias/pagos*` server-side — see
 * src/lib/server/members-adapter.ts for the DTO translation and the
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
import {
  Badge,
  Button,
  buttonClasses,
  DataBox,
  DataRow,
  EmptyState,
  ErrorState,
  FilterPanel,
  FilterPill,
  LoadingState,
  Pagination,
  SearchInput,
  STAT_GRID,
  StatCard,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableNameCell,
  TableRow,
} from "@/components/ui";
import { useAuth } from "@/contexts/AuthContext";
import {
  Users,
  UserCheck,
  Clock,
  ShieldCheck,
  Search,
  User,
  GraduationCap,
  CheckCircle2,
  Building2,
  Stethoscope,
  Loader2,
  Plus,
  ToggleLeft,
  ToggleRight,
  Pencil,
  X,
  UserPlus,
} from "lucide-react";
import { ICON } from "@/lib/icon-size";
import { fetchMembers, fetchFichaMedica, actualizarFichaMedica } from "@/services/api";
import { getUserInitials } from "@/lib/auth-utils";
import {
  buildMemberStats,
  formatMembershipPeriod,
  filterAccounts,
  accountMatchesFlag,
  countAccountsMatchingFlag,
  getAccountStatusBadge,
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
import type { BackendTipoRol, FichaMedicaEditable, TipoSangre } from "@/types/domain";
import { formatCurrency, formatDate } from "@/lib/format-utils";
import MedicalRecordEditor from "./MedicalRecordEditor";
import AccountInfoSection from "./AccountInfoSection";
import { useAccountRolesAndStatus, ROLE_LABELS } from "./useAccountRolesAndStatus";
import CreateMembershipForm from "./CreateMembershipForm";
import RegisterPaymentForm from "./RegisterPaymentForm";

const FILTER_CHIPS: { flag: MemberFilterFlag; label: string }[] = [
  { flag: "all", label: "Todos" },
  { flag: "vencida", label: "Membresía vencida" },
  { flag: "pendiente", label: "Pago pendiente" },
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
        <h3 className="flex flex-1 items-center gap-1.5 text-sm font-bold text-ink">
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

function StudentEditPanel({ student, onMembershipCreated }: StudentRowProps): React.ReactElement {
  const [showMedical, setShowMedical] = useState(false);

  const personaId = Number(student.id);
  const age = calculateAge(student.fechaNacimiento);

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

  return (
    <li className="py-4 first:pt-0 last:pb-0">
      {/* Identity */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-sunken text-sm font-bold text-ink-2">
            {getUserInitials(`${student.nombres} ${student.apellidos}`)}
          </div>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-ink">
              {student.nombres} {student.apellidos}
            </p>
            {age !== null && <DataBox className="mt-1">{age} años</DataBox>}
          </div>
        </div>
      </div>

      {/* Ficha — full-width row (card is now the modal's full content width,
          not squeezed into a half-width grid column), four stats side by
          side on larger screens instead of a cramped two-up layout. */}
      <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-section border-t border-line pt-3 text-xs sm:grid-cols-3">
        <div>
          <dt className="text-ink-3">Estado</dt>
          <dd className="mt-1">
            <Badge tone={student.activo ? "ok" : "bad"}>
              {student.activo ? "Activo" : "Inactivo"}
            </Badge>
          </dd>
        </div>
        <div>
          <dt className="text-ink-3">Membresía</dt>
          <dd className="mt-1">
            {student.membresia ? (
              <Badge tone={membershipTone}>{membershipLabel}</Badge>
            ) : (
              <span className="text-ink-3">Sin membresía</span>
            )}
          </dd>
        </div>
        <div>
          <dt className="text-ink-3">Último pago</dt>
          <dd className="mt-1">
            {student.ultimoPago ? (
              <Badge tone={paymentTone}>{paymentLabel}</Badge>
            ) : (
              <span className="text-ink-3">No registrado</span>
            )}
          </dd>
        </div>
      </dl>

      {/* Each figure is a value that matters (a plan, a period, an amount),
          so each gets its own box rather than one run-on sentence stitched
          together with middots. */}
      {student.membresia && (
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <DataBox>{student.membresia.tipo}</DataBox>
          <DataBox>
            {formatMembershipPeriod(student.membresia.fechaInicio, student.membresia.fechaFin)}
          </DataBox>
          <DataBox>{formatCurrency(student.membresia.monto)}</DataBox>
        </div>
      )}
      {student.ultimoPago && (
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
          <DataBox>{formatCurrency(student.ultimoPago.monto)}</DataBox>
          <DataBox>{student.ultimoPago.periodo}</DataBox>
        </div>
      )}

      {/* The two write flows are independent forms, each owning its own state
          and its own failures — see CreateMembershipForm / RegisterPaymentForm.
          Which one is offered is decided here, and only here: you create a
          membership when there is none, and register a payment against one
          that exists. */}
      {!student.membresia && (
        <CreateMembershipForm personaId={personaId} onCreated={onMembershipCreated} />
      )}
      {student.membresia && (
        <div className="mt-2.5">
          <RegisterPaymentForm personaId={personaId} membresia={student.membresia} />
        </div>
      )}

      {/* Actions */}
      <div className="mt-3 flex flex-wrap gap-2 border-t border-line pt-3">
        <button
          type="button"
          onClick={() => setShowMedical((v) => !v)}
          className="inline-flex items-center gap-1 rounded-lg bg-cata-red/15 px-2.5 py-1 text-2xs tracking-flat font-semibold text-cata-red transition-colors hover:bg-cata-red/25"
        >
          <Stethoscope size={ICON.sm} strokeWidth={1.5} aria-hidden="true" />
          Ficha médica
        </button>
      </div>

      {showMedical && (
        <MedicalRecordEditor personaId={personaId} studentName={`${student.nombres} ${student.apellidos}`} />
      )}
    </li>
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
  onClose: () => void;
  /** Refetch the member list — forwarded to each student's edit panel. */
  onMembershipCreated: () => void;
}

const ALL_BACKEND_ROLES: BackendTipoRol[] = ["ADMINISTRADOR", "ENTRENADOR", "REPRESENTANTE", "ALUMNO"];


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
      <TableCell type="number">{account.estudiantes.length}</TableCell>
      <TableCell type="badge">
        <Badge tone={statusBadge.tone}>{statusBadge.label}</Badge>
      </TableCell>
      <TableCell type="action">
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
    <DataRow
      name={`${account.nombres} ${account.apellidos}`}
      meta={
        <>
          <DataBox>{getPayerTypeLabel(account.role)}</DataBox>
          <DataBox>{account.telefono}</DataBox>
          {account.email ? (
            <DataBox className="max-w-[10rem] truncate">{account.email}</DataBox>
          ) : null}
          <DataBox variant="numeric">{account.estudiantes.length}</DataBox>
        </>
      }
      status={<Badge tone={statusBadge.tone}>{statusBadge.label}</Badge>}
      actions={
        <Button
          size="sm"
          onClick={(event) => {
            event.currentTarget.focus();
            onEdit();
          }}
          aria-label={`Editar ${account.nombres} ${account.apellidos}`}
        >
          Editar
        </Button>
      }
    />
  );
}

function MemberEditDialog({
  account,
  onClose,
  onMembershipCreated,
}: MemberEditDialogProps): React.ReactElement {
  // Roles and estado are ONE concern, not two: a single request answers both,
  // a failed load has to show up in both places, and the header badge below
  // renders `activo`. See useAccountRolesAndStatus for why that is a hook and
  // the identity fields are a component.
  const {
    roles,
    activo,
    ready: rolesReady,
    loading: rolesLoading,
    roleLoading,
    stateLoading,
    roleError,
    stateError,
    toggleRole,
    toggleEstado,
  } = useAccountRolesAndStatus(Number(account.id));
  const statusBadge = getAccountStatusBadge(account);
  const personaId = Number(account.id);


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

  return (
    <>
      {createPortal(
          <dialog
            ref={dialogRef}
            aria-modal="true"
            aria-labelledby={`edit-member-title-${account.id}`}
            onCancel={(event) => event.preventDefault()}
            className="fixed inset-0 z-50 m-auto flex h-fit max-h-[calc(100vh-2rem)] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-line bg-paper p-0 shadow-elevated backdrop:bg-coal/40"
          >
            {/* Header — avatar, name, phone, status badge, close. Sits on
                `sunken` rather than flush `paper`: the body below is `canvas`,
                so a plain white band between two greys was the "very flat"
                header — one more step on the surface ladder gives it its own
                plane, the same way a card reads as an object against the page. */}
            <div className="flex shrink-0 items-start justify-between gap-3 border-b border-line bg-sunken px-5 py-4">
              <div className="flex min-w-0 items-center gap-3">
                {/* Identity accent, not a status or a CTA — `coal`, never the
                    brand red reserved for primary actions and destructive
                    intent (see `cata.red`'s own doc comment in
                    tailwind.config.ts). */}
                <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-coal/[0.08] text-base font-bold text-coal">
                  {getUserInitials(`${account.nombres} ${account.apellidos}`)}
                </div>
                <div className="min-w-0">
                  <h2
                    id={`edit-member-title-${account.id}`}
                    className="truncate text-lg font-bold leading-tight text-ink"
                  >
                    {account.nombres} {account.apellidos}
                  </h2>
                  <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                    <DataBox>{account.telefono}</DataBox>
                    <span className="text-xs text-ink-3">{getPayerTypeLabel(account.role)}</span>
                  </div>
                  {/* This used to read "Los cambios se guardan al instante",
                      which was true of roles and estado and false of the
                      identity fields and the membership form. Each group now
                      states its own contract in its own header, so the header
                      only says where to look. */}
                  <p className="mt-1.5 text-xs text-ink-2">
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
                  className="rounded-lg p-1.5 text-ink-3 transition-colors hover:bg-sunken hover:text-ink"
                >
                  <X size={ICON.sm} strokeWidth={1.5} aria-hidden="true" />
                </button>
              </div>
            </div>

            {/* Scrollable body. Four groups, each declaring how it persists:
                identity needs a button, roles and estado save themselves, and
                each student's membership/ficha médica has its own save. */}
            <div className="flex-1 space-y-section overflow-y-auto bg-canvas px-5 py-4">
              <ModalSection title="Datos de la cuenta" saveMode="manual">
                <AccountInfoSection account={account} />
              </ModalSection>

              <ModalSection title="Estado de la cuenta" saveMode="instant">
                <div className="flex flex-wrap items-center gap-3">
                  <button
                    type="button"
                    onClick={() => void toggleEstado()}
                    disabled={stateLoading || !rolesReady}
                    className={`h-badge inline-flex cursor-pointer items-center gap-1.5 rounded-full px-[11px] text-2xs tracking-flat font-bold disabled:opacity-50 ${
                      activo ? "bg-state-ok-bg text-state-ok" : "bg-state-bad-bg text-state-bad"
                    }`}
                    aria-pressed={activo}
                  >
                    {stateLoading || rolesLoading ? (
                      <Loader2 size={ICON.sm} className="animate-spin" aria-hidden="true" />
                    ) : activo ? (
                      <ToggleRight size={ICON.sm} aria-hidden="true" />
                    ) : (
                      <ToggleLeft size={ICON.sm} aria-hidden="true" />
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
                  <ShieldCheck size={ICON.sm} strokeWidth={1.5} className="text-ink-3" aria-hidden="true" />
                }
              >
                <>
                  {rolesLoading && (
                    <p className="mb-2 flex items-center gap-1.5 text-xs text-ink-3" role="status">
                      <Loader2 size={ICON.sm} className="animate-spin" aria-hidden="true" />
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
                          className={`flex cursor-pointer items-center gap-2 rounded-lg border px-2.5 py-2 text-xs font-semibold transition-colors ${
                            "focus-within:outline focus-within:outline-2 focus-within:outline-offset-0 focus-within:outline-ball focus-within:shadow-focus-band "
                          }${
                            selected
                              ? "border-coal bg-coal/[0.04] text-ink"
                              : "border-line-2 bg-paper text-ink-2 hover:bg-canvas"
                          }`}
                        >
                          <RoleIcon size={ICON.sm} strokeWidth={1.5} className="shrink-0" aria-hidden="true" />
                          <span className="flex-1 truncate">{ROLE_LABELS[role]}</span>
                          {isLoading && (
                            <Loader2 size={ICON.sm} className="shrink-0 animate-spin" aria-hidden="true" />
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
                              className={`inline-block h-3.5 w-3.5 transform rounded-full shadow-soft transition-transform ${
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
                  {/* A list of people, so it takes the same divider hairlines
                      every other list of people in the product uses — not
                      `DataRowList`'s own outer border, which would nest a
                      second box inside this section's card. */}
                  <ul className="divide-y divide-line">
                    {account.estudiantes.map((estudiante) => (
                      <StudentEditPanel
                        key={estudiante.id}
                        student={estudiante}
                        onMembershipCreated={onMembershipCreated}
                      />
                    ))}
                  </ul>
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
        personasCapped: upstreamPersonasCapped,
        membresiasDegraded: upstreamMembresiasDegraded = false,
      } = await fetchMembers();
      setAccounts(membersData);
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
        title="Miembros"
        actions={
          <Link href="/admin/crear-cuenta" className={buttonClasses("primary", "sm")}>
            <UserPlus size={ICON.sm} strokeWidth={2} aria-hidden="true" />
            Crear cuenta
          </Link>
        }
      >
        {error && (
          <ErrorState
            title="No se pudieron cargar los miembros"
            message={error}
            onRetry={() => void loadMembers()}
          />
        )}

        {/* Stats row — `07-miembros.html`'s four tiles. Figures are ink; the
            old version put a red icon disc beside every one of them, which
            made four neutral counts read as four alerts. */}
        <div className={STAT_GRID}>
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
                // The count itself already sits in the "Estudiantes" tile
                // right beside this one — repeating it here just echoed
                // that figure. The population it's measured against still
                // has to be named, because it is students, not accounts.
                : "de los estudiantes"
            }
          />
          <StatCard label="Pagos pendientes" value={stats.pendingPayments} hint="por validar" />
        </div>

        {/* Search + filter chips. They used to sit loose on the canvas as two
            unrelated rows; `FilterPanel` frames them and fixes their order.
            "Crear cuenta" used to sit in the search row too — the screen's
            primary action, at the end of a control that filters. It lives in
            the header's `actions` slot now — see `AppShellProps.actions`. */}
        <FilterPanel
          label="Filtros de miembros"
          search={
            <SearchInput
              label="Buscar miembros"
              placeholder="Buscar por nombre o correo…"
              value={searchTerm}
              onChange={setSearchTerm}
            />
          }
          chips={
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
          }
        />

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
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3 text-xs text-ink-2">
              <p role="status" aria-label="Resultados mostrados">
                {filteredAccounts.length} resultados mostrados
              </p>
              {aggregateIsCapped && (
                <p role="alert" className="max-w-md text-state-bad">
                  La fuente devuelve hasta {MEMBERS_AGGREGATE_LIMIT} registros; este listado puede estar incompleto.
                </p>
              )}
            </div>
            {/* Below `sm` the table used to hide Contacto/Estudiantes/Estado
                /Editar behind `hidden sm:table-cell`, leaving a one-column
                list with a second, duplicated edit button crammed under each
                name. A phone gets a real row per account instead — same data,
                one edit trigger, nothing hidden — through the same `DataRow`
                primitive every other list of people in the product uses,
                rather than a hand-rolled `<li>` card. Divider hairlines are
                applied directly (instead of via `DataRowList`) because this
                list already sits inside the card's own border below — a
                second border here would nest a box inside a box. */}
            <ul className="divide-y divide-line sm:hidden">
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
                    <TableHeaderCell type="number">Estudiantes</TableHeaderCell>
                    <TableHeaderCell type="badge">Membresía</TableHeaderCell>
                    <TableHeaderCell type="action">
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
            {/* INSIDE the card, not after it. This pager used to be a sibling
                of the card it paginates, so it floated on the canvas while
                every other list in the product carried its pager welded to the
                foot of the card. The `footer` variant owns that placement now,
                so the move is a nesting change and no classes travel with it. */}
            {totalPages > 1 && (
              <Pagination
                page={page}
                totalPages={totalPages}
                onPageChange={setPage}
                totalItems={filteredAccounts.length}
                pageSize={MEMBERS_PAGE_SIZE}
                itemNoun="miembro"
                variant="footer"
              />
            )}
          </div>
        ) : null}

        {!loading && filteredAccounts.length === 0 && (
          <EmptyState
            icon={<Users size={ICON.lg} strokeWidth={1.5} aria-hidden="true" />}
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
        )}

        {/* One dialog for the whole page, keyed so switching accounts remounts
            it with fresh state. Rendering it per row would portal two copies
            into the document, since each account exists twice in the DOM (a
            table row and a mobile card). */}
        {editingAccount && (
          <MemberEditDialog
            key={editingAccount.id}
            account={editingAccount}
            onClose={() => setEditingAccountId(null)}
            onMembershipCreated={() => void loadMembers({ silent: true })}
          />
        )}
      </AppShell>
    </ProtectedRoute>
  );
}
