/**
 * /profile — the account screen, rebuilt for issue #204 from
 * `docs/archive/prototypes/prototipos/30-perfil-rediseño.html` (visual reference for
 * structure and copy; every field below still traces back to a real API
 * response — see "Data sources" and "Fields deliberately excluded" below).
 *
 * Two regions, not four stacked blocks:
 *
 *   1. The identity COLUMN, 292px: `IdentityPanel` — a white panel with a
 *      coal shoulder (D7), the avatar astride its lower edge, the name, the
 *      membership badge when there is one, the "Cambiar foto" trigger and, in
 *      its own full-width row, "Correo de acceso" — plus, for anyone who has
 *      one, `MembershipCard` below it, and `SessionsCard` below that for
 *      anyone with a session history (see "The gap this screen used to
 *      document" at the foot of this doc).
 *   2. The workspace — "Datos personales" (one datum per `DetailRow`,
 *      including "Correo de cuenta" and "Rol" — deliberately repeated from
 *      the identity panel, see below), "Información de tu rol" (ALWAYS
 *      rendered — every one of the four role variants has something real to
 *      state there), "Últimas asistencias" (only when there are any),
 *      "Estudiantes a mi cargo" (representante only, including the
 *      no-representados state), and "Seguridad".
 *
 * Below `split` (980px) the panel collapses to a horizontal band above the
 * workspace; both stack to one column on a phone. Nothing here truncates —
 * every name, correo, role, estado and dependant fact wraps (`break-words`),
 * never `truncate`.
 *
 * ## Data sources (unchanged since #36)
 *
 * - ADMINISTRADOR/ENTRENADOR ("tesorero" falls through to this same branch
 *   too — it's a dead backend role no real account can carry anymore) fetch
 *   `fetchMiPerfil()` (`GET /api/auth/me`). Nombres, apellidos, roles and
 *   correo are read-only; teléfono is edited inline (`actualizarMiPerfil()`,
 *   `PATCH /api/auth/me`). Correo is intentionally NOT editable — it is the
 *   JWT `sub` claim, and self-service editing was removed by design (see
 *   auth_servicio.py).
 *
 * - ALUMNO / representante-linked accounts fetch `fetchStudentPortal()` — the
 *   same data `/student` uses — for the membership badge, the dependants
 *   list, `fechaNacimiento` and `representante`, PLUS `fetchMiPerfil()` for
 *   the identity fields the portal payload does not carry (teléfono, fecha
 *   de creación, foto).
 *
 *   Teléfono is edited inline on this branch too: `PATCH /auth/me` is
 *   self-service for EVERY authenticated role — it resolves the person from
 *   the JWT `sub` and checks no role at all (see `auth_router.
 *   actualizar_perfil_propio`) — so the writer here is the same
 *   `actualizarMiPerfil()` call the staff branch makes, seeded from the same
 *   `/auth/me` payload. Correo stays read-only on both branches: it is the
 *   JWT `sub`, and the DTO does not even accept the field.
 *
 *   A third, supplementary call — `fetchPagosDePersona()` — exists for the
 *   single date no adapter fills: `MembershipSummary.fechaFin` is `undefined`
 *   on every real payload, so the membership card's "Vigente hasta" is the
 *   furthest APPROVED payment instead (see `MembershipCard`).
 *
 *   The faro pass added no call. What it added is the rest of the payload
 *   that call was already returning: `membership.categoria`, `.modalidad`,
 *   `.fechaActivacion`, `.fechaFin` and `recentSessions` were all arriving
 *   and being dropped, which is the whole of the owner's "perfil genérico" —
 *   discarded data, not missing data.
 *
 * ## Reversed since the #204 first pass
 *
 * The first implementation of this issue read "if the prototype shows a
 * field the product doesn't compute, drop it" as "when in doubt, cut it" —
 * and dropped whole sections that DO have real data behind them. This pass
 * re-checked every prototype element against the API instead of against the
 * previous code:
 *
 * - **Correo / Rol inside "Datos personales"** — deliberately repeated from
 *   the identity panel now (they were NOT, by design, in the first pass).
 *   The owner named this exact duplication as a requirement, not a defect.
 * - **Foto de perfil ("Cambiar foto")** — `fotoUrl` was already fetched; the
 *   labelled button was what was missing (the trigger used to be an icon-only
 *   overlay on the avatar).
 * - **Security row icons** — decorative only; the descriptive text next to
 *   them already existed.
 *
 * ## Reversed AGAIN by the faro pass, and why
 *
 * Three of that pass's additions were arguments for showing something rather
 * than for a reader needing it, and each is now argued the other way in place:
 *
 * - **"Cuenta activa"** was defended here as a logically-guaranteed fact —
 *   reaching this page proves `sesion_vigente`, which is true. It is also
 *   unfalsifiable: no reader has ever seen it absent and none ever will, and a
 *   badge that cannot vary is a decoration shaped like a status. Retired; see
 *   the note in the quick-recognition block.
 * - **The photo-state line** ("Foto de perfil: Sin foto cargada") named an
 *   absence in the identity cell, which `DESIGN.md` forbids there, and named
 *   it beside an avatar already showing initials instead of a face.
 * - **The panel's own "Cerrar sesión"** was one `logout()` under two words in
 *   two places. Seguridad kept it, under the word that names the act.
 *
 * ## Fields deliberately excluded (still, and for a different reason each)
 *
 * - **"Cédula"** — only the admin-facing `/personas/{id}` carries it, and
 *   that is not readable by the account itself.
 * - **"2 dispositivos" (device count on "Otras sesiones")** — still excluded,
 *   and the reason moved rather than disappeared. It used to be "the backend
 *   has no session enumeration at all"; that is no longer true — `SessionsCard`
 *   below reads a real one. What stays true is that a COUNT beside that button
 *   would be a second, weaker rendering of a list the same column already
 *   shows in full, with names and dates. The row keeps its verb; the card
 *   keeps the facts.
 *
 * ## The gap this screen used to document, and how it closed
 *
 * The identity column ran ~500px short of the workspace on any account with no
 * membership card — staff, in other words — and the note by `ProfileLayout`
 * said so in as many words. The fix could not be "show more of what we have":
 * every field `GET /auth/me` returns was already on screen, correo and rol
 * twice by the owner's own requirement, leaving only `fechaNacimiento` unused.
 * And this file had already retired two attempts to fill space with something
 * that was not data ("Cuenta activa", the device count above).
 *
 * So the space is filled by a datum that did not exist before: `SessionsCard`,
 * backed by a `sesion` table, a `GET /auth/me/sesiones` endpoint and their
 * migration. That table is OBSERVATIONAL — `Usuario.version_sesion` remains
 * the only thing that decides whether a token is valid.
 */

"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import ProtectedRoute from "@/components/ProtectedRoute";
import AppShell from "@/components/shell/AppShell";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/contexts/ToastContext";
import AvatarPhoto from "@/components/AvatarPhoto";
import ChangePasswordCard from "./ChangePasswordCard";
import {
  fetchMiPerfil,
  actualizarMiPerfil,
  solicitarRecuperacion,
  fetchStudentPortal,
  fetchPagosDePersona,
  subirFotoPerfil,
  invalidarOtrasSesiones,
  ApiClientError,
} from "@/services/api";
import ConfirmDialog from "@/components/ConfirmDialog";
import type {
  StudentPortalSummary,
  StudentProfileSummary,
  StudentSessionSummary,
  MembershipSummary,
  PagoPersona,
} from "@/services/api";
import type { PerfilPropio, UserRole } from "@/types/domain";
import {
  describeMembershipState,
  personInitials,
  resolveCoverageEnd,
} from "@/app/student/student-utils";
import SessionsCard from "./SessionsCard";
import {
  ActionTile,
  CoverageMeter,
  HeroStats,
  IconTile,
  SectionHead,
  daysUntil,
  type AccentTone,
  type HeroStat,
} from "./ProfileParts";
import { clubToday } from "@/lib/club-date";
import {
  Badge,
  Button,
  DataBox,
  ErrorState,
  LoadingState,
  PAGE_RAIL,
  RoleShortcuts,
  buttonClasses,
} from "@/components/ui";
import type { RoleShortcut, RoleShortcutTone } from "@/components/ui";
import type { BadgeTone } from "@/components/ui/Badge";
import { MEMBERSHIP_STATUS_LABELS, MEMBERSHIP_STATUS_TONE } from "@/app/members/members-utils";
import { getAttendanceBadgeTone, getAttendanceLabel } from "@/app/attendance/attendance-utils";
// Reused as-is (not duplicated) for consistency — this is the same
// backend-estado -> frontend-estado mapping `members-adapter.ts` reuses;
// it's a pure value object with no server-only APIs, safe in a client bundle.
import { MEMBERSHIP_STATUS_BY_ESTADO } from "@/lib/membership-status";
import { backendRoleForUserRole, getBackendRoleLabel, getRoleLabel } from "@/lib/auth-utils";
import {
  Activity,
  ArrowRight,
  BadgeCheck,
  Camera,
  IdCard,
  LifeBuoy,
  Loader2,
  Lock,
  LogOut,
  Monitor,
  Save,
  ShieldCheck,
  User,
  Users,
  X,
  Zap,
} from "lucide-react";
import { ICON } from "@/lib/icon-size";
import { formatDate } from "@/lib/format-utils";
import { toUserMessage } from "@/lib/error-message";

