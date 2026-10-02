/**
 * `/ayuda` — the answers, browsable.
 *
 * This page is the FAQ and nothing else (#1374 correction): the four
 * audience groups below are the whole surface. Schedules are answered by the
 * landing's live section — the one place the club's published catalog is
 * shown — and the club's own facts live in the knowledge the retired
 * assistant left behind, not as blocks to scroll past here.
 *
 * Deliberately reachable WITHOUT a session. The two questions asked most often
 * — "when does my child train" and "how do I sign in" — are asked by people
 * who are, by definition, not signed in.
 */

"use client";

import { useMemo, useState } from "react";
import { Dumbbell, Rocket, ShieldCheck, Users } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { ICON } from "@/lib/icon-size";
import AppShell from "@/components/shell/AppShell";
import {
  Accordion,
  BackLink,
  Button,
  EmptyState,
  FilterPanel,
  FilterPill,
  InfoPanel,
  PAGE_RAIL,
  RoleShortcuts,
  SearchInput,
} from "@/components/ui";
import type { RoleShortcut } from "@/components/ui";
import { useReportProblem } from "@/components/report-problem/useReportProblem";
import { useAuth } from "@/contexts/AuthContext";
import { backHrefForRole } from "@/lib/auth-utils";
import type { UserRole } from "@/types/domain";
import { cn } from "@/components/ui/cn";
import { FAQ_SECTIONS } from "./faq-content";

/**
 * The audience color system #203 asks for — one hue per "who this section is
 * for", so the grid reads as a set of audiences rather than a wall of
 * identical cards. Every value here is a named token from
 * `tailwind.config.ts`, never a literal hex: `color-contrast.test.ts` only
 * proves tokens are AA-safe, and `no screen paints with Tailwind's default
 * palette` only allows names it already knows.
 *
 * The icon/text pairs mirror the ones `/admin/crear-cuenta` already ships for
 * the same "estudiante" (`cuenta-representante`) and "entrenador"
 * (`cuenta-entrenador`) accounts, and reuse `cata-red` at the same `/15` tint
 * that screen uses for its own red card — both are icon-only usages (3:1,
 * not the 4.5:1 body-text floor), matching how those tokens already ship.
 *
 * Keyed by section title rather than folded into `faq-content.ts`: that file
 * is the copy that is tested against the club's knowledge snapshot, and
 * this is presentation the content module has no reason to know about.
 */
const SECTION_ACCENT: Record<string, { icon: LucideIcon; iconBg: string; iconFg: string }> = {
  "Para empezar": {
    icon: Rocket,
    iconBg: "bg-cata-yellow-soft",
    iconFg: "text-ball-ink",
  },
  "Si es estudiante o representante": {
    icon: Users,
    iconBg: "bg-cuenta-representante-bg",
    iconFg: "text-cuenta-representante",
  },
  "Si es entrenador": {
    icon: Dumbbell,
    iconBg: "bg-cuenta-entrenador-bg",
    iconFg: "text-cuenta-entrenador",
  },
  "Si es administrador": {
    icon: ShieldCheck,
    iconBg: "bg-cata-red/15",
    iconFg: "text-cata-red",
  },
};

function sectionSlug(title: string): string {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, "-");
}

/**
 * Answers that hand the reader to the surface that actually holds the fact
 * (#1374 correction): the schedule answer directs to the landing's live
 * section instead of restating times this page cannot keep current — the
 * landing reads the published catalog, and its `#horarios` anchor is where
 * the header's own "Horarios" link has always landed.
 *
 * The link text is a VERBATIM substring of the canonical answer, so the
 * parity guard keeps comparing the same words on both sides — the anchor
 * changes where a phrase points, never what it says.
 */
const ANSWER_LINKS: Readonly<Record<string, { linkText: string; href: string }>> = {
  "¿Cuáles son los horarios?": {
    linkText: "Horarios de la página principal",
    href: "/#horarios",
  },
};

/**
 * The answer's own words, with the mapped phrase promoted to a link. If the
 * canonical answer drifts away from the mapped phrase, the answer still
 * renders whole — and `AyudaPage.test.tsx` fails loudly, because the link it
 * guards would be gone.
 */
