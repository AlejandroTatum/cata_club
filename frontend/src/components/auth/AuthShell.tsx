/**
 * AuthShell — shared split-screen layout for the public auth screens
 * (/login, /forgot-password), matching the final mockups
 * (`design/admin-login-mockup-v1.html` and siblings).
 *
 * Left: dark marketing panel with brand identity, a short headline/copy
 * and two highlight stats. Right: the screen-specific form content
 * (passed as children).
 *
 * No client-only APIs are used here, so this stays a plain server-safe
 * component usable from either server or "use client" pages.
 */

import Image from "next/image";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { buildMemberStats } from "@/app/members/members-utils";
import { buildAttendanceStats } from "@/app/attendance/attendance-utils";
import { MOCK_MEMBER_ACCOUNTS } from "@/mocks/members";
import { MOCK_ATTENDANCE_RECORDS } from "@/mocks/attendance";
import { computeAuthBrandHighlights } from "./auth-shell-stats";

export interface AuthShellProps {
  /** Small uppercase label above the form title (e.g. "Panel de gestión"). */
  eyebrow: string;
  /** Main form heading (e.g. "Bienvenido de nuevo"). */
  title: string;
  /** Optional subheading below the title. */
  subtitle?: string;
  /** Brand panel headline. Accepts markup for the emphasized fragment. */
  headline: React.ReactNode;
  /** Brand panel supporting copy. */
  description: string;
  /** Shows a "Volver al sitio" link at the top of the brand panel. */
  showBackToSite?: boolean;
  /** Screen-specific form content, rendered below the title/subtitle. */
  children: React.ReactNode;
}

export default function AuthShell({
  eyebrow,
  title,
  subtitle,
  headline,
  description,
  showBackToSite = false,
  children,
}: AuthShellProps): React.ReactElement {
  // Real typed mock data, not fabricated marketing numbers — same
  // aggregates the admin dashboard/members/attendance screens use.
  const memberStats = buildMemberStats(MOCK_MEMBER_ACCOUNTS);
  const attendanceStats = buildAttendanceStats(MOCK_ATTENDANCE_RECORDS);
  const highlights = computeAuthBrandHighlights(memberStats, attendanceStats);

  return (
    <div className="auth-shell flex min-h-screen flex-col md:flex-row">
      {/* Brand / marketing panel */}
      <div className="relative flex flex-none items-center justify-center overflow-hidden bg-cata-black px-7 py-9 text-white md:basis-[44%] md:px-14 md:py-14">
        {showBackToSite && (
          <Link
            href="/"
            className="absolute left-7 top-7 z-10 flex items-center gap-1.5 text-sm font-semibold text-white/55 transition-colors hover:text-white"
          >
            <ArrowLeft size={15} strokeWidth={1.5} aria-hidden="true" />
            Volver al sitio
          </Link>
        )}

        <div className="relative z-[1] mx-auto max-w-[420px] text-center">
          <div className="mb-9 flex flex-col items-center gap-4">
            <div className="relative h-[92px] w-[92px] shrink-0 overflow-hidden rounded-[20px] shadow-elevated ring-1 ring-white/15">
              <Image
                src="/brand/cata-club-logo.jpeg"
                alt="Cata Club"
                fill
                className="object-cover"
                sizes="92px"
                priority
              />
            </div>
            <div className="leading-tight">
              <strong className="block text-[27px] font-extrabold tracking-tight">
                Cata Club
              </strong>
              <span className="mt-1.5 block text-xs font-semibold uppercase tracking-[0.16em] text-white/45">
                Panel de gestión
              </span>
            </div>
          </div>

          <h2 className="text-balance mb-4 text-3xl font-extrabold leading-[1.1] tracking-tight sm:text-[38px]">
            {headline}
          </h2>
          <p className="mx-auto max-w-[36ch] text-sm leading-relaxed text-white/60">
            {description}
          </p>

          <div className="mt-9 flex justify-center gap-9">
            <div>
              <strong className="block text-[27px] font-bold tracking-tight tabular-nums text-cata-yellow">
                {highlights.activeStudents}
              </strong>
              <span className="mt-1 block text-xs text-white/45">Estudiantes activos</span>
            </div>
            <div>
              <strong className="block text-[27px] font-bold tracking-tight tabular-nums text-cata-yellow">
                {highlights.attendanceRatePercent}%
              </strong>
              <span className="mt-1 block text-xs text-white/45">Asistencia promedio</span>
            </div>
          </div>
        </div>

        <p className="absolute bottom-8 left-7 z-[1] hidden text-xs text-white/35 md:block">
          © 2026 Cata Club — Tenis de Mesa
        </p>
      </div>

      {/* Form panel */}
      <div className="flex flex-1 items-center justify-center px-6 py-10 sm:px-8 md:py-12">
        <div className="w-full max-w-[380px]">
          <div className="mb-7 text-center">
            <p className="mb-2 text-[11px] font-bold uppercase tracking-[0.2em] text-cata-red">
              {eyebrow}
            </p>
            <h1 className="text-[27px] font-extrabold tracking-tight text-cata-text">
              {title}
            </h1>
            {subtitle && (
              <p className="mt-2 text-sm text-cata-text/65">{subtitle}</p>
            )}
          </div>

          {children}
        </div>
      </div>
    </div>
  );
}
