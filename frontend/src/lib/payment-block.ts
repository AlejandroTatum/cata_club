/**
 * Non-payment block (#1768): the rules the member portal shares.
 *
 * The backend computes the block on read, per profile (`bloqueadoPorImpago` on
 * each portal profile); the portal's restriction is frontend routing, and the
 * backend's own enforcement is the attendance. A blocked profile gets ONLY the
 * Payments module, so it can pay and be let back in — never a «go to the club»
 * screen.
 */

import type { UserRole } from "@/types/domain";
import { formatDate } from "@/lib/format-utils";

/** A blocked minor on their own account cannot pay: the representative does. */
export const PAYMENT_BLOCK_MINOR_MESSAGE = "Pídele a tu representante que pague.";

/** Shown beside the payment method while blocked: cash is not a way back in from the portal. */
export const CASH_AT_CLUB_NOTE = "El efectivo se paga en el club.";

/**
 * The banner of a blocked profile. The date is the end of its coverage.
 *
 * @param studentName the dependent's given name when a guardian reads it; the
 *   reader's own account (`null`) is addressed in «tú».
 */
export function paymentBlockBanner(cubiertoHasta: string | null, studentName: string | null = null): string {
  const venció = cubiertoHasta ? `venció el ${formatDate(cubiertoHasta)}` : "venció";
  if (studentName) return `La membresía de ${studentName} ${venció}. Paga para que vuelva a entrenar.`;
  return `Tu membresía ${venció}. Paga para volver a entrenar.`;
}

/**
 * Whether a portal page must send this profile to Payments.
 *
 * Staff are NEVER restricted: `auth/me` computes the flag from the caller's own
 * person whatever their role, and an admin or coach whose own membership lapsed
 * still runs the club. For them the block is a banner on their own Payments
 * page and nothing more. A staff member's access to `/student*` is the existing
 * `isStaffPlayer` / `staffAwaitsFirstPayment` routing, which this does not touch.
 */
export function isPaymentsOnlyProfile(
  role: UserRole | null | undefined,
  profile: { bloqueadoPorImpago?: boolean } | null | undefined,
): boolean {
  if (role !== "estudiante" && role !== "representante") return false;
  return profile?.bloqueadoPorImpago === true;
}
