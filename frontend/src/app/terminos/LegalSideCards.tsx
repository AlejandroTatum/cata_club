import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { ICON } from "@/lib/icon-size";
import { cn } from "@/components/ui/cn";
import { landingConfig, toWhatsAppLink } from "../landing/landing-config";

export const CONTACT_EMAIL = "cataclub.loja@proton.me";
export const SIDE_TITLE = "font-display text-lg uppercase leading-tight tracking-flat text-ink";

const DOCUMENTS = [{ href: "/terminos", label: "Términos y condiciones" }] as const;

/** The public legal documents (one since #1615), the current one marked. */
export function LegalRelated({ path, className }: { path?: string; className?: string }): React.ReactElement {
  return (
    <nav aria-label="Otros documentos públicos" className={cn("card p-5", className)}>
      {/* A label for the link group, and no red rule: the rule is the
          document's kicker and it stays singular to keep meaning anything. */}
      <p className="mb-1.5 text-2xs font-extrabold uppercase tracking-caps text-ink-3-strong">Otros documentos públicos</p>
      {/* Rows with an arrow at the end: the link is the whole row's width, not a short word in a wide card. */}
      <ul className="grid divide-y divide-cata-border text-sm font-semibold text-cata-red-dark">
        {DOCUMENTS.map((doc) => (
          <li key={doc.href}>
            <Link href={doc.href} aria-current={doc.href === path ? "page" : undefined} className="flex min-h-ctl items-center justify-between gap-3 py-2.5 aria-[current=page]:text-cata-text">
              <span className="underline underline-offset-4">{doc.label}</span>
              <ChevronRight size={ICON.sm} strokeWidth={1.5} aria-hidden="true" className="flex-none text-ink-3" />
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}

/** The club's contact, content-height: it never stretches to a neighbour. */
export function LegalQuestions({ className }: { className?: string }): React.ReactElement {
  const { whatsapp } = landingConfig.contact;
  return (
    <section aria-labelledby="legal-dudas" className={cn("card grid content-start gap-2 p-5", className)}>
      <h2 id="legal-dudas" className={SIDE_TITLE}>
        ¿Dudas?
      </h2>
      <p className="text-sm leading-prose text-ink-2">Escríbanos y le responderemos de forma administrativa.</p>
      <p className="flex flex-wrap gap-x-5 gap-y-1 text-sm font-semibold text-cata-red-dark underline underline-offset-4">
        <a href={`mailto:${CONTACT_EMAIL}`} className="touch-target-row flex items-center">{CONTACT_EMAIL}</a>
        {whatsapp.map((number) => (
          <a key={number} href={toWhatsAppLink(number)} target="_blank" rel="noreferrer" className="touch-target-row flex items-center">
            WhatsApp {number}
            <span className="sr-only"> (abre en una pestaña nueva)</span>
          </a>
        ))}
      </p>
    </section>
  );
}
