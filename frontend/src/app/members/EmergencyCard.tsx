"use client";

/**
 * The "tarjeta de emergencia": what a trainer sees when something happens,
 * drawn live from the same values the medical-record editor holds so it
 * updates as the family types. Also carries a completeness indicator and who
 * can see this data.
 */

import { HeartPulse, Phone, ShieldCheck, TriangleAlert } from "lucide-react";
import { DataBox } from "@/components/ui";
import { ICON } from "@/lib/icon-size";

export interface EmergencyCardValues {
  /** Human-readable blood type ("O POSITIVO") or empty when unknown. */
  tipoSangre: string;
  alergias: string;
  /** Comma-separated illnesses, as typed. */
  enfermedades: string;
  contactoEmergencia: string;
  /** Phone as it should be shown (already formatted), or empty. */
  telefonoEmergencia: string;
}

const FIELD_LABELS: { key: keyof EmergencyCardValues; label: string }[] = [
  { key: "tipoSangre", label: "tipo de sangre" },
  { key: "alergias", label: "alergias" },
  { key: "enfermedades", label: "enfermedades" },
  { key: "contactoEmergencia", label: "contacto" },
  { key: "telefonoEmergencia", label: "teléfono" },
];

function Line({ label, value, emptyText }: { label: string; value: string; emptyText: string }): React.ReactElement {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-line py-2.5 last:border-b-0">
      <dt className="flex-none text-2xs font-bold uppercase text-ink-3-strong">{label}</dt>
      <dd className={value ? "min-w-0 break-words text-right text-sm font-semibold text-ink" : "text-right text-sm text-ink-3-strong"}>{value || emptyText}</dd>
    </div>
  );
}

function Alert({ label, value }: { label: string; value: string }): React.ReactElement {
  return (
    <div>
      <dt className="text-2xs font-bold uppercase text-state-warn">{label}</dt>
      <dd className="break-words text-base font-bold text-ink">{value}</dd>
    </div>
  );
}

