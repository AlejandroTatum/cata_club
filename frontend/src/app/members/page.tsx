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

import LinkifiedText from "@/components/LinkifiedText";
import { useCallback, useEffect, useMemo, useState } from "react";

import Link from "next/link";
import { createPortal } from "react-dom";
import ProtectedRoute from "@/components/ProtectedRoute";
import AppShell from "@/components/shell/AppShell";
import ConfirmDialog from "@/components/ConfirmDialog";
import {
  BackLink,
  Badge,
  Button,
  DataBox,
  DataRow,
  EmptyState,
  ErrorState,
  FilterPanel,
  FilterPill,
  IdentityCell,
  LoadingState,
  Pagination,
  ResponsiveListTable,
  RowActionsMenu,
  InfoPanel,
  PAGE_RAIL,
  SearchInput,
  TableCell,
  TableHeaderCell,
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
  ToggleLeft,
  ToggleRight,
  Pencil,
  UserMinus,
  X,
  Wallet,
  ChevronRight,
  AlertTriangle,
} from "lucide-react";
import { ICON } from "@/lib/icon-size";
import { fetchMembers, fetchFichaMedica, actualizarFichaMedica } from "@/services/api";
import { getUserInitials } from "@/lib/auth-utils";
import MemberDialogHeader from "./MemberDialogHeader";
import {
  buildMemberStats,
  formatMembershipCoverage,
  filterAccounts,
  accountMatchesFlag,
  countAccountsMatchingFlag,
  getAccountStatusBadge,
  getAccountStateBadge,
  getMembershipStatusBadge,
  getDebtSummary,
  isRepresentativePersonaRow,
  paginateAccounts,
  getTotalPages,
  MEMBERS_PAGE_SIZE,
  PAYMENT_STATUS_LABELS,
  PAYMENT_STATUS_TONE,
  getPayerTypeLabel,
  accountDisplayRoles,
  type MemberAccount,
  type MemberStudentSummary,
  type MemberFilterFlag,
} from "./members-utils";
import type { BackendTipoRol, FichaMedicaEditable, TipoSangre } from "@/types/domain";
import { formatCurrency, formatDate } from "@/lib/format-utils";
import { calculatePersonAge } from "@/lib/identity-validation";
import { clubToday } from "@/lib/club-date";
import AccountInfoSection from "./AccountInfoSection";
import { useAccountRolesAndStatus, ROLE_LABELS } from "./useAccountRolesAndStatus";
import { type MembresiaCallbacks } from "./StudentMembershipActions";
import LinkRepresentativeSection from "./LinkRepresentativeSection";
import ReassignRepresentativeSection from "./ReassignRepresentativeSection";
import IndependizarSection from "./IndependizarSection";
import { useNativeDialog, NATIVE_DIALOG_WIDE_SHELL_CLASS, NATIVE_DIALOG_BODY_CLASS } from "./useNativeDialog";
import MedicalRecordDialog from "./MedicalRecordDialog";
import PaymentsDialog from "./PaymentsDialog";

const FILTER_CHIPS: { flag: MemberFilterFlag; label: string }[] = [
  { flag: "all", label: "Todos" },
  { flag: "vencida", label: "Membresía vencida" },
  { flag: "pendiente", label: "Pago pendiente" },
  // Issue #730. A count is not a worklist: the chip is both the number and
  // the route to the rows behind it — and from each row, the edit dialog's
  // medical-record editor is where it gets fixed.
  { flag: "sin-emergencia", label: "Sin datos de emergencia" },
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
  manual: "Sin cambios",
};

/** ADMA-12: a manual-save group only asks to be saved once something was edited. */
const DIRTY_LABEL = "Cambios sin guardar";

