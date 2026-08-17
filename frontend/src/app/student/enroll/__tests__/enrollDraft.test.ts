/**
 * Draft persistence for the public enrollment wizard (issue #317 / hallazgo
 * #62): a reload used to lose every field the visitor had already typed,
 * because `formData` lived only in `useState` with no backing store.
 *
 * This is NOT the ghost-state pattern issue #310 (K3) removed from the
 * attendance wizard — that draft outlived a REJECTED submission and showed a
 * trainer's unaccepted marks as if the club had them on file. This draft is
 * data the visitor typed and has NEVER been sent anywhere, so there is
 * nothing it can misrepresent as confirmed. `EnrollPage.test.tsx` covers the
 * on-screen label and the point where it is cleared; this file covers only
 * the pure read/write/parse contract.
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  clearEnrollDraft,
  loadEnrollDraft,
  parseEnrollDraft,
  saveEnrollDraft,
  initialFormData,
  ENROLLMENT_TYPES,
  type EnrollFormData,
} from "../enroll-utils";

const SOME_DRAFT: EnrollFormData = {
  ...initialFormData,
  enrollmentType: ENROLLMENT_TYPES.CHILD,
  nombres: "Lucas",
  apellidos: "Martinez",
};

beforeEach(() => {
  window.sessionStorage.clear();
});

describe("saveEnrollDraft / loadEnrollDraft", () => {
  it("round-trips whatever was saved", () => {
    saveEnrollDraft(SOME_DRAFT);
    expect(loadEnrollDraft()).toEqual(SOME_DRAFT);
  });

  it("returns null when nothing was ever saved", () => {
    expect(loadEnrollDraft()).toBeNull();
  });
});

describe("clearEnrollDraft", () => {
  it("removes a previously saved draft", () => {
    saveEnrollDraft(SOME_DRAFT);
    clearEnrollDraft();
    expect(loadEnrollDraft()).toBeNull();
  });

  it("is a no-op when there was nothing to clear", () => {
    expect(() => clearEnrollDraft()).not.toThrow();
  });
});

describe("parseEnrollDraft", () => {
  it("discards malformed JSON wholesale, rather than partially trusting it", () => {
    expect(parseEnrollDraft("{not json")).toBeNull();
  });

  it("discards a value that is not an EnrollFormData shape", () => {
    expect(parseEnrollDraft(JSON.stringify({ nombres: "Lucas" }))).toBeNull();
    expect(parseEnrollDraft(JSON.stringify(["not", "an", "object"]))).toBeNull();
    expect(parseEnrollDraft(JSON.stringify(null))).toBeNull();
  });

  it("discards an enrollmentType outside the known enum", () => {
    const tampered = { ...SOME_DRAFT, enrollmentType: "admin" };
    expect(parseEnrollDraft(JSON.stringify(tampered))).toBeNull();
  });

  it("returns null for an empty string", () => {
    expect(parseEnrollDraft(null)).toBeNull();
    expect(parseEnrollDraft("")).toBeNull();
  });
});
