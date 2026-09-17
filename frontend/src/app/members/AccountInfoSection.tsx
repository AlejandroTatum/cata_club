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
import { PhoneField } from "@/components/wizard-fields";
import { actualizarPersona } from "@/services/api";
import { toUserMessage } from "@/lib/error-message";
import { phoneRule, toPhoneFieldDigits, toStoredPhone } from "@/lib/identity-validation";
import type { MemberAccount } from "./members-utils";

interface AccountInfoSectionProps {
  account: MemberAccount;
}

export default function AccountInfoSection({ account }: AccountInfoSectionProps): React.ReactElement {
  const personaId = Number(account.id);
  const [nombres, setNombres] = useState(account.nombres);
  const [apellidos, setApellidos] = useState(account.apellidos);
  // Issue #1207: `account.telefono` is typed `string`, but a represented
  // minor without a phone of their own can still arrive here as `null` at
  // runtime — `?? ""` (via `toPhoneFieldDigits`) defends this component on
  // its own, on top of (not instead of) the `null` → `""` coercion
  // `members-adapter.ts` now does. Issue #1296: the same `PhoneField` every
  // other phone field on the app shares — the stored `0XXXXXXXXX` shows as
  // its local digits, with no trunk 0.
  const [telefono, setTelefono] = useState(toPhoneFieldDigits(account.telefono ?? null));
  const [telefonoError, setTelefonoError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  async function handleSave(): Promise<void> {
    // Issue #1207's phoneless represented minor stays representable from
    // this counter: the field is optional, so only a NON-empty value is
    // checked against the shared rule — unlike every other adopting site,
    // where the phone is required.
    const digits = telefono.trim();
    const phoneError = digits ? phoneRule(toStoredPhone(digits), "El teléfono") : null;
    setTelefonoError(phoneError);
    if (phoneError) return;

    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      await actualizarPersona(personaId, {
        nombres: nombres.trim(),
        apellidos: apellidos.trim(),
        telefono: toStoredPhone(telefono),
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
      </dl>
      {/* Issue #1296: the same `PhoneField` every other phone field on the
          app shares (fixed +593, local digits, no trunk 0) — the only site
          of the five that had neither `type="tel"`, a mask, nor `phoneRule`
          wired in at all. Breaks out of the compact `dl`/`dt`/`dd` rows the
          other two fields keep: the field's own label/prefix/hint block
          would otherwise fight that layout for the same row. */}
      <PhoneField
        idPrefix="telefono"
        field={account.id}
        label="Teléfono"
        value={telefono}
        onChange={setTelefono}
        error={telefonoError ?? undefined}
      />
      <dl className="space-y-field text-sm">
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
