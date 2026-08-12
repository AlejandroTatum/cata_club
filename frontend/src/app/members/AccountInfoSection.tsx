/**
 * Nombre / apellido / teléfono for one account — the one block of the edit
 * dialog that is genuinely independent of the rest.
 *
 * Roles and estado share a load and a badge with the dialog header, so they
 * stay lifted (see `useAccountRolesAndStatus`). This does not: it reads three
 * fields off the account it was handed, PATCHes them on demand, and tells
 * nobody. That is why it is a component and they are a hook.
 *
 * `PATCH /personas/{id}` already existed (via `PersonaUpdateDTO`) and
 * `actualizarPersona` already wrapped it; it was just never wired into this
 * modal even though its trigger is labeled "Editar". Local edits do not
 * retroactively update the row's `account` prop — a reload reflects the change
 * everywhere else.
 */

"use client";

import { useState } from "react";
import { CheckCircle2, Loader2, Mail, Save } from "lucide-react";
import { ICON } from "@/lib/icon-size";
import { buttonClasses } from "@/components/ui";
import { actualizarPersona } from "@/services/api";
import { toUserMessage } from "@/lib/error-message";
import type { MemberAccount } from "./members-utils";

interface AccountInfoSectionProps {
  account: MemberAccount;
}

export default function AccountInfoSection({ account }: AccountInfoSectionProps): React.ReactElement {
  const personaId = Number(account.id);
  const [nombres, setNombres] = useState(account.nombres);
  const [apellidos, setApellidos] = useState(account.apellidos);
  const [telefono, setTelefono] = useState(account.telefono);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  async function handleSave(): Promise<void> {
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      await actualizarPersona(personaId, {
        nombres: nombres.trim(),
        apellidos: apellidos.trim(),
        telefono: telefono.trim(),
      });
      setSaved(true);
    } catch (err: unknown) {
      setError(toUserMessage(err, "No se pudieron guardar los cambios."));
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <dl className="space-y-field text-sm">
        <div className="flex items-center justify-between gap-3">
          <dt className="shrink-0 text-ink-3" id={`nombres-label-${account.id}`}>Nombres</dt>
          <dd className="min-w-0 flex-1">
            <input
              type="text"
              value={nombres}
              onChange={(e) => setNombres(e.target.value)}
              aria-labelledby={`nombres-label-${account.id}`}
              className="input-field w-full py-1 text-right text-sm"
            />
          </dd>
        </div>
        <div className="flex items-center justify-between gap-3">
          <dt className="shrink-0 text-ink-3" id={`apellidos-label-${account.id}`}>Apellidos</dt>
          <dd className="min-w-0 flex-1">
            <input
              type="text"
              value={apellidos}
              onChange={(e) => setApellidos(e.target.value)}
              aria-labelledby={`apellidos-label-${account.id}`}
              className="input-field w-full py-1 text-right text-sm"
            />
          </dd>
        </div>
        <div className="flex items-center justify-between gap-3">
          <dt className="shrink-0 text-ink-3" id={`telefono-label-${account.id}`}>Teléfono</dt>
          <dd className="min-w-0 flex-1">
            <input
              type="text"
              value={telefono}
              onChange={(e) => setTelefono(e.target.value)}
              aria-labelledby={`telefono-label-${account.id}`}
              className="input-field w-full py-1 text-right text-sm"
            />
          </dd>
        </div>
        {/* Email deliberately read-only, no editable input: no admin endpoint
            mutates it (email lives on Usuario, not on the Persona that
            PATCH /personas/{id} edits). */}
        {account.email && (
          <div className="flex items-center justify-between gap-3">
            <dt className="text-ink-3">Correo</dt>
            <dd className="flex min-w-0 items-center gap-1.5 truncate font-semibold text-ink">
              <Mail size={ICON.sm} strokeWidth={1.5} aria-hidden="true" />
              <span className="truncate">{account.email}</span>
            </dd>
          </div>
        )}
      </dl>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => void handleSave()}
          disabled={saving}
          className={buttonClasses("primary", "sm")}
        >
          {saving ? (
            <Loader2 size={ICON.sm} className="animate-spin" aria-hidden="true" />
          ) : (
            <Save size={ICON.sm} strokeWidth={1.5} aria-hidden="true" />
          )}
          {/* Explicit scope: this button only PATCHes nombres/apellidos/
              teléfono. Roles, estado, ficha médica and membresía each save
              themselves. */}
          {saving ? "Guardando…" : "Guardar nombre, apellido y teléfono"}
        </button>
        {saved && (
          <p className="flex items-center gap-1 text-xs text-state-ok" role="status">
            <CheckCircle2 size={ICON.sm} strokeWidth={2} aria-hidden="true" />
            Guardado.
          </p>
        )}
      </div>
      {error && (
        <p className="mt-2 text-xs text-state-bad" role="alert">
          {error}
        </p>
      )}
    </>
  );
}
