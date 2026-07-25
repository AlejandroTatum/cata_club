/**
 * /profile — unified "Mi cuenta" account screen (issue #36, redesign).
 *
 * ONE shared page layout (header, hero card, 3-column grid, bottom banner)
 * whose CONTENT swaps by role — not two separate top-level views. All data
 * still comes from the same sources as before:
 *
 * - ADMINISTRADOR/ENTRENADOR ("tesorero" falls through to this same branch
 *   too — it's a dead backend role no real account can carry anymore, see
 *   prior design decision) fetch their own identity via `fetchMiPerfil()`
 *   (`GET /api/auth/me`). Nombres, apellidos, roles, and correo are
 *   read-only; teléfono is edited inline (`actualizarMiPerfil()`, `PATCH
 *   /api/auth/me`) from the "Información personal" column. Correo is
 *   intentionally NOT editable here — it's the JWT `sub` claim, and
 *   self-service editing was removed by design (see auth_servicio.py).
 *   "Cambiar contraseña" (in "Estado de cuenta") reuses the existing
 *   unauthenticated recovery-email flow against the user's own known correo.
 *
 * - ALUMNO / representante-linked accounts fetch `fetchStudentPortal()` —
 *   the same data `/student` uses. The hero card summarizes the caller's
 *   own (`self`) ranking + membership; any managed dependents
 *   (`representados`) get their own read-only summary cards below the grid
 *   (ranking + membership, with the honest "no disponible" fallback for
 *   membership since the backend never scopes a dependent's membership to
 *   the caller — only the caller's own `/membresias/mias` row is real).
 *   `fetchStudentPortal` carries no photo field, so this branch ALSO makes
 *   a supplementary `fetchMiPerfil()` call purely to read `fotoUrl` for the
 *   hero avatar — failures there are swallowed silently (cosmetic only,
 *   never blocks the rest of the student portal).
 *
 * Profile photo upload (`POST /api/auth/me/foto`) is self-service and
 * role-agnostic on the backend, so BOTH branches can upload/replace their
 * own hero avatar — not staff-only.
 *
 * History: issue #35 was a same-for-all-roles "under construction"
 * placeholder. Issue #36 first pass redirected estudiante/representante to
 * `/student`; a follow-up replaced that redirect with a read-only summary
 * view; a later pass unified the staff and student views into one shared
 * page structure; this pass extends photo upload (originally staff-only)
 * to the student/representante branch too.
 */

"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import ProtectedRoute from "@/components/ProtectedRoute";
import AppShell from "@/components/shell/AppShell";
import BackLink from "@/components/BackLink";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/contexts/ToastContext";
import {
  fetchMiPerfil,
  actualizarMiPerfil,
  solicitarRecuperacion,
  fetchStudentPortal,
  subirFotoPerfil,
  ApiClientError,
} from "@/services/api";
import type { StudentPortalSummary, StudentProfileSummary, MembershipSummary } from "@/services/api";
import type { PerfilPropio, UserRole } from "@/types/domain";
import { describeRanking } from "@/app/student/student-utils";
import { Badge, ErrorState, LoadingState } from "@/components/ui";
import type { BadgeTone } from "@/components/ui/Badge";
import { MEMBERSHIP_STATUS_LABELS, MEMBERSHIP_STATUS_TONE } from "@/app/members/members-utils";
// Reused as-is (not duplicated) for consistency — this is the same
// backend-estado -> frontend-estado mapping `members-adapter.ts` reuses;
// it's a pure value object with no server-only APIs, safe in a client bundle.
import { MEMBERSHIP_STATUS_BY_ESTADO } from "@/lib/membership-status";
import { getRoleLabel } from "@/lib/auth-utils";
import {
  User,
  Loader2,
  Pencil,
  Save,
  X,
  KeyRound,
  CheckCircle2,
  Mail,
  Phone,
  Shield,
  Calendar,
  Trophy,
  ShieldCheck,
  ArrowRight,
  AlertTriangle,
  Camera,
} from "lucide-react";
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

