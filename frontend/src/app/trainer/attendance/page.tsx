/**
 * Trainer Attendance — "Pasar lista"
 * (`docs/archive/prototypes/prototipos/20-tomar-lista.html`).
 *
 * Three steps, backed by real data end to end:
 *   - Horario selection from `GET /api/attendance/schedules`, with the roster
 *     loaded from that Horario's assigned alumnos
 *     (`GET /api/groups/horarios/:id/alumnos`).
 *   - Marking, on 48px single-line fiches.
 *   - Confirmation + persistence via `POST /api/attendance/records`.
 *
 * Domain rules: a Horario is not owned by one trainer, any trainer may file a
 * session, and the system records who did.
 *
 * ## Data-integrity guarantees this screen must never lose
 *
 * The roster starts on `DEFAULT_ATTENDANCE` ("present"), because a session is
 * overwhelmingly "everyone showed up" and starting from nothing turned 40
 * students into 40 obligatory taps.
 *
 * That default does NOT remove the risk it replaced, it turns it around: the
 * old `absent` default let a trainer file a whole session as a no-show by
 * tapping straight through, and a `present` default lets them file students as
 * having attended without ever looking at them — including students on roster
 * page 2 they never scrolled to. So the roll call separates the VALUE from the
 * DECISION and never conflates the two:
 *   - `SessionStudent.reviewed` says whether a human touched the row. Every
 *     path that sets a state sets it: the fiche tap, the four controls,
 *     "Marcar restantes presentes", a record already saved for this session,
 *     and a restored draft entry.
 *   - `countUnreviewed` spans the FULL roster, never the visible page or the
 *     name filter, and both the roll call and the confirmation step show it.
 *   - An unreviewed fiche is visibly provisional (dashed outline, dashed state
 *     chip, "sin revisar" in its accessible name), and "Ver solo sin revisar"
 *     turns the count into a way to actually go clear it.
 *   - The confirmation step says "N de M siguen en Presente porque nadie los
 *     revisó" instead of reporting "45 presentes" identically either way, and
 *     offers to go back. It informs; it does not block — the trainer asked for
 *     a default, and a default that blocks is not one.
 *   - Tapping a fiche cycles the state, but `cycleWizardAttendance` can never
 *     return to `UNMARKED`, and the four explicit 44px controls stay present
 *     and stay a `radiogroup` — the tap is an accelerator, not a replacement.
 *   - The draft in `sessionStorage` only ever persists REVIEWED rows in one of
 *     the four REAL states, keyed by horario + date, so a refresh can never
 *     launder "nobody looked" into "confirmed"; see the rules block in
 *     `attendance-utils.ts`. Every way back INTO the flow — the browser's Back
 *     button, a reload, the resume offer on step 1 — goes through that same
 *     draft, so none of them can restore a row nobody decided.
 *   - The `UNMARKED` sentinel still never reaches the API: `toAttendanceMarks`
 *     strips it and the submit refuses while `countUnmarked` is non-zero.
 *
 * ## What the audit found, and where it is answered
 *
 *   - 40 simultaneous targets on one screen → the fiche is one target for the
 *     common case; the four controls are the deliberate path.
 *   - No sticky commit → the totals + Continuar bar is `sticky bottom-0`, so
 *     the trainer never scrolls the card to reach it.
 *   - No draft persistence → a phone call no longer costs the session.
 *   - "N registro(s) no se pudieron guardar" without naming anyone → the
 *     failures are listed by name.
 *   - Back threw the trainer out of the wizard (user control and freedom, the
 *     principle that never moved off the prototype's 6/10) → the step lives in
 *     the URL, so each one is a real history entry: Back walks step 3 → step 2
 *     → step 1 → out, a reload lands back on the roll call, and leaving with
 *     marks on screen asks first instead of discarding in silence.
 *
 * ## Why this file is thin
 *
 * Every concern above used to live directly in this component, which is what
 * ran its Cognitive Complexity past every reasonable ceiling — state, effects,
 * handlers and render logic all nested in one function add up, even when each
 * piece alone is simple. This file now only WIRES those concerns together;
 * each one lives in its own hook or component, colocated in this folder:
 * `useAttendanceSchedules` (step 1's own data), `useAttendanceRoster` (the
 * open roster + step machinery), `useAttendanceMarking` (every way a mark
 * changes), `useAttendanceSubmission` (filing + the receipt's own counts),
 * `useWizardUrl`/`useWizardUrlRestore` (the wizard's address), `useLeaveGuard`
 * and `useResumableDrafts` (the two ways a roll call in progress survives),
 * plus one presentational component per step and per dense render section.
 */

"use client";