/** Lifetime of the password-recovery link (backend `crear_token_recuperacion`, 30 min). */
const RESET_LINK_VALID_MINUTES = 30;
/** Wait before the recovery link can be requested again. */
const RESET_RESEND_COOLDOWN_SECONDS = 120;

function formatCountdown(seconds: number): string {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}
import { phoneFieldRule, toPhoneFieldDigits, toStoredPhone } from "@/lib/identity-validation";
import { revisarFoto, subirFotoDeArchivo } from "@/lib/photo-upload";
import { PhoneField } from "@/components/wizard-fields";

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

/** Roles with no staff profile here — they see the student-branch content in the unified layout instead. */
const STUDENT_SUMMARY_ROLES: ReadonlySet<UserRole> = new Set(["representante", "estudiante"]);

/** The one phone rule the profile states: the same local digits the field's own hint asks for. */
const PHONE_PROFILE_MESSAGE =
  "Escriba su celular de 9 dígitos que empieza con 9 (por ejemplo, 991234567) o su fijo con código de provincia (por ejemplo, 42345678). Es opcional.";

const ADMIN_SHORTCUTS: RoleShortcut[] = [
  { title: "Panel de Control", description: "Resumen del día del club", href: "/dashboard" },
  { title: "Miembros", description: "Cuentas, roles y membresías", href: "/members" },
  { title: "Pagos", description: "Revisar y aprobar comprobantes", href: "/payments" },
  { title: "Asistencias", description: "Registros de entrenamiento", href: "/attendance" },
];

const TRAINER_SHORTCUTS: RoleShortcut[] = [
  { title: "Mi día", description: "Sus próximas sesiones", href: "/trainer" },
  { title: "Pasar lista", description: "Registrar la asistencia", href: "/trainer/attendance" },
  { title: "Alumnos del club", description: "Consultar a sus alumnos", href: "/trainer/students" },
];

const STUDENT_SHORTCUTS: RoleShortcut[] = [
  { title: "Mi cuenta", description: "Su resumen y próximas sesiones", href: "/student" },
  { title: "Pagos", description: "Sus cuotas y comprobantes", href: "/student/payments" },
  { title: "Asistencias", description: "Su historial de entrenamientos", href: "/student/attendance" },
  { title: "Ficha médica", description: "Mantener sus datos de salud", href: "/student/medical-record" },
];

const REPRESENTANTE_SHORTCUTS: RoleShortcut[] = [
  { title: "Mi cuenta", description: "El resumen de su familia", href: "/student" },
  { title: "Pagos", description: "Cuotas y comprobantes", href: "/student/payments" },
  { title: "Asistencias", description: "Entrenamientos de sus representados", href: "/student/attendance" },
  { title: "Ficha médica", description: "Datos de salud de sus representados", href: "/student/medical-record" },
  { title: "Agregar estudiante", description: "Sumar a otra persona a su cargo", href: "/student/add-dependent" },
];

function shortcutsForRole(role: UserRole): RoleShortcut[] {
  switch (role) {
    case "admin":
      return ADMIN_SHORTCUTS;
    case "trainer":
      return TRAINER_SHORTCUTS;
    case "representante":
      return REPRESENTANTE_SHORTCUTS;
    case "estudiante":
      return STUDENT_SHORTCUTS;
    default:
      return [];
  }
}

function toErrorMessage(error: unknown, fallback: string): string {
  return toUserMessage(error, fallback);
}

function describeMembership(
  membership: MembershipSummary | null,
): { label: string; tone: BadgeTone } | null {
  if (!membership) return null;
  const estado =
    MEMBERSHIP_STATUS_BY_ESTADO[membership.estado as keyof typeof MEMBERSHIP_STATUS_BY_ESTADO];
  return {
    label: MEMBERSHIP_STATUS_LABELS[estado],
    tone: MEMBERSHIP_STATUS_TONE[estado],
  };
}

const NO_MEMBERSHIP_FALLBACK = "No disponible — consulte con administración";

/**
 * Per-role copy for the workspace lede and "Información de tu rol" —
 * `docs/archive/prototypes/prototipos/30-perfil-rediseño.html`'s four review variants,
 * keyed by the same `UserRole` this page already branches on.
 *
 * `roleText` for "estudiante"/"representante" is NOT copied verbatim: the
 * prototype's synthetic sentences assert "la información de membresía no
 * está disponible" / "la cuenta tiene personas representadas vinculadas" as
 * if always true, but this page DOES show real membership status and MAY
 * have zero representados — an unconditional copy-paste would print a false
 * claim next to the real fact just below it. The title and lede are still
 * verbatim; only the two state-dependent clauses are adapted.
 */
const ROLE_COPY: Record<
  UserRole,
  {
    lede: string;
    roleCaption: string;
    roleTitle: string;
    roleText: (hasDependents: boolean) => string;
  }
> = {
  admin: {
    lede: "Revise sus datos y mantenga segura su cuenta.",
    roleCaption: "Rol asignado a esta cuenta",
    roleTitle: "Cuenta administrativa",
    roleText: () =>
      "Esta cuenta tiene el rol de Administrador. Los datos de los miembros se gestionan desde Miembros, en el menú.",
  },
  trainer: {
    lede: "Revise su información de contacto y el acceso a su cuenta.",
    roleCaption: "Información de su perfil",
    roleTitle: "Perfil de entrenador",
    roleText: () =>
      "Su cuenta está identificada con el rol de Entrenador. El resto de la información operativa aparece en sus pantallas correspondientes.",
  },
  estudiante: {
    lede: "Consulte sus datos de cuenta y la información disponible de su portal.",
    roleCaption: "Datos del portal estudiantil",
    roleTitle: "Perfil estudiantil",
    roleText: () => "Estos datos describen la cuenta del estudiante.",
  },
  representante: {
    lede: "Administre sus datos de cuenta y revise las personas representadas.",
    roleCaption: "Datos disponibles para su cuenta",
    roleTitle: "Cuenta representante",
    roleText: (hasDependents) =>
      hasDependents
        ? "La cuenta tiene personas representadas vinculadas. El estado de membresía se muestra solo cuando la información está disponible."
        : "Esta cuenta tiene el rol de Representante. El estado de membresía se muestra solo cuando la información está disponible.",
  },
  // Reached, not just kept total. The shell offers "Perfil" from the user menu
  // to every session it draws, and it draws one for an "unsupported" account:
  // ALUMNO is granted lazily, so a freshly self-enrolled person holds no role
  // yet and still gets the student portal in its "pending" mode
  // (`derivePortalMode`). This page used to refuse them — a row the menu
  // offered and the guard then bounced, ejecting them from the portal to
  // /unauthorized with a permission toast over it, which is the same defect
  // issue #762 closes for multi-role accounts. Their data is all here: the
  // staff branch reads `GET /api/auth/me`, which needs no role at all.
  unsupported: {
    lede: "Revise sus datos y mantenga segura su cuenta.",
    roleCaption: "Información de su cuenta",
    roleTitle: "Cuenta",
    roleText: () => "Esta cuenta no tiene un rol reconocido asignado.",
  },
};

type StaffLoadState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; perfil: PerfilPropio };

type StudentLoadState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; data: StudentPortalSummary };

// ---------------------------------------------------------------------------
// The 56px detail row (`.drow`, _sistema.css:247-250) — the single row shape
// the workspace is built from. One datum, an uppercase label on the left, the
// value in bold on the right, the note (if any) inline beside the value.
// ---------------------------------------------------------------------------

function DetailRow({
  label,
  icon,
  children,
  note,
  action,
}: {
  label?: string;
  /** Decorative only — the descriptive text already carries the meaning
   *  (Seguridad's three rows are the only current callers). */
  icon?: React.ReactNode;
  children: React.ReactNode;
  note?: string;
  action?: React.ReactNode;
}): React.ReactElement {
  return (
    // `flex-wrap` plus a real minimum on the value column: at 375px a 150px
    // label, a sentence and a 40px button do not fit on one line, and without
    // a wrap the value collapsed to one word per line while the button was
    // clipped by the card's own edge. The action now drops to a second line
    // and stays right-aligned; above `sm` nothing about the row changes.
    //
    // No `min-h-drow` (56px): that floor was sized for the shared dense-row
    // primitive, not for a row holding one line of text — it left ~40px of
    // dead air around a 20px value. The row now sizes to its own content.
    <div className="flex flex-wrap items-center gap-x-4 gap-y-field border-b border-line px-5 py-2 last:border-b-0">
      {icon && (
        <span aria-hidden="true" className="flex-none text-ink-3">
          {icon}
        </span>
      )}
      {label && (
        // Grey and normal weight, not bold uppercase caps: the label only
        // has to orient, the VALUE is what the reader came to read. Bold
        // uppercase at the same size as the value made the two compete for
        // attention instead of one leading the other.
        <span className="w-[110px] flex-none text-xs text-ink-3 sm:w-[150px]">{label}</span>
      )}
      <span className="flex min-w-[9rem] flex-1 flex-wrap items-center gap-x-2 gap-y-field text-sm font-semibold text-ink">
        {children}
        {note && <span className="text-xs font-normal text-ink-3">{note}</span>}
      </span>
      {/*
        A COLUMN, not just `ml-auto`. The only rows that pass an action are the
        three "Seguridad" ones, and each passes a sentence as its value — so
        with the action sized to its own button, every row left its sentence a
        different width, wrapped at a different point, and put its button on a
        different line. Rows that share a shape have to share it exactly.

        `w-full` below `sm`: at 375px the sentence and the button never share a
        line anyway, so the action takes its own, right-aligned, on all three
        rows alike instead of on whichever ones happened to overflow.
      */}
      {action && (
        <span className="ml-auto flex w-full justify-end sm:w-[210px] sm:flex-none">{action}</span>
      )}
    </div>
  );
}

