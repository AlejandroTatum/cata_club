/**
 * Unit tests for the Membresías y Pagos page pagination helpers.
 *
 * Pure functions — no React dependencies. Pattern follows
 * members-utils.test.ts / attendance-utils.test.ts.
 */

import { describe, it, expect } from "vitest";
import type { PaymentValidationRequest } from "@/services/api";
import {
  PAYMENTS_PAGE_SIZE,
  paginatePaymentRequests,
  getTotalPages,
  humanizePaymentPeriod,
  getPendingRequests,
  findQueueNeighbours,
  getAutoAdvanceId,
  buildApprovalChecklist,
  classifyPaymentMethod,
  describeBatchApproval,
  getNextUnreviewedId,
  composeRejectionReason,
} from "../payments-utils";

function buildRequests(count: number): PaymentValidationRequest[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `req-${i}`,
    studentName: `Student ${i}`,
    membershipPeriod: "2026-07",
    membershipType: "Mensual",
    expectedAmount: 25,
    paymentMethod: "Transferencia",
    uploadedAt: "2026-07-01T12:00:00Z",
    currentMembershipStatus: "vencida",
    proofFileName: "comprobante.png",
    proofFileType: "image",
    validationStatus: "pendiente",
    startDate: "2026-07-01",
    endDate: "2026-07-31",
  }));
}

describe("paginatePaymentRequests", () => {
  it("uses a page size of 10", () => {
    expect(PAYMENTS_PAGE_SIZE).toBe(10);
  });

  it("slices requests to the page size for page 1, and the remainder for a later page", () => {
    const requests = buildRequests(25);
    const page1 = paginatePaymentRequests(requests, 1);
    expect(page1).toHaveLength(10);
    expect(page1[0].id).toBe("req-0");
    expect(page1[9].id).toBe("req-9");

    const page3 = paginatePaymentRequests(requests, 3);
    expect(page3).toHaveLength(5);
    expect(page3[0].id).toBe("req-20");
  });

  it("returns an empty array for a page beyond the data", () => {
    expect(paginatePaymentRequests(buildRequests(5), 5)).toEqual([]);
  });

  it("reflects a filtered subset, not the unfiltered total", () => {
    const requests = buildRequests(30);
    const filtered = requests.filter((r) => r.id === "req-0" || r.id === "req-1");
    expect(paginatePaymentRequests(filtered, 1)).toEqual(filtered);
    expect(getTotalPages(filtered.length)).toBe(1);
  });
});

