"use client";

import { useCallback, useEffect, useState, type CSSProperties } from "react";
import { usePathname } from "next/navigation";
import { Flag } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { ICON } from "@/lib/icon-size";
import { resolveShellKind } from "@/lib/shell-routes";
import { useReportProblem } from "../report-problem/useReportProblem";

/** Gap kept between the launcher and whatever is pinned to the bottom edge. */
const EDGE_GAP_PX = 16;
const MOBILE_TAB_BAR_SELECTOR = 'nav[aria-label="Navegación principal (móvil)"]';
const COMMIT_BAR_SELECTOR = '[data-testid="attendance-commit-bar"]';
const MODAL_SELECTOR = '[role="dialog"][aria-modal="true"]';

/**
 * Space the launcher must clear: the admin tab bar and the trainer's attendance
 * commit bar are `fixed` to the bottom on mobile (and not fixed from `lg`), so
 * the real geometry is measured instead of hard-coding their heights.
 */
function measureBottomObstruction(): number {
  let top = window.innerHeight;
  for (const node of document.querySelectorAll<HTMLElement>(`${MOBILE_TAB_BAR_SELECTOR}, ${COMMIT_BAR_SELECTOR}`)) {
    if (getComputedStyle(node).position !== "fixed") continue;
    const rect = node.getBoundingClientRect();
    if (rect.height > 0) top = Math.min(top, rect.top);
  }
  return window.innerHeight - top;
}

/**
 * Floating «Reportar un problema» launcher for signed-in app routes. It reuses
 * the `/ayuda` flow: the current screen is captured first (the launcher itself
 * is `data-report-ignore`, so it never shows up in the capture), then the same
 * dialog opens and records the current route.
 */
export default function ReportProblemFab(): React.ReactElement | null {
  const pathname = usePathname();
  const { session } = useAuth();
  const report = useReportProblem();
  const [modalOpen, setModalOpen] = useState(false);
  const [bottom, setBottom] = useState(EDGE_GAP_PX);

  const sync = useCallback((): void => {
    setModalOpen(document.querySelector(MODAL_SELECTOR) !== null);
    setBottom(measureBottomObstruction() + EDGE_GAP_PX);
  }, []);

  useEffect((): (() => void) => {
    sync();
    const observer = new MutationObserver(sync);
    observer.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ["class", "style"] });
    window.addEventListener("resize", sync);
    return (): void => {
      observer.disconnect();
      window.removeEventListener("resize", sync);
    };
  }, [sync, pathname]);

  const visible = !!session && resolveShellKind(pathname) === "app";
  if (!visible) return null;

  const style: CSSProperties = { bottom };
  return (
    <>
      {!modalOpen && !report.dialog && (
        <button
          type="button"
          data-report-ignore
          onClick={(): void => report.open()}
          disabled={report.busy}
          style={style}
          className="fixed right-4 z-20 inline-flex min-h-[44px] items-center gap-2 rounded-full bg-ink px-4 text-sm font-bold text-white shadow-elevated transition-colors hover:bg-ink/90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cata-red disabled:opacity-70 sm:right-6"
        >
          <Flag size={ICON.sm} strokeWidth={2} aria-hidden="true" />
          Reportar un problema
        </button>
      )}
      {report.dialog}
    </>
  );
}
