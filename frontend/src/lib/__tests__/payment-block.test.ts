/**
 * Non-payment block (#1768) — the pure rules the portal screens share.
 */

import { describe, it, expect } from "vitest";
import {
  CASH_AT_CLUB_NOTE,
  PAYMENT_BLOCK_MINOR_MESSAGE,
  isPaymentsOnlyProfile,
  paymentBlockBanner,
} from "@/lib/payment-block";

describe("paymentBlockBanner", () => {
  it("names the day the coverage ended, in the product's date grammar", () => {
    expect(paymentBlockBanner("2026-09-30")).toBe(
      "Tu membresía venció el 30/09/2026. Paga para volver a entrenar.",
    );
  });

  it("drops the date, not the sentence, when the backend sent none", () => {
    expect(paymentBlockBanner(null)).toBe("Tu membresía venció. Paga para volver a entrenar.");
  });

  it("names the dependent when a guardian is the reader", () => {
    expect(paymentBlockBanner("2026-09-30", "Sofía")).toBe(
      "La membresía de Sofía venció el 30/09/2026. Paga para que vuelva a entrenar.",
    );
  });
});

describe("copy", () => {
  it("speaks «tú», never voseo", () => {
    expect(PAYMENT_BLOCK_MINOR_MESSAGE).toBe("Pídele a tu representante que pague.");
    expect(CASH_AT_CLUB_NOTE).toBe("El efectivo se paga en el club.");
  });
});

describe("isPaymentsOnlyProfile", () => {
  it("restricts a blocked profile of a player or a guardian", () => {
    expect(isPaymentsOnlyProfile("estudiante", { bloqueadoPorImpago: true })).toBe(true);
    expect(isPaymentsOnlyProfile("representante", { bloqueadoPorImpago: true })).toBe(true);
  });

  it("leaves a profile that is not blocked alone", () => {
    expect(isPaymentsOnlyProfile("estudiante", { bloqueadoPorImpago: false })).toBe(false);
    expect(isPaymentsOnlyProfile("estudiante", {})).toBe(false);
    expect(isPaymentsOnlyProfile("estudiante", null)).toBe(false);
  });

  it("NEVER locks staff out, even when their own membership is blocked (L6)", () => {
    expect(isPaymentsOnlyProfile("admin", { bloqueadoPorImpago: true })).toBe(false);
    expect(isPaymentsOnlyProfile("trainer", { bloqueadoPorImpago: true })).toBe(false);
  });

  it("does not restrict an unauthenticated or unsupported reader", () => {
    expect(isPaymentsOnlyProfile(null, { bloqueadoPorImpago: true })).toBe(false);
    expect(isPaymentsOnlyProfile("unsupported", { bloqueadoPorImpago: true })).toBe(false);
  });
});