function AnswerWithLink({ question, answer }: { question: string; answer: string }): React.ReactElement {
  const link = ANSWER_LINKS[question];
  if (!link) return <>{answer}</>;

  const [before, after] = answer.split(link.linkText);
  if (after === undefined) return <>{answer}</>;

  return (
    <>
      {before}
      <a
        href={link.href}
        className="font-semibold text-ink underline decoration-line-2 decoration-2 underline-offset-4 hover:decoration-ink"
      >
        {link.linkText}
      </a>
      {after}
    </>
  );
}

/** Rows share the viewport's height left under the page header (no dead band). */
const FILL_SCREEN = "xl:min-h-[calc(100dvh-25rem)] xl:auto-rows-fr";

/**
 * Where each audience most often goes next. Destinations only — every one is
 * a route the role's own navigation already reaches.
 */
const QUICK_LINKS_BY_ROLE: Partial<Record<UserRole, RoleShortcut[]>> = {
  admin: [
    { title: "Panel de Control", description: "Resumen del día del club", href: "/dashboard" },
    { title: "Miembros", description: "Cuentas, roles y membresías", href: "/members" },
    { title: "Pagos", description: "Revisar y aprobar comprobantes", href: "/payments" },
    { title: "Asistencias", description: "Registros de entrenamiento", href: "/attendance" },
  ],
  trainer: [
    { title: "Mi día", description: "Sus próximas sesiones", href: "/trainer" },
    { title: "Asistencias", description: "Registrar la asistencia", href: "/trainer/attendance" },
    { title: "Mi perfil", description: "Sus datos y su cuenta", href: "/profile" },
  ],
  estudiante: [
    { title: "Mi cuenta", description: "Su resumen y próximas sesiones", href: "/student" },
    { title: "Mis pagos", description: "Sus cuotas y comprobantes", href: "/student/payments" },
    { title: "Mi asistencia", description: "Su historial de entrenamientos", href: "/student/attendance" },
    { title: "Mi perfil", description: "Sus datos y su cuenta", href: "/profile" },
  ],
  representante: [
    { title: "Mi cuenta", description: "El resumen de su familia", href: "/student" },
    { title: "Mis pagos", description: "Cuotas y comprobantes", href: "/student/payments" },
    { title: "Agregar estudiante", description: "Sumar a otra persona a su cargo", href: "/student/add-dependent" },
    { title: "Mi perfil", description: "Sus datos y su cuenta", href: "/profile" },
  ],
};

const PUBLIC_QUICK_LINKS: RoleShortcut[] = [
  { title: "Iniciar sesión", description: "Ingresar a su cuenta", href: "/login" },
  { title: "Horarios del club", description: "Días y horas de entrenamiento", href: "/#horarios" },
  { title: "Página principal", description: "Conocer el club", href: "/" },
];

