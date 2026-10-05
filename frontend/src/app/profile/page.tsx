/**
 * /profile — the account screen, v2 (extra-color-redesign T5).
 *
 * Three blocks instead of nine cards:
 *
 *   1. The identity card: white, with the asymmetric institutional-red field,
 *      the role as its first word (the yellow ball its full stop), the coal
 *      avatar bridging into the body, then the contact data — correo on a
 *      full row, teléfono editable inline — and the account's creation date.
 *   2. The block of the role: a jugador's membership ticket (days left and a
 *      30-day strip), a representante's «A tu cargo» list, or the coal board
 *      with its table-tennis motif for entrenador and administrador.
 *      `roleBlocksFor` decides which.
 *   3. «Seguridad»: the password change folded behind «Cambiar», the account's
 *      sessions, and the reset-by-email link.
 *
 * ## Data sources (unchanged — no call was added)
 *
 * - Staff (administrador, entrenador, and the unrecognised-role fallback)
 *   read `fetchMiPerfil()` (`GET /api/auth/me`). Nombres, apellidos, roles and
 *   correo are read-only; teléfono is edited inline (`PATCH /api/auth/me`).
 *   Correo is the JWT `sub` claim and is never editable here.
 * - Jugador and representante read `fetchStudentPortal()` for the membership,
 *   the dependants, `fechaNacimiento` and `representante`, plus
 *   `fetchMiPerfil()` for what the portal does not carry (teléfono, fecha de
 *   creación, foto) and `fetchPagosDePersona()` for the end of paid coverage
 *   (`MembershipSummary.fechaFin` is filled by no adapter, so the furthest
 *   APPROVED payment's `fechaFin` stands in — see `resolveCoverageEnd`).
 *
 * What the screen no longer carries, on purpose: «Atajos de tu rol» (the menu
 * has them), the long «Cómo proteger tu cuenta» / «Qué hacer si necesitas
 * ayuda» guides (one line at the foot of Seguridad), the profile's own «Cerrar
 * sesión» (it stays in the menu) and the «No disponible — consulta con
 * administración» filler. Nothing truncates: names and correos wrap.
 */

"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import ProtectedRoute from "@/components/ProtectedRoute";
import AppShell from "@/components/shell/AppShell";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/contexts/ToastContext";
import ChangePasswordCard from "./ChangePasswordCard";
import {
  fetchMiPerfil,
  actualizarMiPerfil,
  solicitarRecuperacion,
  fetchStudentPortal,
  fetchPagosDePersona,
  subirFotoPerfil,
  invalidarOtrasSesiones,
} from "@/services/api";
import ConfirmDialog from "@/components/ConfirmDialog";
import type { StudentPortalSummary, StudentProfileSummary, MembershipSummary, PagoPersona } from "@/services/api";
import type { PerfilPropio, UserRole } from "@/types/domain";
import {
  describeMembershipState,
  personInitials,
  resolveCoverageEnd,
} from "@/app/student/student-utils";
import SessionsCard from "./SessionsCard";
import { daysUntil, roleBlocksFor, ticketTone, ticketWord } from "./ProfileParts";
import {
  CoalBoard,
  DependantsCard,
  IdentityCard,
  MembershipTicket,
  SecurityCard,
  SecurityRow,
  TelefonoRead,
  type IdentityChip,
  type IdentityFact,
} from "./ProfileCards";
import { clubToday } from "@/lib/club-date";
import { Button, ErrorState, LoadingState, buttonClasses } from "@/components/ui";
import type { BadgeTone } from "@/components/ui/Badge";
import { MEMBERSHIP_STATUS_LABELS, MEMBERSHIP_STATUS_TONE } from "@/app/members/members-utils";
// Reused as-is (not duplicated) for consistency — this is the same
// backend-estado -> frontend-estado mapping `members-adapter.ts` reuses;
// it's a pure value object with no server-only APIs, safe in a client bundle.
import { MEMBERSHIP_STATUS_BY_ESTADO } from "@/lib/membership-status";
import { backendRoleForUserRole, getBackendRoleLabel, getRoleLabel } from "@/lib/auth-utils";
import { Loader2, Save, X } from "lucide-react";
import { ICON } from "@/lib/icon-size";
import { formatDate } from "@/lib/format-utils";
import LinkifiedText from "@/components/LinkifiedText";
import { toUserMessage } from "@/lib/error-message";
import { phoneFieldRule, toPhoneFieldDigits, toStoredPhone } from "@/lib/identity-validation";
import { revisarFoto, subirFotoDeArchivo } from "@/lib/photo-upload";
import { PhoneField } from "@/components/wizard-fields";

