/**
 * The club's transfer data, as shown in the «Cómo pagar» block (#1535, FAM-04).
 *
 * One module of record: components never restate these values. Every field the
 * club has not configured is `undefined`/empty and renders nothing. The QR and
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

export const CLUB_PAYMENT_INFO: Partial<ClubPaymentInfo> = {
  holder: "Lucía Catalina Cedillo Flor",
  accountType: "Cuenta de Ahorros",
  accountNumber: "2901580636",
  bank: "Banco de Loja",
  holderId: "0102724358",
};

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
  raw: Partial<ClubPaymentInfo> = CLUB_PAYMENT_INFO,
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
