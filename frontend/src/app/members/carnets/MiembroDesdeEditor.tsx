/**
 * The admin's «Miembro desde» control for ONE player (issue #1749): a month and
 * a year, saved or cleared on its own. The carnet and the player's profile
 * read what is saved here; empty means they show nothing.
 *
 * The range is checked here first (not before the club's founding month, not
 * after the current one) so a typo answers on the spot; the backend checks it
 * again and is the authority, as it is for "only players".
 */

"use client";

import { useId, useState } from "react";
import { Button } from "@/components/ui";
import { FILTER_LABEL } from "@/components/ui/FilterPanel";
import { FOUNDING_DATE } from "@/app/landing/landing-config";
import { clubIsoDate } from "@/lib/club-date";
import { toUserMessage } from "@/lib/error-message";
import { setMiembroDesde } from "@/services/api";

const FIELD_CONTROL =
  "h-ctl rounded-ctl border border-line-2 bg-paper px-3 text-sm text-ink outline-none focus:border-ink-3";

const FOUNDING_MONTH = `${FOUNDING_DATE.year}-${String(FOUNDING_DATE.month).padStart(2, "0")}`;

/** The msg for a month outside the club's life, or `null` when the month is fine. */
function rangeError(month: string, currentMonth: string): string | null {
  if (!/^\d{4}-\d{2}$/.test(month)) return "Elige un mes y un año.";
  if (month < FOUNDING_MONTH) return "No puede ser anterior a octubre de 2013.";
  if (month > currentMonth) return "No puede estar en el futuro.";
  return null;
}

export default function MiembroDesdeEditor({
  personaId,
  name,
  value,
  onSaved,
}: {
  personaId: string;
  name: string;
  /** What is on record (`YYYY-MM-01`), or `null`. */
  value: string | null;
  /** Called with the stored value (`YYYY-MM-01`, or `null` once cleared). */
  onSaved: (value: string | null) => void;
}): React.ReactElement {
  const inputId = useId();
  const [month, setMonth] = useState(value ? value.slice(0, 7) : "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const currentMonth = clubIsoDate().slice(0, 7);

  async function submit(next: string | null): Promise<void> {
    setSaved(false);
    if (next !== null) {
      const problem = rangeError(next, currentMonth);
      if (problem) {
        setError(problem);
        return;
      }
    }
    setError(null);
    setSaving(true);
    try {
      const result = await setMiembroDesde(personaId, next);
      setMonth(result.miembroDesde ? result.miembroDesde.slice(0, 7) : "");
      setSaved(true);
      onSaved(result.miembroDesde);
    } catch (cause: unknown) {
      setError(toUserMessage(cause, "No se pudo guardar «Miembro desde»."));
    } finally {
      setSaving(false);
    }
  }

  return (
    <form
      noValidate
      className="flex flex-wrap items-end gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        void submit(month);
      }}
    >
      <div className="flex flex-col gap-field">
        <label htmlFor={inputId} className={FILTER_LABEL}>
          Miembro desde
        </label>
        <input
          id={inputId}
          type="month"
          aria-label={`Miembro desde de ${name}`}
          value={month}
          min={FOUNDING_MONTH}
          max={currentMonth}
          disabled={saving}
          onChange={(event) => {
            setMonth(event.target.value);
            setSaved(false);
            setError(null);
          }}
          className={FIELD_CONTROL}
        />
      </div>
      <Button type="submit" variant="secondary" size="sm" disabled={saving}>
        Guardar
      </Button>
      {value ? (
        <Button type="button" variant="tertiary" size="sm" disabled={saving} onClick={() => void submit(null)}>
          Quitar
        </Button>
      ) : null}
      {error ? (
        <p role="alert" className="basis-full text-xs text-state-bad">
          {error}
        </p>
      ) : null}
      {saved && !error ? (
        <p role="status" className="basis-full text-xs text-ink-2">
          Guardado.
        </p>
      ) : null}
    </form>
  );
}
