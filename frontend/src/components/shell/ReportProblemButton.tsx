"use client";

import { usePathname } from "next/navigation";
import { Flag } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { ICON } from "@/lib/icon-size";
import { resolveShellKind } from "@/lib/shell-routes";
import { useReportProblem } from "../report-problem/useReportProblem";

/**
 * «Reportar un problema» for signed-in app routes. It lives in the shell's
 * utility row, next to search, theme and the bell: a control that floated over
 * the viewport corner sat on top of whatever data was scrolled under it (the
 * right rail, the last column, the last row above a bottom bar), and no amount
 * of bottom padding fixes a thing that follows the viewport. In the row it
 * takes its own space, so it cannot cover anything by construction.
 *
 * It reuses the `/ayuda` flow: the current screen is captured first (the
 * button itself is `data-report-ignore`, so it never shows up in the capture),
 * then the same dialog opens and records the current route.
 */
export default function ReportProblemButton(): React.ReactElement | null {
  const pathname = usePathname();
  const { session } = useAuth();
  const report = useReportProblem();

  const visible = !!session && resolveShellKind(pathname) === "app";
  if (!visible) return null;

  return (
    <>
      <button
        type="button"
        data-report-ignore
        onClick={(): void => report.open()}
        disabled={report.busy}
        title="Reportar un problema"
        className="touch-target flex h-ctl items-center justify-center gap-2 rounded-ctl border border-line-2 bg-paper px-3 text-xs font-semibold text-ink-2 transition-colors hover:border-ink-3 hover:text-ink disabled:opacity-70 max-lg:w-11 max-lg:px-0"
      >
        <Flag size={ICON.sm} strokeWidth={2} aria-hidden="true" />
        {/* Icon-only below `lg` so the row fits a phone; the name stays for
            assistive tech and the `title` is the pointer tooltip. */}
        <span className="max-lg:sr-only">Reportar un problema</span>
      </button>
      {report.dialog}
    </>
  );
}