/** Lifetime of the password-recovery link (backend `crear_token_recuperacion`, 30 min). */
const RESET_LINK_VALID_MINUTES = 30;
/** Wait before the recovery link can be requested again. */
const RESET_RESEND_COOLDOWN_SECONDS = 120;

function formatCountdown(seconds: number): string {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

/** Roles with no staff profile here — they see the student-branch content in the unified layout instead. */
const STUDENT_SUMMARY_ROLES: ReadonlySet<UserRole> = new Set(["representante", "estudiante"]);

/** The one phone rule the profile states: the same local digits the field's own hint asks for. */
const PHONE_PROFILE_MESSAGE =
  "Escribe tu celular de 9 dígitos que empieza con 9 (por ejemplo, 991234567) o tu fijo con código de provincia (por ejemplo, 42345678). Es opcional.";

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

/** The «bajada» under the page title, per role. */
const ROLE_LEDE: Record<UserRole, string> = {
  admin: "Administra tus datos de cuenta.",
  trainer: "Administra tus datos de cuenta.",
  estudiante: "Tus datos y el estado de tu membresía.",
  representante: "Tus datos y las personas a tu cargo.",
  unsupported: "Administra tus datos de cuenta.",
};

/** Copy of the coal board — the staff roles state what their account is for. */
const BOARD_COPY = {
  "trainer-board": {
    motif: "table",
    title: "Entrenador",
    text: "Tu información operativa vive en tus pantallas: Mi día y Pasar lista.",
  },
  "admin-board": {
    motif: "arc",
    title: "Administración",
    text: "Los datos de los miembros se gestionan desde Miembros, en el menú.",
  },
  "account-board": {
    motif: "arc",
    title: "Cuenta",
    text: "Esta cuenta no tiene un rol reconocido asignado.",
  },
} as const;

type StaffLoadState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; perfil: PerfilPropio };

type StudentLoadState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; data: StudentPortalSummary };

/**
 * The shell every state of this page shares. Keeping the title in ONE place
 * stops loading, error and the loaded layout from drifting apart.
 */