/**
 * The shell every state of this page shares. Keeping the title in ONE place
 * stops loading, error and the loaded layout from drifting apart now that
 * the loaded layout owns its own `AppShell` (it has to, because the header's
 * action depends on the layout's edit state).
 */
function ProfileShell({
  actions,
  subtitle,
  children,
}: {
  actions?: React.ReactNode;
  /** The role-specific "bajada" under the title (issue #204's prototype
   *  copy) — omitted for the loading/error shells, which have no role yet. */
  subtitle?: string;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <AppShell title="Perfil" subtitle={subtitle} actions={actions}>
      {children}
    </AppShell>
  );
}

function AccountSummary({
  memberSince,
  active,
}: {
  memberSince: string | null;
  /** Staff accounts are always active; students read their state from the membership card. */
  active: boolean;
}): React.ReactElement | null {
  // Role and correo are stated once, in the identity panel above — repeating
  // them here is what made the profile read the same fact four times (ENT-21).
  if (!active && !memberSince) return null;
  return (
    <dl data-testid="profile-account-summary" className="grid gap-3 text-sm">
      {active && (
        <div className="grid gap-1">
          <dt className="text-xs text-ink-3-strong">Estado</dt>
          <dd>
            <Badge tone="ok">Activa</Badge>
          </dd>
        </div>
      )}
      {memberSince && (
        <div className="grid gap-1">
          <dt className="text-xs text-ink-3-strong">Cuenta creada</dt>
          <dd className="text-ink">{memberSince}</dd>
        </div>
      )}
    </dl>
  );
}

function CardSection({
  title,
  subtitle,
  icon,
  tone,
  action,
  testId,
  children,
}: {
  title: string;
  /** A short caption to the right of the title (e.g. "Acciones de acceso"). */
  subtitle?: string;
  icon: React.ReactNode;
  tone: AccentTone;
  action?: React.ReactNode;
  testId?: string;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <section data-testid={testId} className="card overflow-hidden">
      <SectionHead title={title} subtitle={subtitle} icon={icon} tone={tone} action={action} />
      {children}
    </section>
  );
}

/** Rail card: the same tinted header as the section cards, with the guidance below it. */
function RailCard({
  title,
  icon,
  tone,
  children,
}: {
  title: string;
  icon: React.ReactNode;
  tone: AccentTone;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <aside aria-label={title} className="card overflow-hidden">
      <SectionHead title={title} icon={icon} tone={tone} />
      <div className="flex flex-col gap-2 p-[18px] text-sm text-ink-2">{children}</div>
    </aside>
  );
}

/** Role-specific accent: one hue per account type, reused by the hero-adjacent cards. */
const ROLE_TONE: Record<UserRole, RoleShortcutTone> = {
  admin: "red",
  trainer: "trainer",
  representante: "info",
  estudiante: "ball",
  unsupported: "neutral",
};

// ---------------------------------------------------------------------------
// IdentityPanel — the compact ~292px identity surface (issue #204).
//
// A WHITE card, not a second coal mass beside the sidebar: `.card` gives it
// the paper background, hairline and shadow every card in the product
// already shares. The only color gesture is the asymmetric institutional-red
// field across the top (`clip-path`, matching `.identity-rail::before` in
// the prototype) with the yellow dot inside it, and the coal avatar
// straddling the red/white boundary via a negative top margin.
//
// Nothing here truncates: `break-words` on the name and the correo, never
// `truncate` — the issue's own hard content rule.
// ---------------------------------------------------------------------------

interface IdentityPanelProps {
  name: string;
  initials: string;
  fotoUrl?: string | null;
  roleLabel: string;
  /** Rendered ONLY when there is a real status to report — see the module docstring. */
  statusBadge: { label: string; tone: BadgeTone } | null;
  /** Pre-formatted ("Cuenta creada el 10/03/2024"), or `null` when there is no date. */
  memberSince: string | null;
  stats: readonly HeroStat[];
  correo: string;
  uploadingFoto: boolean;
  fotoError: string | null;
  fotoInputRef: React.RefObject<HTMLInputElement>;
  onFotoChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  /** The screen's profile actions (edit / save / cancel), rendered inside the band. */
  actions?: React.ReactNode;
}

/**
 * The identity band: one coal surface across the main column that carries who
 * the person is (avatar, name, role, account date, correo) and what they can do
 * about it (edit data, change photo). The ball-yellow ring on the avatar and
 * the role pill are the only accents; two soft discs of ball and red give the
 * flat coal some depth without spending a solid red field (the red stays on
 * the one primary button). Nothing truncates: the name and correo wrap.
 */
function IdentityPanel({
  name,
  initials,
  fotoUrl,
  roleLabel,
  statusBadge,
  memberSince,
  stats,
  correo,
  uploadingFoto,
  fotoError,
  fotoInputRef,
  onFotoChange,
  actions,
}: IdentityPanelProps): React.ReactElement {
  return (
    <section
      data-testid="profile-hero"
      aria-label={`Identidad de la cuenta de ${name}`}
      className="relative isolate flex flex-col overflow-hidden rounded-card bg-coal text-white shadow-elevated"
    >
      <span
        aria-hidden="true"
        className="pointer-events-none absolute -right-16 -top-24 -z-10 h-72 w-72 rounded-full bg-ball/10"
      />
      <span
        aria-hidden="true"
        className="pointer-events-none absolute -bottom-28 right-40 -z-10 h-64 w-64 rounded-full bg-cata-red/15"
      />

      <div className="flex flex-col gap-6 px-6 py-7 md:flex-row md:items-center md:gap-8 lg:px-8">
        <div className="flex-none">
          <div className="flex h-28 w-28 items-center justify-center overflow-hidden rounded-full bg-coal-3 text-2xl font-extrabold text-ball ring-4 ring-ball ring-offset-4 ring-offset-coal">
            <AvatarPhoto
              fotoUrl={fotoUrl}
              initials={initials}
              className="h-28 w-28 rounded-full object-cover"
            />
          </div>
        </div>

        <div className="min-w-0 flex-1">
          <p
            data-testid="profile-shoulder"
            className="inline-flex rounded-full border border-ball/40 bg-ball/10 px-3 py-1 text-2xs font-bold uppercase tracking-caps-wide text-ball"
          >
            {roleLabel}
          </p>
          <h2 className="mt-3 break-words font-display text-xl uppercase leading-tight tracking-flat text-white">
            {name}
          </h2>
          {statusBadge && (
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              <Badge tone={statusBadge.tone}>{statusBadge.label}</Badge>
            </div>
          )}
          <div className="mt-3 grid gap-1 text-sm text-white/70">
            {memberSince && <p>{memberSince}</p>}
            <p className="break-words font-semibold text-white">{correo}</p>
            <p className="text-xs text-white/60">El correo lo gestiona el club, no se edita aquí.</p>
          </div>
        </div>

        <div className="flex flex-none flex-wrap items-center gap-2 md:flex-col md:items-stretch">
          {actions}
          <button
            type="button"
            onClick={() => fotoInputRef.current?.click()}
            disabled={uploadingFoto}
            className={buttonClasses("onCoal", "md", "justify-center")}
          >
            {uploadingFoto ? (
              <Loader2 size={ICON.sm} className="animate-spin" aria-hidden="true" />
            ) : (
              <Camera size={ICON.sm} strokeWidth={1.5} aria-hidden="true" />
            )}
            {uploadingFoto ? "Subiendo…" : "Cambiar foto"}
          </button>
          <input
            ref={fotoInputRef}
            type="file"
            accept="image/jpeg,image/png"
            onChange={onFotoChange}
            className="hidden"
            data-testid="foto-perfil-input"
          />
        </div>
      </div>

      {stats.length > 0 && <HeroStats stats={stats} />}

      {fotoError && (
        <p role="alert" className="border-t border-white/10 bg-coal-2 px-6 py-3 text-xs text-white lg:px-8">
          {fotoError}
        </p>
      )}
    </section>
  );
}

/**
 * One fact in the narrow left column: label above value, not beside it.
 *
 * `DetailRow` cannot go here and the reason is arithmetic. Its label column is
 * `sm:w-[150px]` and its value column has a `min-w-[9rem]` (144px) floor, so
 * one row needs 294px + gutters before it can lay out — and this column is
 * 292px wide. Tailwind's `sm:` is a VIEWPORT query, not a container one, so on
 * a 1440px desktop those two floors apply inside a 292px box and the row
 * overflows its own card.
 *
 * Stacking is not a second vocabulary for the same thing either: it is the
 * `field` spacing step doing exactly what the layout section defines it for —
 * *"entre una etiqueta y lo que etiqueta"*.
 */