describe("getTotalPages", () => {
  it("rounds up to a whole page count, floored at 1 (never 0 pages)", () => {
    expect(getTotalPages(25)).toBe(3);
    expect(getTotalPages(10)).toBe(1);
    expect(getTotalPages(0)).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// humanizePaymentPeriod — "01/07/2026 – 12/08/2026" → "1 jul → 12 ago"
// ---------------------------------------------------------------------------

describe("humanizePaymentPeriod", () => {
  it("humanises a same-year range into the prototype's arrow grammar", () => {
    expect(humanizePaymentPeriod("01/07/2026 – 12/08/2026")).toBe("1 jul → 12 ago");
  });

  it("keeps both years when the period crosses a year boundary", () => {
    expect(humanizePaymentPeriod("20/12/2025 – 20/01/2026")).toBe("20 dic 2025 → 20 ene 2026");
  });

  it("accepts a hyphen or em dash as the separator, not only the en dash", () => {
    expect(humanizePaymentPeriod("01/07/2026 - 12/08/2026")).toBe("1 jul → 12 ago");
    expect(humanizePaymentPeriod("01/07/2026 — 12/08/2026")).toBe("1 jul → 12 ago");
  });

  it("renders a lone date when the adapter could only resolve one side", () => {
    expect(humanizePaymentPeriod("01/07/2026")).toBe("1 jul");
  });

  it("returns the original value untouched when it is not a dd/mm/yyyy range", () => {
    // The backend period is a formatted string, not a pair of dates: if its
    // grammar ever changes, showing it verbatim beats showing nothing.
    expect(humanizePaymentPeriod("2026-Q1")).toBe("2026-Q1");
    expect(humanizePaymentPeriod("")).toBe("");
  });

  it("rejects an impossible date instead of rolling it over into the next month", () => {
    expect(humanizePaymentPeriod("31/02/2026 – 12/08/2026")).toBe("31/02/2026 – 12/08/2026");
  });
});

// ---------------------------------------------------------------------------
// Pending queue navigation — "Pendiente 2 de 14" plus prev/next
// ---------------------------------------------------------------------------

function withStatus(
  count: number,
  statuses: PaymentValidationRequest["validationStatus"][],
): PaymentValidationRequest[] {
  return buildRequests(count).map((r, i) => ({ ...r, validationStatus: statuses[i] }));
}

describe("getPendingRequests", () => {
  it("keeps only pending requests, in their original order", () => {
    const requests = withStatus(3, ["validado", "pendiente", "pendiente"]);
    expect(getPendingRequests(requests).map((r) => r.id)).toEqual(["req-1", "req-2"]);
  });
});

describe("findQueueNeighbours", () => {
  it("reports a 1-based position inside the pending queue", () => {
    const pending = buildRequests(3);
    expect(findQueueNeighbours(pending, "req-1")).toMatchObject({ position: 2, total: 3 });
  });

  it("exposes the previous and next pending ids", () => {
    const pending = buildRequests(3);
    expect(findQueueNeighbours(pending, "req-1")).toMatchObject({
      previousId: "req-0",
      nextId: "req-2",
    });
  });

  it("has no previous at the head and no next at the tail", () => {
    const pending = buildRequests(2);
    expect(findQueueNeighbours(pending, "req-0").previousId).toBeNull();
    expect(findQueueNeighbours(pending, "req-1").nextId).toBeNull();
  });

  it("reports position 0 for a request that is not in the queue (already resolved)", () => {
    const pending = buildRequests(2);
    expect(findQueueNeighbours(pending, "req-9")).toEqual({
      position: 0,
      total: 2,
      previousId: null,
      nextId: null,
    });
  });
});

describe("getAutoAdvanceId", () => {
  it("advances to the next pending request after the one just resolved", () => {
    const pending = buildRequests(3);
    expect(getAutoAdvanceId(pending, "req-1")).toBe("req-2");
  });

  it("falls back to the previous one when the resolved request was the last", () => {
    const pending = buildRequests(3);
    expect(getAutoAdvanceId(pending, "req-2")).toBe("req-1");
  });

  it("returns null when the queue is emptied, so the caller goes back to the list", () => {
    const pending = buildRequests(1);
    expect(getAutoAdvanceId(pending, "req-0")).toBeNull();
    expect(getAutoAdvanceId([], "req-0")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Approval checklist + typified rejection reasons
// ---------------------------------------------------------------------------

describe("classifyPaymentMethod", () => {
  it("reads the kind back out of the label the adapter emits", () => {
    expect(classifyPaymentMethod("Efectivo")).toBe("efectivo");
    expect(classifyPaymentMethod("Transferencia")).toBe("transferencia");
  });

  it("survives casing and padding without inventing a kind", () => {
    expect(classifyPaymentMethod("  EFECTIVO ")).toBe("efectivo");
    expect(classifyPaymentMethod("Depósito bancario")).toBe("otro");
    expect(classifyPaymentMethod("")).toBe("otro");
  });
});

describe("buildApprovalChecklist", () => {
  const transfer = { paymentMethod: "Transferencia", expectedAmountLabel: "$25,00", hasProof: true };

  it("asks about the voucher when there is a voucher to read", () => {
    const { items } = buildApprovalChecklist(transfer);
    expect(items.map((c) => c.label)).toEqual([
      "El comprobante es legible y no está cortado",
      "El monto del comprobante coincide con $25,00",
      "La fecha de la transferencia cae dentro del período",
    ]);
  });

  it("never asks a cash payment about a comprobante it does not have", () => {
    const { items, note } = buildApprovalChecklist({
      paymentMethod: "Efectivo",
      expectedAmountLabel: "$25,00",
      hasProof: false,
    });

    const labels = items.map((c) => c.label);
    expect(labels).toEqual([
      "Se recibió $25,00 en efectivo",
      "El período de vigencia que se va a activar es el correcto",
    ]);
    // The two questions that were unanswerable — and therefore ticked blindly.
    expect(labels.some((l) => l.includes("comprobante"))).toBe(false);
    expect(note).toContain("efectivo");
  });

  it("keeps the legibility question for a cash payment that does carry a recibo", () => {
    const { items } = buildApprovalChecklist({
      paymentMethod: "Efectivo",
      expectedAmountLabel: "$25,00",
      hasProof: true,
    });
    expect(items.map((c) => c.key)).toEqual(["efectivo-recibido", "legible", "periodo"]);
  });

  it("points a proofless transfer at the club's account instead of at a missing file", () => {
    const { items, note } = buildApprovalChecklist({ ...transfer, hasProof: false });
    expect(items.map((c) => c.label)).toEqual([
      "La transferencia de $25,00 está acreditada en la cuenta del club",
      "El período de vigencia que se va a activar es el correcto",
    ]);
    expect(note).toContain("Transferencia sin comprobante adjunto");
  });

  it("treats an unrecognised method as strictly as a transfer", () => {
    const withProof = buildApprovalChecklist({ ...transfer, paymentMethod: "Depósito" });
    expect(withProof.kind).toBe("otro");
    expect(withProof.items.map((c) => c.key)).toEqual(["legible", "monto", "fecha"]);
    expect(
      buildApprovalChecklist({ ...transfer, paymentMethod: "Depósito", hasProof: false }).note,
    ).toContain("Depósito");
  });

  it("gives every item a stable key so a checked box survives a re-render", () => {
    const keys = buildApprovalChecklist(transfer).items.map((c) => c.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys).toEqual(
      buildApprovalChecklist({ ...transfer, expectedAmountLabel: "$40,00" }).items.map((c) => c.key),
    );
  });
});

// ---------------------------------------------------------------------------
// Batch approval
// ---------------------------------------------------------------------------

describe("getNextUnreviewedId", () => {
  const pending = buildRequests(4);

  it("walks forward to the first request still waiting for a review", () => {
    expect(getNextUnreviewedId(pending, "req-0", new Set(["req-0"]))).toBe("req-1");
    expect(getNextUnreviewedId(pending, "req-0", new Set(["req-0", "req-1"]))).toBe("req-2");
  });

  it("wraps to the top for anything skipped on the way down", () => {
    expect(getNextUnreviewedId(pending, "req-3", new Set(["req-0", "req-2", "req-3"]))).toBe("req-1");
  });

  it("returns null when everything is reviewed, so the admin lands back on the queue", () => {
    const all = new Set(pending.map((r) => r.id));
    expect(getNextUnreviewedId(pending, "req-2", all)).toBeNull();
    expect(getNextUnreviewedId([], "req-0", new Set())).toBeNull();
  });
});

describe("describeBatchApproval", () => {
  it("states the count, the money and who it lands on", () => {
    expect(describeBatchApproval(["Ana Ruiz", "Beto Lima"], "$50,00")).toBe(
      "Se van a aprobar 2 pagos ya revisados, por un total de $50,00. Se activan las membresías de Ana Ruiz, Beto Lima.",
    );
  });

  it("agrees in the singular rather than saying '1 pagos'", () => {
    expect(describeBatchApproval(["Ana Ruiz"], "$25,00")).toBe(
      "Se va a aprobar 1 pago ya revisado, por $25,00. Se activa la membresía de Ana Ruiz.",
    );
  });

  it("truncates a long batch instead of printing an unreadable roll call", () => {
    const names = ["A", "B", "C", "D", "E", "F"];
    expect(describeBatchApproval(names, "$150,00")).toContain("A, B, C, D y 2 más");
  });
});

describe("composeRejectionReason", () => {
  it("sends the typified reason verbatim — it is what the payer will read", () => {
    expect(composeRejectionReason("monto", "")).toBe("El monto no coincide");
  });

  it("appends the optional note after the reason", () => {
    expect(composeRejectionReason("ilegible", "  Se ve cortado.  ")).toBe(
      "El comprobante no se lee — Se ve cortado.",
    );
  });

  it("returns an empty string when no reason is selected, so the caller can block", () => {
    expect(composeRejectionReason("", "una nota")).toBe("");
    expect(composeRejectionReason("no-existe", "")).toBe("");
  });
});
