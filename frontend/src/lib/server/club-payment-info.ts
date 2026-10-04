/**
 * The club's transfer data — SERVER ONLY (#1535, FAM-04).
 *
 * The owner's rule: this data is shown only to signed-in users. It therefore
 * must never be imported from a client component or from `lib/club-payment-info.ts`
 * (shared with the browser): a literal here would ship in the public JS bundle.
 * It leaves the server only through the authenticated
 * `GET /api/club/payment-info` route. The holder's e-mail is deliberately absent.
 */

import { getClubPaymentInfo, type ClubPaymentInfo } from "@/lib/club-payment-info";

export const CLUB_PAYMENT_INFO: Partial<ClubPaymentInfo> = {
  holder: "Lucía Catalina Cedillo Flor",
  accountType: "Cuenta de Ahorros",
  accountNumber: "2901580636",
  bank: "Banco de Loja",
  holderId: "0102724358",
};

/** The normalized data, or `null` when the club has not configured the essentials. */
export function getServerClubPaymentInfo(): ClubPaymentInfo | null {
  return getClubPaymentInfo(CLUB_PAYMENT_INFO);
}