function PanelFact({ label, children }: { label: string; children: React.ReactNode }): React.ReactElement {
  return (
    <div className="border-b border-line px-5 py-3 last:border-b-0">
      <p className="text-2xs font-bold uppercase tracking-wide text-ink-3-strong">{label}</p>
      <p className="mt-field break-words text-sm font-semibold text-ink">{children}</p>
    </div>
  );
}

/**
 * The club's side of the relationship, assembled from `self.membership` —
 * which this page has been fetching since #36 and reading two fields of.
 *
 * `fetchStudentPortal()` returns `categoria`, `modalidad`, `fechaActivacion`
 * and `montoAplicado` on every membership row, and the screen used `estado`
 * for a badge and dropped the rest. That is the whole of "perfil genérico":
 * not missing data, discarded data.
 *
 * ## "Vigente hasta" is the coverage end, not `membership.fechaFin`
 *
 * `MembershipSummary.fechaFin` is declared on the client type and produced by
 * nobody: `buildMembershipView` (src/lib/server/student-adapter.ts) has no line
 * that fills it, so the row this card used to draw from that field never
 * appeared on a real payload. The end of paid coverage is the furthest
 * `fechaFin` among the persona's APPROVED payments — `resolveCoverageEnd`, the
 * same reading `/student/payments` prints — so it arrives here as
 * `coverageEnd`, from the supplementary lookup `ProfileContent` makes. That
 * ONE date is the only fact on this card the portal payload does not carry.
 *
 * An absent coverage end draws no row, never a labelled dash: this card's rule
 * is that a datum the club cannot prove is left out, which is why `hasta` is a
 * plain empty string rather than a placeholder. The reader who needs to know
 * whether coverage is current is not left guessing either way — the identity
 * panel above carries the membership's own state badge.
 *
 * Of the four fields the payload does carry, three are drawn and the one that
 * is not has its reason:
 *
 * - **`montoAplicado`** is money. On its own a figure does not say whether it
 *   is owed, paid or overdue, and "Mis pagos" exists to answer precisely that.
 *   A number that decides nothing is the grid rule's own example.
 * - **`modalidad`** is drawn only when the plan name does not already contain
 *   it. Every plan the club sells today is named for how it is charged
 *   ("Mensual Infantil" / "MENSUAL"), so the honest row for those is no row.
 *   `PERSONALIZADA` against a plan named for its season is the case that keeps
 *   the field alive.
 */
function MembershipCard({
  membership,
  coverageEnd,
}: {
  membership: MembershipSummary;
  /** Furthest `fechaFin` among APPROVED payments (`resolveCoverageEnd`), or `null`. */
  coverageEnd: string | null;
}): React.ReactElement {
  const plan = membership.categoria?.trim();
  const modalidad = membership.modalidad?.trim();
  const modalidadLabel = modalidad
    ? modalidad.charAt(0).toUpperCase() + modalidad.slice(1).toLowerCase()
    : "";
  // Case-insensitive: the backend spells the modalidad in caps and the plan
  // name in title case, so a literal comparison would never match and every
  // row would print the same word twice.
  const modalidadIsRedundant =
    !modalidad || (plan?.toLowerCase().includes(modalidad.toLowerCase()) ?? false);
  const desde = membership.fechaActivacion ? formatDate(membership.fechaActivacion) : "";
  const hasta = coverageEnd ? formatDate(coverageEnd) : "";

  return (
    <section data-testid="profile-membership" className="card flex flex-none flex-col overflow-hidden">
      <SectionHead
        title="Su membresía"
        icon={<BadgeCheck size={ICON.sm} strokeWidth={1.5} />}
        tone="ball"
      />
      {coverageEnd && <CoverageMeter daysLeft={daysUntil(coverageEnd, clubToday())} />}
      {plan && <PanelFact label="Plan">{plan}</PanelFact>}
      {!modalidadIsRedundant && <PanelFact label="Modalidad">{modalidadLabel}</PanelFact>}
      {desde && <PanelFact label="Socio desde">{desde}</PanelFact>}
      {hasta && <PanelFact label="Vigente hasta">{hasta}</PanelFact>}
    </section>
  );
}

/**
 * The last few times the person was on a table, from `self.recentSessions` —
 * the other field the payload carried and the screen threw away.
 *
 * Gated on `length > 0` rather than given an empty state, and that is a
 * finding rather than a shortcut: attendance already owns two screens of its
 * own (`/student` and `/student/attendance`), each with a real empty state
 * that explains what to do about it. A third one here would be a third
 * vocabulary for the same nothing. When there ARE sessions the card is worth
 * its space, because it answers "am I actually going?" without leaving the
 * page.
 *
 * Not `ActivityList`: that primitive's row opens with an actor's initials, and
 * the actor of every row here is the person reading it. Their own initials
 * repeated down a column identify nobody.
 */
