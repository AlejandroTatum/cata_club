"use client";

import { useCallback, useState, type ReactElement } from "react";
import ReportProblemDialog, { type InitialCapture } from "../ReportProblemDialog";
import { captureViewport } from "./capture";

/**
 * Opens the report dialog AFTER grabbing the current page: the capture has to
 * happen before the dialog (and its backdrop) exists, or it would photograph
 * the dialog itself. A failed capture never blocks the report.
 */
export function useReportProblem(requestId?: string): { open: () => void; busy: boolean; dialog: ReactElement | null } {
  const [capture, setCapture] = useState<InitialCapture | null>(null);
  const [busy, setBusy] = useState(false);

  const open = useCallback((): void => {
    if (busy) return;
    setBusy(true);
    captureViewport()
      .then((file) => setCapture({ file, failed: false }))
      .catch(() => setCapture({ file: null, failed: true }))
      .finally(() => setBusy(false));
  }, [busy]);

  const dialog = capture ? <ReportProblemDialog capture={capture} requestId={requestId} onClose={() => setCapture(null)} /> : null;
  return { open, busy, dialog };
}
