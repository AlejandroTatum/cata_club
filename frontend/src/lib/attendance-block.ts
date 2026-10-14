/**
 * Non-payment block (#1768) on attendance: the one place that knows how the
 * backend names its refusal.
 *
 * The backend answers a player blocked for non-payment with a stable machine
 * reason, `codigo` (`AsistenciaBloqueadaPorImpago` for a single registration,
 * `AsistenciaLoteFallidoDTO.codigo` for each failed item of a batch). The
 * reason's wording is for the trainer to read and may change; the code is what
 * the BFF and the screens decide on, never the text.
 */

export const ATTENDANCE_BLOCKED_BY_NON_PAYMENT_CODE = "asistencia_bloqueada_por_impago";

/** Whether `codigo` (or an `ApiClientError.code`) is the non-payment refusal. */
export function isAttendanceBlockedByNonPayment(codigo: unknown): boolean {
  return codigo === ATTENDANCE_BLOCKED_BY_NON_PAYMENT_CODE;
}