function ModalSection({
  title,
  icon,
  saveMode,
  dirty = false,
  children,
}: {
  title: string;
  icon?: React.ReactNode;
  saveMode: SaveMode;
  dirty?: boolean;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <section className="rounded-ctl border border-line bg-paper">
      <header className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-3">
        <h3 className="flex flex-1 items-center gap-1.5 text-sm font-bold text-ink">
          {icon}
          {title}
        </h3>
        <Badge tone={dirty ? "warn" : "neutral"}>{dirty ? DIRTY_LABEL : SAVE_MODE_LABEL[saveMode]}</Badge>
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
// the account row.
//
// La fila volvió a desplegarse (`AccountRow`), así que conviene ser exacto: lo
// que despliega son los NOMBRES de los representados y nada más. Todo lo
// editable — ficha médica, membresía, pagos — sigue viviendo solo en el modal,
// que es de donde se lo sacó.
// ---------------------------------------------------------------------------

interface StudentRowProps {
  student: MemberStudentSummary;
}

/**
 * A `DataBox` with its own small caption above it — issue #313 (K5 hallazgo
 * #44): the ficha's membership/payment figures had no label at all, so an
 * admin could not tell a plan's price from a payment's amount at a glance.
 */
function LabeledDataBox({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <span className="inline-flex flex-col items-start gap-0.5">
      <span className="text-2xs text-ink-3">{label}</span>
      <DataBox>{children}</DataBox>
    </span>
  );
}

function StudentEditPanel({ student }: StudentRowProps): React.ReactElement {
  const rawAge = student.fechaNacimiento
    ? calculatePersonAge(student.fechaNacimiento, clubToday())
    : NaN;
  const age = Number.isNaN(rawAge) ? null : rawAge;

  const { label: membershipLabel, tone: membershipTone } = getMembershipStatusBadge(student);
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
          <dt className="text-ink-3">En el club</dt>
          <dd className="mt-1">
            <Badge tone={student.activo ? "ok" : "bad"}>
              {student.activo ? "Activo" : "Inactivo/Archivado"}
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
          so each gets its own labeled box rather than one run-on sentence
          stitched together with middots.

          Issue #313 (K5 hallazgo #44): estas seis fichas no llevaban rótulo
          y el período se imprimía DOS veces en formatos distintos —
          `formatMembershipPeriod` (dd/mm/aaaa) aquí Y `ultimoPago.periodo`
          (aaaa-mm-dd, sin formatear) abajo, la misma fecha con otra cara.
          `ultimoPago.periodo` se borra: no agrega ningún dato que "Vigencia"
          no diga ya. Lo que sí es un hecho aparte es cuándo se REGISTRÓ el
          pago (`fechaPago`) — eso no vivía en ningún lado de la ficha. */}
      {student.membresia && (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <LabeledDataBox label="Plan">{student.membresia.tipo}</LabeledDataBox>
          <LabeledDataBox label="Vigencia">
            {formatMembershipCoverage(student.membresia.cubiertoHasta)}
          </LabeledDataBox>
          <LabeledDataBox label="Precio del plan">
            {formatCurrency(student.membresia.monto)}
          </LabeledDataBox>
        </div>
      )}
      {student.ultimoPago && (
        <div className="mt-1.5 flex flex-wrap items-center gap-2">
          <LabeledDataBox label="Monto del último pago">
            {formatCurrency(student.ultimoPago.monto)}
          </LabeledDataBox>
          <LabeledDataBox label="Pago registrado">
            {formatDate(student.ultimoPago.fechaPago)}
          </LabeledDataBox>
        </div>
      )}

      {/* Medical, payment, benefit, debt, and plan actions belong to the
          dedicated row entry points (issue #613), not this account editor. */}
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
  /** Issue #505: opens `MedicalRecordDialog` directly for this account. */
  onMedical: () => void;
  /** Issue #505: opens `PaymentsDialog` directly for this account. */
  onPayments: () => void;
}

/** `MembresiaCallbacks` (see its own doc comment) — forwarded unchanged to each student's edit panel. */
interface MemberEditDialogProps extends MembresiaCallbacks {
  account: MemberAccount;
  onClose: () => void;
}

const ALL_BACKEND_ROLES: BackendTipoRol[] = ["ADMINISTRADOR", "ENTRENADOR", "REPRESENTANTE", "ALUMNO"];


const ROLE_ICONS: Record<BackendTipoRol, typeof ShieldCheck> = {
  ADMINISTRADOR: ShieldCheck,
  ENTRENADOR: GraduationCap,
  REPRESENTANTE: Building2,
  ALUMNO: User,
};

/**
 * The trigger every row carries, at D5's THIRD level.
 *
 * It used to be `secondary` — `bg-paper` on a `line-2` border — which is the
 * skin D8 reserves for the one action that may stand beside the header's
 * primary. Drawn once per row on a paper table it is a box you can see and
 * cannot use: forty-five identical outlines down the page, none of them more
 * important than the row it belongs to. `tertiary` is distinguished by FILL
 * instead, which reads as a control without adding a forty-fifth line to the
 * grid — and it is the correct LEVEL, not just the quieter one.
 */
function EditAccountButton({
  account,
  onEdit,
}: Pick<AccountListItemProps, "account" | "onEdit">): React.ReactElement {
  return (
    <Button
      variant="secondary"
      size="sm"
      className="w-full !px-2"
      // Focus the trigger explicitly: the dialog restores focus to whatever was
      // focused at mount, and a mouse click does not reliably move focus to a
      // <button> on its own.
      onClick={(event) => {
        event.currentTarget.focus();
        onEdit();
      }}
      aria-label={`Editar ${account.nombres} ${account.apellidos}`}
    >
      Editar
    </Button>
  );
}

/**
 * Issue #505: direct entry point into `PaymentsDialog` — no need to open
 * `EditAccountButton`'s dialog first and scroll past roles/estado to reach
 * the membership/payment forms. Same trigger level, size and
 * focus-before-open pattern as `EditAccountButton`.
 */
function PaymentsAccessButton({
  account,
  onPayments,
}: Pick<AccountListItemProps, "account" | "onPayments">): React.ReactElement {
  return (
    <Button
      variant="secondary"
      size="sm"
      className="w-full !px-2"
      onClick={(event) => {
        event.currentTarget.focus();
        onPayments();
      }}
      aria-label={`Pagos de ${account.nombres} ${account.apellidos}`}
    >
      <Wallet size={ICON.sm} strokeWidth={1.5} aria-hidden="true" />
      Pagos
    </Button>
  );
}

/** Fixed width of one action slot, so rows with and without a menu stay aligned. */
const ROW_ACTION_SLOT = "w-20";

/**
 * A row's actions: ONE primary button plus an overflow menu.
 *
 * The row used to repeat three buttons (Ficha médica, Pagos, Editar) on every
 * account. Pagos stays visible because registering and regularising payments
 * is the recurring task an admin comes to this list for; editing an account
 * and reading a medical record are occasional, so they live in the "Más
 * acciones para <nombre>" menu. The representative's own row has no student to
 * show a ficha or payments for, so Editar is its only action and stays as the
 * visible button, with no menu.
 */
function AccountRowActions({
  account,
  showStudentActions,
  onEdit,
  onMedical,
  onPayments,
}: AccountListItemProps & { showStudentActions: boolean }): React.ReactElement {
  const fullName = `${account.nombres} ${account.apellidos}`;

  // Every row draws the same two slots at the same width, so the buttons line
  // up down the column. The representative's row has nothing to put in the
  // menu slot; it stays an empty, aria-hidden spacer instead of shifting the
  // primary slot to the right.
  if (!showStudentActions) {
    return (
      <>
        <div className={ROW_ACTION_SLOT}>
          <EditAccountButton account={account} onEdit={onEdit} />
        </div>
        <div className={ROW_ACTION_SLOT} aria-hidden="true" />
      </>
    );
  }

  return (
    <>
      <div className={ROW_ACTION_SLOT}>
        <PaymentsAccessButton account={account} onPayments={onPayments} />
      </div>
      <div className={ROW_ACTION_SLOT}>
      <RowActionsMenu
        label={`Más acciones para ${fullName}`}
        triggerLabel="Más"
        items={[
          {
            label: `Editar ${fullName}`,
            icon: <Pencil size={ICON.sm} strokeWidth={1.5} aria-hidden="true" />,
            onSelect: onEdit,
          },
          {
            label: `Ficha médica de ${fullName}`,
            icon: <Stethoscope size={ICON.sm} strokeWidth={1.5} aria-hidden="true" />,
            onSelect: onMedical,
          },
        ]}
      />
      </div>
    </>
  );
}

/** One account as a table row (`sm` and up). */
function AccountRow({ account, onEdit, onMedical, onPayments }: AccountListItemProps): React.ReactElement {
  const statusBadge = getAccountStatusBadge(account);
  const accountBadge = getAccountStateBadge(account);
  const debtSummary = getDebtSummary(account);
  const fullName = `${account.nombres} ${account.apellidos}`;
  // Issue #1199/#1211: the representative/payer's own row (badge
  // "Representante", "—" in "Representado por") has no student to show a
  // ficha médica or a payment for — hiding these keeps "Editar" as the only
  // action offered. A represented student's own row is never affected, with
  // or without a membership on file — see `isRepresentativePersonaRow`.
  const showStudentActions = !isRepresentativePersonaRow(account);

  return (
    <TableRow>
      {/* D9's shared identity cell, not a second drawing of the same layout.
          Issue #388 removed the row's disclosure along with the group it used
          to expand: `estudiantes` is now always this exact person, so there is
          no relationship left to name or count here. Issue #1132 closed the
          "no real roles" gap `lib/server/members-adapter.ts`'s module doc
          used to document — `accountDisplayRoles` folds the bulk-fetched
          roles with the membership-derived "jugador" signal (see its own doc
          comment in `members-utils.ts`). */}
      <TableCell>
        <IdentityCell name={fullName} roles={accountDisplayRoles(account)} />
        {/* ADMA-03: on a tablet the column below does not fit, so the name moves under the person. */}
        {account.representadoPor ? (
          <p className="mt-1 text-2xs text-ink-3 lg:hidden">Representado por {account.representadoPor}</p>
        ) : null}
      </TableCell>
      <TableCell className="hidden lg:table-cell">{account.representadoPor ?? "—"}</TableCell>
      <TableCell type="badge">
        <Badge tone={statusBadge.tone}>{statusBadge.label}</Badge>
        {/* ADMA-24: how much is owed and since when, without opening the ficha. */}
        {debtSummary ? <p className="mt-1 text-2xs text-ink-3">{debtSummary}</p> : null}
      </TableCell>
      {/* Issue #869: `Cuenta` — `Usuario.activo`, never derived from the
          `Membresía` badge to its left. */}
      <TableCell type="badge">
        <Badge tone={accountBadge.tone}>{accountBadge.label}</Badge>
      </TableCell>
      <TableCell type="action">
        <div className="flex items-center justify-end gap-1.5">
          <AccountRowActions
            account={account}
            showStudentActions={showStudentActions}
            onEdit={onEdit}
            onMedical={onMedical}
            onPayments={onPayments}
          />
        </div>
      </TableCell>
    </TableRow>
  );
}

/** The same account below `sm`, where a five-column table cannot fit. */
function AccountCard({ account, onEdit, onMedical, onPayments }: AccountListItemProps): React.ReactElement {
  const statusBadge = getAccountStatusBadge(account);
  const accountBadge = getAccountStateBadge(account);
  const debtSummary = getDebtSummary(account);
  // Issue #1199: same rule as `AccountRow` above.
  const showStudentActions = !isRepresentativePersonaRow(account);

  return (
    <DataRow
      name={`${account.nombres} ${account.apellidos}`}
      meta={
        <>
          <DataBox>{account.telefono}</DataBox>
          {account.email ? (
            <DataBox className="max-w-[10rem] truncate">{account.email}</DataBox>
          ) : null}
          {/* Same omit-rather-than-invent convention as `email` above: a
              self-managed account has nothing to say here, so it says
              nothing rather than printing a placeholder. */}
          {account.representadoPor ? (
            <DataBox className="h-auto max-w-full whitespace-normal break-words">
              Representado por {account.representadoPor}
            </DataBox>
          ) : null}
        </>
      }
      status={
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge tone={statusBadge.tone}>{statusBadge.label}</Badge>
          {debtSummary ? <span className="text-2xs text-ink-3">{debtSummary}</span> : null}
          {/* Issue #869: `Cuenta`, the mobile row equivalent of the desktop
              table's own column — never derived from the badge above. */}
          <Badge tone={accountBadge.tone}>{accountBadge.label}</Badge>
        </div>
      }
      actions={
        <>
          <AccountRowActions
            account={account}
            showStudentActions={showStudentActions}
            onEdit={onEdit}
            onMedical={onMedical}
            onPayments={onPayments}
          />
        </>
      }
    />
  );
}

function MemberEditDialog({
  account,
  onClose,
  ...membresiaCallbacks
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
    changed,
    selectRole,
    toggleEstado,
  } = useAccountRolesAndStatus(Number(account.id));
  // ADMA-08: switching the account off locks the person out, so it asks first.
  const [deactivateConfirmOpen, setDeactivateConfirmOpen] = useState(false);
  // ADMA-12: the identity section's own edits.
  const [identityDirty, setIdentityDirty] = useState(false);
  const statusBadge = getAccountStatusBadge(account);
  // Issue #869: the header badge below reads `account.accountState` (from
  // the list's own bulk fetch), never `activo` from `useAccountRolesAndStatus`
  // — that hook's placeholder defaults to `true` and its fetch fails outright
  // for a persona with no `Usuario` (`RolServicio._obtener_usuario_de_persona`),
  // which is exactly the "summary hardcoded as active" the issue reports. The
  // "Estado de la cuenta" toggle further down still needs the hook: it is the
  // control that MUTATES the state, not a read of it.
  const personaId = Number(account.id);

  // Issue #460: `LinkRepresentativeSection` only makes sense for a minor —
  // an adult links themselves through their own account (INS-2), and the
  // endpoint this reuses (`vincular-representado`) already rejects an adult
  // cédula with the same generic message it uses for "doesn't exist"
  // (`_resolver_representado_elegible`). `account.estudiantes[0]` is always
  // THIS persona (issue #388: one row per persona, not per representante's
  // dependents — see `buildMemberAccounts`'s own doc comment).
  const primaryStudent = account.estudiantes[0];
  const rawStudentAge = primaryStudent?.fechaNacimiento
    ? calculatePersonAge(primaryStudent.fechaNacimiento, clubToday())
    : NaN;
  const isMinorStudent = !Number.isNaN(rawStudentAge) && rawStudentAge < 18;

  // Issue #314 (K6 hallazgo #16): otorgar o quitar el rol ADMINISTRADOR daba
  // control total del club (o se lo quitaba) al primer clic, sin ningún paso
  // intermedio — el bloque "Roles" ya avisa que "se guarda al instante" pero
  // no distingue esa palabra de las otras tres. Solo ADMINISTRADOR gana esta
  // compuerta: es la única de las cuatro con ese efecto, y las otras siguen
  // siendo reversibles con un clic, como antes.
  const accountFullName = `${account.nombres} ${account.apellidos}`;
  // ADMA-07: the role waiting on that confirmation, if any. Picking Admin
  // grants it; picking anything else while holding Admin revokes it.
  const [pendingRole, setPendingRole] = useState<BackendTipoRol | null>(null);
  const grantingAdmin = pendingRole === "ADMINISTRADOR";
  // H3: the radios only move this pending choice. Native radio groups change
  // selection on arrow keys, so committing from the change event silently
  // re-roled an account while a keyboard user was just moving through the
  // options. The change is committed only by «Guardar rol».
  const [draftRole, setDraftRole] = useState<BackendTipoRol | null>(null);
  const shownRole = draftRole ?? roles[0];
  // A legacy multi-role account counts as different from any single pick.
  const roleDirty = draftRole !== null && !(roles.length === 1 && roles[0] === draftRole);
  const commitRole = async (role: BackendTipoRol): Promise<void> => {
    // On success `roles` now equals the pick; on failure the hook rolled
    // `roles` back and the error is shown. Either way the draft is spent.
    await selectRole(role);
    setDraftRole(null);
  };

  // Native <dialog> shown via showModal(): the browser traps Tab focus and
  // renders the ::backdrop for us, so no manual focus trap is needed (unlike
  // ConfirmDialog.tsx's older role="dialog" div convention). Escape/backdrop/
  // focus-restore wiring lives in `useNativeDialog` (issue #505) — shared with
  // the two new direct entry points, `MedicalRecordDialog` and `PaymentsDialog`.
  const { dialogRef, closeButtonRef, shellStyle } = useNativeDialog(onClose);

  return (
    <>
      {createPortal(
          <dialog
            ref={dialogRef}
            aria-modal="true"
            aria-labelledby={`edit-member-title-${account.id}`}
            onCancel={(event) => event.preventDefault()}
            className={NATIVE_DIALOG_WIDE_SHELL_CLASS}
            style={shellStyle}
          >
            <MemberDialogHeader
              account={account}
              titleId={`edit-member-title-${account.id}`}
              purpose="Editar cuenta"
              closeButtonRef={closeButtonRef}
              onClose={onClose}
              liveAccountState={changed ? (activo ? "active" : "inactive") : undefined}
              liveRoles={changed ? roles : undefined}
            />

            {/* Scrollable body. Four groups, each declaring how it persists:
                identity needs a button, roles and estado save themselves, and
                each student's membership/ficha médica has its own save. */}
            <div className={NATIVE_DIALOG_BODY_CLASS}>
              {/* Two columns from `lg`: what is edited and saved by hand on the
                  left, what saves itself on the right — so the contract in each
                  header also reads as a position. Stacks on a phone. */}
              <div className="grid gap-section lg:grid-cols-2 lg:items-start">
              <div className="grid min-w-0 content-start gap-section">
              <ModalSection title="Datos de la cuenta" saveMode="manual" dirty={identityDirty}>
                <AccountInfoSection account={account} onDirtyChange={setIdentityDirty} />
              </ModalSection>

              {/* Issue #460: the only in-app way to assign a representante to
                  a minor used to be knowing the endpoint existed and calling
                  it directly — this panel had roles, estado, and per-student
                  membership/ficha médica, and no field for it.

                  #1133 split the two cases: a minor with NO representative
                  yet has nothing to conflict with, so it keeps the original
                  `vincular-representado` desk flow (`LinkRepresentativeSection`).
                  A minor who ALREADY has one goes through the atomic
                  `reasignar-representante` command instead
                  (`ReassignRepresentativeSection`), which knows the CURRENT
                  link and lets the backend reject a stale one (409) instead
                  of silently overwriting it. */}
              {isMinorStudent && (
                <ModalSection
                  title="Representante legal"
                  saveMode="manual"
                  icon={<Building2 size={ICON.sm} strokeWidth={1.5} className="text-ink-3" aria-hidden="true" />}
                >
                  {account.representadoPor && account.representadoPorId ? (
                    <ReassignRepresentativeSection
                      personaId={personaId}
                      personaNombreCompleto={accountFullName}
                      representanteActualId={account.representadoPorId}
                      representanteActualNombre={account.representadoPor}
                      onReasignado={membresiaCallbacks.onMembresiaChanged}
                    />
                  ) : (
                    <LinkRepresentativeSection
                      studentCedula={primaryStudent?.cedula}
                      currentRepresentativeName={account.representadoPor}
                      onLinked={membresiaCallbacks.onMembresiaChanged}
                    />
                  )}
                </ModalSection>
              )}

              {/* Issue #1137: independence stopped being self-service — it is
                  now a PRESENCIAL command an ADMINISTRADOR runs from here,
                  never from `/student`. Only offered to a represented ADULT:
                  a represented minor is exactly the case the backend rejects
                  (`independizar_presencial`'s own doc comment), so this
                  never shows beside "Representante legal" above for the
                  same student. */}
              {account.representadoPor && !isMinorStudent && (
                <ModalSection
                  title="Independencia"
                  saveMode="manual"
                  icon={<UserMinus size={ICON.sm} strokeWidth={1.5} className="text-ink-3" aria-hidden="true" />}
                >
                  <IndependizarSection
                    personaId={personaId}
                    personaNombreCompleto={accountFullName}
                    onIndependizado={membresiaCallbacks.onMembresiaChanged}
                  />
                </ModalSection>
              )}

              </div>

              <div className="grid min-w-0 content-start gap-section">
              <ModalSection title="Estado de la cuenta" saveMode="instant">
                <div className="flex flex-wrap items-center gap-3">
                  <button
                    type="button"
                    onClick={() => (activo ? setDeactivateConfirmOpen(true) : void toggleEstado())}
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
                    <LinkifiedText text={stateError} />
                  </p>
                )}
              </ModalSection>

              <ModalSection
                title="Roles"
                saveMode="manual"
                dirty={roleDirty}
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
                  <div
                    role="radiogroup"
                    aria-label="Rol de la cuenta"
                    className="grid grid-cols-2 gap-2"
                  >
                    {ALL_BACKEND_ROLES.map((role) => {
                      const selected = shownRole === role;
                      const isLoading = roleLoading === role;
                      const RoleIcon = ROLE_ICONS[role];
                      return (
                        // The audit found keyboard focus landing on nothing
                        // here: the real input was `sr-only` and the wrapping
                        // <label> carried no focus style — so tabbing through
                        // the dialog moved an invisible cursor. `focus-within`
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
                            type="radio"
                            name={`rol-${account.id}`}
                            checked={selected}
                            onChange={() => setDraftRole(role)}
                            disabled={roleLoading !== null || !rolesReady}
                            className="sr-only"
                          />
                          {/* Selection is a coal ring + the yellow ball dot,
                              never red — red is the primary CTA and
                              destructive actions only. */}
                          <span
                            aria-hidden="true"
                            className={`relative inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full border ${
                              selected ? "border-coal bg-coal" : "border-line-2 bg-white"
                            }`}
                          >
                            {selected && <span className="h-1.5 w-1.5 rounded-full bg-ball" />}
                          </span>
                        </label>
                      );
                    })}
                  </div>
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <Button
                      size="sm"
                      disabled={!roleDirty || roleLoading !== null || !rolesReady}
                      onClick={() => {
                        if (draftRole === null) return;
                        // Granting or revoking ADMINISTRADOR is a
                        // privilege change, not a label — it needs an
                        // explicit stop naming the effect (issue #314).
                        if (draftRole === "ADMINISTRADOR" || roles.includes("ADMINISTRADOR")) {
                          setPendingRole(draftRole);
                          return;
                        }
                        void commitRole(draftRole);
                      }}
                    >
                      {roleLoading !== null ? "Guardando…" : "Guardar rol"}
                    </Button>
                    <p className="text-xs text-ink-3">
                      Elija un rol y pulse «Guardar rol» para aplicarlo.
                    </p>
                  </div>
                  {roleError && (
                    <p className="mt-2 text-xs text-state-bad" role="alert">
                      <LinkifiedText text={roleError} />
                    </p>
                  )}
                </>
              </ModalSection>

              </div>
              </div>

              {/* Issue #1221: the personas THIS account represents
                  (`representanteId` pointing here), never this account's own
                  `estudiantes[0]` — see `members-adapter.ts#
                  buildMemberAccounts`'s doc comment. Hidden entirely for a
                  represented minor and for a self-managed adult with no
                  dependants, same "hide rather than show an empty card"
                  convention the rest of this dialog already follows. */}
              {account.dependientes && account.dependientes.length > 0 && (
                <ModalSection title="Estudiantes a cargo" saveMode="manual">
                  {/* A list of people, so it takes the same divider hairlines
                      every other list of people in the product uses — not
                      `DataRowList`'s own outer border, which would nest a
                      second box inside this section's card. */}
                  <ul className="divide-y divide-line">
                    {account.dependientes.map((estudiante) => (
                      <StudentEditPanel
                        key={estudiante.id}
                        student={estudiante}
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

            <ConfirmDialog
              open={deactivateConfirmOpen}
              variant="danger"
              title="Desactivar cuenta"
              message={`¿Desactivar la cuenta de ${accountFullName}? No podrá iniciar sesión hasta que la active de nuevo.`}
              confirmLabel="Desactivar"
              onConfirm={() => {
                setDeactivateConfirmOpen(false);
                void toggleEstado();
              }}
              onCancel={() => setDeactivateConfirmOpen(false)}
            />

            <ConfirmDialog
              open={pendingRole !== null}
              variant="danger"
              title={grantingAdmin ? "Otorgar el rol Admin" : "Quitar el rol Admin"}
              message={
                grantingAdmin
                  ? `Va a convertir a ${accountFullName} en Administrador. Va a tener control total del club: podrá gestionar pagos, cuentas, roles y datos de todos los socios.`
                  : `Va a quitarle el rol de Administrador a ${accountFullName}. Va a perder el control total del club: ya no va a poder gestionar pagos, cuentas, roles ni datos de otros socios.`
              }
              onConfirm={() => {
                const role = pendingRole;
                setPendingRole(null);
                if (role) void commitRole(role);
              }}
              onCancel={() => {
                setPendingRole(null);
                setDraftRole(null);
              }}
            />
          </dialog>,
          document.body,
        )}
    </>
  );
}

// ---------------------------------------------------------------------------
// List fill + rail
// ---------------------------------------------------------------------------

/** Rows the list card keeps drawn, so a short result does not leave a hole under it. */
const MIN_LIST_ROWS = 6;

/**
 * Placeholder rows below a short, single-page result. Purely decorative
 * (`aria-hidden`, not `<tr>`s), so row counts, roles and tests never see them;
 * they only keep the card as tall as a normal list instead of letting it
 * collapse to one or two rows beside a taller rail.
 */
function GhostRows({ shown }: { shown: number }): React.ReactElement | null {
  const missing = MIN_LIST_ROWS - shown;
  if (missing <= 0) return null;
  return (
    <div aria-hidden="true" data-testid="members-ghost-rows" className="hidden sm:block">
      {Array.from({ length: missing }, (_, index) => (
        <div key={index} className="flex h-[60px] items-center gap-3 border-t border-line px-4">
          <div className="h-9 w-9 rounded-full bg-sunken" />
          <div className="grid gap-1.5">
            <div className="h-2.5 w-40 rounded-full bg-sunken" />
            <div className="h-2 w-24 rounded-full bg-sunken/70" />
          </div>
        </div>
      ))}
    </div>
  );
}

const RAIL_ROW =
  "flex min-h-[44px] w-full items-center gap-3 rounded-ctl px-3 text-left text-sm text-ink transition-colors hover:bg-sunken";

function AttentionRow({
  label,
  count,
  tone,
}: {
  label: string;
  count: React.ReactNode;
  tone: "warn" | "neutral";
}): React.ReactElement {
  return (
    <>
      <span className="flex-1">{label}</span>
      <Badge tone={tone}>{count}</Badge>
      <ChevronRight size={ICON.sm} strokeWidth={1.5} className="shrink-0 text-ink-3" aria-hidden="true" />
    </>
  );
}

function MembersRail({
  stats,
  onFilter,
}: {
  stats: ReturnType<typeof buildMemberStats>;
  onFilter: (flag: MemberFilterFlag) => void;
}): React.ReactElement {
  return (
    <div className="grid content-start gap-page" data-testid="members-rail">
      <InfoPanel
        title="Requiere atención"
        className="border-state-warn/30"
      >
        <ul className="-mx-3 grid gap-1">
          <li>
            <Link href="/payments" className={RAIL_ROW}>
              <AttentionRow
                label="Pagos por validar"
                count={stats.pendingPayments}
                tone={stats.pendingPayments > 0 ? "warn" : "neutral"}
              />
            </Link>
          </li>
          <li>
            <button type="button" className={RAIL_ROW} onClick={() => onFilter("sin-emergencia")}>
              <AttentionRow
                label="Sin datos de emergencia"
                count={stats.sinDatosEmergencia}
                tone={stats.sinDatosEmergencia > 0 ? "warn" : "neutral"}
              />
            </button>
          </li>
        </ul>
        <p className="flex items-start gap-1.5 text-xs text-ink-3">
          <AlertTriangle size={ICON.sm} strokeWidth={1.5} className="mt-0.5 shrink-0" aria-hidden="true" />
          Sin datos de emergencia: no tiene representante ni ficha médica cargada.
        </p>
      </InfoPanel>

      <InfoPanel title="Cómo usar el listado">
        <p>Empiece por los pagos pendientes: filtre por «Pago pendiente» y valide cada uno.</p>
        <dl className="grid gap-2">
          <div>
            <dt className="font-semibold text-ink">Pagos</dt>
            <dd>Registrar un pago, regularizar deuda, cambiar de plan o suspender la membresía.</dd>
          </div>
          <div>
            <dt className="font-semibold text-ink">Editar</dt>
            <dd>Datos de la cuenta, estado (activa o inactiva) y roles.</dd>
          </div>
          <div>
            <dt className="font-semibold text-ink">Más</dt>
            <dd>Abre la ficha médica y el resto de acciones de la fila.</dd>
          </div>
        </dl>
        <dl className="grid gap-2 border-t border-line pt-3">
          <div className="flex items-center gap-2">
            <dt><Badge tone="ok">Activo</Badge></dt>
            <dd>Membresía al día.</dd>
          </div>
          <div className="flex items-center gap-2">
            <dt><Badge tone="warn">Pago pendiente</Badge></dt>
            <dd>Hay un pago por validar.</dd>
          </div>
          <div className="flex items-center gap-2">
            <dt><Badge tone="bad">Vencida</Badge></dt>
            <dd>Debe regularizar pagos.</dd>
          </div>
          <div className="flex items-center gap-2">
            <dt><Badge tone="neutral">Sin membresía</Badge></dt>
            <dd>Aún no tiene plan.</dd>
          </div>
        </dl>
      </InfoPanel>
    </div>
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
  /** At least one membership could not be read upstream — see `MembersResponse`. */
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  /**
   * Issue #505: the row now offers three direct entry points — Ficha médica,
   * Pagos, Editar — that each open their own dialog. One shared field (not
   * three independent id states) keeps the pre-existing "only one dialog at
   * a time" behavior: opening any of the three for any account replaces
   * whatever was open, the same way `editingAccountId` used to.
   */
  const [openDialog, setOpenDialog] = useState<{
    kind: "edit" | "medical" | "payments";
    accountId: string;
  } | null>(null);
  const [page, setPage] = useState(1);

  const toggleDialog = useCallback((kind: "edit" | "medical" | "payments", accountId: string) => {
    setOpenDialog((prev) => (prev?.kind === kind && prev.accountId === accountId ? null : { kind, accountId }));
  }, []);
  const closeDialog = useCallback(() => setOpenDialog(null), []);

  // `silent` refreshes the data WITHOUT flipping the page-level `loading` flag.
  // That flag gates the whole account list (see the `loading ? ... : ...` split
  // below), so raising it while the edit dialog is open unmounts the dialog and
  // discards every unsaved field in it. A refresh triggered from inside the
  // dialog — creating a membership — must never do that.
  const loadMembers = useCallback(async ({ silent = false } = {}): Promise<void> => {
    if (!silent) setLoading(true);
    setError(null);
    try {
      const { accounts: membersData } = await fetchMembers();
      setAccounts(membersData);
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

  const totalPages = useMemo(() => getTotalPages(filteredAccounts.length), [filteredAccounts]);
  const paginatedAccounts = useMemo(
    () => paginateAccounts(filteredAccounts, page),
    [filteredAccounts, page],
  );

  const findOpenAccount = (kind: "edit" | "medical" | "payments"): MemberAccount | null =>
    openDialog?.kind === kind
      ? (accounts.find((account) => account.id === openDialog.accountId) ?? null)
      : null;
  const editingAccount = findOpenAccount("edit");
  const medicalAccount = findOpenAccount("medical");
  const paymentsAccount = findOpenAccount("payments");

  return (
    <ProtectedRoute allowedRoles={["admin"]}>
      <AppShell
        back={<BackLink href="/dashboard" />}
        title="Miembros"
        subtitle="Las cuentas que pagan y los jugadores que tienen a cargo."
      >
        {error && (
          <ErrorState
            title="No se pudieron cargar los miembros"
            message={error}
            onRetry={() => void loadMembers()}
          />
        )}

        <div className={PAGE_RAIL}>
          <div className="grid min-w-0 content-start gap-page">
        {/* Search + filter chips. They used to sit loose on the canvas as two
            unrelated rows; `FilterPanel` frames them and fixes their order.
            Account creation is intentionally absent: new members use the
            public enrollment flow, while this screen remains focused on
            roles, account status, memberships, and payments. */}
        <FilterPanel
          label="Filtros de miembros"
          search={
            <SearchInput
              label="Buscar miembros"
              placeholder="Buscar por nombre o cédula…"
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
        {loading ? (
          <div className="card">
            <LoadingState label="Cargando miembros…" />
          </div>
        ) : filteredAccounts.length > 0 ? (
          <div className="card overflow-hidden">
            {/* Below `sm` the table used to hide Contacto/Estudiantes/Estado
                /Editar behind `hidden sm:table-cell`, leaving a one-column
                list with a second, duplicated edit button crammed under each
                name. A phone gets a real row per account instead — same data,
                one edit trigger, nothing hidden — through the same `DataRow`
                primitive every other list of people in the product uses,
                rather than a hand-rolled `<li>` card. Divider hairlines are
                applied directly (instead of via `DataRowList`) because this
                list already sits inside the card's own border below — a
                second border here would nest a box inside a box.

                The mobile/desktop split itself, and the footer pager below,
                are `ResponsiveListTable`'s shared shell — see that
                component's doc comment for why the surrounding card and the
                loading/empty states stayed page-owned. */}
            <ResponsiveListTable
              items={paginatedAccounts}
              getKey={(account) => account.id}
              header={
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3 text-xs text-ink-2">
                  <p role="status" aria-label="Resultados mostrados">
                    {filteredAccounts.length}{" "}
                    {filteredAccounts.length === 1 ? "resultado mostrado" : "resultados mostrados"}
                  </p>
                </div>
              }
              renderCard={(account) => (
                <AccountCard
                  account={account}
                  onEdit={() => toggleDialog("edit", account.id)}
                  onMedical={() => toggleDialog("medical", account.id)}
                  onPayments={() => toggleDialog("payments", account.id)}
                />
              )}
              renderRow={(account) => (
                <AccountRow
                  account={account}
                  onEdit={() => toggleDialog("edit", account.id)}
                  onMedical={() => toggleDialog("medical", account.id)}
                  onPayments={() => toggleDialog("payments", account.id)}
                />
              )}
              tableHead={
                <TableRow>
                  {/* "Miembro", not "Responsable de pago" — issue #388 made
                      the person the row's unit, not the paying root. A
                      represented person's row holds THEIR identity, not
                      their representative's; who pays for them is the
                      adjacent "Representado por" column, not this one. */}
                  <TableHeaderCell>Miembro</TableHeaderCell>
                  <TableHeaderCell className="hidden lg:table-cell">Representado por</TableHeaderCell>
                  <TableHeaderCell type="badge">Membresía</TableHeaderCell>
                  {/* Issue #869: account (login) state, separate from
                      Membresía to its left — never derived from it. */}
                  <TableHeaderCell type="badge">Cuenta</TableHeaderCell>
                  {/* Named for what the column HOLDS, not for the button
                      inside it — a column called "Editar" is a heading that
                      reads the label of the control under it back to you.
                      D9's rule of words also forbids a label deducible from
                      another, and every trigger in this column already
                      announces itself as "Editar <nombre>".

                      Kept off the screen rather than renamed in place: over
                      a column of 32px triggers a printed heading is one more
                      word to skip past, and "Acciones" tells a sighted
                      reader nothing the buttons underneath do not. It stays
                      in the accessibility tree because a `<th>` with no name
                      is a column a screen reader announces as blank. */}
                  <TableHeaderCell type="action">
                    <span className="sr-only">Acciones</span>
                  </TableHeaderCell>
                </TableRow>
              }
              // INSIDE the card, not after it. This pager used to be a sibling
              // of the card it paginates, so it floated on the canvas while
              // every other list in the product carried its pager welded to
              // the foot of the card. The `footer` variant owns that
              // placement now, so the move is a nesting change and no
              // classes travel with it.
              footer={
                totalPages > 1 ? (
                  <Pagination
                    page={page}
                    totalPages={totalPages}
                    onPageChange={setPage}
                    totalItems={filteredAccounts.length}
                    pageSize={MEMBERS_PAGE_SIZE}
                    itemNoun="miembro"
                    variant="footer"
                  />
                ) : undefined
              }
            />
            {totalPages <= 1 && <GhostRows shown={paginatedAccounts.length} />}
          </div>
        ) : null}

        {/* D11b measured this one: 25% of the viewport — 227px — went dead the
            moment a search found nobody, because three short lines kept their
            own height and the rest of the column stayed bare canvas underneath.
            `fill` stretches the card to the column it stands in, so the surplus
            becomes air inside the surface instead of a hole below it. The three
            parts D11 requires are untouched. */}
        {!loading && filteredAccounts.length === 0 && (
          <EmptyState
            fill
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
          </div>

          <MembersRail
            stats={stats}
            onFilter={setActiveFlag}
          />
        </div>

        {/* One dialog for the whole page, keyed so switching accounts remounts
            it with fresh state. Rendering it per row would portal two copies
            into the document, since each account exists twice in the DOM (a
            table row and a mobile card). */}
        {editingAccount && (
          <MemberEditDialog
            key={editingAccount.id}
            account={editingAccount}
            onClose={closeDialog}
            onMembershipCreated={() => void loadMembers({ silent: true })}
            onDebtRegularized={() => void loadMembers({ silent: true })}
            onMembresiaChanged={() => void loadMembers({ silent: true })}
            onPaymentRegistered={() => void loadMembers({ silent: true })}
          />
        )}
        {/* Issue #505: direct entry points, mutually exclusive with the
            dialog above and with each other via the shared `openDialog`
            state — opening any of the three closes whichever was open. */}
        {medicalAccount && (
          <MedicalRecordDialog key={medicalAccount.id} account={medicalAccount} onClose={closeDialog} />
        )}
        {paymentsAccount && (
          <PaymentsDialog
            key={paymentsAccount.id}
            account={paymentsAccount}
            onClose={closeDialog}
            onMembershipCreated={() => void loadMembers({ silent: true })}
            onDebtRegularized={() => void loadMembers({ silent: true })}
            onMembresiaChanged={() => void loadMembers({ silent: true })}
            onPaymentRegistered={() => void loadMembers({ silent: true })}
          />
        )}
      </AppShell>
    </ProtectedRoute>
  );
}
