/**
 * `/ayuda` — the answers, browsable.
 *
 * The assistant could already answer all of this, but only if you thought of
 * the question first. That is the whole gap P10 was capped on: searching and
 * browsing answer different needs, and a family opening the app for the first
 * time cannot ask about something they do not yet know exists.
 *
 * Deliberately reachable WITHOUT a session. The two questions asked most often
 * — "when does my child train" and "how do I sign in" — are asked by people
 * who are, by definition, not signed in.
 */

"use client";

import { Dumbbell, HelpCircle, Rocket, ShieldCheck, Users } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { ICON } from "@/lib/icon-size";
import AppShell from "@/components/shell/AppShell";
import { Accordion, BackLink, Button } from "@/components/ui";
import { openHelpChat } from "@/components/chatbot/help-chat-store";
import { FAQ_SCHEDULES, FAQ_SECTIONS } from "./faq-content";

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
 * is the copy that is tested against the chatbot's own source of truth, and
 * this is presentation the content module has no reason to know about.
 */
const SECTION_ACCENT: Record<string, { icon: LucideIcon; iconBg: string; iconFg: string; stripe: string }> = {
  "Para empezar": {
    icon: Rocket,
    iconBg: "bg-cata-yellow-soft",
    iconFg: "text-ball-ink",
    stripe: "border-l-ball",
  },
  "Si es estudiante o representante": {
    icon: Users,
    iconBg: "bg-cuenta-representante-bg",
    iconFg: "text-cuenta-representante",
    stripe: "border-l-cuenta-representante",
  },
  "Si es entrenador": {
    icon: Dumbbell,
    iconBg: "bg-cuenta-entrenador-bg",
    iconFg: "text-cuenta-entrenador",
    stripe: "border-l-cuenta-entrenador",
  },
  "Si es administrador": {
    icon: ShieldCheck,
    iconBg: "bg-cata-red/15",
    iconFg: "text-cata-red",
    stripe: "border-l-cata-red",
  },
};

function sectionSlug(title: string): string {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, "-");
}

export default function AyudaPage(): React.ReactElement {
  return (
    <AppShell
      title="Preguntas frecuentes"
      subtitle="Cómo funciona la app del club, sección por sección."
    >
      <BackLink href="/" label="Volver al inicio" className="mb-6" />

      <div className="mx-auto flex max-w-3xl flex-col gap-page">
        {/*
         * The schedule first, and as a table rather than prose. It is the most
         * asked question in the club and the only answer here that someone
         * needs to READ OFF rather than read — a parent checking whether they
         * make it from school by 16:00 is scanning a column, not a paragraph.
         */}
        <section
          aria-labelledby="horarios-heading"
          className="card p-5 sm:p-6"
        >
          <h2 id="horarios-heading" className="mb-1 text-base font-extrabold text-ink">
            Horarios de entrenamiento
          </h2>
          <p className="mb-4 text-xs text-ink-2">
            Días y horas fijos del club, por categoría.
          </p>

          <div className="overflow-x-auto">
            <table className="w-full min-w-[420px] border-collapse text-left">
              <thead>
                <tr className="border-b border-line">
                  <th scope="col" className="pb-2 pr-4 text-2xs font-bold uppercase text-ink-3-strong">
                    Categoría
                  </th>
                  <th scope="col" className="pb-2 pr-4 text-2xs font-bold uppercase text-ink-3-strong">
                    Para quién
                  </th>
                  <th scope="col" className="pb-2 pr-4 text-2xs font-bold uppercase text-ink-3-strong">
                    Días
                  </th>
                  <th scope="col" className="pb-2 text-2xs font-bold uppercase text-ink-3-strong">
                    Hora
                  </th>
                </tr>
              </thead>
              <tbody>
                {FAQ_SCHEDULES.map((schedule) => (
                  <tr key={schedule.category} className="border-b border-line last:border-b-0">
                    <th scope="row" className="py-2.5 pr-4 text-sm font-bold text-ink">
                      {schedule.category}
                    </th>
                    <td className="py-2.5 pr-4 text-xs text-ink-2">{schedule.ages}</td>
                    <td className="py-2.5 pr-4 text-xs text-ink-2">{schedule.days}</td>
                    <td className="py-2.5 text-xs font-semibold tabular-nums text-ink">
                      {schedule.hours}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {/*
         * Two columns on desktop, one on narrow screens — #203's grid. Each
         * `FAQ_SECTIONS` entry renders as exactly one `<section>`, which is
         * also exactly one grid cell: a section's questions can never split
         * across columns because there is nothing splitting them, the CSS
         * grid just wraps whole cells.
         */}
        <div data-testid="faq-grid" className="grid grid-cols-1 gap-page lg:grid-cols-2 lg:items-start">
          {FAQ_SECTIONS.map((section) => {
            const slug = sectionSlug(section.title);
            const headingId = `faq-${slug}`;
            const accent = SECTION_ACCENT[section.title];
            const Icon = accent.icon;

            return (
              <section
                key={section.title}
                aria-labelledby={headingId}
                className={`card border-l-4 p-5 sm:p-6 ${accent.stripe}`}
              >
                <div className="mb-4 flex items-center gap-3">
                  <span
                    aria-hidden="true"
                    className={`flex h-9 w-9 flex-none items-center justify-center rounded-xl ${accent.iconBg}`}
                  >
                    <Icon size={ICON.base} strokeWidth={1.5} className={accent.iconFg} />
                  </span>
                  <h2 id={headingId} className="text-base font-extrabold text-ink">
                    {section.title}
                  </h2>
                </div>
                <Accordion
                  idPrefix={`faq-${slug}`}
                  label={section.title}
                  items={section.entries.map((entry) => ({
                    id: sectionSlug(entry.question),
                    question: entry.question,
                    answer: entry.answer,
                  }))}
                />
              </section>
            );
          })}
        </div>

        {/*
         * The escape hatch, at the bottom rather than the top: someone who
         * scrolled this far did not find their answer, and that is exactly the
         * moment to offer a person.
         */}
        <section className="rounded-card border border-line-2 bg-sunken p-5 text-center sm:p-6">
          <HelpCircle size={ICON.base} strokeWidth={1.5} aria-hidden="true" className="mx-auto mb-2 text-ink-3" />
          <h2 className="text-sm font-extrabold text-ink">¿No encontró lo que buscaba?</h2>
          <p className="mx-auto mt-1 max-w-md text-xs text-ink-2">
            Pregúntele al asistente con sus propias palabras, o escríbale al club directamente.
          </p>
          <div className="mt-4 flex flex-wrap justify-center gap-3">
            <Button variant="primary" onClick={() => openHelpChat()}>
              Preguntar al asistente
            </Button>
          </div>
        </section>
      </div>
    </AppShell>
  );
}
