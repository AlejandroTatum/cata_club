/**
 * Trainer Attendance Registration — real, persisted flow.
 *
 * Multi-step wizard for registering attendance in training sessions,
 * backed by real data end-to-end:
 *   - Schedule (Horario) selection from `GET /api/attendance/schedules`,
 *     with the roster loaded directly from that Horario's assigned alumnos
 *     (`GET /api/groups/horarios/:id/alumnos`).
 *   - Student attendance marking (present/absent/late/justified).
 *   - Confirmation + real persistence via `POST /api/attendance/records`
 *     (one real `POST /asistencias` per student, see
 *     src/lib/server/attendance-adapter.ts).
 *
 * Domain rules:
 *   - Horario/session is NOT owned by one trainer.
 *   - Any trainer can register attendance in any available session.
 *   - The system records which trainer took the attendance.
 */

"use client";

import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import Link from "next/link";
import ProtectedRoute from "@/components/ProtectedRoute";
import AppShell from "@/components/shell/AppShell";

import StudentSearch from "@/components/StudentSearch";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/contexts/ToastContext";
import {
  Calendar,
  Clock,
  Users,
  UserCheck,
  UserX,
  Timer,
  FileText,
  CheckCircle,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  AlertTriangle,
  ClipboardList,
  XCircle,
} from "lucide-react";
import {
  ATTENDANCE_LABELS,
  ATTENDANCE_STATES,
  countByState,
  buildAttendanceSummary,
  buildRosterFromAlumnoHorarios,
  resolveEntrenadorId,
  resolveDisplayTrainerName,
  type SessionStudent,
} from "./attendance-utils";
import { getAttendanceBadgeTokens, formatDay, groupSchedulesByDay, paginateRecords, getTotalPages } from "@/app/attendance/attendance-utils";
import type { TrainingSchedule } from "@/app/attendance/attendance-utils";
import type { DiaSemana } from "@/types/domain";
import {
  fetchTrainingSchedules,
  fetchAlumnosPorHorario,
  fetchAttendanceRecords,
  registerAttendance,
  type RegisterAttendanceResult,
} from "@/services/api";
import type { EstadoAsistencia } from "@/types/domain";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type WizardStep = "select-session" | "mark-attendance" | "confirm";

const STEP_ORDER: WizardStep[] = ["select-session", "mark-attendance", "confirm"];

const STEP_LABELS: Record<WizardStep, string> = {
  "select-session": "Seleccionar Horario",
  "mark-attendance": "Registrar Asistencia",
  confirm: "Confirmar y Finalizar",
};

// ---------------------------------------------------------------------------
// UI constants
// ---------------------------------------------------------------------------

/** Page size for the student list in the attendance registration wizard. */
const WIZARD_PAGE_SIZE = 10;

