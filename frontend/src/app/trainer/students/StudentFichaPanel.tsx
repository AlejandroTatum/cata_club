"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, Phone, UserRound } from "lucide-react";
import { fetchFichaEmergencia, type FichaEmergencia } from "@/services/api";
import { BLOOD_TYPE_LABELS, type BloodType } from "@/types/enrollment";
import { ICON } from "@/lib/icon-size";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui";
import type { AlumnoDelClub } from "./students-utils";

type Load = { tipo: "cargando" } | { tipo: "error" } | { tipo: "lista"; ficha: FichaEmergencia };

/** Digits and a leading plus only: what a `tel:` link can dial. */
function dialable(phone: string): string {
  return phone.replace(/[^\d+]/g, "");
}

function Field({ label, children }: { label: string; children: React.ReactNode }): React.ReactElement {
  return (
    <div className="flex flex-col gap-1 border-b border-line px-5 py-3 last:border-b-0">
      <span className="text-2xs font-bold uppercase tracking-flat text-ink-3">{label}</span>
      {children}
    </div>
  );
}

function Missing(): React.ReactElement {
  return <span className="text-sm text-ink-3">No registra</span>;
}

/** A contact with a tap-to-call number; the number is the action, not decoration. */
function Contact({ name, phone }: { name: string | null; phone: string | null }): React.ReactElement {
  if (!name && !phone) return <Missing />;
  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <span className="text-sm font-semibold text-ink">{name ?? "No registra"}</span>
      {phone && (
        <a
          href={`tel:${dialable(phone)}`}
          aria-label={`Llamar a ${name ?? "contacto"} al ${phone}`}
          className="inline-flex h-ctl items-center gap-1.5 rounded-lg border border-line bg-paper px-3 text-sm font-bold tabular-nums text-ink hover:bg-ink/5"
        >
          <Phone size={ICON.sm} strokeWidth={1.5} aria-hidden="true" />
          {phone}
        </a>
      )}
    </div>
  );
}

function hasNothing(ficha: FichaEmergencia): boolean {
  return [
    ficha.tipoSangre,
    ficha.alergias,
    ficha.contactoEmergencia,
    ficha.telefonoEmergencia,
    ficha.representanteNombreCompleto,
    ficha.representanteTelefono,
  ].every((v) => !v?.trim());
}

/**
 * Ficha médica as a persistent panel beside the roster (desktop master–detail).
 * Same data and same on-demand fetch as `EmergencyCardDialog`: one read per
 * selected student, never one per roster row.
 */
export default function StudentFichaPanel({
  student,
}: {
  student: AlumnoDelClub | null;
}): React.ReactElement {
  const [estado, setEstado] = useState<Load>({ tipo: "cargando" });
  const [intento, setIntento] = useState(0);
  const id = student?.personaId;

  useEffect(() => {
    if (id === undefined) return;
    let cancelado = false;
    setEstado({ tipo: "cargando" });
    fetchFichaEmergencia(id)
      .then((ficha) => {
        if (!cancelado) setEstado({ tipo: "lista", ficha });
      })
      .catch((err: unknown) => {
        console.error("[trainer/students] fetchFichaEmergencia failed", err);
        if (!cancelado) setEstado({ tipo: "error" });
      });
    return (): void => {
      cancelado = true;
    };
  }, [id, intento]);

  if (!student) {
    return (
      <aside
        aria-label="Ficha médica"
        data-testid="ficha-panel-ghost"
        className="card overflow-hidden p-0 lg:sticky lg:top-4"
      >
        <div className="flex items-start gap-3 px-5 py-4 text-ink-3">
          <UserRound size={ICON.lg} strokeWidth={1.5} aria-hidden="true" className="flex-none" />
          <div>
            <h2 className="text-base font-bold text-ink">Elija un alumno</h2>
            <p className="text-sm">Su ficha médica y a quién llamar aparecen acá.</p>
          </div>
        </div>
        <dl aria-hidden="true" className="flex flex-col border-t border-dashed border-line">
          {[
            ["Tipo de sangre", "Se muestra al elegir un alumno"],
            ["Alergias", "Se muestra al elegir un alumno"],
            ["Contacto de emergencia", "Nombre y teléfono para llamar"],
            ["Representante legal", "Nombre y teléfono de respaldo"],
          ].map(([label, hint]) => (
            <div
              key={label}
              className="flex items-center justify-between gap-3 border-b border-dashed border-line px-5 py-3 last:border-b-0"
            >
              <div className="flex min-w-0 flex-col gap-1">
                <dt className="text-2xs font-bold uppercase tracking-flat text-ink-3">{label}</dt>
                <dd className="text-sm text-ink-3">{hint}</dd>
              </div>
              <span className="flex-none text-sm font-semibold text-ink-3">—</span>
            </div>
          ))}
        </dl>
      </aside>
    );
  }

  return (
    <aside
      aria-label="Ficha médica"
      data-testid="ficha-panel"
      className="card overflow-hidden p-0 lg:sticky lg:top-4"
    >
      <div className="flex items-center gap-3 border-b border-line bg-state-bad-bg px-5 py-4">
        <span
          aria-hidden="true"
          className="flex h-9 w-9 flex-none items-center justify-center rounded-full bg-paper text-state-bad"
        >
          <AlertTriangle size={ICON.base} strokeWidth={1.5} />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-base font-bold text-ink">{student.nombreCompleto}</h2>
          <p className="text-xs text-ink-3">
            {student.edad} años{student.horariosCompactos ? ` · ${student.horariosCompactos}` : ""}
          </p>
        </div>
      </div>

      {estado.tipo === "cargando" && (
        <LoadingState label={`Cargando la ficha de ${student.nombreCompleto}…`} />
      )}
      {estado.tipo === "error" && (
        <div className="p-5">
          <ErrorState
            title="No se pudo cargar la ficha"
            message="Revise su conexión e intente nuevamente."
            onRetry={() => setIntento((n) => n + 1)}
          />
        </div>
      )}
      {estado.tipo === "lista" && hasNothing(estado.ficha) && (
        <EmptyState
          surface="inset"
          icon={<AlertTriangle size={ICON.lg} strokeWidth={1.5} aria-hidden="true" />}
          title="Sin datos de emergencia"
          description={`El club no tiene cargada la ficha médica de ${student.nombreCompleto} ni un representante legal. Pídalos en secretaría antes del próximo entrenamiento.`}
        />
      )}
      {estado.tipo === "lista" && !hasNothing(estado.ficha) && (
        <div className="flex flex-col">
          <Field label="Tipo de sangre">
            {estado.ficha.tipoSangre ? (
              <span className="text-sm font-semibold text-ink">
                {BLOOD_TYPE_LABELS[estado.ficha.tipoSangre as BloodType] ?? estado.ficha.tipoSangre}
              </span>
            ) : (
              <Missing />
            )}
          </Field>
          <Field label="Alergias">
            {estado.ficha.alergias ? (
              <span className="text-sm font-semibold text-ink">{estado.ficha.alergias}</span>
            ) : (
              <Missing />
            )}
          </Field>
          <Field label="Contacto de emergencia">
            <Contact name={estado.ficha.contactoEmergencia} phone={estado.ficha.telefonoEmergencia} />
          </Field>
          <Field label="Representante legal (respaldo)">
            <Contact
              name={estado.ficha.representanteNombreCompleto}
              phone={estado.ficha.representanteTelefono}
            />
          </Field>
        </div>
      )}
    </aside>
  );
}
