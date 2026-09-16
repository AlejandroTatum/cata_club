/**
 * The attendance window is ONE number, written in three places, and this file
 * is what keeps them equal.
 *
 * 1. `RECENT_SESSIONS_LIMIT` in src/lib/server/student-adapter.ts — the slice
 *    `buildRecentSessions` applies before the payload reaches the client. This
 *    is the DATA.
 * 2. `PORTAL_SESSION_WINDOW` in src/app/student/attendance/page.tsx — a
 *    deliberate duplicate (that adapter module is server-only and cannot be
 *    imported into a client component). This is the CONSTANT.
 * 3. The footnote `PortalWindowNote` prints to the student. This is the COPY.
 *
 * The screen was audited precisely because (1) and (3) can drift silently: the
 * cap is applied on the server, the sentence is written on the client, and
 * neither one is wrong on its own. A reader who is told "las 30 sesiones más
 * recientes" over a list the adapter capped at 5 has been lied to by an
 * arithmetic detail nobody sees — which is the defect class this file exists
 * to make impossible.
 *
 * ## What this deliberately does NOT check
 *
 * That the window is a particular size. It was raised from 5 to 30 once
 * already, and the honest reason to raise it again is a reader's need, not
 * this guard; a test that pinned 30 would have to be edited by whoever raises
 * it, which is exactly the drift-by-forgetfulness the guard prevents
 * elsewhere. It checks AGREEMENT, in both directions, whatever the number is.
 *
 * Nor that the list renders that many rows: the page slices nothing (it draws
 * whatever the payload carries), and `StudentAttendancePage.test.tsx` already
 * asserts every record it is given appears.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const SRC = join(__dirname, "..", "..", "..", "..");

function read(relativePath: string): string {
  return readFileSync(join(SRC, relativePath), "utf8");
}

/**
 * Prose explaining the rule is not a breach of it — every one of these three
 * files discusses the window in its own doc comments, and a naive scan would
 * read those sentences as declarations.
 */
function stripComments(text: string): string {
  return text
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

function declaredConstant(source: string, name: string): number {
  const match = new RegExp(`const\\s+${name}\\s*=\\s*(\\d+)`).exec(stripComments(source));
  if (!match) throw new Error(`${name} is no longer declared as a numeric literal`);
  return Number(match[1]);
}

const ADAPTER = "lib/server/student-adapter.ts";
const PAGE = "app/student/attendance/page.tsx";
const ROUTE = "app/api/student/route.ts";

describe("attendance window — the adapter's slice, the page's constant and the footnote agree", () => {
  it("declares the same window the server actually slices to", () => {
    const adapterLimit = declaredConstant(read(ADAPTER), "RECENT_SESSIONS_LIMIT");
    const pageWindow = declaredConstant(read(PAGE), "PORTAL_SESSION_WINDOW");

    expect(pageWindow).toBe(adapterLimit);
  });

  it("prints the constant instead of a number typed into the sentence", () => {
    // A hardcoded figure in the footnote is the same drift with no constant to
    // compare it against: `Su portal recibe las 30 sesiones…` would stay at 30
    // forever, whatever the adapter does.
    expect(read(PAGE)).toMatch(/Su portal recibe las \{PORTAL_SESSION_WINDOW\} sesiones/);
  });

  it("asks the backend for a page that contains the whole window", () => {
    // The BFF requests one page of history and sorts client-side, so a page
    // smaller than the window would hand the adapter fewer records than the
    // footnote promises — the same lie, one layer down.
    const adapterLimit = declaredConstant(read(ADAPTER), "RECENT_SESSIONS_LIMIT");
    const pageLimit = declaredConstant(read(ROUTE), "HISTORIAL_PAGE_LIMIT");

    expect(pageLimit).toBeGreaterThanOrEqual(adapterLimit);
  });
});
