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

import { Dumbbell, Rocket, ShieldCheck, Users } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { ICON } from "@/lib/icon-size";
import AppShell from "@/components/shell/AppShell";
import { Accordion, BackLink } from "@/components/ui";
import { useAuth } from "@/contexts/AuthContext";
import { backHrefForRole } from "@/lib/auth-utils";
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

export default function AyudaPage(): React.ReactElement {
  const { session } = useAuth();
  return (
    <AppShell
      title="Preguntas frecuentes"
      subtitle="Cómo funciona la app del club, sección por sección."
    >
      <BackLink href={backHrefForRole(session?.user.role)} />

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
    </AppShell>
  );
}
