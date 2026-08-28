/**
 * AccountControls — the two shapes "acceso a la cuenta" takes inside the top
 * header: a popup trigger on the desktop bar, and the same two destinations as
 * plain rows inside the mobile panel, where a floating panel has nowhere to
 * open.
 *
 * They live here because the header draws each of them TWICE: once in the
 * product's own bar and once in the institutional bar the public legal pages
 * get, which until issue #782 showed every visitor "Iniciar sesión" — including
 * the ones who were already signed in. A second copy of the popup wiring
 * (trigger ref, panel ref, Escape and outside-click dismissal) is exactly the
 * pair that drifts: one of them gets the fix and the other keeps the bug.
 *
 * The panel itself is `UserMenuDropdown`, unchanged — the same one the sidebar
 * opens, so all three entry points offer the same two options (issue #35).
 */

"use client";

import { useCallback, useId, useRef, useState } from "react";
import Link from "next/link";
import { LogOut, User } from "lucide-react";
import { ICON } from "@/lib/icon-size";
import { useDismissablePopup } from "@/lib/useDismissablePopup";
import UserMenuDropdown from "@/components/UserMenuDropdown";

interface AccountMenuProps {
  /** Shown beside the icon, and read into the trigger's accessible name. */
  userName: string;
  /** Invoked by the panel's "Cerrar Sesión" item. */
  onLogout: () => void;
}

/**
 * The desktop trigger and its panel. Renders its own positioning context, so a
 * host only has to place this element where the slot belongs.
 */
export function AccountMenu({ userName, onLogout }: AccountMenuProps): React.ReactElement {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const menuId = useId();

  const close = useCallback((): void => setOpen(false), []);
  useDismissablePopup({ open, onClose: close, panelRef, triggerRef });

  return (
    <div className="relative">
      <button
        ref={triggerRef}
        type="button"
        onClick={(): void => setOpen((isOpen): boolean => !isOpen)}
        // `aria-haspopup="true"` is an alias for "menu"; this popup is a
        // labelled panel, not a menu.
        aria-haspopup="dialog"
        aria-controls={menuId}
        aria-expanded={open}
        aria-label={`Menú de cuenta de ${userName}`}
        className="flex items-center gap-1.5 rounded-xl px-2.5 py-1.5 text-xs font-semibold text-white/65 transition-colors hover:bg-white/[0.08] hover:text-white"
      >
        <User size={ICON.sm} strokeWidth={1.5} aria-hidden="true" />
        <span className="max-w-[120px] truncate">{userName}</span>
      </button>
      {open && (
        <UserMenuDropdown
          ref={panelRef}
          id={menuId}
          onLogout={onLogout}
          onNavigate={close}
          className="absolute right-0 top-full mt-1.5 w-40"
        />
      )}
    </div>
  );
}

interface AccountMobileItemsProps {
  /** Called on any item click — the host closes its panel here. */
  onNavigate: () => void;
  onLogout: () => void;
}

/**
 * The same two destinations as full-width rows, for a mobile panel that is
 * already an open list. Rows rather than a dropdown: the panel IS the popup,
 * and a second one nested inside it would need its own dismissal.
 */
export function AccountMobileItems({
  onNavigate,
  onLogout,
}: AccountMobileItemsProps): React.ReactElement {
  return (
    <>
      <Link
        href="/profile"
        onClick={onNavigate}
        className="flex items-center gap-3 rounded-xl px-3.5 py-2.5 text-sm font-semibold text-white/65 transition-colors hover:bg-white/[0.08] hover:text-white"
      >
        <User size={ICON.base} strokeWidth={1.5} aria-hidden="true" />
        Perfil
      </Link>
      <button
        type="button"
        onClick={(): void => {
          onLogout();
          onNavigate();
        }}
        className="flex w-full items-center gap-3 rounded-xl px-3.5 py-2.5 text-sm font-semibold text-white/65 transition-colors hover:bg-white/[0.08] hover:text-cata-red"
      >
        <LogOut size={ICON.base} strokeWidth={1.5} aria-hidden="true" />
        Cerrar Sesión
      </button>
    </>
  );
}
