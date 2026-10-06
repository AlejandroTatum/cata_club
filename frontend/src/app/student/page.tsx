"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { buildContextLine } from "@/components/dashboard/context-line";
import ProtectedRoute from "@/components/ProtectedRoute";
import AppShell from "@/components/shell/AppShell";
import { useAuth } from "@/contexts/AuthContext";
import {
  fetchStudentPortal,
  fetchPagosDePersona,
  fetchHorariosPorAlumno,
} from "@/services/api";
import type {
  AlumnoHorario,
  StudentPortalSummary,
  StudentProfileSummary,
  PagoPersona,
} from "@/services/api";
import { formatCurrency } from "@/lib/format-utils";
import {
  EmptyState,
  InfoPanel,
  LoadingState,
  PAGE_RAIL,
  STAT_GRID,
  StatCard,
  StatTrack,
  buttonClasses,
  cn,
} from "@/components/ui";
import {
  useManagedProfiles,
  withSelectedStudent,
} from "./ManagedStudentPicker";
import FamilyStrip from "./FamilyStrip";
import GuardiansCard from "./GuardiansCard";
import CuotaCard from "./CuotaCard";
import MemberCard from "./MemberCard";
import WeekPlan from "./WeekPlan";
import JoinAsPlayerAction from "./JoinAsPlayerAction";
import StudentErrorState from "./StudentErrorState";
import {
  derivePortalMode,
  isRepresentative,
  isMinor,
  buildWeeklyTrainingSchedule,
  describePaymentSituation,
  describeNextPayment,
  findNextTrainingSessions,
  describeRejectedPago,
  displayNameFor,
  firstNameOf,
  summarizeRecentAttendance,
  contarEntrenamientosSemanales,
  daysUntil,
  describeCoverageStat,
  describePendingStat,
  type UpcomingTraining,
  noScheduleWhatsAppHref,
  hasOwnMembership,
} from "./student-utils";
import {
  CalendarCheck,
  Dumbbell,
  Hourglass,
  Banknote,
  ShieldCheck,
  Stethoscope,
  Users,
  User,
  UserPlus,
  ArrowRight,
} from "lucide-react";
import { ICON } from "@/lib/icon-size";
import { toUserMessage } from "@/lib/error-message";
import { attendanceTone } from "@/lib/attendance-tone";

// ---------------------------------------------------------------------------
// Load state
// ---------------------------------------------------------------------------

type LoadState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; data: StudentPortalSummary };

type PagosState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; pagos: PagoPersona[] };

type HorariosState =
  | { status: "loading" }
  | { status: "error" }
  | { status: "ready"; asignaciones: AlumnoHorario[] };

// ---------------------------------------------------------------------------
// "Próximos entrenamientos" — the second of the two things this screen is for
//
// The screen used to answer this with the most recent RECORDED session under
// the heading "Entrenamientos": a past fact where a family reads a future one.
// It could not do better, because `Horario` carries no link to the persona it
// serves.
//
// `AlumnoHorario` does. The rows behind this panel are the assignment an admin
// made in `/groups` — `buildWeeklyTrainingSchedule` merges the club's
// consecutive one-hour blocks back into the window the student actually
// attends, and `findNextTrainingSessions` walks the calendar forward from
// today. Nothing here is projected: the schedule is the club's, and the dates
// are its next occurrences.
//
// The panel says so in as many words, because the club records no
// cancellations, holidays or one-off changes anywhere — a date printed with no
// source would read as a confirmed appointment, which is not what it is.
// ---------------------------------------------------------------------------

/**
 * A text action that reads as a destination, not as a button competing with the page's CTA.
 *
 * `min-h-[24px]` is the WCAG 2.2 AA target size (SC 2.5.8): the 13px label's
 * own line box measures 20px tall, which is under the 24x24 floor. The extra
 * height is hit area only — the box centres its content, so the type size and
 * the underline's position are unchanged.
 */
function SituationLink({ href, children }: { href: string; children: React.ReactNode }): React.ReactElement {
  return (
    <Link
      href={href}
      className="touch-target-row inline-flex min-h-[24px] items-center gap-1.5 rounded text-sm font-semibold text-ink underline decoration-line-2 decoration-2 underline-offset-4 transition-colors hover:decoration-ink"
    >
      {children}
      <ArrowRight size={ICON.sm} strokeWidth={1.75} aria-hidden="true" />
    </Link>
  );
}