export default function EmergencyCard({
  studentName,
  values,
  ownerIsViewer,
}: {
  studentName?: string;
  values: EmergencyCardValues;
  /** True when the reader is the record's owner ("usted"), false for a guardian. */
  ownerIsViewer: boolean;
}): React.ReactElement {
  const filled = FIELD_LABELS.filter(({ key }) => values[key].trim() !== "");
  const missing = FIELD_LABELS.filter(({ key }) => values[key].trim() === "");
  const hasHealthAlert = values.alergias.trim() !== "" || values.enfermedades.trim() !== "";
  // What is NOT filled stays a quiet line; what is filled lives in the warning block above.
  const quietLines = [
    { label: "Alergias", empty: values.alergias.trim() === "" },
    { label: "Enfermedades", empty: values.enfermedades.trim() === "" },
  ].filter((line) => line.empty);
  const pct = Math.round((filled.length / FIELD_LABELS.length) * 100);
  const complete = missing.length === 0;

  return (
    <aside
      aria-label="Tarjeta de emergencia"
      data-testid="emergency-card"
      className="flex flex-col gap-page lg:sticky lg:top-4 lg:self-start"
    >
      <section className="card overflow-hidden">
        <header className="flex items-center gap-2.5 bg-coal px-4 py-3 text-white">
          <HeartPulse size={ICON.base} strokeWidth={1.75} aria-hidden="true" />
          <div className="min-w-0">
            <h3 className="text-2xs font-bold uppercase tracking-caps">Tarjeta de emergencia</h3>
            {studentName && <p className="truncate text-sm font-semibold">{studentName}</p>}
          </div>
          <span
            data-testid="emergency-card-blood"
            className={
              values.tipoSangre
                ? "ml-auto flex h-10 min-w-10 flex-none items-center justify-center rounded-ctl bg-white px-2 text-sm font-extrabold tabular-nums text-state-bad"
                : "ml-auto flex-none text-xs font-semibold text-white/70"
            }
          >
            {values.tipoSangre ? values.tipoSangre.replace(" POSITIVO", "+").replace(" NEGATIVO", "−") : "Sangre —"}
          </span>
        </header>
        <div className="flex flex-col gap-3 p-4">
          {hasHealthAlert ? (
            <div
              data-testid="emergency-card-health"
              className="flex flex-col gap-2.5 rounded-ctl border border-state-warn/30 bg-state-warn-bg p-3"
            >
              <div className="flex items-center gap-1.5 text-2xs font-bold uppercase text-state-warn">
                <TriangleAlert size={ICON.sm} strokeWidth={1.75} aria-hidden="true" />
                Atención médica
              </div>
              <dl className="flex flex-col gap-2">
                {values.alergias.trim() !== "" && <Alert label="Alergias" value={values.alergias} />}
                {values.enfermedades.trim() !== "" && <Alert label="Enfermedades" value={values.enfermedades} />}
              </dl>
            </div>
          ) : null}
          {quietLines.length > 0 ? (
            <dl>
              {quietLines.map(({ label }) => (
                <Line key={label} label={label} value="" emptyText="Sin declarar" />
              ))}
            </dl>
          ) : null}
          <div data-testid="emergency-card-contact" className="rounded-ctl border border-line p-3">
            <div className="flex items-center gap-1.5 text-2xs font-bold uppercase text-ink-3-strong">
              <Phone size={ICON.sm} strokeWidth={1.75} aria-hidden="true" />
              Contacto de emergencia
            </div>
            {values.contactoEmergencia.trim() === "" && values.telefonoEmergencia.trim() === "" ? (
              <p className="mt-1.5 text-sm text-ink-3-strong">Sin registrar</p>
            ) : (
              <div className="mt-1.5 flex flex-col gap-1">
                <p className={values.contactoEmergencia ? "break-words text-sm font-semibold text-ink" : "text-sm text-ink-3-strong"}>
                  {values.contactoEmergencia || "Sin registrar"}
                </p>
                {values.telefonoEmergencia ? (
                  <a
                    href={`tel:${values.telefonoEmergencia.replace(/[^\d+]/g, "")}`}
                    className="inline-flex min-h-9 items-center gap-1.5 self-start text-base font-extrabold tabular-nums text-ink underline decoration-line-2 underline-offset-4 hover:decoration-ink"
                  >
                    {values.telefonoEmergencia}
                  </a>
                ) : (
                  <p className="text-sm text-ink-3-strong">Teléfono sin registrar</p>
                )}
              </div>
            )}
          </div>
        </div>
      </section>

      <section className="card p-4" aria-labelledby="emergency-completeness-title">
        <div className="flex items-baseline justify-between gap-2">
          <h3 id="emergency-completeness-title" className="text-2xs font-bold uppercase text-ink-3-strong">
            Ficha completa
          </h3>
          <span className="text-sm font-bold tabular-nums text-ink">{pct}%</span>
        </div>
        <div
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={pct}
          aria-label="Completitud de la ficha médica"
          className="mt-2 h-1.5 overflow-hidden rounded-full bg-line"
        >
          <div className={complete ? "h-full bg-state-ok" : "h-full bg-state-warn"} style={{ width: `${pct}%` }} />
        </div>
        <p className="mt-2 text-xs text-ink-3-strong">
          {complete
            ? "Todos los datos están cargados."
            : `Falta: ${missing.map((m) => m.label).join(", ")}.`}
        </p>
      </section>

      <section className="card p-4" aria-labelledby="emergency-visibility-title">
        <h3 id="emergency-visibility-title" className="flex items-center gap-1.5 text-2xs font-bold uppercase text-ink-3-strong">
          <ShieldCheck size={ICON.sm} strokeWidth={1.75} aria-hidden="true" />
          Quién puede ver estos datos
        </h3>
        <ul className="mt-2 flex flex-wrap gap-1.5">
          <li><DataBox>Entrenadores del club</DataBox></li>
          <li><DataBox>Administración</DataBox></li>
          <li><DataBox>{ownerIsViewer ? "Tú" : "Tú, como representante"}</DataBox></li>
        </ul>
        <p className="mt-2 text-xs text-ink-3-strong">
          Se usan solo para actuar ante una emergencia durante las actividades del club.
        </p>
      </section>
    </aside>
  );
}
