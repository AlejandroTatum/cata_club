import { describe, expect, it } from "vitest";
import { CLUB_PAYMENT_INFO, getClubPaymentInfo } from "../club-payment-info";

describe("club payment info", () => {
  it("carries the club's account from its card", () => {
    expect(getClubPaymentInfo()).toMatchObject({
      holder: "Lucía Catalina Cedillo Flor",
      accountType: "Cuenta de Ahorros",
      accountNumber: "2901580636",
      bank: "Banco de Loja",
      holderId: "0102724358",
    });
  });

  it("has no QR, cash place or cash hours configured", () => {
    const info = getClubPaymentInfo();
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
