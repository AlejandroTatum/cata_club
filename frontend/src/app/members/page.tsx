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
import ConfirmDialog from "@/components/ConfirmDialog";
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
  IdentityCell,
  LoadingState,
  Pagination,
  ResponsiveListTable,
  SearchInput,
  STAT_GRID,
  StatCard,
  StatTrack,
  TableCell,
  TableHeaderCell,
  TableRow,
} from "@/components/ui";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/contexts/ToastContext";
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
  AlertTriangle,
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
import { calculatePersonAge } from "@/lib/identity-validation";
import { clubToday } from "@/lib/club-date";
import MedicalRecordEditor from "./MedicalRecordEditor";
import AccountInfoSection from "./AccountInfoSection";
import { useAccountRolesAndStatus, ROLE_LABELS } from "./useAccountRolesAndStatus";
import CreateMembershipForm from "./CreateMembershipForm";
import RegisterPaymentForm from "./RegisterPaymentForm";
import RegularizarDeudaForm from "./RegularizarDeudaForm";
import SuspenderReactivarForm from "./SuspenderReactivarForm";
import CambiarPlanForm from "./CambiarPlanForm";
import BeneficioSection from "./BeneficioSection";

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
// the account row.
//
// La fila volvió a desplegarse (`AccountRow`), así que conviene ser exacto: lo
// que despliega son los NOMBRES de los representados y nada más. Todo lo
// editable — ficha médica, membresía, pagos — sigue viviendo solo en el modal,
// que es de donde se lo sacó.
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
  /**
   * Called after a debt regularization is recorded (issue #284) so the page
   * can refetch and show the remaining debt — same silent-refresh semantics
   * as `onMembershipCreated` (never unmount the open dialog).
   */
  onDebtRegularized: () => void;
  /**
   * Called after a suspend/reactivate/cambiar-plan write (issue #400,
   * criterios 1/3) — same silent-refresh semantics as the two callbacks
   * above. All three of these callbacks currently resolve to the exact same
   * `loadMembers` call at the page level; they stay separate props (rather
   * than reusing `onDebtRegularized`) because each write flow owns its own
   * named contract, same convention this file already uses for the other
   * two.
   */
  onMembresiaChanged: () => void;
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

