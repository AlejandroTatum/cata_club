/**
 * Whether the what's-new dialog is open, and the one way to close it.
 *
 * The seen version lives in `localStorage` under `WHATS_NEW_STORAGE_KEY`.
 * Storage can throw (private mode, locked-down profiles) and does not exist on
 * the server, so every access is guarded, and a failure always errs toward
 * "do not show": a release note is never worth a crash or a dialog that comes
 * back on every screen.
 *
 * `handledThisSession` is what makes that hold when storage cannot remember:
 * the shell mounts this hook on every page, so without it a failed write
 * would reopen the dialog on the next navigation.
 */

"use client";

import { useCallback, useEffect, useState } from "react";
import { WHATS_NEW_STORAGE_KEY, WHATS_NEW_VERSION } from "./content";

let handledThisSession = false;

/** Test seam: the module-level flag outlives a single render tree. */
export function resetWhatsNewSessionForTests(): void {
  handledThisSession = false;
}

/** `true` only when the current version is certainly not yet seen. */
function isUnseen(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(WHATS_NEW_STORAGE_KEY) !== WHATS_NEW_VERSION;
  } catch {
    return false;
  }
}

function markSeen(): void {
  handledThisSession = true;
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(WHATS_NEW_STORAGE_KEY, WHATS_NEW_VERSION);
  } catch {
    // The session flag above still keeps it closed until the tab is reloaded.
  }
}

export function useWhatsNew(ready: boolean): { open: boolean; dismiss: () => void } {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!ready || handledThisSession) return;
    if (isUnseen()) {
      setOpen(true);
    } else {
      handledThisSession = true;
    }
  }, [ready]);

  const dismiss = useCallback((): void => {
    markSeen();
    setOpen(false);
  }, []);

  return { open, dismiss };
}
