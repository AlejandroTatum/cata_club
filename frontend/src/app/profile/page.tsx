/**
 * /profile — the account screen, transcribed from
 * `docs/ux/prototipos/25-perfil.html`.
 *
 * Four blocks at the prototype's 820px measure, not a grid of cramped boxes:
 *
 *   1. `.idcard` — a 72px coal/ball avatar, the name and the correo on the
 *      left; a rail of account facts on the right (rol, membresía, nivel,
 *      miembro desde — whichever of them this account actually has). Per the
 *      prototype's own decision note, "Estado de cuenta" does not earn a
 *      section: it is one binary fact, so it folds in beside the role.
 *   2. "Datos personales" — a list of 56px `.drow`s, ONE datum per row, an
 *      uppercase 150px label on the left and the value in bold on the right.
 *   3. "Seguridad" — the same row pattern, carrying actions instead of values.
 *   4. "Estudiantes a mi cargo" — kept, because for a representante it is the
 *      reason to open this page at all.
 *
 * ## Why the content starts high
 *
 * The page used to open with a "Volver al Panel" link, then a line carrying
 * nothing but "Editar datos", and only then the identity card — which landed
 * at y=317 of a 900px viewport, i.e. ~35% down, with the first two thirds of
 * the screen spent on chrome. Both rows are gone: the action moved into
 * `PageHeader`'s own row (`.rowline` in the prototype) via `AppShell`'s
 * `actions` slot, and the back link went with it because `25-perfil.html`
 * draws none — the shell's sidebar is the way back.
 *
 * Data sources are unchanged:
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
 *   same data `/student` uses — for the membership badge and the dependants
 *   list, PLUS `fetchMiPerfil()` for the identity fields the portal payload
 *   does not carry (teléfono, fecha de creación, foto).
 *
 * Two fields the prototype draws are NOT rendered, because nothing in the API
 * can produce them (see the report accompanying this change):
 *
 * "Cédula" is NOT rendered, because nothing in the API can produce it (see
 * the report accompanying this change): neither `PerfilPropio`
 * (`UsuarioMeResponseDTO`) nor `StudentProfileSummary` carries it. Only the
 * admin-facing `/personas/{id}` does, and that is not readable by the
 * account itself.
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
// `formatLevelName`, not `describeRanking`: this page prints the level beside
// a name and inside a labelled rail, where `describeRanking`'s
// "Sin nivel asignado" / "No disponible" sentences would read as values. The
// level here is either a real level or the slot is dropped.
import { personInitials, formatLevelName } from "@/app/student/student-utils";
import { Badge, Button, ErrorState, LoadingState, buttonClasses } from "@/components/ui";
import type { BadgeTone } from "@/components/ui/Badge";
import { MEMBERSHIP_STATUS_LABELS, MEMBERSHIP_STATUS_TONE } from "@/app/members/members-utils";
// Reused as-is (not duplicated) for consistency — this is the same
// backend-estado -> frontend-estado mapping `members-adapter.ts` reuses;
// it's a pure value object with no server-only APIs, safe in a client bundle.
import { MEMBERSHIP_STATUS_BY_ESTADO } from "@/lib/membership-status";
import { backendRoleForUserRole, getBackendRoleLabel, getRoleLabel } from "@/lib/auth-utils";
import { Loader2, Save, X, Camera, ArrowRight } from "lucide-react";
import { formatDate } from "@/lib/format-utils";

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

/** Roles with no staff profile here — they see the student-branch content in the unified layout instead. */
const STUDENT_SUMMARY_ROLES: ReadonlySet<UserRole> = new Set(["representante", "estudiante"]);

function toErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof ApiClientError) return error.message;
  if (error instanceof Error) return error.message;
  return fallback;
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
// this page is built from. One datum, an uppercase label on the left, the
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
    <div className="flex min-h-drow flex-wrap items-center gap-x-4 gap-y-2 border-b border-line px-5 py-2.5 last:border-b-0">
      {label && (
        <span className="w-[110px] flex-none text-[10.5px] font-bold uppercase tracking-[0.1em] text-ink-3 sm:w-[150px]">
          {label}
        </span>
      )}
      <span className="flex min-w-[9rem] flex-1 flex-wrap items-center gap-x-2 gap-y-0.5 text-sm font-semibold text-ink">
        {children}
        {note && <span className="text-xs font-normal text-ink-3">{note}</span>}
      </span>
      {action && <span className="ml-auto flex-none">{action}</span>}
    </div>
  );
}

/**
 * The shell every state of this page shares. Keeping the eyebrow/title/
 * subtitle in ONE place stops loading, error and the loaded layout from
 * drifting apart now that the loaded layout owns its own `AppShell` (it has
 * to, because the header's action depends on the layout's edit state).
 *
 * The voice is usted: the tú of the auth screens is marketing copy and stops
 * at the door.
 */
function ProfileShell({
  actions,
  children,
}: {
  actions?: React.ReactNode;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <AppShell
      eyebrow="Su cuenta"
      title="Perfil"
      subtitle="Gestione su información y consulte su estado en el club."
      actions={actions}
    >
      {children}
    </AppShell>
  );
}

/**
 * One fact on the identity card's right-hand rail: a 10.5px uppercase label
 * over the value, same label treatment as `.drow .k`.
 *
 * The rail exists because the card used to be an avatar, a name, a correo and
 * a large white void to their right. Every item here is a value the page has
 * already fetched — a slot with no source is not rendered at all.
 */
