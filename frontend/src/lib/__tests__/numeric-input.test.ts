import { describe, it, expect } from "vitest";
import {
  AMOUNT_MAX_DECIMAL_DIGITS,
  AMOUNT_MAX_VALUE,
  capDigits,
  filterNumericInput,
  isAllowedChar,
  NUMERIC_FIELD_MAX_DIGITS,
} from "../numeric-input";

describe("isAllowedChar", () => {
  it("allows digits for both cedula and phone", () => {
    expect(isAllowedChar("cedula", "5")).toBe(true);
    expect(isAllowedChar("phone", "5")).toBe(true);
  });

  it("rejects letters for both modes", () => {
    expect(isAllowedChar("cedula", "a")).toBe(false);
    expect(isAllowedChar("phone", "a")).toBe(false);
  });

  it("allows digits and both decimal separator spellings for amount", () => {
    // Issue #667/#506: an es-EC/es-AR admin types "," on `/tarifas`; both
    // spellings are accepted, but only one of either counts as THE separator.
    expect(isAllowedChar("amount", "5")).toBe(true);
    expect(isAllowedChar("amount", ".")).toBe(true);
    expect(isAllowedChar("amount", ",")).toBe(true);
  });

  it("rejects letters and phone-style separators for amount", () => {
    expect(isAllowedChar("amount", "a")).toBe(false);
    expect(isAllowedChar("amount", "-")).toBe(false);
    expect(isAllowedChar("amount", " ")).toBe(false);
  });

  it("rejects separators for cedula — identity-validation.ts never tolerates them there", () => {
    expect(isAllowedChar("cedula", "-")).toBe(false);
    expect(isAllowedChar("cedula", " ")).toBe(false);
    expect(isAllowedChar("cedula", "(")).toBe(false);
  });

  it("allows the same separators phoneError() strips before validating", () => {
    expect(isAllowedChar("phone", "-")).toBe(true);
    expect(isAllowedChar("phone", " ")).toBe(true);
    expect(isAllowedChar("phone", "(")).toBe(true);
    expect(isAllowedChar("phone", ")")).toBe(true);
  });

  it("allows + for phone — an autofilled/typed +593 needs it before normalization runs (issue #855)", () => {
    expect(isAllowedChar("phone", "+")).toBe(true);
  });

  it("still rejects + for cedula and amount", () => {
    expect(isAllowedChar("cedula", "+")).toBe(false);
    expect(isAllowedChar("amount", "+")).toBe(false);
  });
});

describe("NUMERIC_FIELD_MAX_DIGITS", () => {
  it("caps both cedula and phone at 10 digits", () => {
    expect(NUMERIC_FIELD_MAX_DIGITS.cedula).toBe(10);
    expect(NUMERIC_FIELD_MAX_DIGITS.phone).toBe(10);
  });

  it("caps amount's integer part at 6 digits, with 2 decimal digits", () => {
    expect(NUMERIC_FIELD_MAX_DIGITS.amount).toBe(6);
    expect(AMOUNT_MAX_DECIMAL_DIGITS).toBe(2);
  });

  it("names the largest value those two caps allow, for a submit-time business ceiling", () => {
    expect(AMOUNT_MAX_VALUE).toBe(999999.99);
  });
});

describe("capDigits", () => {
  it("leaves a value at or under the cap untouched", () => {
    expect(capDigits("cedula", "171234567")).toEqual({ value: "171234567", limitReached: false });
  });

  it("truncates a cedula value over the cap and reports the limit was hit", () => {
    expect(capDigits("cedula", "17123456789")).toEqual({ value: "1712345678", limitReached: true });
  });

  it("counts digits only for phone, not separators — a formatted 10-digit number is untouched", () => {
    // 10 digits, 2 separators: under the digit cap even though the raw string is 12 chars.
    expect(capDigits("phone", "099-123-4567")).toEqual({ value: "099-123-4567", limitReached: false });
  });

  it("drops digits past the phone cap but keeps interleaved separators", () => {
    expect(capDigits("phone", "099-123-45678")).toEqual({ value: "099-123-4567", limitReached: true });
  });

  it("does not strip letters — it only enforces the digit count", () => {
    // capDigits is the onChange backstop: it must NOT double as a letter
    // filter, or a programmatic value-set (autofill, `.fill()` in e2e) would
    // silently lose the letters a keydown/paste handler is responsible for
    // rejecting instead — see V01 in enroll-qa.spec.ts.
    expect(capDigits("phone", "099abc1234")).toEqual({ value: "099abc1234", limitReached: false });
  });

  it("leaves an amount at or under both caps untouched", () => {
    expect(capDigits("amount", "1234.56")).toEqual({ value: "1234.56", limitReached: false });
  });

  it("leaves a whole-number amount with no separator untouched", () => {
    expect(capDigits("amount", "45")).toEqual({ value: "45", limitReached: false });
  });

  it("truncates an amount's integer part past 6 digits", () => {
    expect(capDigits("amount", "1234567.89")).toEqual({ value: "123456.89", limitReached: true });
  });

  it("truncates an amount's decimal part past 2 digits", () => {
    expect(capDigits("amount", "45.678")).toEqual({ value: "45.67", limitReached: true });
  });

  it("drops a second decimal separator", () => {
    expect(capDigits("amount", "45.6.7")).toEqual({ value: "45.67", limitReached: true });
  });

  it("accepts a comma as the decimal separator", () => {
    expect(capDigits("amount", "45,50")).toEqual({ value: "45,50", limitReached: false });
  });

  it("drops a second separator regardless of which spelling repeats", () => {
    expect(capDigits("amount", "45,,50")).toEqual({ value: "45,50", limitReached: true });
  });

  it("treats a comma and a dot as the same separator slot — only the first counts", () => {
    expect(capDigits("amount", "45,5.0")).toEqual({ value: "45,50", limitReached: true });
  });
});

describe("filterNumericInput", () => {
  it("strips letters for cedula and keeps only digits", () => {
    expect(filterNumericInput("cedula", "17a123456789")).toEqual({ value: "1712345678", limitReached: true });
  });

  it("strips letters for phone but keeps allowed separators", () => {
    expect(filterNumericInput("phone", "099abc-123-4567")).toEqual({ value: "099-123-4567", limitReached: false });
  });

  it("caps after stripping, so a long paste both loses letters and hits the cap", () => {
    expect(filterNumericInput("cedula", "17a2b3c4d5e6f78901")).toEqual({
      value: "1723456789",
      limitReached: true,
    });
  });

  it("reports no limit reached for a short, clean paste", () => {
    expect(filterNumericInput("cedula", "171234")).toEqual({ value: "171234", limitReached: false });
  });

  it("strips a currency symbol and letters from a pasted amount", () => {
    expect(filterNumericInput("amount", "$45.00 USD")).toEqual({ value: "45.00", limitReached: false });
  });

  // Superseded by the comma-as-decimal-separator tests in `capDigits` above
  // (issue #667/#506): a real `/tarifas` admin types "," as the DECIMAL
  // mark ("45,50"), not as a thousands grouping symbol, so "1,234.56" is
  // read as "1" + separator "," + "23" (2 decimal digits, the cap) — the
  // "4" and the second separator ("." ) are both dropped, same as any other
  // over-the-cap character.
  it("reads a comma as the decimal separator, not a thousands grouping symbol", () => {
    expect(filterNumericInput("amount", "1,234.56")).toEqual({ value: "1,23", limitReached: true });
  });
});