function TrainingPanel({
  profile,
  horariosState,
  /** Whose record this is — "sus asistencias" only when the reader is the student. */
  viewingOwnProfile,
  studentName,
}: {
  profile: StudentProfileSummary;
  horariosState: HorariosState;
  viewingOwnProfile: boolean;
  studentName: string;
}): React.ReactElement {
  // Issue #313 (K5 hallazgo #52): el tile "Entrenamientos" cuenta
  // `buildWeeklyTrainingSchedule(...).length` — la MISMA lista de ventanas
  // semanales — y esta tarjeta se llama a sí misma "Esta semana" / "el
  // horario semanal". Un tope fijo de 3 (`findNextTrainingSessions(..., 3)`)
  // hacía que el tile dijera 5 mientras la tarjeta solo listaba 3 días. El
  // límite ahora es el largo real de esa misma lista: nunca corta lo que el
  // tile ya prometió mostrar completo.
  const weeklySlots = useMemo(
    () =>
      horariosState.status === "ready"
        ? buildWeeklyTrainingSchedule(horariosState.asignaciones)
        : [],
    [horariosState],
  );
  const sessions = useMemo(
    () => findNextTrainingSessions(weeklySlots, weeklySlots.length),
    [weeklySlots],
  );

  const recap = summarizeRecentAttendance(profile.recentSessions);
  // A guardian reading "De sus últimas 2 sesiones asistió a 1" about their
  // child was being told about themselves. The subject is named instead.
  const scope = recap
    ? viewingOwnProfile
      ? recap.total === 1
        ? "tu última sesión registrada"
        : `tus últimas ${recap.total} sesiones registradas`
      : recap.total === 1
        ? `la última sesión registrada de ${studentName}`
        : `las últimas ${recap.total} sesiones registradas de ${studentName}`
    : "";

  return (
    <section
      data-testid="student-situation"
      aria-label="Esta semana"
      // `flex-1 min-h-0`, not the old `h-full`: this card used to stand alone
      // in its own grid column (its row's only occupant), where "fill the
      // row" and "fill 100% of my parent" were the same thing. It now shares
      // a flex column with `CuotaCard` above it — `h-full` there meant "take
      // the WHOLE stretched column", squeezing `CuotaCard` below its own
      // content height and letting its `overflow-hidden` silently clip the
      // payment button. `flex-1` takes only what `CuotaCard` doesn't need.
      className="card flex flex-col overflow-hidden"
    >
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-field px-5 pb-3.5 pt-[18px]">
        <h2 className="font-display text-lg uppercase leading-tight tracking-flat text-ink">Esta semana</h2>
        <p className="text-xs text-ink-3-strong">
          {viewingOwnProfile
            ? "El horario semanal que el club te asignó."
            : `El horario semanal que el club le asignó a ${studentName}.`}
        </p>
      </div>

      {horariosState.status === "loading" && (
        <div className="border-t border-line">
          <LoadingState label="Consultando tu horario…" />
        </div>
      )}

      {horariosState.status === "error" && (
        <div className="border-t border-line px-5 py-4">
          <p className="text-sm leading-relaxed text-ink-3-strong">
            No se pudo consultar el horario en este momento. Vuelve a cargar la página o consulta
            en administración del club.
          </p>
        </div>
      )}

      {horariosState.status === "ready" &&
        (sessions.length > 0 ? (
          <div className="border-t border-line pt-4">
            <WeekPlan sessions={sessions} />
          </div>
        ) : (
          // One line with its way out (D11: what is missing, why, what to
          // do). FAM-29: the text asks to write to administration, so the
          // button is that message, sent to the club's WhatsApp. A tall empty
          // card here would only stretch the column beside the carnet.
          <div className="flex flex-wrap items-center gap-x-4 gap-y-field border-t border-line px-5 py-4">
            <p className="min-w-0 flex-1 text-sm text-ink-2">
              <span className="font-semibold text-ink">
                {viewingOwnProfile
                  ? "Todavía no tienes un horario asignado"
                  : `${studentName} todavía no tiene un horario asignado`}
              </span>
              . El club asigna los días y las horas; escribe a administración para que te asignen uno.
            </p>
            <a
              href={noScheduleWhatsAppHref(studentName, viewingOwnProfile)}
              target="_blank"
              rel="noopener noreferrer"
              className={buttonClasses("secondary", "sm")}
            >
              Escribir al club por WhatsApp
              <ArrowRight size={ICON.sm} strokeWidth={1.5} aria-hidden="true" />
            </a>
          </div>
        ))}

      {/* One line, not a second panel: it is the same subject — training —
          and it is the fact a family checks right after "when is the next
          one". The record itself lives on `/student/attendance`. */}
      <div className="flex flex-wrap items-center justify-between gap-x-5 gap-y-field border-t border-line bg-sunken px-5 py-3.5">
        <p className="text-xs leading-relaxed text-ink-3-strong">
          {recap ? (
            // La CIFRA se fue a la tile "Asistencia" de la fila de pulso: acá
            // queda el alcance, que es lo que la tile no puede decir ("sus
            // últimas 10 sesiones registradas"). Repetir "8 de 10" en los dos
            // lugares habría sido el recap duplicado que este proyecto ya
            // borró una vez en el panel del entrenador.
            <>Sobre {scope}.</>
          ) : viewingOwnProfile ? (
            "Tu asistencia aparecerá aquí en cuanto el entrenador tome lista."
          ) : (
            `La asistencia de ${studentName} aparecerá aquí en cuanto el entrenador tome lista.`
          )}
        </p>
        {/* The link carries the profile it is talking about, so the record it
            opens is the one the sentence beside it just described. */}
        <SituationLink href={withSelectedStudent("/student/attendance", profile.personaId)}>
          {viewingOwnProfile ? "Ver mis asistencias" : `Ver las asistencias de ${studentName}`}
        </SituationLink>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Membership plan catalog — pending-enrollment view only
// ---------------------------------------------------------------------------

function MembershipPlansGrid({ data }: { data: StudentPortalSummary }): React.ReactElement {
  if (data.membershipPlans.length === 0) {
    return (
      <EmptyState
        icon={<ShieldCheck size={ICON.lg} strokeWidth={1.5} aria-hidden="true" />}
        title="No hay planes de membresía disponibles"
        description="El catálogo de planes está vacío en este momento. Consulta con administración."
      />
    );
  }
  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
      {data.membershipPlans.map((plan) => (
        <div key={plan.id} className="card flex flex-col p-5">
          <h3 className="text-base font-bold text-ink">{plan.nombre}</h3>
          {/* Name and price only. The plan used to print a franja too, but a
              membership type is what the family pays, not when they train —
              the hours come from the horarios the club assigns afterwards. */}
          <span className="mt-2 text-xl font-extrabold tabular-nums text-ink">
            {formatCurrency(plan.precio)}
          </span>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Pending-enrollment view — honest intermediate state for an authenticated
// persona with no ALUMNO role and no representados (see student-utils.ts's
// `derivePortalMode` doc comment for why this is not /unauthorized).
// ---------------------------------------------------------------------------

function PendingEnrollmentView({
  data,
  accountPersonaId,
}: {
  data: StudentPortalSummary;
  /** The SESSION's own persona id (independent-verification fix, issue
   *  #1132): a pure representative with zero representados and no own
   *  membership lands here, and their "Inscribirme como jugador" CTA used
   *  to be a plain `<Link href="/student/enroll?type=self">` — the PUBLIC
   *  wizard, which creates a brand-new Persona/Usuario instead of a
   *  membership for this existing one. `JoinAsPlayerAction` (the same
   *  component `ActivePortalView` already uses) fixes this here too. */
  accountPersonaId: string;
}): React.ReactElement {
  return (
    <>
      <section className="card p-6">
        <h2 className="font-display text-lg uppercase leading-tight tracking-flat text-ink">Bienvenido a Cata Club</h2>
        {/* Capped at a readable measure inside a full-width card, rather than
            capping the card: a 110-character line is not a paragraph. */}
        <p className="mt-2 max-w-[68ch] text-sm leading-relaxed text-ink-3-strong">
          Tu cuenta está creada pero todavía no tienes una matrícula activa. Completa tu inscripción para
          empezar a entrenar.
        </p>
      </section>

      <MembershipPlansGrid data={data} />

      <div className="flex flex-wrap gap-3">
        <JoinAsPlayerAction accountPersonaId={accountPersonaId} />
        <Link href="/student/enroll?type=child" className={buttonClasses("secondary")}>
          <UserPlus size={ICON.sm} strokeWidth={1.5} aria-hidden="true" />
          Inscribir a un hijo o dependiente
          <ArrowRight size={ICON.sm} strokeWidth={1.5} aria-hidden="true" />
        </Link>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Active portal view — self-managed student and/or representante
// ---------------------------------------------------------------------------

function ActivePortalView({
  data,
  isPlayer,
  accountPersonaId,
  onPhotoUploaded,
  onOwnPhotoUploaded,
}: {
  data: StudentPortalSummary;
  /**
   * Issue #1132: whether the SESSION account itself counts as a player —
   * its own `ALUMNO` role (still granted at direct self-enrollment, before
   * any membership exists) OR its own active membership (a representante
   * who paid for themselves; `crear_membresia` no longer grants `ALUMNO`).
   * Neither signal alone is reliable on its own, so this is already the
   * union of both — see `StudentPortalContent`.
   */
  isPlayer: boolean;
  /** The persona behind the SESSION — not the profile currently selected. */
  accountPersonaId: string;
  onPhotoUploaded: () => void;
  /** Extra refresh for the SESSION avatar, fired only when the OWN profile uploaded. */
  onOwnPhotoUploaded?: () => void;
}): React.ReactElement {
  const { managedProfiles, selectedId, setSelectedId, selectedProfile } = useManagedProfiles(
    data,
    isPlayer,
    accountPersonaId,
  );

  const representative = isRepresentative(data.representados.length);
  const selfIsMinor = isMinor(data.self?.fechaNacimiento);
  const selectedPersonaId = selectedProfile?.personaId ?? "";
  // FAM-23: the first name alone is ambiguous between «María José» and «María Fernanda».
  const selectedName = selectedProfile ? displayNameFor(selectedProfile, managedProfiles) : "";

  // Payments are fetched here rather than inside `PagosSection` because
  // `paymentSituation` below also needs `pendingPagos`, the count of
  // payments still awaiting validation.
  const [pagosState, setPagosState] = useState<PagosState>({ status: "loading" });
  const [pagosReloadToken, setPagosReloadToken] = useState(0);

  useEffect(() => {
    if (!selectedPersonaId) return;
    let cancelled = false;
    setPagosState({ status: "loading" });
    fetchPagosDePersona(selectedPersonaId)
      .then((pagos) => {
        if (!cancelled) setPagosState({ status: "ready", pagos });
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setPagosState({
          status: "error",
          message: toUserMessage(error, "No se pudo cargar el historial de pagos."),
        });
      });
    return () => {
      cancelled = true;
    };
  }, [selectedPersonaId, pagosReloadToken]);

  // The student's REAL schedule assignments — the only source from which an
  // upcoming session can be stated truthfully (see `TrainingPanel`).
  const [horariosState, setHorariosState] = useState<HorariosState>({ status: "loading" });

  useEffect(() => {
    if (!selectedPersonaId) return;
    let cancelled = false;
    setHorariosState({ status: "loading" });
    fetchHorariosPorAlumno(Number(selectedPersonaId))
      .then((asignaciones) => {
        if (!cancelled) setHorariosState({ status: "ready", asignaciones });
      })
      .catch(() => {
        // No message to carry: the panel states the recovery itself, and a
        // schedule lookup failing must never take the payment band with it.
        if (!cancelled) setHorariosState({ status: "error" });
      });
    return () => {
      cancelled = true;
    };
  }, [selectedPersonaId]);

  // Issue #1328: the backend's own combined anchor (`MembershipSummary.
  // cubiertoHasta` — an APPROVED `Pago` AND a `CoberturaBonificada`, the
  // furthest of the two) is the only reading — a benefit applied through
  // `ApplyBenefitForm` shows up here immediately. `buildMembershipView`
  // (`student-adapter.ts`) normalizes an absent field to `null`, so there is
  // no real payload where it is `undefined`; `null` means no coverage yet,
  // never "ask the payments instead".
  const coverageEnd = selectedProfile?.membership?.cubiertoHasta ?? null;
  const pendingPagos = useMemo(
    () =>
      pagosState.status === "ready"
        ? pagosState.pagos.filter((pago) => pago.estadoPago === "PENDIENTE_VALIDACION").length
        : 0,
    [pagosState],
  );
  /**
   * Las tres cifras derivadas de la fila de pulso. Ninguna dispara una
   * llamada: salen del estado que esta pantalla ya tenía.
   *
   * `null` significa "todavía no se sabe", nunca 0. Un alumno sin pago
   * aprobado y uno cuya cobertura vence hoy son situaciones distintas, y un
   * horario que no cargó no es un alumno sin entrenamientos.
   */
  const diasDeCobertura = useMemo(() => daysUntil(coverageEnd), [coverageEnd]);
  const coverageStat = describeCoverageStat(diasDeCobertura, coverageEnd);
  const pendingStat = describePendingStat(pendingPagos);
  const nextPayment = describeNextPayment({
    monthlyPrice: selectedProfile?.membership?.montoAplicado ?? null,
    esGratuidadFamiliar: selectedProfile?.membership?.esGratuidadFamiliar ?? false,
    coverageEnd,
    daysLeft: diasDeCobertura,
    pendingCount: pendingPagos,
  });
  const entrenamientosSemanales = useMemo(
    () =>
      horariosState.status === "ready"
        ? contarEntrenamientosSemanales(horariosState.asignaciones)
        : null,
    [horariosState],
  );
  const asistencia = useMemo(() => {
    const recap = selectedProfile
      ? summarizeRecentAttendance(selectedProfile.recentSessions)
      : null;
    if (!recap) return null;
    return {
      ...recap,
      porcentaje: Math.round((recap.attended / recap.total) * 100),
    };
  }, [selectedProfile]);

  const selectedIsMinor = isMinor(selectedProfile?.fechaNacimiento);
  /**
   * Whether the profile on screen is the account holder's own, rather than a
   * dependent they manage. Several things below turn on it, and every one of
   * them used to turn on the age of the SELECTED profile instead — which is
   * the same question only for a self-managed student.
   */
  const viewingOwnProfile =
    selectedProfile !== null && selectedProfile.personaId === accountPersonaId;
  /**
   * Whether the authenticated account may manage the selected profile's
   * photo: the profile is the account's own, or the account is its
   * representante. The backend re-checks the real permission regardless.
   */
  const canManagePhoto =
    selectedProfile !== null &&
    (viewingOwnProfile || selectedProfile.representanteId === Number(accountPersonaId));
  /**
   * Only a minor looking at their OWN account is read-only on payments. A
   * representante looking at their minor child is the person the backend
   * expects to pay (`registrarPago` authorizes the owner, their representative
   * or an ADMINISTRADOR), so they get the real CTA.
   */
  const paymentsAreReadOnly = selectedIsMinor && viewingOwnProfile;
  // #1137: a represented adult used to have one action here — "Independizarse
  // del representante" — which is gone (independence is now a PRESENCIAL
  // command an ADMINISTRADOR runs from "Miembros", never self-service). That
  // account has nothing left to trigger from its own portal, so it no longer
  // counts toward the account-actions card.
  //
  // #1318: "Agregar hijo o dependiente" is no longer gated on `representative`
  // alone — a self-managed player (`isPlayer`, no dependents yet) can reach
  // it too, and `/student/add-dependent` grants REPRESENTANTE on save if the
  // account doesn't have it yet (see that page's own notice).
  //
  // #1340: `representative || isPlayer` alone does not exclude a player who
  // is STILL represented — the same self-service command rejects that alta
  // with its own precondition (`PersonaServicio.crear_representado_propio`:
  // `persona.representante_id is not None`), so this mirrors that exact
  // check instead of letting the visitor find out from a failed submit.
  const selfRepresented = data.self?.representanteId != null;
  const showAddDependentCta = (representative || isPlayer) && !selfRepresented;
  const showJoinAsPlayerCta = !isPlayer;

  /**
   * The one thing this screen exists to answer, resolved once and rendered
   * in ONE place — the "Cuota" card (`CuotaCard`), which leads with the
   * verdict and states the evidence under it. It used to be rendered twice,
   * as the carnet's own status band as well; the owner moved the verdict off
   * the identity card entirely, so there is one host again.
   * `describePaymentSituation` still owns every word, so the rail card and
   * `/student/payments` can never word the same `estado` differently.
   */
  const paymentSituation = selectedProfile
    ? describePaymentSituation({
        studentName: selectedName,
        viewingOwnProfile,
        blockedAsMinor: paymentsAreReadOnly,
        representanteName: selectedProfile.representante
          ? `${selectedProfile.representante.nombres} ${selectedProfile.representante.apellidos}`.trim()
          : null,
        hasMembership: selectedProfile.membership != null,
        planName: selectedProfile.membership?.categoria ?? null,
        monthlyPrice: selectedProfile.membership?.montoAplicado ?? null,
        coverageEnd,
        pendingCount: pendingPagos,
        esGratuidadFamiliar: selectedProfile.membership?.esGratuidadFamiliar ?? false,
        suspended: selectedProfile.membership?.estado === "SUSPENDIDA",
        motivoSuspension: selectedProfile.membership?.motivoSuspension ?? null,
      })
    : null;

  // FAM-11: a rejected payment used to be visible only in Pagos and the bell.
  const rejectedNotice =
    pagosState.status === "ready" &&
    paymentSituation !== null &&
    paymentSituation.kind !== "minor-blocked" &&
    paymentSituation.kind !== "suspended"
      ? describeRejectedPago(pagosState.pagos, {
          viewingOwnProfile,
          studentName: selectedName,
        })
      : null;

  return (
    // Full content width, like `/dashboard`, `/members` and `/payments` — the
    // 760px cap the prototype started from left the right HALF of the content
    // column empty on every family screen. "El carnet manda" (Propuesta 2)
    // spends that width on the carnet itself: see the `PAGE_RAIL` block below
    // for how the identity card and the two rail cards split it.
    <>
      {/* The greeting is NOT a heading here. It used to be a 26px h2 directly
          under `PageHeader`'s own 26px h1, which stacked "ÁREA DE ESTUDIANTES
          / Mi cuenta / Hola, Ana" — three title-weight lines before a single
          fact — and then repeated the same name in the carnet immediately
          below. It now rides in `AppShell`'s subtitle slot, on the header row
          where it belongs. */}

      {/* Guardian → dependent switcher. The audit named this genuinely
          club-specific: a representante lands on one child and swaps to the
          next without leaving the page. */}
      <FamilyStrip profiles={managedProfiles} value={selectedId} onChange={setSelectedId} />

      {/* Issue #1666: the primary invites / removes the second guardian here;
          the second guardian sees the same card read-only. */}
      {representative && <GuardiansCard />}

      {selectedProfile === null || paymentSituation === null ? (
        <EmptyState
          icon={<User size={ICON.lg} strokeWidth={1.5} aria-hidden="true" />}
          title="No se encontraron jugadores asociados a esta cuenta"
          description="Inscríbete como jugador o agrega un hijo o dependiente para empezar."
        />
      ) : (
        // "El carnet manda" (docs/archive/fixes/12-mi-cuenta-carnet.md, Propuesta 2):
        // the identity card carries its own payment band; the rail stacks the
        // "Cuota" detail card over "Esta semana". `PAGE_RAIL` is the
        // product's one two-column split (see layout.ts) — kept for its
        // `lg:items-start` (no stretch override, see fix 12b below), but its
        // own 340px rail is overridden here.
        //
        // Fix 12c: the chosen maquette draws this split as
        // `grid-template-columns: 1fr 1fr` — even columns. Reusing
        // `PAGE_RAIL`'s 340px rail unmodified left the carnet at roughly
        // three-quarters of the row width, well past what its four-fact grid
        // needs to fill — the actual root of the "empty carnet" defect fix 12
        // and 12b kept re-finding downstream (inside the card, then as page
        // canvas below it) without ever touching the ratio that caused it.
        // `!` beats `PAGE_RAIL`'s own `lg:grid-cols-[…_340px]` regardless of
        // class order, the same mechanism fix 12b used for `lg:!items-stretch`
        // before finding stretching itself was the wrong fix — the technique
        // is fine, that one application of it was not.
        //
        // AND THEN IT MOVED BACK, on purpose. The column is `380px 1fr` now,
        // not `1fr 1fr`. This is not fix 12c reverted by accident: 12c widened
        // the carnet because its FOUR-cell, two-column grid could not fill the
        // 340px rail's complement, and widening the column was the honest fix
        // for that shape. The card no longer has that shape. It is a PORTRAIT
        // credential — one centred column of three stacked figures, the same
        // composition it prints at — and the condition 12c reasoned from is
        // gone: a 566px column is now the thing stopping the card from being
        // a card, not the thing filling it. 380px is the card's own width, and
        // the width it stops needing goes to the rail rather than back into
        // the carnet as the emptiness 12, 12b and 12c each chased downstream.
        //
        // Fix 12b tried stretching the carnet's height first —
        // `lg:!items-stretch` plus `flex-1` on the carnet, so it filled the
        // row's full height — and it traded one emptiness for another:
        // whenever the rail (Cuota + Esta semana) was taller than the
        // carnet's own content, the stretched carnet grew to match it and the
        // slack landed INSIDE the card, below its fact grid. A carnet has a
        // carnet's proportions, not a column's, so it still sits at its
        // natural height, top-aligned with the rail (`lg:items-start`).
        //
        // D11b, and the root cause the three socio screens share: `AppShell`'s
        // `<main>` is `flex flex-1 flex-col` inside a `min-h-screen` chain, so
        // it is ALREADY the height of the window. Nothing on this screen
        // claimed that height, so every pixel the content did not use piled up
        // under the last block — 38% of the viewport for a self-managed adult.
        //
        // `flex-1` here is what claims it. It is not a cosmetic addition: it
        // is the missing first link of a chain this file already wrote and
        // then could not switch on. `TrainingPanel` carries `flex-1`,
        // `TrainingRow` carries `flex-1`, and the panel's footer carries
        // `mt-auto` — all three were inert, because `PAGE_RAIL`'s
        // `lg:items-start` sizes each column to its own content and no
        // container in the chain had any free space for them to divide.
        //
        // `mt-auto` could never have fixed this on its own. An auto margin
        // absorbs free space its container ALREADY has; with nothing stretched
        // it has nothing to absorb, which is exactly how the same attempt died
        // on the profile screen.
        <>
        {/*
          LA FILA DE PULSO, en la gramática de `/dashboard` (STAT_GRID).

          Es lo que faltaba para que esta pantalla y el panel de admin dejaran
          de leerse como dos productos: el vocabulario ya estaba -- el carnet
          es coal con su cifra en `font-display` -- pero la forma no, porque
          acá no había ninguna fila de tiles.

          Lo que NO se portó, y por qué: el carnet no se convierte en banda a
          lo ancho. Tiene proporciones de carnet, no de columna -- el #297
          acaba de volverlo una credencial imprimible de 54x85.6mm-- y el fix
          12b ya probó estirarlo: el sobrante terminó DENTRO de la tarjeta,
          bajo su grilla de datos. El split SÍ se movió después de esto: ya no
          es el `1fr 1fr` del fix 12c sino `380px 1fr`, porque la tarjeta pasó
          a ser vertical y una columna de 566px es justo lo que le impedía
          serlo. El razonamiento completo está sobre el `<div>` del riel.

          Cada cifra sale de datos que la pantalla ya tenía, y ninguna repite
          una cifra que ya esté abajo. La de asistencia se MUDÓ: el pie de
          "Esta semana" cedió su "8 de 10" y se quedó con el alcance, que es lo
          que una tile no puede decir.
        */}
        <div data-testid="student-pulse" className={STAT_GRID}>
          {representative ? (
            /* The guardian's four figures: what the club needs from them. The
               same tiles, the same colour rule — cambia QUÉ se mide, no la
               paleta. «Fichas médicas» cannot say «2 de 3»: the portal does
               not receive each child's record status, so the tile points at
               the screen where it is reviewed instead of inventing a count. */
            <>
              <StatCard
                label="Cobertura"
                {...(diasDeCobertura === null
                  ? { tone: "neutral" as const, status: "Sin pago" }
                  : diasDeCobertura < 0
                    ? { tone: "bad" as const, status: "Vencida" }
                    : { tone: "ok" as const, status: "Al día" })}
                icon={<ShieldCheck size={ICON.sm} strokeWidth={1.75} />}
                href={withSelectedStudent("/student/payments", selectedPersonaId)}
                value={diasDeCobertura === null ? "—" : Math.abs(diasDeCobertura)}
                unit={diasDeCobertura === null ? undefined : diasDeCobertura === 1 || diasDeCobertura === -1 ? "día" : "días"}
                hint={selectedName}
              />
              {nextPayment.hot ? (
                <StatCard
                  label="Próximo pago"
                  variant="hot"
                  href={withSelectedStudent("/student/payments", selectedPersonaId)}
                  value={nextPayment.value}
                  status={nextPayment.status}
                  hint={nextPayment.hint}
                />
              ) : (
                <StatCard
                  label="Próximo pago"
                  tone={nextPayment.tone}
                  status={nextPayment.status}
                  icon={<Banknote size={ICON.sm} strokeWidth={1.75} />}
                  href={withSelectedStudent("/student/payments", selectedPersonaId)}
                  value={nextPayment.value}
                  hint={nextPayment.hint}
                />
              )}
              <StatCard
                label="A tu cargo"
                tone="info"
                status="Registrados"
                icon={<Users size={ICON.sm} strokeWidth={1.75} />}
                value={data.representados.length}
                unit={data.representados.length === 1 ? "jugador" : "jugadores"}
              />
              <StatCard
                label="Fichas médicas"
                tone="info"
                status="Revisa la ficha"
                icon={<Stethoscope size={ICON.sm} strokeWidth={1.75} />}
                href={withSelectedStudent("/student/medical-record", selectedPersonaId)}
                value="—"
                hint={`de ${selectedName}`}
              />
            </>
          ) : (
            <>
          <StatCard
            label="Cobertura"
            tone={coverageStat.tone}
            status={coverageStat.status}
            icon={<ShieldCheck size={ICON.sm} strokeWidth={1.75} />}
            href={withSelectedStudent("/student/payments", selectedPersonaId)}
            value={coverageStat.value}
            unit={coverageStat.unit}
            hint={coverageStat.hint}
          />
          <StatCard
            label="Asistencia"
            {...attendanceTone(asistencia === null ? null : asistencia.porcentaje)}
            icon={<CalendarCheck size={ICON.sm} strokeWidth={1.75} />}
            href={withSelectedStudent("/student/attendance", selectedPersonaId)}
            value={asistencia === null ? "—" : asistencia.porcentaje}
            unit={asistencia === null ? undefined : "%"}
            hint={
              asistencia === null ? (
                "Aparece cuando el entrenador tome lista"
              ) : (
                <span className="flex flex-col gap-y-field">
                  <StatTrack value={asistencia.attended} total={asistencia.total} />
                  <span>{`${asistencia.attended} de ${asistencia.total} sesiones`}</span>
                </span>
              )
            }
          />
          <StatCard
            label="Entrenamientos"
            tone="ball"
            icon={<Dumbbell size={ICON.sm} strokeWidth={1.75} />}
            value={entrenamientosSemanales ?? "—"}
            hint={entrenamientosSemanales === null ? "horario no disponible" : "por semana"}
          />
          <StatCard
            label="Pagos por validar"
            tone={pendingStat.tone}
            status={pendingStat.status}
            icon={<Hourglass size={ICON.sm} strokeWidth={1.75} />}
            href={withSelectedStudent("/student/payments", selectedPersonaId)}
            value={pendingPagos}
            hint={pendingStat.hint}
          />
            </>
          )}
        </div>

        <div className={cn(PAGE_RAIL, "lg:!grid-cols-[minmax(0,336px)_minmax(0,1fr)]", "flex-1")}>
          {/* Below `lg` the wrapper dissolves (`contents`) so the account
              actions can drop to the end of the page: a phone reads carnet,
              cuota, this week, and only then the occasional actions. */}
          <div className="flex flex-col gap-5 max-lg:contents lg:self-stretch">
            <MemberCard
              profile={selectedProfile}
              coverageEnd={coverageEnd}
              horariosState={horariosState}
              canManagePhoto={canManagePhoto}
              onPhotoUploaded={() => {
                onPhotoUploaded();
                // Only the session-owner's photo is the AppShell avatar: an
                // upload on a represented dependent must never refresh/replace
                // the representative's avatar.
                if (selectedProfile?.personaId === accountPersonaId) onOwnPhotoUploaded?.();
              }}
            />

            {/* Only on the minor's OWN account. Shown to a guardian looking
                at their dependent it read "Su representante: Laura Vera" to
                Laura Vera — the card names the person the reader should turn
                to, and the reader was that person. */}
            {selectedIsMinor && viewingOwnProfile && selectedProfile.representante && (
              <section className="card flex items-center gap-3 p-5" aria-label="Su representante">
                <span className="flex h-9 w-9 flex-none items-center justify-center rounded-full bg-canvas">
                  <User size={ICON.base} strokeWidth={1.5} className="text-ink-3" aria-hidden="true" />
                </span>
                <span className="min-w-0">
                  <span className="block text-2xs font-bold uppercase text-ink-3-strong">
                    Su representante
                  </span>
                  <span className="block text-sm font-semibold text-ink">
                    {selectedProfile.representante.nombres}{" "}
                    {selectedProfile.representante.apellidos}
                  </span>
                </span>
              </section>
            )}

            {/* Fills the carnet column under the credential: the quick doors
                this account has, each one only when its destination is valid
                for the role (same gates as the account actions card). */}
            <InfoPanel title="Qué puede hacer aquí" className="max-lg:hidden lg:flex-1">
              <ul className="flex flex-col gap-field">
                <li>
                  <Link
                    href={withSelectedStudent(
                      paymentSituation.canRegister ? "/student/payments?registrar=1" : "/student/payments",
                      selectedPersonaId,
                    )}
                    className="font-semibold text-ink underline decoration-line-2 underline-offset-4 hover:decoration-ink"
                  >
                    {paymentSituation.canRegister ? "Pagar la mensualidad" : "Ver los pagos"}
                  </Link>{" "}
                  y su validación.
                </li>
                <li>
                  <Link
                    href={withSelectedStudent("/student/attendance", selectedPersonaId)}
                    className="font-semibold text-ink underline decoration-line-2 underline-offset-4 hover:decoration-ink"
                  >
                    Ver la asistencia
                  </Link>{" "}
                  de las últimas sesiones.
                </li>
                <li>
                  <Link
                    href={withSelectedStudent("/student/medical-record", selectedPersonaId)}
                    className="font-semibold text-ink underline decoration-line-2 underline-offset-4 hover:decoration-ink"
                  >
                    Revisar la ficha médica
                  </Link>{" "}
                  y el contacto de emergencia.
                </li>
                {!selfIsMinor && showAddDependentCta && (
                  <li>
                    <Link
                      href="/student/add-dependent"
                      className="font-semibold text-ink underline decoration-line-2 underline-offset-4 hover:decoration-ink"
                    >
                      Agregar un dependiente
                    </Link>{" "}
                    a tu cuenta.
                  </li>
                )}
              </ul>
            </InfoPanel>
          </div>

          {/* Below `lg` this is the SECOND stacked block (see `PAGE_RAIL`'s
              doc comment: no explicit columns below `lg` means DOM order is
              reading order), so a phone gets exactly the brief's order —
              carnet, then the payment action, then "Esta semana".

              `lg:self-stretch` is the second link of the chain described on
              the grid above: it opts THIS column, and only this column, out of
              `PAGE_RAIL`'s `lg:items-start`, so the row's full height reaches
              `TrainingPanel`. The carnet column deliberately stays opted in —
              fix 12b stretched it once and the slack landed inside the card,
              under its fact grid, which is the same emptiness moved rather
              than closed. A carnet has a carnet's proportions; a panel of
              rows does not. */}
          {/* FAM-27: below `lg` the Mensualidad card leads the page, above the
              carnet (`order-first`; the DOM keeps the carnet column first so
              `lg` still reads carnet | rail). */}
          <div className="flex flex-col gap-5 max-lg:order-first lg:self-stretch">
            <CuotaCard
              situation={paymentSituation}
              coverageEnd={coverageEnd}
              monthlyPrice={selectedProfile.membership?.montoAplicado ?? null}
              notice={rejectedNotice}
              viewPagosHref={withSelectedStudent("/student/payments", selectedPersonaId)}
              action={
                paymentSituation.canRegister
                  ? // Straight into the open form. The route to paying used to
                    // be three clicks — link, page, "Registrar un pago" — and
                    // the last two were on a screen that never said whose
                    // payment it was about.
                    {
                      href: withSelectedStudent("/student/payments?registrar=1", selectedPersonaId),
                      label: "Registrar un pago",
                    }
                  : {
                      href: withSelectedStudent("/student/payments", selectedPersonaId),
                      label: "Ver los pagos",
                    }
              }
            />

            <TrainingPanel
              profile={selectedProfile}
              horariosState={horariosState}
              viewingOwnProfile={viewingOwnProfile}
              studentName={selectedName}
            />

            {/* A minor manages nothing on their own account — no dependents, no
                joining — but the ficha médica is theirs to read.

                #1318 reopened "Agregar hijo o dependiente" for a self-managed
                adult player, not just an existing representante;
                `/student/add-dependent` grants REPRESENTANTE on save. #1132:
                "Unirme como jugador" is gated on `isPlayer` (role OR own
                active membership), never the role alone, and creates the
                membership for `accountPersonaId`, never the selected profile.
                #1137: independence is a PRESENCIAL admin command, not here. */}
            <section
              aria-label="Acciones de la cuenta"
              className="card flex flex-col overflow-hidden"
            >
              <div className="border-b border-line px-5 py-3">
                <h2 className="font-display text-lg uppercase leading-tight tracking-flat text-ink">Acciones de la cuenta</h2>
              </div>
              <div className="flex flex-col gap-2 px-5 py-4 [&>*]:justify-center">
                {!selfIsMinor && showAddDependentCta && (
                  <Link href="/student/add-dependent" className={buttonClasses("secondary")}>
                    <UserPlus size={ICON.sm} strokeWidth={1.5} aria-hidden="true" />
                    Agregar hijo o dependiente
                    <ArrowRight size={ICON.sm} strokeWidth={1.5} aria-hidden="true" />
                  </Link>
                )}
                {!selfIsMinor && showJoinAsPlayerCta && (
                  <JoinAsPlayerAction accountPersonaId={accountPersonaId} />
                )}
                <Link
                  href={withSelectedStudent("/student/medical-record", selectedPersonaId)}
                  className={buttonClasses("secondary")}
                >
                  <Stethoscope size={ICON.sm} strokeWidth={1.5} aria-hidden="true" />
                  {viewingOwnProfile
                    ? "Ficha médica"
                    : `Ficha médica de ${selectedName}`}
                  <ArrowRight size={ICON.sm} strokeWidth={1.5} aria-hidden="true" />
                </Link>
              </div>
            </section>
          </div>
        </div>
        </>
      )}

    </>
  );
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

function StudentPortalContent(): React.ReactElement {
  const { session, refreshSession } = useAuth();
  const personaId = session?.user.id ?? "";
  const hasAlumnoRole = session?.roles.includes("ALUMNO") ?? false;

  const [state, setState] = useState<LoadState>({ status: "loading" });
  // FAM-01: ANY own membership counts, INACTIVA included. A representative who
  // just joined has one waiting on its first payment: it must appear as a
  // profile they can pay for, and "Unirme como jugador" must not be offered
  // again (it created a duplicate membership).
  const ownMembership = state.status === "ready" && hasOwnMembership(state.data);
  /**
   * Issue #1132: "es jugador" (the domain's single predicate — an ACTIVA
   * Membresia, `app/dominio/jugador.py::es_jugador`) is the union of both
   * signals this session can carry, never the role alone. `ALUMNO` is still
   * granted at direct self-enrollment (`POST /enrollment/`, before any
   * membership exists), but `crear_membresia` no longer grants it when a
   * representante pays a membership for their OWN persona — so that account
   * would otherwise read as "not a player" forever despite having exactly
   * the membership this feature is about.
   */
  const isPlayer = hasAlumnoRole || ownMembership;
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    if (!personaId) return;
    let cancelled = false;
    setState({ status: "loading" });
    fetchStudentPortal(personaId)
      .then((data) => {
        if (!cancelled) setState({ status: "ready", data });
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setState({
          status: "error",
          message: toUserMessage(error, "No se pudo cargar tu cuenta."),
        });
      });
    return () => {
      cancelled = true;
    };
  }, [personaId, reloadToken]);

  const greetingName =
    state.status === "ready" && state.data.self
      ? firstNameOf(state.data.self.nombres)
      : firstNameOf(session?.user.name ?? "");

  // The greeting rides on the header row rather than in a heading of its own
  // (see `ActivePortalView`). While the portal is still loading there is no
  // name to greet, so the slot stays empty instead of flashing a placeholder.
  const portalMode =
    state.status === "ready"
      ? derivePortalMode(isPlayer, state.data.representados.length)
      : null;
  const roleLabel =
    state.status === "ready" && isRepresentative(state.data.representados.length)
      ? "Representante"
      : "Jugador";
  const subtitle =
    portalMode === "active" && greetingName
      ? buildContextLine(`Hola, ${greetingName} · ${roleLabel}`)
      : undefined;

  return (
    <AppShell title="Mi cuenta" subtitle={subtitle}>
      {state.status === "loading" && (
        <div className="card">
          <LoadingState label="Cargando tu cuenta…" />
        </div>
      )}
      {state.status === "error" && (
        <StudentErrorState message={state.message} onRetry={() => setReloadToken((n) => n + 1)} />
      )}
      {state.status === "ready" &&
        (portalMode === "pending" ? (
          <PendingEnrollmentView data={state.data} accountPersonaId={personaId} />
        ) : (
          <ActivePortalView
            data={state.data}
            isPlayer={isPlayer}
            accountPersonaId={personaId}
            onPhotoUploaded={() => setReloadToken((n) => n + 1)}
            onOwnPhotoUploaded={() => void refreshSession()}
          />
        ))}
    </AppShell>
  );
}

export default function StudentPage(): React.ReactElement {
  return (
    <ProtectedRoute allowedRoles={["representante", "estudiante", "unsupported"]}>
      {/* `useManagedProfiles` reads `?alumno=` through `useSearchParams`, which
          needs a boundary to fall back to during prerender — the same wrapper
          `/student/payments` and `/reset-password` use for the same reason. */}
      <Suspense>
        <StudentPortalContent />
      </Suspense>
    </ProtectedRoute>
  );
}