function StudentEditPanel({
  student,
  onMembershipCreated,
  onDebtRegularized,
  onMembresiaChanged,
}: StudentRowProps): React.ReactElement {
  const [showMedical, setShowMedical] = useState(false);

  const personaId = Number(student.id);
  const rawAge = student.fechaNacimiento
    ? calculatePersonAge(student.fechaNacimiento, clubToday())
    : NaN;
  const age = Number.isNaN(rawAge) ? null : rawAge;

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
            {formatMembershipPeriod(student.membresia.fechaInicio, student.membresia.fechaFin)}
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

      {/* Beneficio del club attaches to the PERSONA, not the membership
          (issue #398) — shown regardless of whether the student currently
          has a membresia, unlike the two forms below it. */}
      <BeneficioSection personaId={personaId} />

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
          <RegularizarDeudaForm
            membresiaId={Number(student.membresia.id)}
            montoMensual={student.membresia.monto ?? 0}
            esGratuidadFamiliar={student.membresia.esGratuidadFamiliar}
            onRegularized={onDebtRegularized}
          />
          {/* Issue #400, criterio 3: solo administración suspende/reactiva
              (texto explícito del issue) — el componente decide por sí solo
              si corresponde "Suspender" o "Reactivar" según el estado
              actual, y no se ofrece ninguno de los dos desde VENCIDA. */}
          <SuspenderReactivarForm
            membresiaId={Number(student.membresia.id)}
            estado={student.membresia.estado}
            onChanged={onMembresiaChanged}
          />
          {/* Issue #400, criterio 1: cambio de plan PROSPECTIVO sobre esta
              misma membresía — la cobertura ya pagada no se toca. */}
          <CambiarPlanForm
            membresiaId={Number(student.membresia.id)}
            onChanged={onMembresiaChanged}
          />
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
  onDebtRegularized: () => void;
  onMembresiaChanged: () => void;
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
function EditAccountButton({ account, onEdit }: AccountListItemProps): React.ReactElement {
  return (
    <Button
      variant="tertiary"
      size="sm"
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
 * Issue #362's per-row signal: no legal representative at all AND no ficha
 * médica (`MemberAccount.sinDatosEmergencia`, computed in
 * `members-adapter.ts`). Same icon+text idiom as every other inline warning
 * in the product (`wizard-fields.tsx`, `ErrorState.tsx`) — `text-state-warn`
 * paired with `AlertTriangle`, never a bespoke color or shape.
 */
function EmergencyDataWarning(): React.ReactElement {
  return (
    <span className="flex items-center gap-1 text-2xs font-semibold text-state-warn">
      <AlertTriangle size={ICON.sm} strokeWidth={2} className="shrink-0" aria-hidden="true" />
      Sin datos de emergencia
    </span>
  );
}

/** One account as a table row (`sm` and up). */
function AccountRow({ account, onEdit }: AccountListItemProps): React.ReactElement {
  const statusBadge = getAccountStatusBadge(account);
  const fullName = `${account.nombres} ${account.apellidos}`;

  return (
    <TableRow>
      {/* D9's shared identity cell, not a second drawing of the same layout.
          Issue #388 removed the row's disclosure along with the group it used
          to expand: `estudiantes` is now always this exact person, so there is
          no relationship left to name or count here. `account.role` is still
          not a role — see `lib/server/members-adapter.ts`'s module doc for why
          — so this cell draws the name and nothing else; the account's real
          roles are read one account at a time, in the edit dialog. */}
      <TableCell>
        <IdentityCell name={fullName} />
        {account.sinDatosEmergencia ? (
          <div className="mt-1">
            <EmergencyDataWarning />
          </div>
        ) : null}
      </TableCell>
      <TableCell>{account.representadoPor ?? "—"}</TableCell>
      <TableCell type="badge">
        <Badge tone={statusBadge.tone}>{statusBadge.label}</Badge>
      </TableCell>
      <TableCell type="action">
        <EditAccountButton account={account} onEdit={onEdit} />
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
          <DataBox>{account.telefono}</DataBox>
          {account.email ? (
            <DataBox className="max-w-[10rem] truncate">{account.email}</DataBox>
          ) : null}
          {/* Same omit-rather-than-invent convention as `email` above: a
              self-managed account has nothing to say here, so it says
              nothing rather than printing a placeholder. */}
          {account.representadoPor ? (
            <DataBox>Representado por {account.representadoPor}</DataBox>
          ) : null}
          {account.sinDatosEmergencia ? <EmergencyDataWarning /> : null}
        </>
      }
      status={<Badge tone={statusBadge.tone}>{statusBadge.label}</Badge>}
      actions={<EditAccountButton account={account} onEdit={onEdit} />}
    />
  );
}

function MemberEditDialog({
  account,
  onClose,
  onMembershipCreated,
  onDebtRegularized,
  onMembresiaChanged,
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

  // Issue #314 (K6 hallazgo #16): otorgar o quitar el rol ADMINISTRADOR daba
  // control total del club (o se lo quitaba) al primer clic, sin ningún paso
  // intermedio — el bloque "Roles" ya avisa que "se guarda al instante" pero
  // no distingue esa palabra de las otras tres. Solo ADMINISTRADOR gana esta
  // compuerta: es la única de las cuatro con ese efecto, y las otras siguen
  // siendo reversibles con un clic, como antes.
  const [adminConfirmOpen, setAdminConfirmOpen] = useState(false);
  const accountFullName = `${account.nombres} ${account.apellidos}`;
  const grantingAdmin = !roles.includes("ADMINISTRADOR");

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
                  {/* DESIGN.md's `title` step — Graduate at 20px, uppercase,
                      weight 400 — because this IS the dialog's title: the
                      element `aria-labelledby` points at. The case is a
                      `text-transform`, so the accessible name stays the person's
                      name as written. `tracking-flat` cancels the -0.02em
                      `text-lg` carries for Barlow's lowercase.

                      Measured cost, since the line truncates: at 20px the face
                      runs ~35% wider than Barlow-800 — "María González" is
                      177.2px against 131.6px, and a full four-part name 391.7px
                      against 295.5px. The dialog gives this block ~450px at
                      `max-w-2xl`, so nothing is cut on a desktop; below ~420px
                      viewport width a two-part name starts to ellipsize where
                      Barlow just fit. The full name is never lost — it is in the
                      row behind and in the identity fields below. */}
                  <h2
                    id={`edit-member-title-${account.id}`}
                    className="truncate font-display text-lg uppercase leading-tight tracking-flat text-ink"
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
                            onChange={() => {
                              // ADMINISTRADOR is the one role whose grant/revoke
                              // is a privilege change, not a label — it needs an
                              // explicit stop naming the effect (issue #314).
                              if (role === "ADMINISTRADOR") {
                                setAdminConfirmOpen(true);
                                return;
                              }
                              void toggleRole(role);
                            }}
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
                        onDebtRegularized={onDebtRegularized}
                        onMembresiaChanged={onMembresiaChanged}
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
              open={adminConfirmOpen}
              variant="danger"
              title={grantingAdmin ? "Otorgar el rol Admin" : "Quitar el rol Admin"}
              message={
                grantingAdmin
                  ? `Va a convertir a ${accountFullName} en Administrador. Va a tener control total del club: podrá gestionar pagos, cuentas, roles y datos de todos los socios.`
                  : `Va a quitarle el rol de Administrador a ${accountFullName}. Va a perder el control total del club: ya no va a poder gestionar pagos, cuentas, roles ni datos de otros socios.`
              }
              onConfirm={() => {
                setAdminConfirmOpen(false);
                void toggleRole("ADMINISTRADOR");
              }}
              onCancel={() => setAdminConfirmOpen(false)}
            />
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
  const { showInfo } = useToast();
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

  // #319 hallazgo #68: `ProtectedRoute` already bounces a non-admin session
  // away, but silently — the URL changed and nothing said why. Same pattern
  // as the medical-record minor bounce (#315 hallazgo #69): a toast at the
  // landing spot names the reason instead of leaving a mute redirect.
  useEffect(() => {
    if (isLoading || !session || session.user.role === "admin") return;
    showInfo("No tiene permiso para acceder a esa sección.");
  }, [isLoading, session, showInfo]);

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
        // D11c: the subtitle says WHAT this screen is, in one line, and
        // everything explaining HOW it works lives behind "Ver ayuda" — which
        // is why the note about the 200-record cap is not repeated here.
        subtitle="Las cuentas que pagan y los jugadores que tienen a cargo."
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
            made four neutral counts read as four alerts.

            D7 asks these four to stop wearing one shape for four different
            jobs. The RULE OF THE SHOULDER gives the coal tile to the one thing
            that asks somebody to come and do it — payments waiting to be
            validated is a queue of work; the other three report a state of the
            world — and only to that one, because a shoulder on all four marks
            nothing. The RULE OF SHAPE gives the bar to the one figure that is
            a proportion.

            The two counts stay quiet, and that is a finding rather than a
            preference: `MemberAccount` carries id, role, name, phone and
            students, and nothing anywhere on this screen is dated at account
            or student level. There is no "+6 this month" to draw, so none is
            drawn. */}
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
                : // The count itself already sits in the "Estudiantes" tile
                  // right beside this one — repeating it here just echoed that
                  // figure. The population it's measured against still has to
                  // be named, because it is students, not accounts.
                  //
                  // The bar is what carries the DENOMINATOR now: 21 out of 69
                  // and 21 out of 25 are the same tile until something on it
                  // takes the shape of a proportion, and a bar says which one
                  // without reprinting the neighbour's own figure.
                  //
                  // No bar when the upstream lookup degraded: a share of an
                  // unreadable numerator would draw at 0%, which is exactly
                  // the "0 is not the same as unknown" lie the em dash above
                  // exists to avoid.
                  <span className="flex flex-col gap-y-field">
                    <StatTrack value={stats.activeMemberships} total={stats.totalStudents} />
                    <span>de los estudiantes</span>
                  </span>
            }
          />
          {/* The only tile on this row that is a pile of work somebody has to
              clear. `hot` also spends the ball dot on its foot line, which is
              D7's "pie con punto de estado": a bare 15 is neither good news
              nor bad, and "por validar" is what makes it a queue. */}
          <StatCard
            label="Pagos pendientes"
            value={stats.pendingPayments}
            hint="por validar"
            variant="hot"
          />
          {/* Issue #362. `default` variant, not `hot`: `hot` is reserved for
              the one tile that is a queue of work to clear
              (`StatCard.tsx`'s own doc comment), and this is a state of the
              roster, not a queue — the same reasoning that keeps "Cuentas"
              and "Estudiantes" quiet above. */}
          <StatCard
            label="Sin datos de emergencia"
            value={stats.sinDatosEmergencia}
            hint="sin representante ni ficha médica"
          />
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
          // D11c — "la ayuda no vive suelta". This used to be a bare child of
          // the canvas, in a band of its own between the panel and the table,
          // holding itself there with a margin no other block in the column
          // speaks. What it opens is a caveat about what the search can REACH,
          // so it belongs to the block that searches; and because the panel is
          // the one part of the screen drawn in every state, the caveat is
          // still there in the case that needs it most — a search that found
          // nobody, where the reason may well be the cap itself.
          help={
            <ContextualHelp title="Cómo funciona el listado">
              {/* Issue #388 rewrote both bullets below. La fila ya no es un
                  grupo: cada persona representada dejó de vivir anidada
                  dentro de la fila de su representante y pasó a tener la
                  suya propia, así que la primera viñeta ya no puede hablar de
                  desplegar una fila para leer nombres — no hay nada que
                  desplegar. La segunda viñeta describía `getAccountStatusBadge`
                  resumiendo a TODOS los estudiantes de una cuenta en una sola
                  insignia con el MEJOR estado; ese cálculo ya no existe
                  porque cada fila es una sola persona. */}
              <ul className="flex flex-col gap-field">
                <li>
                  Cada fila es una <b className="font-semibold text-ink">persona</b>: su nombre,
                  su membresía y su estado de pago. Cuando alguien más paga por ella, la fila lo
                  dice en «Representado por».
                </li>
                <li>
                  El estado de la fila es el de esa persona, y de nadie más: no se mezcla con el
                  de quien la representa ni con el de otras personas a cargo de la misma cuenta.
                </li>
                {/* "Registros", no "personas": el tope es de la consulta de
                    origen, y el listado sale de traducir esos registros uno a
                    uno, así que ya coinciden en cantidad. Y el buscador filtra
                    sobre lo ya traído (`filterAccounts` corre en el cliente),
                    de modo que la ayuda no puede prometer que buscar alcance
                    para traer a alguien que quedó fuera del tope. */}
                <li>
                  El listado se arma con hasta {MEMBERS_AGGREGATE_LIMIT} registros de origen y no
                  confirma que se hayan cargado todos los miembros. El buscador filtra solo sobre lo
                  ya traído — por nombre de la persona, su correo o el nombre de quien la
                  representa —, así que si no encuentra a alguien es probable que haya quedado
                  fuera de ese tope.
                </li>
              </ul>
            </ContextualHelp>
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
                  {aggregateIsCapped && (
                    <p role="alert" className="max-w-md text-state-bad">
                      La fuente devuelve hasta {MEMBERS_AGGREGATE_LIMIT} registros; este listado puede estar
                      incompleto.
                    </p>
                  )}
                </div>
              }
              renderCard={(account) => (
                <AccountCard account={account} onEdit={() => toggleEditModal(account.id)} />
              )}
              renderRow={(account) => (
                <AccountRow account={account} onEdit={() => toggleEditModal(account.id)} />
              )}
              tableHead={
                <TableRow>
                  {/* "Miembro", not "Responsable de pago" — issue #388 made
                      the person the row's unit, not the paying root. A
                      represented person's row holds THEIR identity, not
                      their representative's; who pays for them is the
                      adjacent "Representado por" column, not this one. */}
                  <TableHeaderCell>Miembro</TableHeaderCell>
                  <TableHeaderCell>Representado por</TableHeaderCell>
                  <TableHeaderCell type="badge">Membresía</TableHeaderCell>
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
            onDebtRegularized={() => void loadMembers({ silent: true })}
            onMembresiaChanged={() => void loadMembers({ silent: true })}
          />
        )}
      </AppShell>
    </ProtectedRoute>
  );
}
