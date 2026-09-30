import { Inbox } from "lucide-react";
import type { ReactElement } from "react";
import { EmptyState, InfoPanel, cn } from "@/components/ui";
import { ICON } from "@/lib/icon-size";
import type { InboxSummary } from "./inbox";

function Cell({ label, value, hint }: { label: string; value: string; hint?: string }): ReactElement {
  return <div className="flex min-w-0 flex-col gap-1 px-4 py-3">
    <dt className="text-2xs font-bold uppercase tracking-flat text-ink-2">{label}</dt>
    <dd className="truncate text-sm font-semibold text-ink" title={value}>{value}</dd>
    <dd className="truncate text-xs text-ink-3">{hint ?? " "}</dd>
  </div>;
}

function veces(count: number): string {
  return count === 1 ? "1 reporte" : `${count} reportes`;
}

export function SummaryStrip({ summary }: { summary: InboxSummary }): ReactElement {
  return <dl aria-label="Resumen de reportes" className="card grid grid-cols-2 divide-line lg:grid-cols-4 lg:divide-x">
    <Cell label="Reportes" value={String(summary.total)} hint="recibidos en total" />
    <Cell label="Últimos 7 días" value={String(summary.lastWeek)} hint="avisos recientes" />
    <Cell label="Ruta más reportada" value={summary.topRoute?.value ?? "—"} hint={summary.topRoute ? veces(summary.topRoute.count) : "sin ruta indicada"} />
    <Cell label="Dispositivo frecuente" value={summary.topDevice?.value ?? "—"} hint={summary.topDevice ? veces(summary.topDevice.count) : "sin datos"} />
  </dl>;
}

/** Skeleton rows: a date line, a route line and two text lines, like a real report. */
export function GhostRows({ count, className }: { count: number; className?: string }): ReactElement {
  return <div aria-hidden="true" data-testid="ghost-rows" className={cn("flex flex-col divide-y divide-line overflow-hidden opacity-60", className)}>
    {Array.from({ length: count }, (_, row) => <div key={row} className="flex flex-col gap-2 px-5 py-4">
      <div className="flex items-center justify-between gap-6"><div className="h-2.5 w-28 rounded-full bg-line" /><div className="h-2 w-24 rounded-full bg-line" /></div>
      <div className="h-2 w-20 rounded-full bg-line" />
      <div className="h-2.5 w-full max-w-md rounded-full bg-line" />
    </div>)}
  </div>;
}

/** The empty inbox: ghost rows fill the column, the guide sits centered over them. */
export function EmptyInbox(): ReactElement {
  return <section aria-label="Reportes recibidos" className="card relative flex min-h-[22rem] flex-col overflow-hidden lg:min-h-0 lg:flex-1">
    <GhostRows count={14} className="absolute inset-0" />
    <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 bottom-0 h-1/4 bg-gradient-to-t from-paper to-transparent" />
    <div className="relative flex flex-1 items-center justify-center p-4">
      <div className="rounded-card border border-line bg-paper/75 backdrop-blur-sm">
        <EmptyState
          surface="inset"
          icon={<Inbox size={ICON.lg} />}
          title="Aún no hay reportes de error"
          description="Cuando un usuario use «Reportar un problema», su aviso aparecerá aquí."
        />
      </div>
    </div>
  </section>;
}

/** Shown in the rail until a report is selected. */
export function SelectPrompt({ total }: { total: number }): ReactElement {
  return <InfoPanel as="div" title="Detalle del reporte">
    <p>Seleccione un reporte de la lista para ver su detalle.</p>
    <p>
      Cada aviso trae lo que escribió la persona, la ruta afectada y el dispositivo; si
      adjuntó una captura, se abre desde aquí.
    </p>
    <p>{total === 1 ? "Hay 1 reporte recibido." : `Hay ${total} reportes recibidos.`}</p>
  </InfoPanel>;
}

/** How reports reach this inbox; only what the report dialog already promises. */
export function HowItWorks(): ReactElement {
  return <InfoPanel as="div" title="Cómo llegan los reportes">
    <ol className="flex list-decimal flex-col gap-3 pl-5 marker:font-semibold marker:text-ink">
      <li>Quien usa la plataforma elige «Reportar un problema» y describe lo que pasó.</li>
      <li>La ruta y el dispositivo se adjuntan solos, junto con un código de seguimiento.</li>
      <li>La captura es opcional (PNG, JPEG o WebP, hasta 2 MB) y solo se envía si la persona lo acepta.</li>
      <li>Las capturas pueden contener datos personales: solo la administración del club las ve.</li>
    </ol>
  </InfoPanel>;
}

/** Faint outline of a report detail; fills the rail below the guide on an empty inbox. */
export function GhostDetail(): ReactElement {
  return <div aria-hidden="true" data-testid="ghost-detail" className="card relative hidden min-h-32 flex-1 overflow-hidden lg:block">
    <GhostRows count={14} className="absolute inset-0" />
    <div className="pointer-events-none absolute inset-x-0 bottom-0 h-1/4 bg-gradient-to-t from-paper to-transparent" />
  </div>;
}