function ProfileShell({
  subtitle,
  children,
}: {
  /** The role-specific «bajada» — omitted for the loading/error shells, which have no role yet. */
  subtitle?: string;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <AppShell title="Perfil" subtitle={subtitle}>
      {children}
    </AppShell>
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
      /** Furthest `fechaFin` among the profile's APPROVED payments, or `null`. */
      coverageEnd: string | null;
      sessionEmail: string;
      sessionName: string;
      onPerfilUpdated: (perfil: PerfilPropio) => void;
    };

function ProfileLayout(props: ProfileLayoutProps): React.ReactElement {
  const { showSuccess, showError } = useToast();
  const { refreshSession } = useAuth();

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
  // The password form stays folded until asked for.
  const [passwordOpen, setPasswordOpen] = useState(false);
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
  // `PerfilPropio | null` on student — so it reads directly.
  const perfil: PerfilPropio | null = props.perfil;
  const currentFotoUrl = perfil?.fotoUrl;

  async function handleFotoChange(e: React.ChangeEvent<HTMLInputElement>): Promise<void> {
    const archivo = e.target.files?.[0];
    e.target.value = ""; // reset so re-selecting the same file re-triggers onChange
    if (!archivo) return;

    // The allow-list and both refusal sentences live in `lib/photo-upload.ts`,
    // shared with the other photo surface.
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
      // `perfil` state updated above — must be refreshed too (issue #662).
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
    // then, so this is unreachable with nothing to seed.
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
      const message = `Te enviamos un enlace a ${destino} para cambiar tu contraseña. Es válido por ${RESET_LINK_VALID_MINUTES} minutos.`;
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
   * A stale-token failure is already handled globally by `services/api.ts`'s
   * 401 refresh-and-retry, so this handler only reports success or a message.
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
  const representados: StudentProfileSummary[] = props.kind === "student" ? props.data.representados : [];
  const coverageEnd = props.kind === "student" ? props.coverageEnd : null;

  const fullName =
    props.kind === "staff"
      ? `${props.perfil.nombres} ${props.perfil.apellidos}`.trim()
      : self
        ? `${self.nombres} ${self.apellidos}`.trim()
        : props.sessionName;
  const initials = personInitials(
    fullName.split(/\s+/)[0] ?? "",
    fullName.split(/\s+/).slice(1).join(" "),
  );

  /**
   * The membership's standing — the SAME coverage-aware reading
   * `/student/payments` prints (`describeMembershipState`), never `estado`
   * alone (issue #815's class): an `ACTIVA` row whose last approved payment
   * already ran out must not say «Activa» above a lapsed date.
   */
  const selfMembership = self?.membership ?? null;
  const membershipState =
    selfMembership !== null
      ? describeMembershipState(selfMembership.estado, coverageEnd, undefined, selfMembership)
      : null;

  const roleLabel = getRoleLabel(props.role);
  // Every role the backend has on this account (`GET /auth/me`). More than one
  // is unreachable in practice since issue #762, but the list is the ACCOUNT's
  // and a display that reads a list should not assume its length.
  const assignedRoles = props.perfil?.roles ?? [];
  const sessionBackendRole = backendRoleForUserRole(props.role);

  const chips: IdentityChip[] = [];
  if (membershipState) {
    chips.push({ label: membershipState.label, tone: membershipState.tone });
  } else if (props.role !== "estudiante") {
    chips.push({ label: "Cuenta activa", tone: "ok" });
  }
  if (props.role === "representante" && representados.length > 0) {
    chips.push({
      label: `${representados.length} ${representados.length === 1 ? "jugador" : "jugadores"} a cargo`,
      tone: "neutral",
      className: "!bg-cuenta-representante-bg !text-cuenta-representante",
    });
  }
  if (assignedRoles.length > 1) {
    for (const rol of assignedRoles) {
      const active = rol === sessionBackendRole;
      chips.push({
        label: getBackendRoleLabel(rol),
        tone: active ? "ok" : "neutral",
        srOnly: active ? "— rol activo en esta sesión" : undefined,
      });
    }
  }

  const facts: IdentityFact[] = [];
  if (self?.fechaNacimiento) {
    const nacimiento = formatDate(self.fechaNacimiento);
    if (nacimiento) facts.push({ label: "Nacimiento", value: nacimiento });
  }
  if (self?.representante) {
    facts.push({
      label: "Tu representante",
      value: `${self.representante.nombres} ${self.representante.apellidos}`.trim(),
    });
  }

  const telefonoDisplay =
    props.kind === "staff" ? props.perfil.telefono : (props.perfil?.telefono ?? "");
  const fechaCreacion =
    props.kind === "staff" ? props.perfil.fechaCreacion : props.perfil?.fechaCreacion;
  // `null`, not a labelled dash: the identity card never names an absence.
  // This is the CREATION date of the ACCOUNT (`Usuario.fecha_creacion`), not
  // the club affiliation — that one is «Jugador desde» on the ticket.
  const createdOn = fechaCreacion ? formatDate(fechaCreacion) : null;

  const telefonoRow = editing ? (
    <div className="min-w-0 border-t border-line py-2.5">
      <dt className="text-2xs font-bold uppercase tracking-wide text-ink-3-strong">Teléfono</dt>
      <dd className="mt-1 grid gap-2">
        {/* Issue #1296: the same `PhoneField` every other phone field on the
            app shares. `hideLabel` keeps «Teléfono» as the field's one
            accessible name without repeating the label printed above. */}
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
        <div className="flex flex-wrap gap-2">
          <Button variant="primary" onClick={() => void handleSave()} disabled={saving}>
            {saving ? (
              <Loader2 size={ICON.sm} className="animate-spin" aria-hidden="true" />
            ) : (
              <Save size={ICON.sm} strokeWidth={1.5} aria-hidden="true" />
            )}
            {saving ? "Guardando…" : "Guardar"}
          </Button>
          <Button variant="secondary" onClick={cancelEditing} disabled={saving}>
            <X size={ICON.sm} strokeWidth={1.5} aria-hidden="true" />
            Cancelar
          </Button>
        </div>
      </dd>
    </div>
  ) : (
    <>
      <TelefonoRead value={telefonoDisplay} onEdit={perfil !== null ? startEditing : null} />
      {saveError && (
        <p role="alert" className="border-t border-line py-2.5 text-sm text-state-bad sm:col-span-2 split:col-span-1">
          <LinkifiedText text={saveError} />
        </p>
      )}
    </>
  );

  // ---- The role's block --------------------------------------------------
  const daysLeft = coverageEnd ? daysUntil(coverageEnd, clubToday()) : null;
  const blocks = roleBlocksFor(props.role, selfMembership !== null).map((kind) => {
    if (kind === "dependants") {
      return (
        <DependantsCard
          key={kind}
          dependants={representados}
          statusFor={(dependant) => describeMembership(dependant.membership)}
        />
      );
    }
    if (kind === "ticket") {
      if (!selfMembership || !membershipState) return null;
      const plan = selfMembership.categoria?.trim() ?? "";
      const modalidad = selfMembership.modalidad?.trim() ?? "";
      // The backend spells the modalidad in caps and the plan in title case,
      // so the comparison is case-insensitive: every plan the club sells is
      // named for how it is charged, and printing the same word twice helps
      // nobody. `PERSONALIZADA` against a seasonal plan keeps the field alive.
      const modalidadRedundant = !modalidad || plan.toLowerCase().includes(modalidad.toLowerCase());
      const tone = ticketTone(daysLeft, membershipState.tone);
      return (
        <MembershipTicket
          key={kind}
          tone={tone}
          daysLeft={daysLeft}
          statusWord={ticketWord(tone, daysLeft, membershipState.label)}
          until={coverageEnd ? formatDate(coverageEnd) : null}
          plan={plan}
          modalidad={
            modalidadRedundant
              ? ""
              : modalidad.charAt(0).toUpperCase() + modalidad.slice(1).toLowerCase()
          }
          since={selfMembership.fechaActivacion ? formatDate(selfMembership.fechaActivacion) : null}
        />
      );
    }
    const copy = BOARD_COPY[kind];
    return (
      <CoalBoard key={kind} motif={copy.motif} eyebrow="Tu rol" title={copy.title} text={copy.text} />
    );
  });

  return (
    <ProfileShell subtitle={ROLE_LEDE[props.role]}>
      <div
        data-testid="profile-split"
        className="grid min-w-0 gap-4 split:grid-cols-[320px_minmax(0,1fr)] split:items-start split:gap-5"
      >
        <IdentityCard
          name={fullName}
          initials={initials}
          fotoUrl={currentFotoUrl}
          roleLabel={roleLabel}
          chips={chips}
          correo={correoDisplay}
          telefonoRow={telefonoRow}
          facts={facts}
          createdOn={createdOn}
          uploadingFoto={uploadingFoto}
          fotoError={fotoError}
          fotoInputRef={fotoInputRef}
          onFotoChange={(e) => void handleFotoChange(e)}
        />

        <div className="grid min-w-0 content-start gap-4">
          {blocks}

          <SecurityCard>
            <SecurityRow
              title="Contraseña"
              hint="Al cambiarla se cierran tus otras sesiones."
              action={
                <button
                  type="button"
                  aria-expanded={passwordOpen}
                  aria-controls="profile-password-form"
                  onClick={() => setPasswordOpen((open) => !open)}
                  className={buttonClasses("secondary", "sm")}
                >
                  {passwordOpen ? "Cerrar" : "Cambiar"}
                </button>
              }
            />
            {passwordOpen && (
              <div id="profile-password-form">
                <ChangePasswordCard embedded />
              </div>
            )}

            {/* Contenido de compañía: decides alone whether it is worth drawing
                (no rows, no card) and a network failure leaves it invisible. */}
            <SessionsCard embedded refreshKey={sessionsRefresh} />

            <SecurityRow
              title="Otras sesiones"
              hint="Cierra tu sesión en los demás equipos; este sigue conectado."
              action={
                <button
                  type="button"
                  onClick={() => setConfirmingInvalidation(true)}
                  disabled={invalidatingSessions}
                  className={buttonClasses("secondary", "sm")}
                >
                  {invalidatingSessions ? "Cerrando…" : "Cerrar otras sesiones"}
                </button>
              }
            />

            <div className="grid gap-2 border-t border-line bg-sunken px-5 py-3 text-xs text-ink-2">
              <p>
                ¿Prefieres un enlace por correo?{" "}
                <button
                  type="button"
                  onClick={() => void handleChangePassword()}
                  disabled={requestingPassword || resendSecondsLeft > 0}
                  className="touch-target font-bold text-ink underline underline-offset-4 disabled:cursor-not-allowed disabled:no-underline disabled:opacity-60"
                >
                  {requestingPassword ? "Enviando…" : "Restablecer contraseña"}
                </button>
                . ¿Dudas?{" "}
                <Link href="/ayuda" className="font-bold text-ink underline underline-offset-4">
                  Preguntas frecuentes
                </Link>{" "}
                o escribe a administración.
              </p>
              {sessionsMessage && (
                <p role="status" className="text-sm text-state-ok">
                  {sessionsMessage}
                </p>
              )}
              {sessionsError && (
                <p role="alert" className="text-sm text-state-bad">
                  <LinkifiedText text={sessionsError} />
                </p>
              )}
              {passwordMessage && (
                <div className="grid gap-1">
                  <p role="status" className="text-sm text-state-ok">
                    {passwordMessage}
                  </p>
                  <button
                    type="button"
                    className="touch-target justify-self-start text-sm font-semibold underline underline-offset-2 disabled:cursor-not-allowed disabled:no-underline disabled:opacity-60"
                    onClick={() => void handleChangePassword()}
                    disabled={requestingPassword || resendSecondsLeft > 0}
                  >
                    Reenviar enlace
                  </button>
                  {resendSecondsLeft > 0 && (
                    <p className="text-xs text-ink-3-strong">
                      Podrás reenviarlo en {formatCountdown(resendSecondsLeft)}.
                    </p>
                  )}
                </div>
              )}
              {passwordError && (
                <p role="alert" className="text-sm text-state-bad">
                  <LinkifiedText text={passwordError} />
                </p>
              )}
            </div>
          </SecurityCard>

          <ConfirmDialog
            open={confirmingInvalidation}
            variant="danger"
            title="Cerrar otras sesiones"
            message="Se cerrará tu sesión en todos los demás dispositivos y navegadores. Este equipo seguirá conectado. ¿Quieres continuar?"
            confirmLabel="Cerrar otras sesiones"
            cancelLabel="Cancelar"
            onConfirm={() => void handleInvalidateOtherSessions()}
            onCancel={() => setConfirmingInvalidation(false)}
          />
        </div>
      </div>
    </ProfileShell>
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
            message: toErrorMessage(error, "No se pudo cargar tu perfil."),
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
            message: toErrorMessage(error, "No se pudo cargar tu cuenta."),
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
          label={isStudentRole ? "Cargando tu cuenta…" : "Cargando perfil…"}
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
