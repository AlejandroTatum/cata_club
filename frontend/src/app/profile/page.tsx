/**
 * /profile — the account screen, rebuilt for issue #204 from
 * `docs/ux/prototipos/30-perfil-rediseño.html` (visual reference only — never
 * a source of logic or data; every field below still traces back to a real
 * API response).
 *
 * Two regions, not four stacked blocks:
 *
 *   1. `IdentityPanel` — a COMPACT ~292px white panel, clearly its own
 *      surface (never a second coal mass beside the sidebar): the coal
 *      avatar, the name/role/status "quick recognition" block, and — in its
 *      own full-width row — "Correo de acceso". The institutional-red field
 *      across the top and the yellow dot inside it are the one brand
 *      gesture; the avatar sits astride the red/white boundary.
 *   2. The workspace — "Datos personales" (one datum per `DetailRow`),
 *      "Información de tu rol" (role-specific facts the panel's fixed shape
 *      cannot itself state — only rendered when there IS something to add),
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
 * Two fields the prototype draws are NOT rendered, because nothing in the API
 * can produce them: "Cédula" (only the admin-facing `/personas/{id}` carries
 * it, and that is not readable by the account itself) and "Cuenta activa"
 * (no `activo` flag on `UsuarioMeResponseDTO`) — a staff account's quick
 * block therefore shows no status badge at all, honestly, rather than one
 * invented as always-on.
 */

"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import ProtectedRoute from "@/components/ProtectedRoute";
import AppShell from "@/components/shell/AppShell";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/contexts/ToastContext";
import {
  fetchMiPerfil,
  actualizarMiPerfil,
  solicitarRecuperacion,
  fetchStudentPortal,
  subirFotoPerfil,
  invalidarOtrasSesiones,
  ApiClientError,
} from "@/services/api";
import ConfirmDialog from "@/components/ConfirmDialog";
import type { StudentPortalSummary, StudentProfileSummary, MembershipSummary } from "@/services/api";
import type { PerfilPropio, UserRole } from "@/types/domain";
import { personInitials } from "@/app/student/student-utils";
import {
  Badge,
  Button,
  DataBox,
  ErrorState,
  LoadingState,
  buttonClasses,
} from "@/components/ui";
import type { BadgeTone } from "@/components/ui/Badge";
import { MEMBERSHIP_STATUS_LABELS, MEMBERSHIP_STATUS_TONE } from "@/app/members/members-utils";
// Reused as-is (not duplicated) for consistency — this is the same
// backend-estado -> frontend-estado mapping `members-adapter.ts` reuses;
// it's a pure value object with no server-only APIs, safe in a client bundle.
import { MEMBERSHIP_STATUS_BY_ESTADO } from "@/lib/membership-status";
import { backendRoleForUserRole, getBackendRoleLabel, getRoleLabel } from "@/lib/auth-utils";
import { Loader2, Save, X, Camera, ArrowRight } from "lucide-react";
import { ICON } from "@/lib/icon-size";
import { formatDate } from "@/lib/format-utils";
import { toUserMessage } from "@/lib/error-message";

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

/** Roles with no staff profile here — they see the student-branch content in the unified layout instead. */
const STUDENT_SUMMARY_ROLES: ReadonlySet<UserRole> = new Set(["representante", "estudiante"]);

function toErrorMessage(error: unknown, fallback: string): string {
  return toUserMessage(error, fallback);
}

function describeMembership(membership: MembershipSummary | null): { label: string; tone: BadgeTone } | null {
  if (!membership) return null;
  const estado = MEMBERSHIP_STATUS_BY_ESTADO[membership.estado as keyof typeof MEMBERSHIP_STATUS_BY_ESTADO];
  return { label: MEMBERSHIP_STATUS_LABELS[estado], tone: MEMBERSHIP_STATUS_TONE[estado] };
}

const NO_MEMBERSHIP_FALLBACK = "No disponible — consulte con administración";