/** Case- and accent-insensitive, so "inscripcion" finds "inscripción". */
function normalize(text: string): string {
  return text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

export default function AyudaPage(): React.ReactElement {
  const { session } = useAuth();
  const report = useReportProblem();
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<string | null>(null);

  const filtering = query.trim() !== "" || category !== null;
  const role = session?.user.role;
  const quickLinks = (role && QUICK_LINKS_BY_ROLE[role]) || PUBLIC_QUICK_LINKS;

  const visibleSections = useMemo(() => {
    const needle = normalize(query.trim());
    return FAQ_SECTIONS.filter((section) => category === null || section.title === category)
      .map((section) => ({
        ...section,
        entries: section.entries.filter(
          (entry) =>
            needle === "" || normalize(`${entry.question} ${entry.answer}`).includes(needle),
        ),
      }))
      .filter((section) => section.entries.length > 0);
  }, [query, category]);

  return (
    <AppShell
      title="Preguntas frecuentes"
      subtitle="Cómo funciona la app del club, sección por sección."
      back={<BackLink href={backHrefForRole(session?.user.role)} />}
    >
      <div data-testid="faq-split" className={PAGE_RAIL}>
      <div className="grid min-w-0 content-start gap-page">
      <FilterPanel
        label="Buscar en las preguntas frecuentes"
        search={
          <SearchInput
            label="Buscar una pregunta"
            placeholder="Buscar una pregunta…"
            value={query}
            onChange={setQuery}
          />
        }
        chips={
          <div className="flex flex-wrap gap-2" role="group" aria-label="Filtrar por categoría">
            <FilterPill label="Todas" active={category === null} onClick={() => setCategory(null)} />
            {FAQ_SECTIONS.map((section) => (
              <FilterPill
                key={section.title}
                label={section.title}
                active={category === section.title}
                onClick={() => setCategory(section.title)}
              />
            ))}
          </div>
        }
      />
      {visibleSections.length === 0 && (
        <EmptyState
          title="Sin resultados"
          description="Pruebe con otra palabra o elija «Todas» las categorías."
        />
      )}
      {/*
       * Two columns on wide screens, one on narrow ones — #203's grid. Each
       * `FAQ_SECTIONS` entry renders as exactly one `<section>`, which is
       * also exactly one grid cell: a section's questions can never split
       * across columns because there is nothing splitting them, the CSS
       * grid just wraps whole cells.
       */}
      <div
        data-testid="faq-grid"
        className={cn(
          "grid grid-cols-1 gap-page xl:grid-cols-2",
          // Unfiltered, the whole FAQ fills the screen beside the rail; a
          // filtered result keeps its natural height instead of stretching.
          filtering ? "xl:items-start" : FILL_SCREEN,
        )}
      >
        {visibleSections.map((section) => {
          const slug = sectionSlug(section.title);
          const headingId = `faq-${slug}`;
          const accent = SECTION_ACCENT[section.title];
          const Icon = accent.icon;

          return (
            <section key={section.title} aria-labelledby={headingId} className="card p-page">
              <div className="mb-4 flex items-center gap-3">
                {/* `rounded-ctl`, not the 12px this used to write: the system
                    has two radii, and a 36px chip is control-shaped. */}
                <span
                  aria-hidden="true"
                  className={`flex h-9 w-9 flex-none items-center justify-center rounded-ctl ${accent.iconBg}`}
                >
                  <Icon size={ICON.base} strokeWidth={1.5} className={accent.iconFg} />
                </span>
                <h2
                  id={headingId}
                  className="font-display text-lg uppercase leading-tight tracking-flat text-ink"
                >
                  {section.title}
                </h2>
              </div>
              <Accordion
                idPrefix={`faq-${slug}`}
                label={section.title}
                // The category chips are already 40px; the sub-40px targets on a
                // phone are the question triggers (24px), so lift them here.
                className="max-md:[&_h3>button]:min-h-10"
                items={section.entries.map((entry) => ({
                  id: sectionSlug(entry.question),
                  question: entry.question,
                  answer: <AnswerWithLink question={entry.question} answer={entry.answer} />,
                }))}
              />
            </section>
          );
        })}
      </div>
      </div>

      <div className="grid min-w-0 content-start gap-page">
        <InfoPanel title="Cómo usar esta página">
          <p>Escriba una palabra en el buscador o elija una categoría para acotar las preguntas.</p>
          <p>Toque una pregunta para ver su respuesta; se abre una a la vez por categoría.</p>
          <p>Los horarios y precios vigentes se consultan en la página principal del club.</p>
        </InfoPanel>
        <InfoPanel title="¿No encontró su respuesta?">
          <p>Cuéntenos qué pasó y lo revisamos: se envía junto con una captura de esta pantalla.</p>
          <Button variant="secondary" onClick={() => report.open()} disabled={report.busy}>
            Reportar un problema
          </Button>
        </InfoPanel>
        <InfoPanel title="Qué encontrará aquí">
          <ul className="grid gap-2">
            {FAQ_SECTIONS.map((section) => (
              <li key={section.title} className="flex items-center justify-between gap-3">
                <span>{section.title}</span>
                <span className="text-xs text-ink-3-strong">
                  {section.entries.length} {section.entries.length === 1 ? "pregunta" : "preguntas"}
                </span>
              </li>
            ))}
          </ul>
        </InfoPanel>
        <InfoPanel title="Accesos rápidos">
          <RoleShortcuts shortcuts={quickLinks} label="Accesos rápidos" className="sm:grid-cols-1" />
        </InfoPanel>
      </div>
      </div>
      {report.dialog}
    </AppShell>
  );
}