const ATTENDANCE_ICONS: Record<EstadoAsistencia, React.ReactNode> = {
  present: <UserCheck size={16} strokeWidth={2} aria-hidden="true" />,
  absent: <UserX size={16} strokeWidth={2} aria-hidden="true" />,
  late: <Timer size={16} strokeWidth={2} aria-hidden="true" />,
  justified: <FileText size={16} strokeWidth={2} aria-hidden="true" />,
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function TrainerAttendancePage(): React.ReactElement {
  const { session } = useAuth();
  const { showError } = useToast();

  const [step, setStep] = useState<WizardStep>("select-session");

  const [schedules, setSchedules] = useState<TrainingSchedule[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [selectedScheduleId, setSelectedScheduleId] = useState<number | null>(null);
  const [expandedDays, setExpandedDays] = useState<Set<DiaSemana>>(new Set());
  const [rosterLoading, setRosterLoading] = useState(false);
  const [rosterError, setRosterError] = useState<string | null>(null);

  const [students, setStudents] = useState<SessionStudent[]>([]);
  const [searchFilter, setSearchFilter] = useState("");
  const [studentPage, setStudentPage] = useState(1);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [result, setResult] = useState<RegisterAttendanceResult | null>(null);

  const loadOptions = useCallback(async (): Promise<void> => {
    try {
      setLoading(true);
      setLoadError(null);
      const scheduleData = await fetchTrainingSchedules();
      setSchedules(scheduleData);
    } catch (err) {
      console.error("[trainer/attendance] loadOptions failed", err);
      setLoadError("Error al cargar horarios");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadOptions();
  }, [loadOptions]);

  useEffect(() => {
    if (submitError) showError(submitError);
  }, [submitError, showError]);

  // Reset student page when search filter changes.
  useEffect(() => {
    setStudentPage(1);
  }, [searchFilter]);

  const currentIndex = STEP_ORDER.indexOf(step);
  const isFirst = currentIndex === 0;
  const isLast = currentIndex === STEP_ORDER.length - 1;
  const progress = ((currentIndex + 1) / STEP_ORDER.length) * 100;

  const selectedSchedule = schedules.find((s) => s.id === selectedScheduleId) ?? null;

  // Admins may register attendance on a trainer's behalf (backend requires
  // entrenadorId to belong to an actual ENTRENADOR — see attendance-utils.ts).
  const trainerName = resolveDisplayTrainerName(
    session?.user?.role ?? null,
    session?.user?.name,
    selectedSchedule,
  );
  const entrenadorPersonaId = resolveEntrenadorId(
    session?.user?.role ?? null,
    session?.user?.id,
    selectedSchedule,
  );

  // /trainer is gated to the "trainer" role only — an admin using this page
  // must bounce back to their own attendance overview, not the trainer panel.
  const backHref = session?.user?.role === "admin" ? "/attendance" : "/trainer";

  // ---- Navigation ----

  async function handleContinueToRoster(): Promise<void> {
    if (selectedScheduleId === null) return;
    setRosterLoading(true);
    setRosterError(null);
    try {
      // The wizard always registers attendance for "today" (backend defaults
      // fechaEntrenamiento to today's server date when omitted — see
      // RegisterAttendanceRequest.fechaEntrenamiento). So "existing records
      // for this session" means: attendance already recorded today for this
      // horarioId. Prefilling from these avoids re-registering everyone as
      // "Ausente" and creating duplicate rows when the wizard is reopened.
      const today = new Date().toISOString().slice(0, 10);
      const [alumnoHorarios, existingRecords] = await Promise.all([
        fetchAlumnosPorHorario(selectedScheduleId),
        fetchAttendanceRecords({
          fechaInicio: today,
          fechaFin: today,
          horarioId: selectedScheduleId,
        }),
      ]);
      setStudents(buildRosterFromAlumnoHorarios(alumnoHorarios, existingRecords));
      setStudentPage(1);
      setStep("mark-attendance");
    } catch (err) {
      console.error("[trainer/attendance] fetchAlumnosPorHorario failed", err);
      setRosterError("No se pudo cargar el listado de estudiantes de este horario.");
    } finally {
      setRosterLoading(false);
    }
  }

  function handleBack(): void {
    const prevIdx = currentIndex - 1;
    if (prevIdx >= 0) {
      setStep(STEP_ORDER[prevIdx]);
    }
  }

  function handleNext(): void {
    const nextIdx = currentIndex + 1;
    if (nextIdx < STEP_ORDER.length) {
      setStep(STEP_ORDER[nextIdx]);
    }
  }

  function toggleDay(day: DiaSemana): void {
    setExpandedDays((prev) => {
      const next = new Set(prev);
      if (next.has(day)) {
        next.delete(day);
      } else {
        next.add(day);
      }
      return next;
    });
  }

  function handleDirectAttendanceSet(studentIndex: number, state: EstadoAsistencia): void {
    setStudents((prev) =>
      prev.map((s, i) => (i === studentIndex ? { ...s, attendance: state } : s)),
    );
  }

  async function handleConfirm(e: FormEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault();
    if (!selectedScheduleId || entrenadorPersonaId === null) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const registration = await registerAttendance({
        horarioId: selectedScheduleId,
        entrenadorId: entrenadorPersonaId,
        students: students.map((s) => ({ personaId: Number(s.id), estado: s.attendance })),
      });
      setResult(registration);
      setConfirmed(true);
    } catch (err) {
      console.error("[trainer/attendance] registerAttendance failed", err);
      setSubmitError("No se pudo registrar la asistencia. Intente nuevamente.");
    } finally {
      setSubmitting(false);
    }
  }

  function handleReset(): void {
    setStep("select-session");
    setSelectedScheduleId(null);
    setStudents([]);
    setConfirmed(false);
    setSubmitting(false);
    setSubmitError(null);
    setResult(null);
  }

  // ---- Student list pagination (attendance wizard) ----

  const filteredStudents = useMemo(() => {
    if (!searchFilter.trim()) return students;
    const q = searchFilter.toLowerCase();
    return students.filter((s) => s.name.toLowerCase().includes(q));
  }, [students, searchFilter]);

  const totalStudentPages = useMemo(
    () => getTotalPages(filteredStudents.length, WIZARD_PAGE_SIZE),
    [filteredStudents.length],
  );
  const paginatedStudents = useMemo(
    () => paginateRecords(filteredStudents, studentPage, WIZARD_PAGE_SIZE),
    [filteredStudents, studentPage],
  );

  // ---- Step renderers ----

  function renderSessionSelection(): React.ReactElement {
    const dayGroups = groupSchedulesByDay(schedules);
    return (
      <div className="space-y-6">
        <div>
          <p className="mb-3 text-sm leading-relaxed text-cata-text/65">
            Seleccione el horario de entrenamiento:
          </p>
          {schedules.length === 0 ? (
            <p className="text-sm text-cata-text/45">No hay horarios registrados.</p>
          ) : (
            <div className="space-y-2">
              {dayGroups.map((group) => {
                const isExpanded = expandedDays.has(group.day);
                const panelId = `schedule-day-${group.day}`;
                return (
                  <div key={group.day} className="overflow-hidden rounded-xl border border-cata-border bg-cata-surface">
                    <button
                      type="button"
                      onClick={() => toggleDay(group.day)}
                      aria-expanded={isExpanded}
                      aria-controls={panelId}
                      className="flex w-full items-center justify-between gap-2.5 p-4 text-left transition-colors duration-150 hover:bg-cata-bg/40"
                    >
                      <span className="flex items-center gap-2.5">
                        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-cata-red/15">
                          <Calendar size={16} strokeWidth={1.5} className="text-cata-red" aria-hidden="true" />
                        </div>
                        <span className="text-sm font-bold text-cata-text">{group.label}</span>
                        <span className="text-xs text-cata-text/45">
                          ({group.schedules.length}{" "}
                          {group.schedules.length === 1 ? "horario" : "horarios"})
                        </span>
                      </span>
                      <ChevronDown
                        size={16}
                        strokeWidth={1.5}
                        className={`shrink-0 text-cata-text/45 transition-transform duration-150 ${
                          isExpanded ? "rotate-180" : ""
                        }`}
                        aria-hidden="true"
                      />
                    </button>
                    {isExpanded && (
                      <div id={panelId} className="grid gap-2 border-t border-cata-border p-3 sm:grid-cols-2">
                        {group.schedules.map((sched) => {
                          const isActive = sched.id === selectedScheduleId;
                          return (
                            <button
                              key={sched.id}
                              type="button"
                              onClick={() => setSelectedScheduleId(sched.id)}
                              className={`card-hover p-5 text-left transition-all duration-150 ${
                                isActive
                                  ? "ring-2 ring-cata-red/30 border-cata-red/20"
                                  : ""
                              }`}
                            >
                              <div className="rounded-lg bg-cata-bg/60 px-3 py-2">
                                <p className="flex items-center gap-1.5 text-xs text-cata-text/70">
                                  <Clock size={13} strokeWidth={1.5} className="text-cata-red/70" aria-hidden="true" />
                                  <span className="font-semibold text-cata-text">{sched.horaInicio}</span>
                                  <span className="text-cata-text/40">a</span>
                                  <span className="font-semibold text-cata-text">{sched.horaFin}</span>
                                </p>
                                <p className="mt-1 flex items-center gap-1.5 text-xs text-cata-text/55">
                                  <UserCheck size={12} strokeWidth={1.5} aria-hidden="true" />
                                  {sched.entrenadorNombre}
                                </p>
                              </div>
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {rosterError && (
          <div className="alert-error" role="alert">
            {rosterError}
          </div>
        )}

        <button
          type="button"
          onClick={handleContinueToRoster}
          disabled={!selectedScheduleId || rosterLoading}
          className="btn-primary w-full shadow-soft"
        >
          {rosterLoading ? "Cargando estudiantes..." : "Continuar"}
          <ChevronRight size={14} strokeWidth={1.5} aria-hidden="true" />
        </button>


      </div>
    );
  }

  function renderMarkAttendance(): React.ReactElement | null {
    if (!selectedSchedule) return null;

    const presentCount = countByState(students, "present");
    const absentCount = countByState(students, "absent");
    const lateCount = countByState(students, "late");
    const justifiedCount = countByState(students, "justified");

    return (
      <div className="space-y-4">
        {/* Session context */}
        <div className="rounded-xl border border-cata-border bg-cata-surface p-4">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-cata-red/15">
              <Calendar size={14} strokeWidth={1.5} className="text-cata-red" aria-hidden="true" />
            </div>
            <span className="font-medium text-cata-text">
              {formatDay(selectedSchedule.diaSemana)}
            </span>
            <span className="text-cata-text/65">&middot;</span>
            <span className="text-cata-text/65">
              {selectedSchedule.horaInicio} — {selectedSchedule.horaFin}
            </span>
          </div>
          {/* Live counts */}
          <div className="mt-3 flex flex-wrap gap-3 text-xs">
            <span className="inline-flex items-center gap-1 rounded-full bg-cata-state-ok/10 px-2 py-0.5 font-medium text-cata-state-ok">
              <UserCheck size={11} strokeWidth={2} aria-hidden="true" />
              {presentCount} Presentes
            </span>
            <span className="inline-flex items-center gap-1 rounded-full bg-red-50 px-2 py-0.5 font-medium text-red-700">
              <UserX size={11} strokeWidth={2} aria-hidden="true" />
              {absentCount} Ausentes
            </span>
            <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 font-medium text-amber-700">
              <Timer size={11} strokeWidth={2} aria-hidden="true" />
              {lateCount} Tardanzas
            </span>
            <span className="inline-flex items-center gap-1 rounded-full bg-blue-50 px-2 py-0.5 font-medium text-blue-700">
              <FileText size={11} strokeWidth={2} aria-hidden="true" />
              {justifiedCount} Justificados
            </span>
          </div>

        </div>

        {/* Student list with attendance toggle */}
        {students.length === 0 ? (
          <div className="card flex flex-col items-center py-10 text-center">
            <Users size={28} strokeWidth={1.5} className="mb-2 text-cata-text/20" aria-hidden="true" />
            <p className="text-sm text-cata-text/50">Este horario no tiene alumnos asignados.</p>
          </div>
        ) : (
          <>
            <div className="relative">
              <input
                type="text"
                placeholder="Filtrar alumnos por nombre..."
                value={searchFilter}
                onChange={(e) => setSearchFilter(e.target.value)}
                className="w-full rounded-lg border border-cata-border bg-white px-4 py-2.5 text-sm text-cata-text placeholder:text-cata-text/40 focus:border-cata-red focus:outline-none focus:ring-1 focus:ring-cata-red"
                aria-label="Filtrar alumnos"
              />
            </div>
            {filteredStudents.length === 0 ? (
              <div className="card flex flex-col items-center py-10 text-center">
                <Users size={28} strokeWidth={1.5} className="mb-2 text-cata-text/20" aria-hidden="true" />
                <p className="text-sm text-cata-text/50">No se encontraron alumnos con ese nombre.</p>
              </div>
            ) : (
              <>
                <div className="space-y-2">
                  {paginatedStudents.map((student) => {
                    const idx = students.findIndex((s) => s.id === student.id);
                    return (
                      <div
                        key={student.id}
                        className="card-hover flex items-center justify-between gap-3 p-4"
                      >
                        <div className="flex items-center gap-3">
                          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-cata-red/15">
                            <UserCheck size={16} strokeWidth={1.5} className="text-cata-red" aria-hidden="true" />
                          </div>
                          <span className="text-sm font-medium text-cata-text">
                            {student.name}
                          </span>
                        </div>

                        <fieldset>
                          <legend className="sr-only">Estado de asistencia de {student.name}</legend>
                          <div className="grid grid-cols-2 gap-1 sm:flex">
                            {ATTENDANCE_STATES.map((state) => {
                              const isActive = student.attendance === state;
                              return (
                                <button
                                  key={state}
                                  type="button"
                                  onClick={() => handleDirectAttendanceSet(idx, state)}
                                  aria-pressed={isActive}
                                  className={`inline-flex items-center gap-1 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-all duration-150 ${
                                    isActive
                                      ? `border-current/20 ${getAttendanceBadgeTokens(state).badgeClass}`
                                      : "border-transparent text-cata-text/45 hover:border-cata-border hover:text-cata-text/65"
                                  }`}
                                >
                                  {ATTENDANCE_ICONS[state]}
                                  <span>{ATTENDANCE_LABELS[state]}</span>
                                </button>
                              );
                            })}
                          </div>
                        </fieldset>
                      </div>
                    );
                  })}
                </div>

                {/* Student list pagination */}
                {filteredStudents.length > WIZARD_PAGE_SIZE && (
                  <div className="flex items-center justify-between rounded-xl border border-cata-border bg-cata-bg px-4 py-3">
                    <p className="text-xs text-cata-text/65">
                      Página {studentPage} de {totalStudentPages} · {filteredStudents.length} alumno{filteredStudents.length !== 1 ? "s" : ""}
                    </p>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => setStudentPage((p) => Math.max(1, p - 1))}
                        disabled={studentPage === 1}
                        className="btn-secondary inline-flex items-center gap-1 px-3 py-1.5 text-xs disabled:cursor-not-allowed disabled:opacity-50"
                        aria-label="Página anterior"
                      >
                        <ChevronLeft size={14} strokeWidth={1.5} aria-hidden="true" />
                        Anterior
                      </button>
                      <button
                        type="button"
                        onClick={() => setStudentPage((p) => Math.min(totalStudentPages, p + 1))}
                        disabled={studentPage === totalStudentPages}
                        className="btn-secondary inline-flex items-center gap-1 px-3 py-1.5 text-xs disabled:cursor-not-allowed disabled:opacity-50"
                        aria-label="Página siguiente"
                      >
                        Siguiente
                        <ChevronRight size={14} strokeWidth={1.5} aria-hidden="true" />
                      </button>
                    </div>
                  </div>
                )}
              </>
            )}
          </>
        )}

        {/* Trainer attribution reminder */}
        <div className="rounded-xl border border-cata-border bg-cata-bg p-3 text-xs text-cata-text/65">
          <span className="flex items-center gap-1.5 font-medium text-cata-text">
            <UserCheck size={12} strokeWidth={1.5} className="text-cata-red" aria-hidden="true" />
            Registrando como: {trainerName}
          </span>
        </div>
      </div>
    );
  }

  function renderConfirmation(): React.ReactElement | null {
    if (!selectedSchedule) return null;

    const presentCount = countByState(students, "present");
    const absentCount = countByState(students, "absent");
    const lateCount = countByState(students, "late");
    const justifiedCount = countByState(students, "justified");
    const summary = buildAttendanceSummary(students);

    return (
      <div className="space-y-5">
        <p className="text-sm leading-relaxed text-cata-text/65">
          Revise el resumen antes de confirmar el registro de asistencia:
        </p>

        {/* Session data */}
        <div className="card-hover p-4">
          <div className="mb-3 flex items-center gap-2">
            <Calendar size={14} strokeWidth={1.5} className="text-cata-red" aria-hidden="true" />
            <h3 className="text-xs font-semibold uppercase tracking-wider text-cata-text/45">
              Sesión
            </h3>
          </div>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
            <dt className="text-cata-text/65">Horario</dt>
            <dd className="font-medium text-cata-text">
              {formatDay(selectedSchedule.diaSemana)} {selectedSchedule.horaInicio} — {selectedSchedule.horaFin}
            </dd>
          </dl>
        </div>

        {/* Attendance summary */}
        <div className="card-hover p-4">
          <div className="mb-3 flex items-center gap-2">
            <Users size={14} strokeWidth={1.5} className="text-cata-red" aria-hidden="true" />
            <h3 className="text-xs font-semibold uppercase tracking-wider text-cata-text/45">
              Resumen de Asistencia
            </h3>
          </div>
          <div className="mb-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div className="rounded-lg bg-cata-state-ok/10 p-3 text-center">
              <p className="text-lg font-bold text-cata-state-ok">{presentCount}</p>
              <p className="text-xs text-cata-state-ok/80">Presentes</p>
            </div>
            <div className="rounded-lg bg-red-50 p-3 text-center">
              <p className="text-lg font-bold text-red-700">{absentCount}</p>
              <p className="text-xs text-red-700/80">Ausentes</p>
            </div>
            <div className="rounded-lg bg-amber-50 p-3 text-center">
              <p className="text-lg font-bold text-amber-700">{lateCount}</p>
              <p className="text-xs text-amber-700/80">Tardanzas</p>
            </div>
            <div className="rounded-lg bg-blue-50 p-3 text-center">
              <p className="text-lg font-bold text-blue-700">{justifiedCount}</p>
              <p className="text-xs text-blue-700/80">Justificados</p>
            </div>
          </div>
          <p className="text-xs text-cata-text/45">{summary}</p>
        </div>

        {/* Trainer attribution */}
        <div className="rounded-xl border border-cata-state-ok/30 bg-cata-state-ok/10 p-4">
          <div className="mb-2 flex items-center gap-2">
            <UserCheck size={14} strokeWidth={1.5} className="text-cata-state-ok" aria-hidden="true" />
            <h3 className="text-xs font-semibold uppercase tracking-wider text-cata-state-ok">
              Asistencia Registrada Por
            </h3>
          </div>
          <div className="flex items-center gap-2 text-sm">
            <UserCheck size={16} strokeWidth={1.5} className="text-cata-state-ok" aria-hidden="true" />
            <span className="font-medium text-cata-state-ok">{trainerName}</span>
          </div>
          <p className="mt-1 text-xs text-cata-state-ok/80">
            {trainerName} será registrado como el entrenador que tomó la asistencia
            de {students.length} estudiantes en esta sesión.
          </p>
        </div>
      </div>
    );
  }

  // ---- Render ----

  return (
    <ProtectedRoute allowedRoles={["trainer", "admin"]}>
      <AppShell eyebrow="Área de entrenadores" title="Registrar Asistencia">
      {confirmed ? (
        <div className="flex min-h-[50vh] items-center justify-center py-8">
          <div className="w-full max-w-lg text-center">
            <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-full bg-cata-state-ok/10">
              <CheckCircle size={32} className="text-cata-state-ok" strokeWidth={1.5} aria-hidden="true" />
            </div>
            <h2 className="mb-3 text-2xl font-bold tracking-tight text-cata-text">
              Asistencia Registrada
            </h2>
            <p className="mb-2 text-sm leading-relaxed text-cata-text/65">
              La asistencia para{" "}
              <strong className="text-cata-text">
                {selectedSchedule
                  ? `${formatDay(selectedSchedule.diaSemana)} ${selectedSchedule.horaInicio} — ${selectedSchedule.horaFin}`
                  : "el horario seleccionado"}
              </strong>{" "}
              ha sido registrada exitosamente.
            </p>
            <p className="mb-2 text-sm leading-relaxed text-cata-text/65">
              <strong className="text-cata-text">{trainerName}</strong> figura como
              el entrenador que tomó la asistencia de{" "}
              <strong className="text-cata-text">{result?.createdCount ?? 0} estudiantes</strong>.
            </p>
            {students.length > 0 && (
              <p className="mb-4 text-xs text-cata-text/40">
                {buildAttendanceSummary(students)}
              </p>
            )}
            {result && result.failed.length > 0 && (
              <div className="mb-8 rounded-xl border border-amber-500/30 bg-amber-900/20 p-3 text-left text-xs text-amber-400">
                <p className="flex items-center gap-1.5 font-medium">
                  <AlertTriangle size={12} strokeWidth={2} aria-hidden="true" />
                  {result.failed.length} registro(s) no se pudieron guardar
                </p>
                <p className="mt-1 text-amber-700/80">
                  Vuelva a intentar el registro para esos estudiantes desde una nueva sesión.
                </p>
              </div>
            )}
            {(!result || result.failed.length === 0) && <div className="mb-8" />}

            <div className="flex flex-col gap-3 sm:flex-row sm:justify-center">
              <button type="button" onClick={handleReset} className="btn-primary shadow-soft">
                Registrar Otra Asistencia
              </button>
              <Link href={backHref} className="btn-secondary">
                Volver al Panel
              </Link>
            </div>
          </div>
        </div>
      ) : (
        <div>
          {/* Loading state */}
          {loading && (
            <div className="flex items-center justify-center py-16">
              <div className="flex items-center gap-2">
                <Clock size={16} strokeWidth={1.5} className="animate-spin text-cata-text/65" aria-hidden="true" />
                <p className="text-sm text-cata-text/50">Cargando horarios y grupos...</p>
              </div>
            </div>
          )}

          {/* Error state */}
          {loadError && !loading && (
            <div className="card mb-8 border border-red-200 bg-red-50 p-6 text-center">
              <XCircle size={32} strokeWidth={1.5} className="mx-auto mb-3 text-red-700" aria-hidden="true" />
              <p className="text-sm text-cata-red">{loadError}</p>
              <button type="button" onClick={() => loadOptions()} className="btn-ghost mt-3 text-xs text-cata-red">
                Reintentar
              </button>
            </div>
          )}

          {!loading && !loadError && (
            <>
              {/* Progress bar */}
              <div className="mb-8">
                <div className="mb-2 flex items-center justify-between text-xs text-cata-text/45">
                  <span>
                    Paso {currentIndex + 1} de {STEP_ORDER.length}
                  </span>
                  <span>{STEP_LABELS[step]}</span>
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-cata-border">
                  <div
                    className="h-full rounded-full bg-cata-red transition-all duration-400 ease-out"
                    style={{ width: `${progress}%` }}
                  />
                </div>
              </div>

              {/* Form card */}
              <div className="card mx-auto max-w-2xl p-6 sm:p-8">
                <div className="mb-6 flex items-center gap-2">
                  <ClipboardList size={16} strokeWidth={1.5} className="text-cata-red" aria-hidden="true" />
                  <h2 className="text-lg font-semibold text-cata-text">
                    {STEP_LABELS[step]}
                  </h2>
                </div>

                <form onSubmit={handleConfirm}>
                  {/* Step content */}
                  {step === "select-session" && renderSessionSelection()}
                  {step === "mark-attendance" && renderMarkAttendance()}
                  {step === "confirm" && renderConfirmation()}

                  {/* Navigation buttons */}
                  {step !== "select-session" && (
                    <div className="mt-8 flex items-center justify-between gap-3">
                      <div>
                        {!isFirst && (
                          <button
                            type="button"
                            onClick={handleBack}
                            disabled={submitting}
                            className="btn-ghost"
                          >
                            <ChevronLeft size={14} strokeWidth={1.5} aria-hidden="true" />
                            Atrás
                          </button>
                        )}
                      </div>

                      <div className="flex gap-3">
                        {!isLast ? (
                          <button
                            type="button"
                            onClick={handleNext}
                            disabled={students.length === 0}
                            className="btn-primary shadow-soft"
                          >
                            Siguiente
                            <ChevronRight size={14} strokeWidth={1.5} aria-hidden="true" />
                          </button>
                        ) : null}

                        {isLast && (
                          <button
                            type="submit"
                            disabled={submitting || entrenadorPersonaId === null || students.length === 0}
                            className="btn-primary shadow-soft"
                          >
                            {submitting ? (
                              "Registrando..."
                            ) : (
                              <>
                                <CheckCircle size={14} strokeWidth={2} aria-hidden="true" />
                                Confirmar Asistencia
                              </>
                            )}
                          </button>
                        )}
                      </div>
                    </div>
                  )}
                </form>
              </div>

              {/* Navigation link */}
              <p className="mt-6 text-center text-sm text-cata-text/65">
                <Link
                  href={backHref}
                  className="font-medium text-cata-red transition-colors hover:text-cata-red-light"
                >
                  &larr; {session?.user?.role === "admin" ? "Volver a Asistencias" : "Volver al Panel del Entrenador"}
                </Link>
              </p>
            </>
          )}
        </div>
      )}
      </AppShell>
    </ProtectedRoute>
  );
}
