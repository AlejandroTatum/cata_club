import { Inbox } from "lucide-react";
import type { ReactElement } from "react";
import { EmptyState, InfoPanel } from "@/components/ui";
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

/** `parcial`: the list spans several pages, so the figures other than the total describe the page on screen. */
export function SummaryStrip({ summary, parcial = false }: { summary: InboxSummary; parcial?: boolean }): ReactElement {
  const alcance = parcial ? " · esta página" : "";
  return <dl aria-label="Resumen de reportes" className="card grid grid-cols-2 divide-line lg:grid-cols-4 lg:divide-x">
    <Cell label="Reportes" value={String(summary.total)} hint="recibidos en total" />
    <Cell label="Últimos 7 días" value={String(summary.lastWeek)} hint={`avisos recientes${alcance}`} />
    <Cell label="Ruta más reportada" value={summary.topRoute?.value ?? "—"} hint={summary.topRoute ? `${veces(summary.topRoute.count)}${alcance}` : "sin ruta indicada"} />
    <Cell label="Dispositivo frecuente" value={summary.topDevice?.value ?? "—"} hint={summary.topDevice ? `${veces(summary.topDevice.count)}${alcance}` : "sin datos"} />
  </dl>;
}

/** The empty inbox: one compact block, no action — reports are filed by users, not by the admin. */
export function EmptyInbox(): ReactElement {
  return <section aria-label="Reportes recibidos">
    <EmptyState
      layout="row"
      icon={<Inbox size={ICON.lg} />}
      title="Aún no hay reportes de error"
      description="Los avisos enviados desde «Reportar un problema» aparecerán aquí."
    />
  </section>;
}

/** Shown in the rail until a report is selected. */
export function SelectPrompt({ total }: { total: number }): ReactElement {
  return <InfoPanel as="div" title="Detalle del reporte" collapsible={false}>
    <p>Selecciona un reporte de la lista para ver su detalle.</p>
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
