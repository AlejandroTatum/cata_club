/**
 * GET /api/health — container liveness probe for the Next.js server.
 *
 * Deliberately dependency-free: no backend call, no auth, no cookies. Same
 * rationale as FastAPI's /health (backend/main.py) — Docker uses this to
 * decide whether to restart the container, so it must answer "is this
 * process serving HTTP?" and nothing else. Probing the backend from here
 * would make a backend outage cascade into a frontend restart loop.
 */

import { NextResponse } from "next/server";

// The standalone build would otherwise prerender this as a static asset at
// build time, and the probe would stop reflecting the running server.
export const dynamic = "force-dynamic";

export async function GET(): Promise<NextResponse> {
  return NextResponse.json({ status: "ok", sha: process.env.BUILD_SHA ?? "unknown" });
}