import { useCallback, useMemo } from "react";
import { useRouter } from "next/navigation";
import ProtectedRoute from "@/components/ProtectedRoute";
import AppShell from "@/components/shell/AppShell";
import { useAuth } from "@/contexts/AuthContext";
import { BackLink, ErrorState, LoadingState, Stepper } from "@/components/ui";
import { lastOccurrenceOfDiaSemana } from "@/lib/club-date";
import { formatDay } from "@/app/attendance/attendance-utils";
import type { CorrectionPatch } from "./CorrectionRow";
import {
  attendanceDraftKey,
  clearAttendanceDraft,
  WIZARD_STEP_ORDER as STEP_ORDER,
  type SessionStudent,
  type WizardStep,
} from "./attendance-utils";

import { useAttendanceSchedules } from "./useAttendanceSchedules";
import { useAttendanceRoster } from "./useAttendanceRoster";
import { useAttendanceMarking } from "./useAttendanceMarking";
import { useAttendanceSubmission } from "./useAttendanceSubmission";
import { useWizardUrl } from "./useWizardUrl";
import { useWizardUrlRestore } from "./useWizardUrlRestore";
import { useResumableDrafts } from "./useResumableDrafts";
import { useLeaveGuard } from "./useLeaveGuard";

import SchedulePickerStep from "./SchedulePickerStep";
import MarkAttendanceStep from "./MarkAttendanceStep";
import ConfirmationStep from "./ConfirmationStep";
import AttendanceReceipt from "./AttendanceReceipt";
import AttendanceCommitBar from "./AttendanceCommitBar";
import AttendanceLeaveDialog from "./AttendanceLeaveDialog";

/** The card heading per step. */
const STEP_LABELS: Record<WizardStep, string> = {
  "select-session": "Elija el horario",
  "mark-attendance": "Pasar lista",
  confirm: "Confirmar y finalizar",
};