function IdentityFact({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <div className="min-w-0">
      <p className="mb-1 text-[10.5px] font-bold uppercase tracking-[0.1em] text-ink-3">{label}</p>
      <div className="flex items-center text-sm font-semibold text-ink">{children}</div>
    </div>
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
        <h2 className="flex-1 text-[13px] font-bold text-ink">{title}</h2>
        {action}
      </div>
      {children}
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

  const telefonoDisplay =
    props.kind === "staff" ? props.perfil.telefono : (props.perfil?.telefono ?? "");
  const fechaCreacion = props.kind === "staff" ? props.perfil.fechaCreacion : props.perfil?.fechaCreacion;

  const nivel =
    props.kind === "student" && self && self.ranking.status === "available" && self.ranking.estaEnRanking
      ? formatLevelName(self.ranking.nivelNombre)
      : null;

  // The page action lives in `PageHeader`'s own row (`.rowline` in
  // `25-perfil.html`), passed up through `AppShell`. It used to sit on a line
  // of its own below a "Volver al Panel" link, and those two rows together
  // pushed the identity card to ~35% of the viewport before anything was read.
  const headerAction =
    props.kind === "student" ? (
      <Link href="/student" className={buttonClasses("secondary")}>
        Ver portal completo
        <ArrowRight size={14} strokeWidth={1.5} aria-hidden="true" />
      </Link>
    ) : editing ? (
      <>
        <Button variant="ghost" onClick={cancelEditing} disabled={saving}>
          <X size={14} strokeWidth={1.5} aria-hidden="true" />
          Cancelar
        </Button>
        <Button variant="primary" onClick={() => void handleSave()} disabled={saving}>
          {saving ? (
            <Loader2 size={14} className="animate-spin" aria-hidden="true" />
          ) : (
            <Save size={14} strokeWidth={1.5} aria-hidden="true" />
          )}
          {saving ? "Guardando…" : "Guardar"}
        </Button>
      </>
    ) : (
      <Button onClick={startEditing}>Editar datos</Button>
    );

  return (
    <ProfileShell actions={headerAction}>
      {/* Full content width, like `/dashboard` and like the rest of the family
          area. The prototype's 820px `.canvas` left ~317px of the content
          column empty at 1440 while every admin screen filled it. The identity
          card spans the width it already wanted; below it the page splits into
          the data the reader came to check and the two account controls, which
          are a rail and never needed 820px of their own. */}
      <div className="w-full space-y-5">
      {/* 1 — `.idcard`: the identity on the left, the account facts it can
          prove on the right. */}
      <section
        data-testid="profile-hero"
        className="card flex flex-col gap-5 px-6 py-[22px] sm:flex-row sm:items-center sm:gap-6"
      >
        <div className="flex min-w-0 flex-1 items-center gap-[18px]">
        <div className="relative flex-none">
          <div className="flex h-[72px] w-[72px] items-center justify-center overflow-hidden rounded-full bg-coal text-2xl font-extrabold text-ball">
            {currentFotoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element -- external Cloudinary URL, not a local/static asset
              <img
                src={currentFotoUrl}
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
              <Loader2 size={12} className="animate-spin" aria-hidden="true" />
            ) : (
              <Camera size={12} strokeWidth={2} aria-hidden="true" />
            )}
          </button>
          <input
            ref={fotoInputRef}
            type="file"
            accept="image/jpeg,image/png"
            onChange={(e) => void handleFotoChange(e)}
            className="hidden"
            data-testid="foto-perfil-input"
          />
        </div>
        <div className="min-w-0">
          <p className="text-xl font-bold tracking-[-0.02em] text-ink">{fullName}</p>
          <p className="mt-0.5 text-[13px] text-ink-3">{correoDisplay}</p>
          {fotoError && (
            <p role="alert" className="mt-2 text-xs text-cata-red">
              {fotoError}
            </p>
          )}
        </div>
        </div>

        {/* The rail. Rol and Membresía keep their badge treatment — they are
            states, not free text — while Nivel and Miembro desde read as
            values. Nothing here is derived or estimated: `nivel` is dropped
            outright when the ranking call came back unavailable, and
            "Miembro desde" only appears once `fetchMiPerfil()` has resolved.

            Two facts the prototype draws are still absent, for want of a
            source: "Cuenta activa" (no `activo` flag on `UsuarioMeResponseDTO`)
            and "Cédula" (admin-only, via `/personas/{id}`). */}
        <div className="flex flex-wrap gap-x-8 gap-y-4 border-t border-line pt-5 sm:flex-none sm:border-l sm:border-t-0 sm:pl-6 sm:pt-0">
          {/*
              EVERY assigned role, not just the session's. `mapBackendRoleToUserRole`
              collapses an account's backend roles to the single
              highest-privilege one, so a person who is administrator AND
              trainer AND representante AND alumno used to read "Rol ·
              Administrador" here — and the other three appeared nowhere in the
              product. The session's own role keeps the solid badge; the rest
              are neutral, so "which one am I using right now" survives.
          */}
          <IdentityFact label={assignedRoles.length > 1 ? "Roles asignados" : "Rol"}>
            {/* Capped, and wrapping. The rail is `flex-none`, so four badges
                laid out in one line grew it far enough to break "Admin Dev"
                across two lines — the same squeeze the membership fallback
                below was already capped for. */}
            <div className="flex max-w-[15rem] flex-wrap items-center gap-1.5">
              {assignedRoles.length === 0 ? (
                <Badge>{roleLabel}</Badge>
              ) : (
                assignedRoles.map((rol) => (
                  <Badge key={rol} tone={rol === sessionBackendRole ? "ok" : "neutral"}>
                    {getBackendRoleLabel(rol)}
                    {rol === sessionBackendRole && assignedRoles.length > 1 && (
                      <span className="sr-only"> — rol activo en esta sesión</span>
                    )}
                  </Badge>
                ))
              )}
            </div>
          </IdentityFact>
          {props.kind === "student" && self && (
            <IdentityFact label="Membresía">
              {membership ? (
                <Badge tone={membership.tone}>{membership.label}</Badge>
              ) : (
                // Capped measure: at its natural width this 45-character
                // sentence is the widest thing in the rail, and the rail is
                // `flex-none`, so it was squeezing the account holder's own
                // name onto two lines beside it.
                <span className="max-w-[22ch] text-xs font-normal text-ink-3">
                  {NO_MEMBERSHIP_FALLBACK}
                </span>
              )}
            </IdentityFact>
          )}
          {nivel && <IdentityFact label="Nivel">{nivel}</IdentityFact>}
          {fechaCreacion && (
            <IdentityFact label="Miembro desde">{formatDate(fechaCreacion)}</IdentityFact>
          )}
        </div>
      </section>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_380px] lg:items-start">
      <div className="flex min-w-0 flex-col gap-5">
      {/* 2 — Datos personales, one datum per 56px row. */}
      <CardSection title="Datos personales" testId="profile-column-info">
        <DetailRow label="Nombres">{fullName}</DetailRow>
        <DetailRow label="Correo" note="Lo gestiona el club, no se edita aquí">
          {correoDisplay}
        </DetailRow>
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
            telefonoDisplay || "—"
          )}
        </DetailRow>
        {/* "Miembro desde" is NOT a row: it is account metadata, it lives on
            the identity card's rail, and repeating it here would be the same
            datum printed twice on one screen. */}
        {/* A note ABOUT the card, not a datum in it — so it sits on `sunken`
            below the rows instead of occupying a 56px `.drow` with an empty
            label column, which is what it did before. */}
        {props.kind === "student" && (
          <p className="border-t border-line bg-sunken px-5 py-3 text-[12.5px] text-ink-3-strong">
            Esta información no se puede editar desde aquí. Escriba al club para corregirla.
          </p>
        )}
        {saveError && (
          <p role="alert" className="border-t border-line px-5 py-3 text-sm text-cata-red">
            {saveError}
          </p>
        )}
      </CardSection>

      {/* 4 — Estudiantes a mi cargo. For a representante this is the reason to
          open the page, so it stays — and it belongs beside the reader's own
          data, not below the two account controls. */}
      {props.kind === "student" && representados.length > 0 && (
        <CardSection
          title="Estudiantes a mi cargo"
          action={
            <Link href="/student/add-dependent" className={buttonClasses("secondary", "sm")}>
              + Agregar
            </Link>
          }
        >
          {representados.map((dependant) => (
            <DependantRow key={dependant.personaId} profile={dependant} />
          ))}
        </CardSection>
      )}
      </div>

      <div className="flex flex-col gap-3">
      {/* 3 — Seguridad: the same 56px row shape as "Datos personales", label
          on the left and the action on the right. The two rows used to put
          "Contraseña" in the VALUE column with no label at all, which broke
          the page's own grammar three rows after establishing it — and left
          the reader guessing what the button beside a bare noun would do.

          Three rows now (E01, slice B4): `POST /auth/sesiones/invalidar`
          exists, so "Otras sesiones" is no longer a button that cannot do
          what it says. */}
      <CardSection title="Seguridad" testId="profile-column-status">
        <DetailRow
          label="Contraseña"
          action={
            <Button size="sm" onClick={() => void handleChangePassword()} disabled={requestingPassword}>
              {requestingPassword ? "Enviando…" : "Cambiar contraseña"}
            </Button>
          }
        >
          <span className="text-[13px] font-normal text-ink-2">
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
          <span className="text-[13px] font-normal text-ink-2">
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
          <span className="text-[13px] font-normal text-ink-2">
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
        <p role="alert" className="text-sm text-cata-red">
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
        <p role="alert" className="text-sm text-cata-red">
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
  const nivel =
    profile.ranking.status === "available" && profile.ranking.estaEnRanking
      ? formatLevelName(profile.ranking.nivelNombre)
      : null;

  return (
    <DetailRow note={membership ? undefined : NO_MEMBERSHIP_FALLBACK}>
      <span className="flex h-8 w-8 flex-none items-center justify-center rounded-full bg-state-neutral-bg text-[10px] font-bold text-state-neutral">
        {personInitials(profile.nombres, profile.apellidos)}
      </span>
      {fullName}
      {membership && <Badge tone={membership.tone}>{membership.label}</Badge>}
      {nivel && <span className="text-xs font-normal text-ink-3">{nivel}</span>}
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
