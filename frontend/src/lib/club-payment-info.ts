/**
 * The club's transfer data, as shown in the «Cómo pagar» block (#1535, FAM-04).
 *
 * Types and the pure normalizer only. The values themselves live in
 * `lib/server/club-payment-info.ts` and reach the browser only through the
 * authenticated `GET /api/club/payment-info` route: nothing here may carry a
 * literal account, holder or cédula, or it would ship in the public bundle.
 * Every field the club has not configured is `undefined`/empty and renders nothing. The QR and
 * the cash place and hours are optional, since the club's card carries none.
 * The holder's e-mail on that card is deliberately not here.
 */

export interface ClubPaymentInfo {
  holder: string;
  accountType: string;
  accountNumber: string;
  bank: string;
  /** The holder's cédula or RUC, exactly as it must appear. */
  holderId: string;
  /** Public path or URL of the QR image. Rendered only when set. */
  qrImageSrc?: string;
  cashPlace?: string;
  cashHours?: string;
}

const clean = (value: string | undefined): string | undefined => {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
};

/**
 * The usable payment data, or `null` when the transfer essentials (bank,
 * number and holder) are missing, so the block hides instead of showing a
 * half-filled account.
 */
export function getClubPaymentInfo(
  raw: Partial<ClubPaymentInfo>,
): ClubPaymentInfo | null {
  const bank = clean(raw.bank);
  const accountNumber = clean(raw.accountNumber);
  const holder = clean(raw.holder);
  if (!bank || !accountNumber || !holder) return null;
  return {
    holder,
    bank,
    accountNumber,
    accountType: clean(raw.accountType) ?? "",
    holderId: clean(raw.holderId) ?? "",
    qrImageSrc: clean(raw.qrImageSrc),
    cashPlace: clean(raw.cashPlace),
    cashHours: clean(raw.cashHours),
  };
}