// Mirrors the backend's own allow-list (`TIPOS_MIME_PERMITIDOS_FOTO_PERFIL` /
// `TAMANO_MAXIMO_FOTO_PERFIL_BYTES` in auth_servicio.py) so an invalid file
// is rejected immediately, without a round trip to the server.
const TIPOS_FOTO_PERFIL_PERMITIDOS = new Set(["image/jpeg", "image/png"]);
const TAMANO_MAXIMO_FOTO_PERFIL_BYTES = 5 * 1024 * 1024;

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
  children,
  note,
  action,
}: {
  label?: string;
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
      {label && (
        // Grey and normal weight, not bold uppercase caps: the label only
        // has to orient, the VALUE is what the reader came to read. Bold
        // uppercase at the same size as the value made the two compete for
        // attention instead of one leading the other.
        <span className="w-[110px] flex-none text-xs text-ink-3 sm:w-[150px]">
          {label}
        </span>
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
  children,
}: {
  actions?: React.ReactNode;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <AppShell title="Perfil" actions={actions}>
      {children}
    </AppShell>
  );
}

function CardSection({
  title,
  action,
  testId,
  children,
}: {
  title: string;
  action?: React.ReactNode;
  testId?: string;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <section data-testid={testId} className="card overflow-hidden">
      <div className="flex items-center gap-3 border-b border-line px-5 py-4">
        <h2 className="flex-1 text-sm font-bold text-ink">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

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
  /** Pre-formatted, e.g. "Miembro desde 10/03/2024" or the "—" fallback. */
  memberSince: string;
  correo: string;
  uploadingFoto: boolean;
  fotoError: string | null;
  fotoInputRef: React.RefObject<HTMLInputElement>;
  onFotoChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
}

function IdentityPanel({
  name,
  initials,
  fotoUrl,
  roleLabel,
  statusBadge,
  memberSince,
  correo,
  uploadingFoto,
  fotoError,
  fotoInputRef,
  onFotoChange,
}: IdentityPanelProps): React.ReactElement {
  return (
    <section
      data-testid="profile-hero"
      aria-label={`Identidad de la cuenta de ${name}`}
      className="card relative flex-none overflow-hidden split:w-[292px]"
    >
      {/* The one club gesture: an asymmetric red field bridging into the
          white body, with the yellow dot as the only secondary mark. */}
      <div
        aria-hidden="true"
        className="absolute inset-x-0 top-0 h-[100px] bg-cata-red [clip-path:polygon(0_0,100%_0,100%_68%,72%_100%,0_86%)]"
      />
      <span
        aria-hidden="true"
        className="absolute right-6 top-[62px] h-4 w-4 rounded-full border-[3px] border-cata-red bg-cata-yellow"
      />

      {/*
        The identity block clears the red field entirely — `pt-[112px]` against
        a 100px field whose deepest point (the polygon's 72% vertex) is exactly
        100px down. It has to: `text-ink` (#17181C) on `cata-red` (#D92128) is
        3.6:1, under AA, and at `pt-8` the name, the badges and "Miembro desde"
        all rendered ON the red — the last one straddling its edge, grey on red
        at ~1.1:1. Text belongs on the white body; the red is a field, not a
        backdrop for copy.

        `items-start`, not `items-end`: the text column is taller than the
        avatar, so bottom-aligning pinned the text to the top of the row and put
        it back under the red. Aligned to the top, the avatar's `-mt-9` lifts it
        (72px tall, spanning 76px–148px) across the red/white boundary, which
        at its own x sits at 87–92px — the "avatar carbón puenteando" the issue
        asks for, now the only thing crossing that edge.
      */}
      <div className="relative flex items-start gap-4 px-5 pb-4 pt-[112px]">
        <div className="relative -mt-9 flex-none">
          <div className="flex h-[72px] w-[72px] items-center justify-center overflow-hidden rounded-full border-4 border-paper bg-coal text-xl font-extrabold text-ball shadow-elevated">
            {fotoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element -- external Cloudinary URL, not a local/static asset
              <img
                src={fotoUrl}
                alt="Foto de perfil"
                className="h-[72px] w-[72px] rounded-full object-cover"
              />
            ) : (
              <span aria-hidden="true">{initials}</span>
            )}
          </div>
          <button
            type="button"
            onClick={() => fotoInputRef.current?.click()}
            disabled={uploadingFoto}
            aria-label="Cambiar foto de perfil"
            className="absolute -bottom-0.5 -right-0.5 flex h-7 w-7 items-center justify-center rounded-full border-2 border-paper bg-coal text-white disabled:opacity-45"
          >
            {uploadingFoto ? (
              <Loader2 size={ICON.sm} className="animate-spin" aria-hidden="true" />
            ) : (
              <Camera size={ICON.sm} strokeWidth={2} aria-hidden="true" />
            )}
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

        {/* The "quick recognition" block: name, role, and — only when there
            is a real one — estado. */}
        <div className="min-w-0 flex-1 pb-1">
          <h2 className="break-words text-lg font-extrabold leading-tight text-ink">{name}</h2>
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <Badge tone="neutral">{roleLabel}</Badge>
            {statusBadge && <Badge tone={statusBadge.tone}>{statusBadge.label}</Badge>}
          </div>
          {/* Account metadata, not personal data — it lives HERE only. Repeating
              it as a "Datos personales" row would be the same fact printed
              twice on one screen. */}
          <p className="mt-2 text-xs text-ink-3">{memberSince}</p>
        </div>
      </div>

      {fotoError && (
        <p role="alert" className="px-5 pb-3 text-xs text-state-bad">
          {fotoError}
        </p>
      )}

      {/* The one full-width row at the foot of the panel — never squeezed
          beside anything else, so the full correo always has the panel's
          whole width to wrap into. */}
      <div className="border-t border-line bg-sunken px-5 py-3">
        <p className="text-2xs font-bold uppercase tracking-wide text-ink-3">Correo de acceso</p>
        <p className="mt-1 break-words text-sm font-semibold text-ink">{correo}</p>
        <p className="mt-1 text-xs text-ink-3">El correo lo gestiona el club, no se edita aquí.</p>
      </div>
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
      sessionEmail: string;
      sessionName: string;
      onPerfilUpdated: (perfil: PerfilPropio) => void;
    };

function ProfileLayout(props: ProfileLayoutProps): React.ReactElement {
  const { showSuccess, showError } = useToast();
  const { logout } = useAuth();

  // ---- Staff-only inline edit state. Always declared (hooks can't be
  // conditional) — simply unused on the student branch. ----
  const [editing, setEditing] = useState(false);
  const [telefono, setTelefono] = useState(props.kind === "staff" ? props.perfil.telefono : "");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const [requestingPassword, setRequestingPassword] = useState(false);
  const [passwordMessage, setPasswordMessage] = useState<string | null>(null);
  const [passwordError, setPasswordError] = useState<string | null>(null);

  // ---- "Cerrar otras sesiones" (E01, slice B4) ---------------------------
  const [confirmingInvalidation, setConfirmingInvalidation] = useState(false);
  const [invalidatingSessions, setInvalidatingSessions] = useState(false);
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

    if (!TIPOS_FOTO_PERFIL_PERMITIDOS.has(archivo.type)) {
      setFotoError("Formato no válido. Solo se permiten imágenes JPG o PNG.");
      return;
    }
    if (archivo.size > TAMANO_MAXIMO_FOTO_PERFIL_BYTES) {
      setFotoError("La imagen supera el tamaño máximo permitido (5 MB).");
      return;
    }

    setUploadingFoto(true);
    setFotoError(null);
    try {
      const updated = await subirFotoPerfil(archivo);
      if (props.kind === "staff") {
        props.onSaved(updated);
      } else {
        props.onPerfilUpdated(updated);
      }
      showSuccess("Foto de perfil actualizada correctamente.");
    } catch (error: unknown) {
      const message = toErrorMessage(error, "No se pudo actualizar la foto de perfil.");
      setFotoError(message);
      showError(message);
    } finally {
      setUploadingFoto(false);
    }
  }

  function startEditing(): void {
    if (props.kind !== "staff") return;
    setTelefono(props.perfil.telefono);
    setSaveError(null);
    setEditing(true);
  }

  function cancelEditing(): void {
    if (props.kind !== "staff") return;
    setTelefono(props.perfil.telefono);
    setSaveError(null);
    setEditing(false);
  }

  async function handleSave(): Promise<void> {
    if (props.kind !== "staff") return;
    const current = props.perfil;
    setSaving(true);
    setSaveError(null);
    try {
      // Correo is never sent here — it's the JWT `sub` claim, and self-service
      // editing was removed by design (see auth_servicio.py).
      const updated = await actualizarMiPerfil({ telefono: telefono.trim() });
      props.onSaved(updated);
      setEditing(false);
      showSuccess("Perfil actualizado correctamente.");
    } catch (error: unknown) {
      // Revert — a rejected edit must never be left displayed as if it were
      // persisted (no silent data loss, per spec).
      setTelefono(current.telefono);
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
      const result = await solicitarRecuperacion(
        props.kind === "staff" ? props.accountEmail : correoDisplay,
      );
      setPasswordMessage(result.mensaje);
      showSuccess(result.mensaje);
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

  const fullName =
    props.kind === "staff"
      ? `${props.perfil.nombres} ${props.perfil.apellidos}`.trim()
      : self
        ? `${self.nombres} ${self.apellidos}`.trim()
        : props.sessionName;

  const roleLabel = getRoleLabel(props.role);
  /**
   * Every role the backend has on this account. `PerfilPropio` is fetched on
   * both branches (`GET /auth/me`), so a multi-role representante/alumno is
   * covered too; it is only `null` while the student branch's own profile call
   * is still in flight, and then the session's single role is all there is.
   */
  const assignedRoles = props.perfil?.roles ?? [];
  const sessionBackendRole = backendRoleForUserRole(props.role);
  const membership = props.kind === "student" && self ? describeMembership(self.membership) : null;
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
  const panelRoleLabel = assignedRoles.length > 1 ? `${assignedRoles.length} roles asignados` : roleLabel;

  const telefonoDisplay =
    props.kind === "staff" ? props.perfil.telefono : (props.perfil?.telefono ?? "");
  const fechaCreacion = props.kind === "staff" ? props.perfil.fechaCreacion : props.perfil?.fechaCreacion;
  const memberSince = fechaCreacion ? `Miembro desde ${formatDate(fechaCreacion)}` : "Miembro desde —";

  // The quick-recognition badge in the identity panel — only when there IS a
  // real membership status to report. When `self` exists but has no
  // membership row, the honest "no disponible" note lives in "Información de
  // tu rol" instead (see below): a fact is stated exactly once, never both as
  // a badge here AND as text there.
  const statusBadge = props.kind === "student" && self ? membership : null;

  // "Información de tu rol" — role-specific facts the panel's fixed shape
  // cannot itself state. Only rendered when there is something real to add:
  // a single-role staff account has nothing beyond the badge already on the
  // panel, so (per this codebase's existing discipline — see the multi-role
  // rail this replaces) that section is simply absent for it.
  //
  // Not gated on `kind`. `roles` comes from `GET /auth/me`, which BOTH
  // branches fetch, and a representante who is also an alumno is an ordinary
  // account here — so the student branch reaches `assignedRoles.length > 1`
  // too. Gating this on staff left exactly the dangling label this redesign
  // exists to remove: the panel badge reads "2 roles asignados" (that label
  // has no `kind` guard either) while nothing on the page said WHICH two.
  const showsMultiRoleBreakdown = assignedRoles.length > 1;
  const showsStudentRoleInfo =
    props.kind === "student" && (self !== null || props.role === "representante");
  const showsRoleInfo = showsMultiRoleBreakdown || showsStudentRoleInfo;

  // The page action lives in `PageHeader`'s own row (`.rowline` in the
  // prototype), passed up through `AppShell`.
  const headerAction =
    props.kind === "student" ? (
      <Link href="/student" className={buttonClasses("secondary")}>
        Ver portal completo
        <ArrowRight size={ICON.sm} strokeWidth={1.5} aria-hidden="true" />
      </Link>
    ) : editing ? (
      <>
        <Button variant="ghost" onClick={cancelEditing} disabled={saving}>
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
      <Button onClick={startEditing}>Editar datos</Button>
    );

  return (
    <ProfileShell actions={headerAction}>
      {/* The compact ~292px panel beside the wide workspace — a `split`
          (980px) breakpoint, not `lg`: below it the panel collapses to a
          horizontal band above the workspace, and both stack to one column
          on a phone. Not `PAGE_RAIL` — that token is the opposite shape (a
          fluid main column plus a fixed-width RIGHT rail); this is a
          fixed-width LEFT panel plus a fluid workspace. */}
      <div className="flex flex-col gap-5 split:flex-row split:items-start split:gap-6">
        <IdentityPanel
          name={fullName}
          initials={initials}
          fotoUrl={currentFotoUrl}
          roleLabel={panelRoleLabel}
          statusBadge={statusBadge}
          memberSince={memberSince}
          correo={correoDisplay}
          uploadingFoto={uploadingFoto}
          fotoError={fotoError}
          fotoInputRef={fotoInputRef}
          onFotoChange={(e) => void handleFotoChange(e)}
        />

        <div className="flex min-w-0 flex-1 flex-col gap-5">
          {/* Datos personales — one datum per row. Correo is NOT a row here:
              it lives on the identity panel only. */}
          <CardSection title="Datos personales" testId="profile-column-info">
            <DetailRow label="Nombres">{fullName}</DetailRow>
            <DetailRow label="Teléfono">
              {props.kind === "staff" && editing ? (
                <input
                  id="perfil-telefono"
                  type="tel"
                  inputMode="tel"
                  aria-label="Teléfono"
                  value={telefono}
                  onChange={(e) => setTelefono(e.target.value)}
                  disabled={saving}
                  className="input-field max-w-xs"
                />
              ) : (
                <DataBox>{telefonoDisplay || "—"}</DataBox>
              )}
            </DetailRow>
            {props.kind === "student" && (
              <p className="border-t border-line bg-sunken px-5 py-3 text-xs text-ink-3-strong">
                Esta información no se puede editar desde aquí. Escriba al club para corregirla.
              </p>
            )}
            {saveError && (
              <p role="alert" className="border-t border-line px-5 py-3 text-sm text-state-bad">
                {saveError}
              </p>
            )}
          </CardSection>

          {showsRoleInfo && (
            <CardSection title="Información de tu rol" testId="profile-role-info">
              {showsMultiRoleBreakdown && (
                // EVERY assigned role, not just the session's. `mapBackendRoleToUserRole`
                // collapses an account's backend roles to the single
                // highest-privilege one, so a person who is administrator AND
                // trainer AND representante AND alumno used to read only
                // "Administrador" here — and the other three appeared nowhere
                // in the product. The session's own role keeps the solid
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
                      <span className="text-sm font-normal text-ink-2">{NO_MEMBERSHIP_FALLBACK}</span>
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
            </CardSection>
          )}

          {/* Estudiantes a mi cargo — representante only, ALWAYS present for
              that role (even with zero representados: an explicit empty
              state, not a silently missing section), because for a
              representante this is the reason to open the page at all. */}
          {props.kind === "student" && props.role === "representante" && (
            <CardSection
              title="Estudiantes a mi cargo"
              testId="profile-dependants"
              action={
                <Link href="/student/add-dependent" className={buttonClasses("secondary", "sm")}>
                  + Agregar
                </Link>
              }
            >
              {representados.length > 0 ? (
                representados.map((dependant) => (
                  <DependantRow key={dependant.personaId} profile={dependant} />
                ))
              ) : (
                <p className="px-5 py-4 text-sm text-ink-2">
                  Todavía no hay estudiantes representados vinculados a esta cuenta.
                </p>
              )}
            </CardSection>
          )}

          <div className="flex flex-col gap-3">
            {/* Seguridad: the same row shape as "Datos personales", label on
                the left and the action on the right. */}
            <CardSection title="Seguridad" testId="profile-column-status">
              <DetailRow
                label="Contraseña"
                action={
                  <Button size="sm" onClick={() => void handleChangePassword()} disabled={requestingPassword}>
                    {requestingPassword ? "Enviando…" : "Cambiar contraseña"}
                  </Button>
                }
              >
                <span className="text-sm font-normal text-ink-2">
                  Le enviamos un enlace de cambio a su correo
                </span>
              </DetailRow>
              <DetailRow
                label="Sesión"
                action={
                  <Button size="sm" onClick={() => void logout()}>
                    Salir
                  </Button>
                }
              >
                <span className="text-sm font-normal text-ink-2">
                  Cerrar sesión en este equipo
                </span>
              </DetailRow>
              <DetailRow
                label="Otras sesiones"
                action={
                  <Button
                    size="sm"
                    onClick={() => setConfirmingInvalidation(true)}
                    disabled={invalidatingSessions}
                  >
                    {invalidatingSessions ? "Cerrando…" : "Cerrar otras sesiones"}
                  </Button>
                }
              >
                <span className="text-sm font-normal text-ink-2">
                  Cierra su sesión en todos los demás dispositivos; este equipo sigue conectado
                </span>
              </DetailRow>
            </CardSection>

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
              <p role="status" className="text-sm text-state-ok">
                {passwordMessage}
              </p>
            )}
            {passwordError && (
              <p role="alert" className="text-sm text-state-bad">
                {passwordError}
              </p>
            )}
          </div>
        </div>
      </div>
    </ProfileShell>
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
    <DetailRow note={membership ? undefined : NO_MEMBERSHIP_FALLBACK}>
      <span className="flex h-8 w-8 flex-none items-center justify-center rounded-full bg-state-neutral-bg text-2xs tracking-flat font-bold text-state-neutral">
        {personInitials(profile.nombres, profile.apellidos)}
      </span>
      {fullName}
      {membership && <Badge tone={membership.tone}>{membership.label}</Badge>}
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

  const [staffState, setStaffState] = useState<StaffLoadState>({ status: "loading" });
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
  const [studentState, setStudentState] = useState<StudentLoadState>({ status: "loading" });
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
    <ProtectedRoute
      allowedRoles={["admin", "trainer", "representante", "estudiante"]}
    >
      <ProfileContent />
    </ProtectedRoute>
  );
}
