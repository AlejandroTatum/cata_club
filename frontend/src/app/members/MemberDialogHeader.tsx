"use client";

import type { RefObject } from "react";
import { X } from "lucide-react";
import { Badge, DataBox } from "@/components/ui";
import { getUserInitials } from "@/lib/auth-utils";
import { ICON } from "@/lib/icon-size";
import { getAccountStateBadge, getAccountRoleLabel, type MemberAccount } from "./members-utils";

interface MemberDialogHeaderProps {
  account: MemberAccount;
  /** The `id` the dialog's `aria-labelledby` points at — the name line. */
  titleId: string;
  /** What this dialog is for ("Editar cuenta", "Pagos", "Ficha médica"). */
  purpose: string;
  closeButtonRef: RefObject<HTMLButtonElement>;
  onClose: () => void;
}

/**
 * The one header shared by the Editar, Pagos and Ficha médica dialogs: avatar,
 * the purpose of the dialog, the person's name, cédula · role · phone, the
 * account status badge and the close button. Sits on `sunken` so it reads as
 * its own plane above the `canvas` body.
 */
export default function MemberDialogHeader({
  account,
  titleId,
  purpose,
  closeButtonRef,
  onClose,
}: MemberDialogHeaderProps): React.ReactElement {
  const badge = getAccountStateBadge(account);
  const cedula = account.estudiantes[0]?.cedula;
  const fullName = `${account.nombres} ${account.apellidos}`;

  return (
    <div className="flex shrink-0 items-start justify-between gap-3 border-b border-line bg-sunken px-5 py-4">
      <div className="flex min-w-0 items-center gap-3">
        {/* Identity accent, not a status or a CTA — `coal`, never the brand red. */}
        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-coal/[0.08] text-base font-bold text-coal">
          {getUserInitials(fullName)}
        </div>
        <div className="min-w-0">
          <p className="text-2xs font-semibold uppercase tracking-wide text-ink-3">{purpose}</p>
          {/* `min-w-0` + `truncate` is load-bearing (issue #659): without it
              this flex item never shrinks below its un-wrapped text width and
              the header row overflows instead of ellipsizing. */}
          <h2
            id={titleId}
            className="min-w-0 truncate font-display text-lg uppercase leading-tight tracking-flat text-ink"
          >
            {fullName}
          </h2>
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            {cedula ? <DataBox>{cedula}</DataBox> : null}
            <DataBox>{account.telefono}</DataBox>
            <span className="text-xs text-ink-3">{getAccountRoleLabel(account)}</span>
          </div>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <Badge tone={badge.tone}>{badge.label}</Badge>
        <button
          ref={closeButtonRef}
          type="button"
          onClick={onClose}
          // Distinct from the footer's "Cerrar" so a controls list tells them apart.
          aria-label="Cerrar ventana"
          className="rounded-lg p-1.5 text-ink-3 transition-colors hover:bg-sunken hover:text-ink"
        >
          <X size={ICON.sm} strokeWidth={1.5} aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}
