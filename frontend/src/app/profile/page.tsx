/**
 * /profile — the account screen, transcribed from
 * `docs/ux/prototipos/25-perfil.html`.
 *
 * Four blocks at a 760px measure, not a grid of cramped boxes:
 *
 *   1. `.idcard` — a 72px coal/ball avatar, the name, the correo, the role
 *      badge. Nothing else. Per the prototype's own decision note, "Estado de
 *      cuenta" does not earn a section: it is one binary fact, so it folds
 *      into a badge beside the role.
 *   2. "Datos personales" — a list of 56px `.drow`s, ONE datum per row, an
 *      uppercase 150px label on the left and the value in bold on the right.
 *   3. "Seguridad" — the same row pattern, carrying actions instead of values.
 *   4. "Estudiantes a mi cargo" — kept, because for a representante it is the
 *      reason to open this page at all.
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
 * - "Cédula": neither `PerfilPropio` (`UsuarioMeResponseDTO`) nor
 *   `StudentProfileSummary` carries it. Only the admin-facing
 *   `/personas/{id}` does, and that is not readable by the account itself.
 * - "Cerrar otras sesiones": there is no session-invalidation endpoint.
 *   `auth_router.py` exposes login/registro/me/refresh/logout/recuperar/
 *   restablecer and nothing that revokes another device's token, so the row
 *   would be a button that cannot do what it says.
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
import { personInitials } from "@/app/student/student-utils";
import { Badge, Button, ErrorState, LoadingState, buttonClasses } from "@/components/ui";
import type { BadgeTone } from "@/components/ui/Badge";
import { MEMBERSHIP_STATUS_LABELS, MEMBERSHIP_STATUS_TONE } from "@/app/members/members-utils";
// Reused as-is (not duplicated) for consistency — this is the same
// backend-estado -> frontend-estado mapping `members-adapter.ts` reuses;
// it's a pure value object with no server-only APIs, safe in a client bundle.
import { MEMBERSHIP_STATUS_BY_ESTADO } from "@/lib/membership-status";
import { getRoleLabel } from "@/lib/auth-utils";
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
    <div className="flex min-h-drow items-center gap-4 border-b border-line px-5 py-2 last:border-b-0">
      {label && (
        <span className="w-[150px] flex-none text-[10.5px] font-bold uppercase tracking-[0.1em] text-ink-3">
          {label}
        </span>
      )}
      <span className="flex flex-1 flex-wrap items-center gap-x-2 gap-y-0.5 text-sm font-semibold text-ink">
        {children}
        {note && <span className="text-xs font-normal text-ink-3">{note}</span>}
      </span>
      {action && <span className="flex-none">{action}</span>}
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

  // ---- Profile photo upload — the caller's own avatar, for BOTH branches.
  // `POST /auth/me/foto` is self-service and role-agnostic. ----
  const fotoInputRef = useRef<HTMLInputElement>(null);
  const [uploadingFoto, setUploadingFoto] = useState(false);
  const [fotoError, setFotoError] = useState<string | null>(null);

  const perfil = props.kind === "staff" ? props.perfil : props.perfil;
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

  const self = props.kind === "student" ? props.data.self : null;
  const representados = props.kind === "student" ? props.data.representados : [];

  const fullName =
    props.kind === "staff"
      ? `${props.perfil.nombres} ${props.perfil.apellidos}`.trim()
      : self
        ? `${self.nombres} ${self.apellidos}`.trim()
        : props.sessionName;

  const roleLabel = getRoleLabel(props.role);
  const membership = props.kind === "student" && self ? describeMembership(self.membership) : null;
  const initials = personInitials(
    fullName.split(/\s+/)[0] ?? "",
    fullName.split(/\s+/).slice(1).join(" "),
  );

  const telefonoDisplay =
    props.kind === "staff" ? props.perfil.telefono : (props.perfil?.telefono ?? "");
  const fechaCreacion = props.kind === "staff" ? props.perfil.fechaCreacion : props.perfil?.fechaCreacion;

  return (
    <div className="mx-auto w-full max-w-[760px] space-y-5">
      {props.kind === "staff" && (
        <BackLink href={props.role === "admin" ? "/dashboard" : "/trainer"} label="Volver al Panel" />
      )}

      {/* Header action row — "Editar datos" lives HERE, at the top of the
          page, not buried at the bottom of a column. */}
      <div className="flex items-center justify-end gap-3">
        {props.kind === "student" ? (
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
        )}
      </div>

      {/* 1 — `.idcard`: avatar, name, correo, badges. Nothing else. */}
      <section data-testid="profile-hero" className="card flex items-center gap-[18px] px-6 py-[22px]">
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
          <p className="mb-2 mt-0.5 text-[13px] text-ink-3">{correoDisplay}</p>
          <div className="flex flex-wrap gap-2">
            <Badge>{roleLabel}</Badge>
            {membership && <Badge tone={membership.tone}>{membership.label}</Badge>}
          </div>
          {props.kind === "student" && self && !membership && (
            <p className="mt-2 text-xs text-ink-3">Membresía: {NO_MEMBERSHIP_FALLBACK}</p>
          )}
          {fotoError && (
            <p role="alert" className="mt-2 text-xs text-cata-red">
              {fotoError}
            </p>
          )}
        </div>
      </section>

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
        {fechaCreacion && <DetailRow label="Miembro desde">{formatDate(fechaCreacion)}</DetailRow>}
        {props.kind === "student" && (
          <DetailRow>
            <span className="text-xs font-normal text-ink-3">
              Esta información no se puede editar desde aquí. Escriba al club para corregirla.
            </span>
          </DetailRow>
        )}
        {saveError && (
          <p role="alert" className="border-t border-line px-5 py-3 text-sm text-cata-red">
            {saveError}
          </p>
        )}
      </CardSection>

      {/* 3 — Seguridad: the same row pattern, carrying actions. */}
      <CardSection title="Seguridad" testId="profile-column-status">
        <DetailRow
          action={
            <Button size="sm" onClick={() => void handleChangePassword()} disabled={requestingPassword}>
              {requestingPassword ? "Enviando…" : "Cambiar contraseña"}
            </Button>
          }
        >
          Contraseña
        </DetailRow>
        <DetailRow
          action={
            <Button size="sm" onClick={() => void logout()}>
              Salir
            </Button>
          }
        >
          Cerrar sesión en este equipo
        </DetailRow>
      </CardSection>

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

      {/* 4 — Estudiantes a mi cargo. For a representante this is the reason to
          open the page, so it stays. */}
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
  );
}

/**
 * One dependant row. No membership badge: the backend only ever scopes
 * `/membresias/mias` to the JWT owner's own persona, never a represented
 * dependant's, so any status shown here would be a guess.
 */
function DependantRow({ profile }: { profile: StudentProfileSummary }): React.ReactElement {
  const fullName = `${profile.nombres} ${profile.apellidos}`.trim();
  return (
    <DetailRow note={NO_MEMBERSHIP_FALLBACK}>
      <span className="flex h-8 w-8 flex-none items-center justify-center rounded-full bg-state-neutral-bg text-[10px] font-bold text-state-neutral">
        {personInitials(profile.nombres, profile.apellidos)}
      </span>
      {fullName}
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

  let content: React.ReactNode;
  if (isStudentRole) {
    if (studentState.status === "loading") {
      content = <LoadingState className="min-h-[50vh] justify-center" label="Cargando su cuenta…" />;
    } else if (studentState.status === "error") {
      content = (
        <ErrorState message={studentState.message} onRetry={() => setStudentReload((n) => n + 1)} />
      );
    } else {
      content = (
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