function RecentSessionsCard({
  sessions,
}: {
  sessions: readonly StudentSessionSummary[];
}): React.ReactElement {
  return (
    <section data-testid="profile-activity" className="card overflow-hidden">
      <SectionHead
        title="Últimas asistencias"
        subtitle="Lo que registró el club"
        icon={<Activity size={ICON.sm} strokeWidth={1.5} />}
        tone="ok"
      />
      <ul className="divide-y divide-line">
        {sessions.map((session) => (
          <li
            key={`${session.fecha}-${session.horario}`}
            className="flex flex-wrap items-center gap-x-4 gap-y-field px-5 py-3"
          >
            {/* Tabular figures: a column of dates is only comparable when
                the digits sit on the same rails. */}
            <span className="w-[86px] flex-none text-xs tabular-nums text-ink-3">
              {formatDate(session.fecha)}
            </span>
            <span className="min-w-0 flex-1 text-sm font-semibold text-ink">
              {session.horario}
            </span>
            {/* Issue #313 (K5 hallazgo #19): esta tarjeta reinventaba su
                propia tabla de estados ("PRESENTE"/"AUSENTE"/"TARDE"), con
                claves que nunca calzaban con la forma real que manda
                `ESTADO_ASISTENCIA_BACKEND_TO_FRONTEND` (minúscula, en
                inglés). El resultado: NINGÚN estado coincidía nunca y las
                21 sesiones se veían indistinguibles, faltas y tardanzas
                incluidas. La fuente única es la misma que ya usa
                /student/attendance para el mismo dato. */}
            {session.estado && (
              <Badge tone={getAttendanceBadgeTone(session.estado)}>
                {getAttendanceLabel(session.estado)}
              </Badge>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

// ---------------------------------------------------------------------------
// The page body — one tree, whose content branches by `kind`.
// ---------------------------------------------------------------------------

type ProfileLayoutProps =
  | {
      kind: "staff";
      role: UserRole;
      perfil: PerfilPropio;
      accountEmail: string;
      onSaved: (perfil: PerfilPropio) => void;
    }
  | {
      kind: "student";
      role: UserRole;
      data: StudentPortalSummary;
      perfil: PerfilPropio | null;
      /**
       * Furthest `fechaFin` among the profile's APPROVED payments, or `null`.
       *
       * Not on the `staff` member because the membership card it feeds exists
       * only here: `self` — and therefore `self.membership` — is the student
       * branch's own profile.
       */
      coverageEnd: string | null;
      sessionEmail: string;
      sessionName: string;
      onPerfilUpdated: (perfil: PerfilPropio) => void;
    };

function ProfileLayout(props: ProfileLayoutProps): React.ReactElement {
  const { showSuccess, showError } = useToast();
  const { logout, refreshSession } = useAuth();

  // ---- Inline teléfono edit. Both branches use it — see `handleSave`. ----
  const [editing, setEditing] = useState(false);
  // Issue #1296: the same `PhoneField` every other phone field on the app
  // shares (fixed +593, local digits, no trunk 0) — the stored value arrives
  // as `0XXXXXXXX`, so it is shown here as the digits `toPhoneFieldDigits`
  // strips the trunk 0 from.
  const [telefono, setTelefono] = useState(toPhoneFieldDigits(props.perfil?.telefono ?? null));
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [telefonoError, setTelefonoError] = useState<string | null>(null);

  const [requestingPassword, setRequestingPassword] = useState(false);
  const [passwordMessage, setPasswordMessage] = useState<string | null>(null);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  // GAP-06: the link lasts 30 minutes (`crear_token_recuperacion`), and a new one
  // can be asked for only after `RESET_RESEND_COOLDOWN_SECONDS`.
  const [resendSecondsLeft, setResendSecondsLeft] = useState(0);

  useEffect(() => {
    if (resendSecondsLeft <= 0) return;
    const timer = setTimeout(() => setResendSecondsLeft((n) => n - 1), 1000);
    return () => clearTimeout(timer);
  }, [resendSecondsLeft]);

  // ---- "Cerrar otras sesiones" (E01, slice B4) ---------------------------
  const [confirmingInvalidation, setConfirmingInvalidation] = useState(false);
  const [invalidatingSessions, setInvalidatingSessions] = useState(false);
  // Bumped after "Cerrar otras sesiones" so SessionsCard reloads its first page.
  const [sessionsRefresh, setSessionsRefresh] = useState(0);
  const [sessionsMessage, setSessionsMessage] = useState<string | null>(null);
  const [sessionsError, setSessionsError] = useState<string | null>(null);

  // ---- Profile photo upload — the caller's own avatar, for BOTH branches.
  // `POST /auth/me/foto` is self-service and role-agnostic. ----
  const fotoInputRef = useRef<HTMLInputElement>(null);
  const [uploadingFoto, setUploadingFoto] = useState(false);
  const [fotoError, setFotoError] = useState<string | null>(null);

  // `perfil` is on BOTH members of the union — `PerfilPropio` on staff,
  // `PerfilPropio | null` on student — so it reads directly. This used to be a
  // ternary whose two branches were the identical expression, written to
  // satisfy narrowing that was never needed.
  const perfil: PerfilPropio | null = props.perfil;
  const currentFotoUrl = perfil?.fotoUrl;

  async function handleFotoChange(e: React.ChangeEvent<HTMLInputElement>): Promise<void> {
    const archivo = e.target.files?.[0];
    e.target.value = ""; // reset so re-selecting the same file re-triggers onChange
    if (!archivo) return;

    // The allow-list and both refusal sentences live in `lib/photo-upload.ts`,
    // shared with the other photo surface — see that module for why this
    // pre-check stays opt-in there.
    const rechazo = revisarFoto(archivo);
    if (rechazo) {
      setFotoError(rechazo);
      return;
    }

    const mensajeError = "No se pudo actualizar la foto de perfil.";
    setUploadingFoto(true);
    setFotoError(null);
    try {
      const resultado = await subirFotoDeArchivo(archivo, subirFotoPerfil, mensajeError);
      if (resultado.status === "failed") {
        setFotoError(resultado.message);
        showError(resultado.message);
        return;
      }
      const updated = resultado.value;
      if (props.kind === "staff") {
        props.onSaved(updated);
      } else {
        props.onPerfilUpdated(updated);
      }
      // `/auth/me/foto` is always self-service (the caller's OWN photo), so
      // the session avatar in AppShell's sidebar — rendered on this very
      // page, from `session.user.fotoUrl` in AuthContext, NOT from the local
      // `perfil` state updated above — must be refreshed too. Without this,
      // it kept showing the previous photo until the next periodic
      // revalidation or a full page reload (issue #662).
      await refreshSession();
      showSuccess("Foto de perfil actualizada correctamente.");
    } catch (error: unknown) {
      // Only the success side effects can reach here now: the upload itself
      // is normalized by `subirFotoDeArchivo`. Kept so a rejected
      // `refreshSession` is still reported instead of escaping unhandled.
      const message = toErrorMessage(error, mensajeError);
      setFotoError(message);
      showError(message);
    } finally {
      setUploadingFoto(false);
    }
  }

  function startEditing(): void {
    // `perfil` is `null` only while the student branch's supplementary
    // `/auth/me` call is still in flight or failed; the trigger is not drawn
    // then (see `headerAction`), so this is unreachable with nothing to seed.
    setTelefono(toPhoneFieldDigits(perfil?.telefono ?? null));
    setSaveError(null);
    setTelefonoError(null);
    setEditing(true);
  }

  function cancelEditing(): void {
    setTelefono(toPhoneFieldDigits(perfil?.telefono ?? null));
    setSaveError(null);
    setTelefonoError(null);
    setEditing(false);
  }

  async function handleSave(): Promise<void> {
    setSaveError(null);
    // The field is optional: an empty value clears the number, a filled one
    // must be valid, and the message lands under the field before any request.
    if (telefono && phoneFieldRule(telefono, "El teléfono")) {
      setTelefonoError(PHONE_PROFILE_MESSAGE);
      return;
    }
    setTelefonoError(null);
    setSaving(true);
    try {
      // Correo is never sent here — it's the JWT `sub` claim, and self-service
      // editing was removed by design (see auth_servicio.py).
      const updated = await actualizarMiPerfil({ telefono: toStoredPhone(telefono) });
      // Each branch owns its own state: staff replaces its `staffState`
      // profile, the student branch its supplementary one.
      if (props.kind === "staff") props.onSaved(updated);
      else props.onPerfilUpdated(updated);
      setEditing(false);
      showSuccess("Perfil actualizado correctamente.");
    } catch (error: unknown) {
      // Revert — a rejected edit must never be left displayed as if it were
      // persisted (no silent data loss, per spec).
      setTelefono(toPhoneFieldDigits(perfil?.telefono ?? null));
      setEditing(false);
      const message = toErrorMessage(error, "No se pudo guardar los cambios.");
      setSaveError(message);
      showError(message);
    } finally {
      setSaving(false);
    }
  }

  const correoDisplay = props.kind === "staff" ? props.perfil.correo : props.sessionEmail;

  async function handleChangePassword(): Promise<void> {
    setRequestingPassword(true);
    setPasswordError(null);
    setPasswordMessage(null);
    try {
      const destino = props.kind === "staff" ? props.accountEmail : correoDisplay;
      await solicitarRecuperacion(destino);
      const message = `Le enviamos un enlace a ${destino} para cambiar su contraseña. Es válido por ${RESET_LINK_VALID_MINUTES} minutos.`;
      setPasswordMessage(message);
      setResendSecondsLeft(RESET_RESEND_COOLDOWN_SECONDS);
      showSuccess(message);
    } catch (error: unknown) {
      const message = toErrorMessage(error, "No se pudo enviar el correo de recuperación.");
      setPasswordError(message);
      showError(message);
    } finally {
      setRequestingPassword(false);
    }
  }

  /**
   * POST /auth/sesiones/invalidar via the BFF: bumps the session epoch and
   * reissues a fresh token pair as cookies in the same response, so THIS
   * device stays authenticated (see `invalidarOtrasSesiones`'s docstring).
   * No redirect and no manual retry here on either branch — a stale-token
   * failure is already handled globally by `services/api.ts`'s 401
   * refresh-and-retry (`subscribeAuthFailure` in `AuthContext`), so this
   * handler only needs to report success or surface a message, never spin.
   */
  async function handleInvalidateOtherSessions(): Promise<void> {
    setConfirmingInvalidation(false);
    setInvalidatingSessions(true);
    setSessionsError(null);
    setSessionsMessage(null);
    try {
      const result = await invalidarOtrasSesiones();
      setSessionsRefresh((n) => n + 1);
      setSessionsMessage(result.mensaje);
      showSuccess(result.mensaje);
    } catch (error: unknown) {
      const message = toErrorMessage(error, "No se pudieron cerrar las otras sesiones.");
      setSessionsError(message);
      showError(message);
    } finally {
      setInvalidatingSessions(false);
    }
  }

  const self = props.kind === "student" ? props.data.self : null;
  const representados = props.kind === "student" ? props.data.representados : [];
  const fallbackStatedByDependants =
    props.role === "representante" &&
    representados.some((dependant) => describeMembership(dependant.membership) === null);

  const fullName =
    props.kind === "staff"
      ? `${props.perfil.nombres} ${props.perfil.apellidos}`.trim()
      : self
        ? `${self.nombres} ${self.apellidos}`.trim()
        : props.sessionName;

  const roleLabel = getRoleLabel(props.role);
  /**
   * Every role the backend has on this account, read from `PerfilPropio`
   * (`GET /auth/me`, fetched on both branches). Only `null` while the student
   * branch's own profile call is still in flight, and then the session's
   * single role is all there is.
   *
   * More than one of them is unreachable in practice since issue #762: an
   * account that still holds two gets no session, so nobody is logged in to
   * look at this screen. The multi-role branches below are left standing
   * because this list is the ACCOUNT's, read from the API rather than from the
   * session, and a display that reads a list should not assume its length.
   */
  const assignedRoles = props.perfil?.roles ?? [];
  const sessionBackendRole = backendRoleForUserRole(props.role);
  /**
   * The end of PAID coverage — the furthest `fechaFin` among this persona's
   * APPROVED payments, resolved by `ProfileContent` through
   * `resolveCoverageEnd`. `MembershipSummary.fechaFin` is declared on the
   * client type and populated by no adapter, so the membership row cannot
   * carry it; this is the same reading, from the same endpoint, that
   * `/student/payments` prints and that this page's own `MembershipCard`
   * draws below.
   *
   * Declared here, above the identity badge, because the badge reads it too:
   * one date, one reading, for the two places on this screen that state the
   * membership's standing.
   */
  const coverageEnd = props.kind === "student" ? props.coverageEnd : null;

  /**
   * The identity panel's status badge — the SAME coverage-aware reading
   * `/student/payments` prints (`describeMembershipState`), never `estado`
   * alone (issue #815's class).
   *
   * `Membresia.estado` is not a live fact: only the daily 02:35 batch flips
   * ACTIVA→VENCIDA, so an `ACTIVA` row whose last approved payment already ran
   * out says "Activa" from local midnight until that batch runs. On this screen
   * that put an "Activa" badge directly above the membership card's own
   * "Vigente hasta" date in the past — two readings of one state, on one
   * screen. Reading coverage here makes the badge and that card agree by
   * construction.
   *
   * The membership row goes in whole so gratuity keeps outranking the date
   * (`esGratuidadFamiliar`), exactly as it does on the payments card, and
   * `today` is left at its default for the same reason the payments screen
   * does: one clock per screen.
   *
   * `null` when there is no membership row at all: the honest "no disponible"
   * note in "Información de tu rol" states that once, never as an absent badge.
   */
  const membership =
    props.kind === "student" && self?.membership
      ? describeMembershipState(self.membership.estado, coverageEnd, undefined, self.membership)
      : null;
  const initials = personInitials(
    fullName.split(/\s+/)[0] ?? "",
    fullName.split(/\s+/).slice(1).join(" "),
  );

  /**
   * The panel's own quick-block badge takes a single string, and a
   * multi-role account cannot repeat one specific role there — the full
   * breakdown (including which role is active this session) already lives in
   * "Información de tu rol" below, so stating "Administrador" in BOTH places
   * would be the same fact printed twice on one screen (the same class of
   * defect this redesign fixes for correo).
   */
  const panelRoleLabel =
    assignedRoles.length > 1 ? `${assignedRoles.length} roles asignados` : roleLabel;

  const telefonoDisplay =
    props.kind === "staff" ? props.perfil.telefono : (props.perfil?.telefono ?? "");
  const fechaCreacion =
    props.kind === "staff" ? props.perfil.fechaCreacion : props.perfil?.fechaCreacion;
  // `null`, not "Cuenta creada el —": the identity cell never names an absence,
  // so a missing `fechaCreacion` draws no line rather than a labelled dash.
  // Issue #313 (K5 hallazgo #50): esto es la fecha de creación de la CUENTA
  // (`Usuario.fecha_creacion`, /api/auth/me), no la afiliación al club — esa
  // es "Socio desde" (`TU MEMBRESÍA`, fechaActivacion), un hecho distinto que
  // puede legítimamente diferir en semanas. Antes ambos se llamaban "Miembro
  // desde X" con fechas distintas en la misma pantalla; el rótulo ahora nombra
  // lo que de verdad mide, en vez de forzar que las dos fechas coincidan.
  const memberSince = fechaCreacion ? `Cuenta creada el ${formatDate(fechaCreacion)}` : null;

  // The membership and the session history the screen used to fetch and
  // discard. Both are read straight off `self` — no default when a field is
  // absent (see `MembershipCard` / `RecentSessionsCard`). The one date the
  // payload cannot carry, the end of paid coverage, is the separate
  // `coverageEnd` above.
  const selfMembership = self?.membership ?? null;
  const recentSessions = self?.recentSessions ?? [];

  // The quick-recognition badge in the identity panel — only when there IS a
  // real membership status to report. When `self` exists but has no
  // membership row, the honest "no disponible" note lives in "Información de
  // tu rol" instead (see below): a fact is stated exactly once, never both as
  // a badge here AND as text there.
  const statusBadge = props.kind === "student" && self ? membership : null;

  // Key numbers for the hero, from data this screen already holds: where the
  // coverage ends, the plan, and how many sessions the club has recorded.
  const heroStats: HeroStat[] = [];
  if (props.kind === "student" && selfMembership) {
    if (selfMembership.categoria?.trim()) heroStats.push({ label: "Plan", value: selfMembership.categoria.trim() });
    if (coverageEnd) heroStats.push({ label: "Cobertura hasta", value: formatDate(coverageEnd) });
    heroStats.push({ label: "Asistencias recientes", value: String(recentSessions.length) });
  }

  // "Información de tu rol" — ALWAYS rendered now (issue #204: every one of
  // the four role variants has a real title/text/fact set to show there —
  // see `ROLE_COPY` and the module docstring's "Reversed since the #204
  // first pass" note). Not gated on `kind`. `roles` comes from `GET
  // /auth/me`, which BOTH branches fetch, and a representante who is also an
  // alumno is an ordinary account here — so the student branch reaches
  // `assignedRoles.length > 1` too.
  const showsMultiRoleBreakdown = assignedRoles.length > 1;
  const roleCopy = ROLE_COPY[props.role];

  // The page action lives in `PageHeader`'s own row (`.rowline` in the
  // prototype), passed up through `AppShell`.
  //
  // One edit affordance for both branches. The student branch keeps its "Ver
  // portal completo" link beside it: editing a teléfono is not the way out of
  // this screen, and retiring the link to make room would trade a navigation
  // for an edit nobody asked to lose. The trigger is withheld only when there
  // is no `perfil` to seed from — see `startEditing`.
  const profileActions = editing ? (
    <>
      <Button variant="onCoal" onClick={cancelEditing} disabled={saving}>
        <X size={ICON.sm} strokeWidth={1.5} aria-hidden="true" />
        Cancelar
      </Button>
      <Button variant="primary" onClick={() => void handleSave()} disabled={saving}>
        {saving ? (
          <Loader2 size={ICON.sm} className="animate-spin" aria-hidden="true" />
        ) : (
          <Save size={ICON.sm} strokeWidth={1.5} aria-hidden="true" />
        )}
        {saving ? "Guardando…" : "Guardar"}
      </Button>
    </>
  ) : (
    <>
      {perfil !== null && <Button onClick={startEditing}>Editar datos</Button>}
    </>
  );
  // The student portal link stays in the page header: leaving the screen is
  // not a profile action, so it does not belong in the identity band.
  const headerAction =
    !editing && props.kind === "student" ? (
      <Link href="/student" className={buttonClasses("secondary")}>
        Ver portal completo
        <ArrowRight size={ICON.sm} strokeWidth={1.5} aria-hidden="true" />
      </Link>
    ) : undefined;
  const roleTone = ROLE_TONE[props.role];
  const roleShortcuts = shortcutsForRole(props.role);

  return (
    <ProfileShell actions={headerAction} subtitle={roleCopy.lede}>
      {/*
        The compact ~292px panel beside the wide workspace — a `split` (980px)
        breakpoint, not `lg`: below it the panel collapses to a horizontal band
        above the workspace, and both stack to one column on a phone. Not
        `PAGE_RAIL` — that token is the opposite shape (a fluid main column
        plus a fixed-width RIGHT rail); this is a fixed-width LEFT panel plus a
        fluid workspace.

        The left side is a COLUMN now rather than a single card, and it holds
        who the person is to the club: the identity panel and, for anyone with
        a membership, the club's own side of it. It used to hold one short card
        above ~300px of bare canvas — the screen's own copy of the empty space
        the owner complained about, in the first place a reader looks.

        The fix is CONTENT, not a stretch, and that distinction is worth
        stating because the rule of air reads like it offers the other one.
        `items-start` stays: a flex column stretches its children across the
        cross axis, not along the main one, so removing it would stretch this
        wrapper to the workspace's height and leave the cards inside exactly
        where they already are. `margin-top: auto` on a card's footer only
        earns its keep when something actually stretches THE CARD — a row of
        equal-height siblings — and writing it here would have been a comment
        describing a mechanism that never fires.

        What is left over is measured rather than hidden: with the membership
        card the student's column runs to ~660px against the workspace's
        ~810px, and a staff account, which has no membership card, keeps a
        taller gap. Both numbers are in the comparison's "Lo que falta".
      */}
      {/* Hero across the full measure, then two balanced columns: who the
          person is (data, role, dependants) and how the account stands
          (membership, security, activity). */}
      <div data-testid="profile-split" className={PAGE_RAIL}>
      <div className="grid min-w-0 content-start gap-5">
      <IdentityPanel
        name={fullName}
        initials={initials}
        fotoUrl={currentFotoUrl}
        roleLabel={panelRoleLabel}
        statusBadge={statusBadge}
        memberSince={memberSince}
        stats={heroStats}
        correo={correoDisplay}
        uploadingFoto={uploadingFoto}
        fotoError={fotoError}
        fotoInputRef={fotoInputRef}
        onFotoChange={(e) => void handleFotoChange(e)}
        actions={profileActions}
      />

      <div className="grid gap-5 xl:grid-cols-2 xl:items-start">
        <div className="flex min-w-0 flex-col gap-5">
          {/* Datos personales — one datum per row. Correo and Rol are
              deliberately repeated from the identity panel (issue #204's own
              requirement — see the module docstring's "Reversed since the
              #204 first pass" note). */}
          <CardSection
            title="Datos personales"
            subtitle="Información de su cuenta"
            icon={<User size={ICON.sm} strokeWidth={1.5} />}
            tone="info"
            testId="profile-column-info"
          >
            <DetailRow label="Nombres">{fullName}</DetailRow>
            <DetailRow label="Teléfono">
              {editing ? (
                // Issue #1296: the same `PhoneField` every other phone field
                // on the app shares. `hideLabel` keeps "Teléfono" as the
                // field's one accessible name without repeating it visually —
                // `DetailRow` already prints it as this row's own label.
                <PhoneField
                  idPrefix="perfil"
                  label="Teléfono"
                  hideLabel
                  value={telefono}
                  onChange={(value) => {
                    setTelefono(value);
                    setTelefonoError(null);
                  }}
                  error={telefonoError ?? undefined}
                  disabled={saving}
                />
              ) : (
                <DataBox>{telefonoDisplay || "—"}</DataBox>
              )}
            </DetailRow>
            {props.kind === "student" && (
              <p className="border-t border-line bg-sunken px-5 py-3 text-xs text-ink-3-strong">
                Solo el teléfono se puede editar desde aquí. Para corregir otro dato, escriba al
                club.
              </p>
            )}
            {saveError && (
              <p role="alert" className="border-t border-line px-5 py-3 text-sm text-state-bad">
                {saveError}
              </p>
            )}
          </CardSection>

          <CardSection
            title="Información de su rol"
            subtitle={roleCopy.roleCaption}
            icon={<IdCard size={ICON.sm} strokeWidth={1.5} />}
            tone={roleTone}
            testId="profile-role-info"
          >
            <div className="border-b border-line px-5 py-3">
              <h3 className="text-sm font-bold text-ink">{roleCopy.roleTitle}</h3>
              <p className="mt-1 text-xs text-ink-2">
                {roleCopy.roleText(representados.length > 0)}
              </p>
            </div>
            {showsMultiRoleBreakdown && (
              // EVERY assigned role, not just the session's. The session used
              // to collapse an account's backend roles to the single
              // highest-privilege one, so a person who is administrator AND
              // trainer AND representante AND alumno read only "Administrador"
              // here — and the other three appeared nowhere in the product.
              // That collapse is gone (#762) and so is the account shape it
              // described. The session's own role keeps the solid
              // badge; the rest are neutral, so "which one am I using right
              // now" survives.
              <DetailRow label="Roles asignados">
                <div className="flex flex-wrap items-center gap-1.5">
                  {assignedRoles.map((rol) => (
                    <Badge key={rol} tone={rol === sessionBackendRole ? "ok" : "neutral"}>
                      {getBackendRoleLabel(rol)}
                      {rol === sessionBackendRole && (
                        <span className="sr-only"> — rol activo en esta sesión</span>
                      )}
                    </Badge>
                  ))}
                </div>
              </DetailRow>
            )}
            {props.kind === "student" && self && (
              <>
                <DetailRow label="Fecha de nacimiento">
                  {formatDate(self.fechaNacimiento) || "—"}
                </DetailRow>
                {/* The membership FACT is stated once on the whole page —
                      as a badge on the identity panel when there is one, or,
                      only when there is not, as this honest note. */}
                {!membership && (
                  <DetailRow label="Membresía">
                    <MembershipFallback stated={fallbackStatedByDependants} />
                  </DetailRow>
                )}
                {self.representante && (
                  <DetailRow label="Su representante">
                    {`${self.representante.nombres} ${self.representante.apellidos}`.trim()}
                  </DetailRow>
                )}
              </>
            )}
            {props.role === "representante" && (
              <DetailRow label="Personas representadas">{String(representados.length)}</DetailRow>
            )}
            {/* Only when there is no `self` profile at all: a representante
                  who is ALSO an alumno already gets their own membership
                  fact above (the `!membership` row inside the `self` block),
                  and stating it twice would be the exact duplication this
                  redesign otherwise avoids. `self === null` genuinely means
                  "not enrolled as a student" — a definite fact, not the
                  ambiguous "lookup vs. no membership" case that fallback
                  text elsewhere is careful about. */}
            {props.role === "representante" && !self && (
              <DetailRow label="Membresía propia">
                <MembershipFallback stated={fallbackStatedByDependants} />
              </DetailRow>
            )}
          </CardSection>

          {/* Where this role's work happens — the same tiles for every role. */}
          {roleShortcuts.length > 0 && (
            <CardSection
              title="Atajos de su rol"
              subtitle="Ir directo a su trabajo"
              icon={<Zap size={ICON.sm} strokeWidth={1.5} />}
              tone="ball"
              testId="profile-shortcuts"
            >
              <div className="p-4">
                <RoleShortcuts shortcuts={roleShortcuts} tone={roleTone} label="Atajos de su rol" />
              </div>
            </CardSection>
          )}

          {/* Estudiantes a mi cargo — representante only, ALWAYS present for
              that role (even with zero representados: an explicit empty
              state, not a silently missing section), because for a
              representante this is the reason to open the page at all. */}
          {props.kind === "student" && props.role === "representante" && (
            <CardSection
              title="Estudiantes a mi cargo"
              icon={<Users size={ICON.sm} strokeWidth={1.5} />}
              tone="info"
              testId="profile-dependants"
              action={
                <Link href="/student/add-dependent" className={buttonClasses("secondary", "sm")}>
                  + Agregar
                </Link>
              }
            >
              {representados.length > 0 ? (
                <>
                  {representados.map((dependant) => (
                    <DependantRow key={dependant.personaId} profile={dependant} />
                  ))}
                  {fallbackStatedByDependants && (
                    <p className="px-5 py-3 text-xs text-ink-3-strong">
                      «—» indica que no hay membresía visible. {NO_MEMBERSHIP_FALLBACK}.
                    </p>
                  )}
                </>
              ) : (
                <p className="px-5 py-4 text-sm text-ink-2">
                  Todavía no hay estudiantes representados vinculados a esta cuenta.
                </p>
              )}
            </CardSection>
          )}

        </div>

        <div className="flex min-w-0 flex-col gap-5">
          <div className="flex flex-col gap-3">
            {/* Seguridad: the same row shape as "Datos personales", label on
                the left and the action on the right. */}
            <CardSection
              title="Seguridad"
              subtitle="Acciones de acceso"
              icon={<ShieldCheck size={ICON.sm} strokeWidth={1.5} />}
              tone="coal"
              testId="profile-column-status"
            >
              <div className="grid gap-3 p-4 sm:grid-cols-3 xl:grid-cols-1">
                <ActionTile
                  icon={<Lock size={ICON.sm} strokeWidth={1.5} />}
                  tone="ball"
                  title={requestingPassword ? "Enviando…" : "Restablecer por correo"}
                  description="Le enviamos un enlace para restablecer su contraseña"
                  onClick={() => void handleChangePassword()}
                  disabled={requestingPassword || resendSecondsLeft > 0}
                />
                <ActionTile
                  icon={<LogOut size={ICON.sm} strokeWidth={1.5} />}
                  tone="neutral"
                  title="Cerrar sesión"
                  description="Cerrar sesión en este equipo"
                  onClick={() => void logout()}
                />
                <ActionTile
                  icon={<Monitor size={ICON.sm} strokeWidth={1.5} />}
                  tone="warn"
                  title={invalidatingSessions ? "Cerrando…" : "Cerrar otras sesiones"}
                  description="Cierra su sesión en todos los demás dispositivos; este equipo sigue conectado"
                  onClick={() => setConfirmingInvalidation(true)}
                  disabled={invalidatingSessions}
                />
              </div>
            </CardSection>

            <ChangePasswordCard />

            {sessionsMessage && (
              <p role="status" className="text-sm text-state-ok">
                {sessionsMessage}
              </p>
            )}
            {sessionsError && (
              <p role="alert" className="text-sm text-state-bad">
                {sessionsError}
              </p>
            )}

            <ConfirmDialog
              open={confirmingInvalidation}
              variant="danger"
              title="Cerrar otras sesiones"
              message="Se cerrará su sesión en todos los demás dispositivos y navegadores. Este equipo seguirá conectado. ¿Desea continuar?"
              confirmLabel="Cerrar otras sesiones"
              cancelLabel="Cancelar"
              onConfirm={() => void handleInvalidateOtherSessions()}
              onCancel={() => setConfirmingInvalidation(false)}
            />

            {passwordMessage && (
              <div className="grid gap-2">
                <p role="status" className="text-sm text-state-ok">
                  {passwordMessage}
                </p>
                <button
                  type="button"
                  className="justify-self-start text-sm font-semibold underline underline-offset-2 disabled:cursor-not-allowed disabled:no-underline disabled:opacity-60"
                  onClick={() => void handleChangePassword()}
                  disabled={requestingPassword || resendSecondsLeft > 0}
                >
                  Reenviar enlace
                </button>
                {resendSecondsLeft > 0 && (
                  <p className="text-xs text-ink-3-strong">
                    Podrá reenviarlo en {formatCountdown(resendSecondsLeft)}.
                  </p>
                )}
              </div>
            )}
            {passwordError && (
              <p role="alert" className="text-sm text-state-bad">
                {passwordError}
              </p>
            )}
          </div>
          {/* The other field the payload always carried and the screen never
              drew. It goes in the wide column because a row of it is a date, a
              schedule and a state on one line — three things the 292px column
              could not hold without wrapping every row differently. */}
          {recentSessions.length > 0 && <RecentSessionsCard sessions={recentSessions} />}

          {/*
              Lo que cierra el hueco que este archivo venía documentando: "a
              staff account, which has no membership card, keeps a taller gap".
              Va para TODOS los roles, no solo staff -- un alumno también tiene
              derecho a ver desde dónde entró, y con la tarjeta de membresía
              arriba la columna simplemente queda mejor servida.

              Se monta sin condición y decide sola si vale la pena renderizarse:
              sin filas devuelve `null`, y un fallo de red la deja invisible en
              vez de gritar. Es contenido de compañía; nadie abre esta pantalla
              para leerlo.
            */}
          <SessionsCard refreshKey={sessionsRefresh} />

        </div>
      </div>
      </div>

      {/* The rail: who this account is at a glance, the club's side of it
          (membership) and how to keep it safe — always visible. */}
      <div className="grid min-w-0 content-start gap-5">
        <RailCard title="Su cuenta" icon={<User size={ICON.sm} strokeWidth={1.5} />} tone="neutral">
          <AccountSummary
            memberSince={fechaCreacion ? formatDate(fechaCreacion) : null}
            active={props.kind === "staff"}
          />
        </RailCard>
        {selfMembership && (
          <MembershipCard membership={selfMembership} coverageEnd={coverageEnd} />
        )}
        <RailCard title="Cómo proteger su cuenta" icon={<ShieldCheck size={ICON.sm} strokeWidth={1.5} />} tone="coal">
          <ul className="grid list-disc gap-2 pl-4">
            <li>Use una contraseña que no repita en otros sitios y cámbiela si sospecha de un acceso ajeno.</li>
            <li>Si inició sesión en un equipo compartido, use «Cerrar sesión» al terminar.</li>
            <li>Revise «Sus sesiones»: si ve un equipo que no reconoce, use «Cerrar otras sesiones».</li>
            <li>No comparta su contraseña ni el enlace de cambio que le llega por correo.</li>
            <li>El correo de acceso lo gestiona el club; para cambiarlo, escriba a administración.</li>
          </ul>
        </RailCard>
        <RailCard title="Qué hacer si necesita ayuda" icon={<LifeBuoy size={ICON.sm} strokeWidth={1.5} />} tone="ball">
          <p>
            Revise las respuestas en{" "}
            <Link
              href="/ayuda"
              className="font-semibold text-ink underline decoration-line-2 decoration-2 underline-offset-4 hover:decoration-ink"
            >
              Preguntas frecuentes
            </Link>
            .
          </p>
          <p>Si no la encuentra, use «Reportar un problema» en el menú lateral.</p>
          <p>Para corregir su correo, nombres o rol, escriba a la administración del club.</p>
        </RailCard>
      </div>
      </div>
    </ProfileShell>
  );
}

/**
 * The "no membership visible" fact is stated ONCE per page (VIS-14): when the
 * dependants list already carries the sentence, every other field shows "—".
 */
function MembershipFallback({ stated }: { stated: boolean }): React.ReactElement {
  return stated ? (
    <span className="text-sm font-normal text-ink-3">
      <span aria-hidden="true">—</span>
      <span className="sr-only">Sin membresía visible</span>
    </span>
  ) : (
    <span className="text-sm font-normal text-ink-2">{NO_MEMBERSHIP_FALLBACK}</span>
  );
}

/**
 * One dependant row.
 *
 * The membership badge is rendered ONLY when the payload actually carried a
 * `membership` for that dependant, and the "no disponible" note is kept for
 * when it did not. Both halves are load-bearing:
 *
 * - The note used to be unconditional, on the premise that `/membresias/mias`
 *   is only ever scoped to the caller's own persona. That is not what the
 *   route does: `src/app/api/student/route.ts` calls
 *   `/membresias/mias?persona_id={id}` once per profile, and a real
 *   representante session comes back with the dependant's membership filled
 *   in. Printing "no disponible" over data the page is holding is a false
 *   statement, and it was the same false statement on every row.
 * - The note stays for the null case because null is genuinely ambiguous:
 *   `fetchMemberships` returns `[]` both when the dependant has no membership
 *   and when the lookup was refused, and those two must not be collapsed into
 *   "sin membresía".
 */
function DependantRow({ profile }: { profile: StudentProfileSummary }): React.ReactElement {
  const fullName = `${profile.nombres} ${profile.apellidos}`.trim();
  const membership = describeMembership(profile.membership);

  return (
    <DetailRow>
      <span className="flex h-8 w-8 flex-none items-center justify-center rounded-full bg-state-neutral-bg text-2xs tracking-flat font-bold text-state-neutral">
        {personInitials(profile.nombres, profile.apellidos)}
      </span>
      {fullName}
      {membership ? (
        <Badge tone={membership.tone}>{membership.label}</Badge>
      ) : (
        <span className="text-sm font-normal text-ink-3">
          <span aria-hidden="true">—</span>
          <span className="sr-only">Sin membresía visible</span>
        </span>
      )}
    </DetailRow>
  );
}

// ---------------------------------------------------------------------------
// Content — data fetching + role branch into the shared layout
// ---------------------------------------------------------------------------

function ProfileContent(): React.ReactElement | null {
  const { session } = useAuth();
  const role = session?.user.role ?? null;
  const isStudentRole = role !== null && STUDENT_SUMMARY_ROLES.has(role);

  const [staffState, setStaffState] = useState<StaffLoadState>({
    status: "loading",
  });
  const [staffReload, setStaffReload] = useState(0);

  useEffect(() => {
    if (isStudentRole) return;
    let cancelled = false;
    setStaffState({ status: "loading" });
    fetchMiPerfil()
      .then((perfil) => {
        if (!cancelled) setStaffState({ status: "ready", perfil });
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setStaffState({
            status: "error",
            message: toErrorMessage(error, "No se pudo cargar su perfil."),
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [isStudentRole, staffReload]);

  const personaId = session?.user.id ?? "";
  const [studentState, setStudentState] = useState<StudentLoadState>({
    status: "loading",
  });
  const [studentReload, setStudentReload] = useState(0);

  useEffect(() => {
    if (!isStudentRole || !personaId) return;
    let cancelled = false;
    setStudentState({ status: "loading" });
    fetchStudentPortal(personaId)
      .then((data) => {
        if (!cancelled) setStudentState({ status: "ready", data });
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setStudentState({
            status: "error",
            message: toErrorMessage(error, "No se pudo cargar su cuenta."),
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [isStudentRole, personaId, studentReload]);

  // `fetchStudentPortal` carries neither teléfono, fecha de creación nor
  // foto — fetched separately, and supplementary: a failure here must never
  // block or error the rest of the student portal, so it is silently ignored
  // (those rows simply show "—").
  const [studentPerfil, setStudentPerfil] = useState<PerfilPropio | null>(null);

  useEffect(() => {
    if (!isStudentRole) return;
    let cancelled = false;
    fetchMiPerfil()
      .then((perfil) => {
        if (!cancelled) setStudentPerfil(perfil);
      })
      .catch(() => {
        // Supplementary only — see comment above.
      });
    return () => {
      cancelled = true;
    };
  }, [isStudentRole]);

  // The one fact the portal payload cannot carry: the end of PAID coverage.
  // `buildMembershipView` never fills `MembershipSummary.fechaFin`, so the
  // real date is the furthest `fechaFin` among APPROVED payments — the same
  // `resolveCoverageEnd` reading `/student/payments` prints, from the same
  // endpoint, fetched with the same ownership criterion. Supplementary in
  // exactly the way the call above is: a failure drops the "Vigente hasta"
  // row instead of replacing the account with an error.
  const [studentPagos, setStudentPagos] = useState<PagoPersona[]>([]);

  useEffect(() => {
    if (!isStudentRole || !personaId) return;
    let cancelled = false;
    fetchPagosDePersona(personaId)
      .then((pagos) => {
        if (!cancelled) setStudentPagos(pagos);
      })
      .catch(() => {
        // Supplementary only — see comment above.
        if (!cancelled) setStudentPagos([]);
      });
    return () => {
      cancelled = true;
    };
  }, [isStudentRole, personaId]);

  // Cheap, but memoised the way `/student/payments` does it: the list is
  // re-derived on every keystroke of the teléfono field above, and the answer
  // cannot change while the fetched array does not.
  const coverageEnd = useMemo(() => resolveCoverageEnd(studentPagos), [studentPagos]);

  if (role === null) return null;

  // `ProfileLayout` renders its OWN `AppShell` — the page action has to reach
  // `PageHeader`'s row, and the edit state that decides which action it is
  // lives inside the layout. Loading and error get the plain shell.
  if (isStudentRole) {
    if (studentState.status === "ready") {
      return (
        <ProfileLayout
          kind="student"
          role={role}
          data={studentState.data}
          perfil={studentPerfil}
          coverageEnd={coverageEnd}
          sessionEmail={session?.user.email ?? ""}
          sessionName={session?.user.name ?? ""}
          onPerfilUpdated={setStudentPerfil}
        />
      );
    }
  } else if (staffState.status === "ready") {
    return (
      <ProfileLayout
        kind="staff"
        role={role}
        perfil={staffState.perfil}
        accountEmail={staffState.perfil.correo ?? session?.user.email}
        onSaved={(perfil) => setStaffState({ status: "ready", perfil })}
      />
    );
  }

  const pending = isStudentRole ? studentState : staffState;

  return (
    <ProfileShell>
      {pending.status === "loading" ? (
        <LoadingState
          className="min-h-[50vh] justify-center"
          label={isStudentRole ? "Cargando su cuenta…" : "Cargando perfil…"}
        />
      ) : (
        <ErrorState
          message={pending.status === "error" ? pending.message : ""}
          onRetry={() =>
            isStudentRole ? setStudentReload((n) => n + 1) : setStaffReload((n) => n + 1)
          }
        />
      )}
    </ProfileShell>
  );
}

export default function ProfilePage(): React.ReactElement {
  return (
    <ProtectedRoute allowedRoles={["admin", "trainer", "representante", "estudiante", "unsupported"]}>
      <ProfileContent />
    </ProtectedRoute>
  );
}