export default function TrainerAttendancePage(): React.ReactElement {
  const { session } = useAuth();
  const router = useRouter();

  const schedules = useAttendanceSchedules();
  const roster = useAttendanceRoster();
  const url = useWizardUrl();

  const isAdmin = session?.user?.role === "admin";
  // /trainer is gated to the "trainer" role only — an admin using this page
  // must bounce back to their own attendance overview, not the trainer panel.
  const backHref = isAdmin ? "/attendance" : "/trainer";
  /** The receipt's "salida hacia el historial" (issue #213). */
  const attendanceHistoryHref = isAdmin ? "/attendance" : "/trainer/attendance/history";

  /** The draft's key — `null` until a session is actually chosen. */
  const draftKey = useMemo(
    () =>
      schedules.selectedScheduleId !== null && roster.sessionDate
        ? attendanceDraftKey(schedules.selectedScheduleId, roster.sessionDate)
        : null,
    [schedules.selectedScheduleId, roster.sessionDate],
  );

  const submission = useAttendanceSubmission({
    selectedScheduleId: schedules.selectedScheduleId,
    step: roster.step,
    readOnly: roster.readOnly,
    students: roster.students,
    sessionDate: roster.sessionDate,
    requestedDate: roster.requestedDate,
    draftKey,
    rosterLoading: roster.rosterLoading,
    writeWizardUrl: url.writeWizardUrl,
    openRoster: roster.openRoster,
  });

  const marking = useAttendanceMarking({
    students: roster.students,
    setStudents: roster.setStudents,
    serverRoster: roster.serverRosterRef.current,
    draftKey,
    confirmed: submission.confirmed,
    setRestoredFromDraft: roster.setRestoredFromDraft,
  });

  useWizardUrlRestore({
    schedules: schedules.schedules,
    loading: schedules.loading,
    loadError: schedules.loadError,
    confirmed: submission.confirmed,
    selectedScheduleId: schedules.selectedScheduleId,
    requestedDate: roster.requestedDate,
    students: roster.students,
    setSelectedScheduleId: schedules.setSelectedScheduleId,
    setStep: roster.setStep,
    ownedHistoryEntries: url.ownedHistoryEntries,
    writeWizardUrl: url.writeWizardUrl,
    openRoster: roster.openRoster,
  });

  const resumableDrafts = useResumableDrafts({
    schedules: schedules.schedules,
    confirmed: submission.confirmed,
    step: roster.step,
    setSelectedScheduleId: schedules.setSelectedScheduleId,
    openRoster: roster.openRoster,
    writeWizardUrl: url.writeWizardUrl,
  });

  const leaveGuard = useLeaveGuard({
    hasUnsavedMarks: marking.hasUnsavedMarks,
    backHref,
    router,
    refreshResumableDrafts: resumableDrafts.refreshResumableDrafts,
  });

  const currentIndex = STEP_ORDER.indexOf(roster.step);
  const isFirst = currentIndex === 0;
  const isLast = currentIndex === STEP_ORDER.length - 1;

  /** The named steps — step 1 carries the decision already made. */
  const stepNames = useMemo(
    () => [
      schedules.selectedSchedule
        ? `Horario · ${formatDay(schedules.selectedSchedule.diaSemana)} ${schedules.selectedSchedule.horaInicio}`
        : "Horario",
      "Pasar lista",
      "Confirmar",
    ],
    [schedules.selectedSchedule],
  );

  const handleContinueToRoster = useCallback((): void => {
    if (schedules.selectedScheduleId === null) return;
    // A schedule on TODAY's own day needs no explicit date — `openRoster`
    // already gives "today" via `clubIsoDate()` when this is `null`. A
    // schedule from a DIFFERENT day must carry its own date explicitly, or
    // it files under TODAY's date instead of the day it happened on (issue
    // #308).
    const requestedDate =
      schedules.selectedSchedule && schedules.selectedSchedule.diaSemana !== schedules.today
        ? lastOccurrenceOfDiaSemana(schedules.selectedSchedule.diaSemana)
        : null;
    void roster.openRoster(schedules.selectedScheduleId, requestedDate, "mark-attendance", (h, d, t) =>
      url.writeWizardUrl(h, d, t, "push"),
    );
  }, [roster, schedules.selectedSchedule, schedules.selectedScheduleId, schedules.today, url]);

  const handleBack = useCallback((): void => {
    url.handleBack(roster.step, schedules.selectedScheduleId, roster.requestedDate, roster.setStep);
  }, [roster, schedules.selectedScheduleId, url]);

  const handleNext = useCallback((): void => {
    url.handleNext(roster.step, schedules.selectedScheduleId, roster.requestedDate, roster.setStep);
  }, [roster, schedules.selectedScheduleId, url]);

  const handleReset = useCallback((): void => {
    if (draftKey) clearAttendanceDraft(draftKey);
    url.resetUrl();
    schedules.setSelectedScheduleId(null);
    roster.resetRoster();
    marking.resetMarking();
    submission.resetSubmission();
  }, [draftKey, marking, roster, schedules, submission, url]);

  /**
   * A row's correction just landed (issue #389, slice 4b) — patch `students`
   * AND the server-roster ref in the SAME operation, from the SAME `apply`
   * closure, so they can never disagree (see `useAttendanceRoster`'s own
   * note on why the ref exists).
   */
  const handleRowCorrected = useCallback(
    (personaId: string, patch: CorrectionPatch): void => {
      const apply = (list: SessionStudent[]): SessionStudent[] =>
        list.map((s) =>
          s.id === personaId
            ? {
                ...s,
                attendance: patch.attendance,
                justificativo: patch.justificativo,
                estadoJustificativo: patch.estadoJustificativo,
              }
            : s,
        );
      roster.setStudents((prev) => apply(prev));
      roster.serverRosterRef.current = apply(roster.serverRosterRef.current);
    },
    [roster],
  );

  return (
    <ProtectedRoute allowedRoles={["trainer", "admin"]}>
      <AppShell title="Pasar lista">
        {/* Issue #213: unconditional now — `handleLeaveWizard` already
            no-ops once `confirmed` is true, so this costs nothing and
            restores the frame every other screen in the panel keeps. */}
        <BackLink href={backHref} onClick={leaveGuard.handleLeaveWizard} className="mb-6" />
        <AttendanceLeaveDialog
          pendingConfirmation={leaveGuard.pendingConfirmation}
          reviewedCount={marking.reviewedCount}
          totalStudents={roster.students.length}
          onConfirm={leaveGuard.handleConfirmPending}
          onCancel={() => leaveGuard.setPendingConfirmation(null)}
        />
        {submission.confirmed ? (
          <AttendanceReceipt
            selectedSchedule={schedules.selectedSchedule}
            confirmationHeadingRef={submission.confirmationHeadingRef}
            result={submission.result}
            confirmedAt={submission.confirmedAt}
            students={roster.students}
            receiptCounts={submission.receiptCounts}
            receiptTotal={submission.receiptTotal}
            hasFailedRecords={submission.hasFailedRecords}
            rosterLoading={roster.rosterLoading}
            retryButtonLabel={submission.retryButtonLabel}
            onRetryFailed={() => void submission.handleRetryFailed()}
            onReset={handleReset}
            attendanceHistoryHref={attendanceHistoryHref}
            rosterError={roster.rosterError}
          />
        ) : (
          <>
            {schedules.loading && <LoadingState label="Cargando horarios…" />}

            {schedules.loadError && !schedules.loading && (
              <ErrorState message={schedules.loadError} onRetry={() => void schedules.loadOptions()} />
            )}

            {!schedules.loading && !schedules.loadError && (
              <>
                {/* The stepper is NAMED: "Horario · Lunes 15:00" tells you
                    what you already decided; "Paso 2 de 3" does not. */}
                <Stepper
                  className="mb-5"
                  steps={stepNames}
                  current={currentIndex + 1}
                  label="Pasos para tomar asistencia"
                />

                <div className="mx-auto w-full max-w-3xl">
                  <div className="card p-5 sm:p-6">
                    <h2 className="mb-4 font-display text-lg uppercase leading-tight tracking-flat text-ink">
                      {STEP_LABELS[roster.step]}
                    </h2>

                    <form onSubmit={(e) => void submission.handleConfirm(e)}>
                      {roster.step === "select-session" && (
                        <SchedulePickerStep
                          resumableDrafts={resumableDrafts.resumableDrafts}
                          describeSchedule={resumableDrafts.describeSchedule}
                          onResumeDraft={resumableDrafts.handleResumeDraft}
                          onDiscardDraft={leaveGuard.setPendingConfirmation}
                          rosterLoading={roster.rosterLoading}
                          schedules={schedules.schedules}
                          visible={schedules.visible}
                          today={schedules.today}
                          showAllDays={schedules.showAllDays}
                          onToggleShowAllDays={() => schedules.setShowAllDays((prev) => !prev)}
                          expandedDays={schedules.expandedDays}
                          onToggleDay={schedules.toggleDay}
                          selectedScheduleId={schedules.selectedScheduleId}
                          onSelectSchedule={schedules.setSelectedScheduleId}
                          weekRecordCounts={schedules.weekRecordCounts}
                          selectedListTaken={schedules.selectedListTaken}
                          rosterError={roster.rosterError}
                        />
                      )}
                      {roster.step === "mark-attendance" && (
                        <MarkAttendanceStep
                          selectedSchedule={schedules.selectedSchedule}
                          readOnly={roster.readOnly}
                          students={roster.students}
                          sessionDate={roster.sessionDate}
                          isAdmin={isAdmin}
                          onRowCorrected={handleRowCorrected}
                          reviewedCount={marking.reviewedCount}
                          unreviewedCount={marking.unreviewedCount}
                          onMarkRemainingPresent={marking.handleMarkRemainingPresent}
                          restoredFromDraft={roster.restoredFromDraft}
                          filteredStudents={marking.filteredStudents}
                          searchFilter={marking.searchFilter}
                          onSearchFilterChange={marking.setSearchFilter}
                          onlyUnreviewed={marking.onlyUnreviewed}
                          onToggleOnlyUnreviewed={() => marking.setOnlyUnreviewed((prev) => !prev)}
                          onShowAllStudents={() => marking.setOnlyUnreviewed(false)}
                          onCycleAttendance={marking.handleCycleAttendance}
                          onDirectAttendanceSet={marking.handleDirectAttendanceSet}
                          onRadioKeyDown={marking.handleAttendanceRadioKeyDown}
                        />
                      )}
                      {roster.step === "confirm" && (
                        <ConfirmationStep
                          selectedSchedule={schedules.selectedSchedule}
                          readOnly={roster.readOnly}
                          confirmCounts={marking.confirmCounts}
                          totalStudents={roster.students.length}
                          unreviewedCount={marking.unreviewedCount}
                          onReviewUnreviewed={() => {
                            marking.setOnlyUnreviewed(true);
                            marking.setSearchFilter("");
                            roster.setStep("mark-attendance");
                          }}
                          onMarkRemainingPresent={marking.handleMarkRemainingPresent}
                          submitError={submission.submitError}
                        />
                      )}

                      {/* The commit bar. `sticky bottom-0` so the trainer
                          never scrolls the whole card to reach it — all
                          three steps commit from it. */}
                      <AttendanceCommitBar
                        step={roster.step}
                        isFirst={isFirst}
                        isLast={isLast}
                        submitting={submission.submitting}
                        onBack={handleBack}
                        lastUndoable={marking.lastUndoable}
                        onUndo={marking.handleUndo}
                        students={roster.students}
                        unreviewedCount={marking.unreviewedCount}
                        unmarkedCount={marking.unmarkedCount}
                        readOnly={roster.readOnly}
                        rosterLoading={roster.rosterLoading}
                        selectedScheduleId={schedules.selectedScheduleId}
                        onContinueToRoster={handleContinueToRoster}
                        onNext={handleNext}
                      />
                    </form>
                  </div>
                </div>
              </>
            )}
          </>
        )}
      </AppShell>
    </ProtectedRoute>
  );
}
