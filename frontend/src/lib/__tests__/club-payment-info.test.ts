import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { getClubPaymentInfo } from "../club-payment-info";
import { CLUB_PAYMENT_INFO, getServerClubPaymentInfo } from "../server/club-payment-info";

const SHARED_SOURCE = readFileSync(path.resolve(__dirname, "../club-payment-info.ts"), "utf8");

describe("club payment info", () => {
  it("serves the club's account from the server-only module", () => {
    expect(getServerClubPaymentInfo()).toMatchObject({
      accountType: "Cuenta de Ahorros",
      bank: "Banco de Loja",
    });
    expect(getServerClubPaymentInfo()?.accountNumber).toMatch(/^\d{10}$/);
    expect(getServerClubPaymentInfo()?.holderId).toMatch(/^\d{10}$/);
  });

  it("keeps every literal out of the shared client module", () => {
    for (const value of Object.values(CLUB_PAYMENT_INFO)) {
      expect(SHARED_SOURCE).not.toContain(value);
    }
    expect(SHARED_SOURCE).not.toMatch(/\d{10}/);
  });

  it("has no QR, cash place or cash hours configured", () => {
    const info = getServerClubPaymentInfo();
    expect(info?.qrImageSrc).toBeUndefined();
    expect(info?.cashPlace).toBeUndefined();
    expect(info?.cashHours).toBeUndefined();
  });

  it("never holds the e-mail", () => {
    expect(JSON.stringify(CLUB_PAYMENT_INFO)).not.toContain("@");
  });

  it("is null when the config is empty or lacks the essentials", () => {
    expect(getClubPaymentInfo({})).toBeNull();
    expect(getClubPaymentInfo({ ...CLUB_PAYMENT_INFO, accountNumber: "  " })).toBeNull();
    expect(getClubPaymentInfo({ ...CLUB_PAYMENT_INFO, bank: undefined })).toBeNull();
  });
});
