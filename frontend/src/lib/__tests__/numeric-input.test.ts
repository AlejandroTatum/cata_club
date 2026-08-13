import { describe, it, expect } from "vitest";
import { capDigits, filterNumericInput, isAllowedChar, NUMERIC_FIELD_MAX_DIGITS } from "../numeric-input";

describe("isAllowedChar", () => {
  it("allows digits for both cedula and phone", () => {
    expect(isAllowedChar("cedula", "5")).toBe(true);
    expect(isAllowedChar("phone", "5")).toBe(true);
  });

  it("rejects letters for both modes", () => {
    expect(isAllowedChar("cedula", "a")).toBe(false);
    expect(isAllowedChar("phone", "a")).toBe(false);
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
});

describe("NUMERIC_FIELD_MAX_DIGITS", () => {
  it("caps both cedula and phone at 10 digits", () => {
    expect(NUMERIC_FIELD_MAX_DIGITS.cedula).toBe(10);
    expect(NUMERIC_FIELD_MAX_DIGITS.phone).toBe(10);
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
});
