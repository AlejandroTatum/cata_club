/**
 * #1779 S5: WHICH portal pages the Payments-only gate covers is a product
 * decision, so it is pinned as a list. The gate (`usePaymentsOnlyRedirect`) is
 * per profile and belongs on the pages that are about ONE profile's own data:
 * home, attendance, medical record. `/student/enroll`, `/student/add-dependent`
 * and `/profile` act on the ACCOUNT — a guardian with a blocked child must keep
 * enrolling and adding dependents, and `/profile` is always open. Adding the gate
 * to one of them needs a deliberate change here.
 *
 * @vitest-environment node
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, it, expect } from "vitest";

const APP_DIR = path.resolve(__dirname, "../..");

function pagesUsingTheGate(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) return entry === "__tests__" ? [] : pagesUsingTheGate(full);
    if (!/^page\.tsx$/.test(entry)) return [];
    return readFileSync(full, "utf8").includes("usePaymentsOnlyRedirect") ? [path.relative(APP_DIR, full)] : [];
  });
}

describe("the Payments-only gate's scope", () => {
  it("covers exactly the three pages about one profile's own data", () => {
    expect(pagesUsingTheGate(APP_DIR).sort()).toEqual([
      path.join("student", "attendance", "page.tsx"),
      path.join("student", "medical-record", "page.tsx"),
      path.join("student", "page.tsx"),
    ]);
  });
});