function firstNameOf(fullName: string): string {
  return fullName.trim().split(/\s+/)[0] || fullName;
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

// The local `LoadingBlock` (plain text, no indicator) and `ErrorBlock` (a
// fifth error shape, whose icon was optional so the same failure looked
// different depending on which branch produced it) are gone. Both branches now
// render the shared `LoadingState` / `ErrorState`.

// ---------------------------------------------------------------------------
// Representado summary card — read-only, same data source as /student
// (fetchStudentPortal), used below the main grid for a representante's
// managed dependents. Kept as its own small component (pre-existing pattern
// from the previous iteration of this page), just no longer used for the
// caller's own (self) profile — that's now integrated into the hero card.
// ---------------------------------------------------------------------------

interface StudentSummaryCardProps {
  profile: StudentProfileSummary;
}

function StudentSummaryCard({ profile }: StudentSummaryCardProps): React.ReactElement {
  const ranking = describeRanking(profile.ranking);
  const membership = describeMembership(profile.membership);
  const fullName = `${profile.nombres} ${profile.apellidos}`.trim();

  return (
    <div className="card p-5 sm:p-6">
      <div className="mb-4 flex items-center gap-3">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-cata-red/10">
          <User size={20} className="text-cata-red" strokeWidth={1.5} aria-hidden="true" />
        </div>
        <h3 className="text-base font-bold tracking-tight text-cata-text">{fullName}</h3>
      </div>

      <dl className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <dt className="flex items-center gap-1.5 text-xs font-medium text-cata-text/65">
            <Trophy size={13} strokeWidth={1.5} aria-hidden="true" />
            Ranking
          </dt>
          <dd className="text-sm font-medium text-cata-text">{ranking.label}</dd>
        </div>
        <div className="flex items-center justify-between gap-3">
          <dt className="flex items-center gap-1.5 text-xs font-medium text-cata-text/65">
            <ShieldCheck size={13} strokeWidth={1.5} aria-hidden="true" />
            Membresía
          </dt>
          <dd>
            {membership ? (
              <Badge tone={membership.tone}>{membership.label}</Badge>
            ) : (
              <span className="text-sm text-cata-text/65">{NO_MEMBERSHIP_FALLBACK}</span>
            )}
          </dd>
        </div>
      </dl>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Unified layout — header + hero + 3-column grid + banner. Content within
// each shared section branches by `kind` ("staff" vs "student"); the page
// structure itself is a single tree, not two separate top-level views.
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
      sessionEmail: string;
      sessionName: string;
      fotoUrl?: string | null;
      onFotoUpdated: (fotoUrl: string | null | undefined) => void;
    };

function ProfileLayout(props: ProfileLayoutProps): React.ReactElement {
  const { showSuccess, showError } = useToast();
  // ---- Staff-only inline edit / change-password state. Always declared
  // (hooks can't be conditional) — simply unused on the student branch. ----
  const [editing, setEditing] = useState(false);
  const [telefono, setTelefono] = useState(props.kind === "staff" ? props.perfil.telefono : "");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState(false);

  const [requestingPassword, setRequestingPassword] = useState(false);
  const [passwordMessage, setPasswordMessage] = useState<string | null>(null);
  const [passwordError, setPasswordError] = useState<string | null>(null);

  // ---- Profile photo upload — the caller's own hero avatar, for BOTH
  // branches. `POST /auth/me/foto` is self-service and role-agnostic; only
  // the SOURCE of the current `fotoUrl` differs (the staff branch's fetched
  // `PerfilPropio`, vs the student branch's separately-fetched `fotoUrl`
  // prop, since `fetchStudentPortal` itself carries no photo field). ----
  const fotoInputRef = useRef<HTMLInputElement>(null);
  const [uploadingFoto, setUploadingFoto] = useState(false);
  const [fotoError, setFotoError] = useState<string | null>(null);
  const [fotoSuccess, setFotoSuccess] = useState(false);

  const currentFotoUrl = props.kind === "staff" ? props.perfil.fotoUrl : props.fotoUrl;

  async function handleFotoChange(e: React.ChangeEvent<HTMLInputElement>): Promise<void> {
    const archivo = e.target.files?.[0];
    e.target.value = ""; // reset so re-selecting the same file re-triggers onChange
    if (!archivo) return;

    setFotoSuccess(false);
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
        props.onFotoUpdated(updated.fotoUrl);
      }
      setFotoSuccess(true);
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
    setSaveSuccess(false);
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
    const perfil = props.perfil;
    setSaving(true);
    setSaveError(null);
    setSaveSuccess(false);
    try {
      // Correo is intentionally never sent here — it's the JWT `sub` claim
      // and self-service editing was removed by design (see auth_servicio.py).
      const updated = await actualizarMiPerfil({ telefono: telefono.trim() });
      props.onSaved(updated);
      setEditing(false);
      setSaveSuccess(true);
      showSuccess("Perfil actualizado correctamente.");
    } catch (error: unknown) {
      // Revert — a rejected edit must never be left displayed as if it were
      // persisted (no silent data loss, per spec).
      setTelefono(perfil.telefono);
      setEditing(false);
      const message = toErrorMessage(error, "No se pudo guardar los cambios.");
      setSaveError(message);
      showError(message);
    } finally {
      setSaving(false);
    }
  }

  async function handleChangePassword(): Promise<void> {
    if (props.kind !== "staff") return;
    setRequestingPassword(true);
    setPasswordError(null);
    setPasswordMessage(null);
    try {
      const result = await solicitarRecuperacion(props.accountEmail);
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

  const self = props.kind === "student" ? props.data.self : null;
  const representados = props.kind === "student" ? props.data.representados : [];

  const fullName =
    props.kind === "staff"
      ? `${props.perfil.nombres} ${props.perfil.apellidos}`.trim()
      : self
        ? `${self.nombres} ${self.apellidos}`.trim()
        : props.sessionName;

  const correoDisplay = props.kind === "staff" ? props.perfil.correo : props.sessionEmail;
  const roleLabel = getRoleLabel(props.role);
  const firstName = firstNameOf(fullName);

  const ranking = self ? describeRanking(self.ranking) : null;
  // Only the self profile has a real membership status here — a `self:
  // null` account (a representante with no own alumno profile) has no
  // personal status to report, so the hero deliberately shows nothing for
  // it instead of a misleading "no disponible" claim.
  const membership = props.kind === "student" && self ? describeMembership(self.membership) : null;

  return (
    <div className="mx-auto w-full max-w-6xl space-y-6">
      {props.kind === "student" && (
        <div className="flex justify-end">
          <Link href="/student" className="btn-secondary inline-flex items-center gap-2 text-sm">
            Ver portal completo
            <ArrowRight size={14} strokeWidth={1.5} aria-hidden="true" />
          </Link>
        </div>
      )}

      {props.kind === "staff" && (
        <BackLink
          href={props.role === "admin" ? "/dashboard" : "/trainer"}
          label="Volver al Panel"
        />
      )}

      {/* Hero card */}
      <div data-testid="profile-hero" className="card relative overflow-hidden p-6 sm:p-8">
        <div className="pointer-events-none absolute -right-8 -top-8 opacity-[0.06]" aria-hidden="true">
          <ShieldCheck size={180} strokeWidth={1} className="text-cata-red" />
        </div>

        <div className="relative grid gap-6 sm:grid-cols-2 sm:items-center lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          {/* Left: avatar + name + correo + status badge */}
          <div className="flex items-center gap-4">
            <div className="relative shrink-0">
              <div className="flex h-16 w-16 items-center justify-center overflow-hidden rounded-full bg-cata-red/10">
                {currentFotoUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element -- external Cloudinary URL, not a local/static asset
                  <img
                    src={currentFotoUrl}
                    alt="Foto de perfil"
                    className="h-16 w-16 rounded-full object-cover"
                  />
                ) : (
                  <User size={28} className="text-cata-red" strokeWidth={1.5} aria-hidden="true" />
                )}
              </div>
              <button
                type="button"
                onClick={() => fotoInputRef.current?.click()}
                disabled={uploadingFoto}
                aria-label="Cambiar foto de perfil"
                className="absolute -bottom-1 -right-1 flex h-6 w-6 items-center justify-center rounded-full border-2 border-white bg-cata-red text-white shadow-sm disabled:opacity-50"
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
            <div>
              <h2 className="text-lg font-bold tracking-tight text-cata-text">{fullName}</h2>
              <p className="text-sm text-cata-text/65">{correoDisplay}</p>
              <div className="mt-1.5">
                {props.kind === "staff" ? (
                  <Badge>{roleLabel}</Badge>
                ) : self ? (
                  membership ? (
                    <Badge tone={membership.tone}>{membership.label}</Badge>
                  ) : (
                    <span className="text-xs text-cata-text/65">{NO_MEMBERSHIP_FALLBACK}</span>
                  )
                ) : null}
              </div>
              {fotoError && (
                <p role="alert" className="mt-1 text-xs text-cata-red">
                  {fotoError}
                </p>
              )}
              {fotoSuccess && (
                <p role="status" className="mt-1 text-xs text-cata-state-ok">
                  Foto actualizada.
                </p>
              )}
            </div>
          </div>

          {/* Center: two stacked info blocks */}
          <div className="grid gap-4 sm:grid-cols-2 lg:border-l lg:border-cata-border lg:pl-6">
            {props.kind === "staff" ? (
              <>
                <div>
                  <dt className="flex items-center gap-1.5 text-xs font-medium text-cata-text/65">
                    <Shield size={13} strokeWidth={1.5} aria-hidden="true" />
                    Rol
                  </dt>
                  <dd className="mt-1 text-sm font-semibold text-cata-text">{roleLabel}</dd>
                </div>
                <div>
                  <dt className="flex items-center gap-1.5 text-xs font-medium text-cata-text/65">
                    <Calendar size={13} strokeWidth={1.5} aria-hidden="true" />
                    Miembro desde
                  </dt>
                  <dd className="mt-1 text-sm font-semibold text-cata-text">{formatDate(props.perfil.fechaCreacion)}</dd>
                </div>
              </>
            ) : (
              <>
                <div>
                  <dt className="flex items-center gap-1.5 text-xs font-medium text-cata-text/65">
                    <Trophy size={13} strokeWidth={1.5} aria-hidden="true" />
                    Ranking / Nivel
                  </dt>
                  <dd className="mt-1 text-sm font-semibold text-cata-text">
                    {ranking ? ranking.label : self ? "No disponible" : "No aplica"}
                  </dd>
                </div>
                <div>
                  <dt className="flex items-center gap-1.5 text-xs font-medium text-cata-text/65">
                    <ShieldCheck size={13} strokeWidth={1.5} aria-hidden="true" />
                    Suscripción / Membresía
                  </dt>
                  <dd className="mt-1 text-sm font-semibold text-cata-text">
                    {membership ? membership.label : self ? "No disponible" : "No aplica"}
                  </dd>
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Two-column grid — Accesos rápidos (formerly a third column) was
          dropped: redundant with AppShell's own sidebar nav, already visible
          on this page. */}
      <div className="grid gap-4 sm:grid-cols-2">
        {/* Column 1 — Información personal */}
        <div data-testid="profile-column-info" className="card p-5 sm:p-6">
          <div className="mb-4 flex items-center gap-2">
            <User size={16} className="text-cata-text/65" strokeWidth={1.5} aria-hidden="true" />
            <h3 className="text-sm font-bold tracking-tight text-cata-text">Información personal</h3>
          </div>

          <dl className="space-y-4">
            <div>
              <dt className="mb-1 flex items-center gap-1.5 text-xs font-medium text-cata-text/65">
                <User size={13} strokeWidth={1.5} aria-hidden="true" />
                Nombre completo
              </dt>
              <dd className="text-sm text-cata-text">{fullName}</dd>
            </div>

            <div>
              {/* Correo is never editable here — it's the JWT `sub` claim,
                  and self-service editing was intentionally removed. */}
              <dt className="mb-1 flex items-center gap-1.5 text-xs font-medium text-cata-text/65">
                <Mail size={13} strokeWidth={1.5} aria-hidden="true" />
                Correo electrónico
              </dt>
              <dd className="text-sm text-cata-text">{correoDisplay}</dd>
            </div>

            {props.kind === "staff" && (
              <div>
                <dt>
                  <label
                    htmlFor="perfil-telefono"
                    className="mb-1 flex items-center gap-1.5 text-xs font-medium text-cata-text/65"
                  >
                    <Phone size={13} strokeWidth={1.5} aria-hidden="true" />
                    Teléfono
                  </label>
                </dt>
                {editing ? (
                  <input
                    id="perfil-telefono"
                    type="tel"
                    value={telefono}
                    onChange={(e) => setTelefono(e.target.value)}
                    disabled={saving}
                    className="input-field w-full"
                  />
                ) : (
                  <dd className="text-sm text-cata-text">{props.perfil.telefono}</dd>
                )}
              </div>
            )}

            {props.kind === "staff" && (
              <div>
                <dt className="mb-1 flex items-center gap-1.5 text-xs font-medium text-cata-text/65">
                  <Calendar size={13} strokeWidth={1.5} aria-hidden="true" />
                  Fecha de registro
                </dt>
                <dd className="text-sm text-cata-text">{formatDate(props.perfil.fechaCreacion)}</dd>
              </div>
            )}
          </dl>

          {saveError && (
            <p role="alert" className="mt-3 text-sm text-cata-red">
              {saveError}
            </p>
          )}
          {saveSuccess && (
            <p role="status" className="mt-3 flex items-center gap-1 text-sm text-cata-state-ok">
              <CheckCircle2 size={14} strokeWidth={2} aria-hidden="true" />
              Datos guardados correctamente.
            </p>
          )}

          <div className="mt-5 border-t border-cata-border pt-4">
            {props.kind === "staff" ? (
              editing ? (
                <div className="flex flex-wrap items-center gap-3">
                  <button
                    type="button"
                    onClick={() => void handleSave()}
                    disabled={saving}
                    className="btn-primary inline-flex items-center gap-2 disabled:opacity-50"
                  >
                    {saving ? (
                      <Loader2 size={14} className="animate-spin" aria-hidden="true" />
                    ) : (
                      <Save size={14} strokeWidth={1.5} aria-hidden="true" />
                    )}
                    {saving ? "Guardando…" : "Guardar"}
                  </button>
                  <button
                    type="button"
                    onClick={cancelEditing}
                    disabled={saving}
                    className="btn-ghost inline-flex items-center gap-2 disabled:opacity-50"
                  >
                    <X size={14} strokeWidth={1.5} aria-hidden="true" />
                    Cancelar
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={startEditing}
                  className="btn-secondary w-full items-center gap-2"
                >
                  <Pencil size={14} strokeWidth={1.5} aria-hidden="true" />
                  Editar información
                </button>
              )
            ) : (
              <p className="text-xs text-cata-text/50">Esta información no se puede editar desde aquí.</p>
            )}
          </div>
        </div>

        {/* Column 2 — Estado de cuenta / Contexto */}
        <div data-testid="profile-column-status" className="card p-5 sm:p-6">
          <div className="mb-4 flex items-center gap-2">
            <ShieldCheck size={16} className="text-cata-text/65" strokeWidth={1.5} aria-hidden="true" />
            <h3 className="text-sm font-bold tracking-tight text-cata-text">Estado de cuenta</h3>
          </div>

          <div className="rounded-xl bg-cata-state-ok/10 p-4">
            {props.kind === "staff" ? (
              <>
                <p className="text-xs font-medium text-cata-text/65">Roles asignados</p>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {props.perfil.roles.map((rol) => (
                    <Badge key={rol}>{rol}</Badge>
                  ))}
                </div>
              </>
            ) : self ? (
              membership ? (
                <>
                  <p className="text-xs font-medium text-cata-text/65">Estado de la membresía</p>
                  <Badge className="mt-2" tone={membership.tone}>{membership.label}</Badge>
                </>
              ) : (
                <p className="text-sm text-cata-text/65">{NO_MEMBERSHIP_FALLBACK}</p>
              )
            ) : (
              // No `self` profile at all (a representante managing only
              // dependents, no own alumno role) — distinct copy from the
              // membership-lookup fallback above, since there is nothing to
              // "consult with administration" about here, just no personal
              // account to summarize.
              <p className="text-sm text-cata-text/65">
                Esta cuenta no tiene un perfil propio — administra a sus estudiantes desde aquí.
              </p>
            )}
          </div>

          <p className="mt-3 text-xs text-cata-text/50">
            {props.kind === "staff"
              ? "Permisos asignados a tu cuenta en el sistema."
              : self
                ? membership
                  ? "No hay una fecha de renovación disponible en este resumen."
                  : "Consulte con administración para más detalles sobre su membresía."
                : "Vea el resumen de cada estudiante a continuación."}
          </p>

          <div className="mt-5 border-t border-cata-border pt-4">
            {props.kind === "student" ? (
              <Link href="/student" className="btn-secondary w-full items-center justify-center">
                Ver detalles
              </Link>
            ) : (
              <>
                <button
                  type="button"
                  onClick={() => void handleChangePassword()}
                  disabled={requestingPassword}
                  className="btn-secondary w-full items-center gap-2 disabled:opacity-50"
                >
                  <KeyRound size={14} strokeWidth={1.5} aria-hidden="true" />
                  {requestingPassword ? "Enviando…" : "Cambiar contraseña"}
                </button>
                {passwordMessage && (
                  <p role="status" className="mt-2 text-sm text-cata-state-ok">
                    {passwordMessage}
                  </p>
                )}
                {passwordError && (
                  <p role="alert" className="mt-2 text-sm text-cata-red">
                    {passwordError}
                  </p>
                )}
              </>
            )}
          </div>
        </div>
      </div>

      {/* Representados — read-only summary cards for managed dependents. */}
      {props.kind === "student" && representados.length > 0 && (
        <div className="space-y-3">
          <h3 className="text-sm font-bold tracking-tight text-cata-text">Estudiantes a mi cargo</h3>
          <div className="grid gap-4 sm:grid-cols-2">
            {representados.map((profile) => (
              // The backend only ever scopes /membresias/mias to the JWT
              // owner's own persona — never a represented dependent's, so
              // this always passes [] to force the honest "no disponible"
              // fallback rather than falsely reporting "sin membresía".
              <StudentSummaryCard key={profile.personaId} profile={profile} />
            ))}
          </div>
        </div>
      )}

      {/* Bottom banner */}
      <div className="card flex items-center justify-between gap-4 p-4 sm:p-5">
        <div className="flex items-center gap-3">
          {props.kind === "staff" ? (
            <ShieldCheck size={22} className="shrink-0 text-cata-red" strokeWidth={1.5} aria-hidden="true" />
          ) : (
            <Trophy size={22} className="shrink-0 text-cata-red" strokeWidth={1.5} aria-hidden="true" />
          )}
          <p className="text-sm text-cata-text">
            {props.kind === "staff"
              ? `Gracias por tu trabajo administrando Cata Club, ${firstName}.`
              : `Gracias por ser parte de Cata Club, ${firstName}. ¡Sigue entrenando!`}
          </p>
        </div>
        {props.kind === "staff" ? (
          <Shield size={18} className="shrink-0 text-cata-text/20" strokeWidth={1.5} aria-hidden="true" />
        ) : (
          <ShieldCheck size={18} className="shrink-0 text-cata-text/20" strokeWidth={1.5} aria-hidden="true" />
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Content — data fetching + role branch into the unified layout
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

  // `fetchStudentPortal` carries no photo field — fetched separately, purely
  // supplementary to the hero avatar. Failure here must never block or error
  // the rest of the student portal (ranking/membership), so it's silently
  // ignored (the avatar just falls back to the generic icon).
  const [studentFotoUrl, setStudentFotoUrl] = useState<string | null | undefined>(undefined);

  useEffect(() => {
    if (!isStudentRole) return;
    let cancelled = false;
    fetchMiPerfil()
      .then((perfil) => {
        if (!cancelled) setStudentFotoUrl(perfil.fotoUrl);
      })
      .catch(() => {
        // Supplementary only — see comment above.
      });
    return () => {
      cancelled = true;
    };
  }, [isStudentRole]);

  if (role === null) return null;

  let content: React.ReactNode;
  if (isStudentRole) {
    if (studentState.status === "loading") {
      content = <LoadingState className="min-h-[50vh] justify-center" label="Cargando su cuenta…" />;
    } else if (studentState.status === "error") {
      content = (
        <ErrorState
          message={studentState.message}
          onRetry={() => setStudentReload((n) => n + 1)}
        />
      );
    } else {
      content = (
        <ProfileLayout
          kind="student"
          role={role}
          data={studentState.data}
          sessionEmail={session?.user.email ?? ""}
          sessionName={session?.user.name ?? ""}
          fotoUrl={studentFotoUrl}
          onFotoUpdated={setStudentFotoUrl}
        />
      );
    }
  } else if (staffState.status === "loading") {
    content = <LoadingState className="min-h-[50vh] justify-center" label="Cargando perfil…" />;
  } else if (staffState.status === "error") {
    content = <ErrorState message={staffState.message} onRetry={() => setStaffReload((n) => n + 1)} />;
  } else {
    content = (
      <ProfileLayout
        kind="staff"
        role={role}
        perfil={staffState.perfil}
        accountEmail={staffState.perfil.correo ?? session?.user.email}
        onSaved={(perfil) => setStaffState({ status: "ready", perfil })}
      />
    );
  }

  return (
    <AppShell eyebrow="Tu cuenta" title="Perfil" subtitle="Gestiona tu información y consulta tu estado en el sistema.">
      {content}
    </AppShell>
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
