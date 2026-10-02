import Link from "next/link";
import { sectionId, type LegalBlock } from "./legal-content";
import LegalToc from "./LegalToc";
import { cn } from "@/components/ui/cn";
import { PAGE_RAIL } from "@/components/ui/layout";
import { landingConfig, toWhatsAppLink } from "../landing/landing-config";

const CONTACT_EMAIL = "cataclub.loja@proton.me";
const DOCUMENTS = [
  { href: "/terminos", label: "Términos de uso" },
  { href: "/privacidad", label: "Aviso de privacidad" },
  { href: "/permiso-imagen-fetm", label: "Permiso público de imagen FETM" },
] as const;

interface LegalDocumentPageProps {
  title: string;
  blocks: readonly LegalBlock[];
  /**
   * Optional side summary. A document too short to fill the viewport passes
   * one: the page then becomes a document surface beside a rail instead of a
   * narrow column floating over an empty canvas.
   */
  aside?: React.ReactNode;
  /** Three to five key points, shown under "En resumen" in the right column. */
  summary?: readonly string[];
  /** The document's own route, marked as current in the document links. */
  path?: string;
}

/**
 * The one surface behind `/terminos`, `/privacidad` and `/permiso-imagen-fetm`.
 *
 * ## Mode: this is a Read surface
 *
 * A visitor arrives here to UNDERSTAND a document, not to be convinced by it
 * and not to operate a tool. That decides nearly everything below: the column
 * is sized to be read, the rhythm exists to separate sections rather than to
 * decorate them, and the one accent on the page is spent once.
 *
 * ## Why the type changed
 *
 * The page already spoke the club's COLOURS and none of its TYPE — the title
 * and every section heading were `font-bold` on the interface face, which is
 * the face a generic document arrives in. Reaching the club's site and finding
 * a page that drops its identity is the defect (#769), and the fix is the
 * product's own type ramp: Graduate, uppercase, on the title and the section
 * headings, and nowhere else on the page.
 *
 * "Nowhere else" is the whole of `tailwind.config.ts:331-335`, and it is not a
 * preference. Graduate is a collegiate display face with one cut, no lowercase
 * design intent and almost no vertical range: below its floor, or inside a
 * sentence, it stops being words and becomes texture. So the kicker, the
 * metadata, the prose and the links stay in Barlow, and only the two headings
 * take it: the section headings at the 20px `title` step, the document title at
 * `headline` (26px) rising to 32px from `sm` up. Both carry `tracking-flat`,
 * because Graduate is wide and flat and has to contradict the negative tracking
 * every size step above 15px carries.
 * `lib/__tests__/display-face-usage.test.ts` holds all of that.
 *
 * The title does NOT take the 46px `display` step the landing's hero uses, and
 * the column below is the reason: 46px of Graduate in a ~62ch measure wraps a
 * document title into four lines of shouting. 32px against a 15px body is a
 * 2.1× step plus a face change plus a case change — hierarchy is not in short
 * supply. The old `text-3xl sm:text-5xl` was larger in pixels but sat in a
 * column 1.7× wider, so relative to its measure the title is bigger now, not
 * smaller.
 *
 * ## The anchor, and how little of it there is
 *
 * The landing's vocabulary is a short red rule set against an uppercase,
 * wide-tracked label. It appears here exactly ONCE, on the document kicker,
 * and deliberately not above each of the seventeen section headings: a rule
 * over every section is not an accent any more, it is grammar. The section
 * headings are anchored by the face and by the space above them instead — and
 * the space is asymmetric on purpose, roughly two to one, so a heading reads
 * as belonging to what follows it rather than floating between two blocks.
 *
 * ## The main landmark (#820)
 *
 * This page reaches the user through no shell: the root layout's wrapper is
 * deliberately NOT a `<main>` (see `lib/__tests__/main-landmark.test.ts`, the
 * closed set of files allowed to declare one), and the institutional bar above
 * the document is a banner, not content. So the document column is the
 * landmark — it keeps the `contenido` id it already had, now on an element
 * that means where the content begins.
 */
const SIDE_TITLE = "font-display text-lg uppercase leading-tight tracking-flat text-ink";

export default function LegalDocumentPage({ title, blocks, aside, summary, path }: LegalDocumentPageProps): React.ReactElement {
  const sections = blocks.flatMap((block, index) => (block.kind === "heading" ? [{ id: sectionId(block.text, index), label: block.text }] : []));
  const hasToc = sections.length > 1;
  const { whatsapp } = landingConfig.contact;
  const related = (
    <nav aria-label="Otros documentos públicos" className="card p-5">
      {/* A label for the link group, and no red rule: the rule is the
          document's kicker and it stays singular to keep meaning anything. */}
      <p className="mb-3 text-2xs font-extrabold uppercase tracking-caps text-ink-3-strong">Otros documentos públicos</p>
      <ul className="grid gap-2 text-sm font-semibold text-cata-red-dark underline underline-offset-4">
        {DOCUMENTS.map((doc) => (
          <li key={doc.href}>
            <Link href={doc.href} aria-current={doc.href === path ? "page" : undefined}>
              {doc.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
  const keyPoints =
    aside !== undefined ? (
      aside
    ) : summary !== undefined ? (
      <section aria-labelledby="legal-resumen" className="card grid gap-3 p-5">
        <h2 id="legal-resumen" className={SIDE_TITLE}>
          En resumen
        </h2>
        <ul className="grid list-disc gap-2 pl-5 text-sm leading-prose text-ink-2">
          {summary.map((point) => (
            <li key={point}>{point}</li>
          ))}
        </ul>
      </section>
    ) : null;
  const questions = (
    <section aria-labelledby="legal-dudas" className="card grid gap-2 p-5">
      <h2 id="legal-dudas" className={SIDE_TITLE}>
        ¿Dudas?
      </h2>
      <p className="text-sm leading-prose text-ink-2">Escríbanos y le responderemos de forma administrativa.</p>
      <p className="grid gap-1 text-sm font-semibold text-cata-red-dark underline underline-offset-4">
        <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>
        {whatsapp.map((number) => (
          <a key={number} href={toWhatsAppLink(number)} target="_blank" rel="noreferrer">
            WhatsApp {number}
            <span className="sr-only"> (abre en una pestaña nueva)</span>
          </a>
        ))}
      </p>
    </section>
  );
  return (
    <main
      id="contenido"
      className={cn("mx-auto w-full max-w-7xl py-8 text-base sm:py-12", PAGE_RAIL, hasToc && "xl:grid-cols-[240px_minmax(0,1fr)_300px]")}
    >
      {hasToc && (
        <div className="hidden xl:sticky xl:top-24 xl:block">
          <LegalToc items={sections} />
        </div>
      )}
      <div className="grid min-w-0 content-start gap-page max-lg:order-2">
        <div className="card p-6 sm:p-10">
          {/*
           * No `focus-visible:*` utilities here: `globals.css` gives every
           * `a[href]` outside the landing the two-tone focus ring.
           */}
          <Link href="/" className="mb-10 inline-flex text-sm font-semibold text-cata-red-dark underline-offset-4 hover:underline">
            Volver a Cata Club
          </Link>
          {/* A DIV, not a `<header>`: the institutional bar is the page's one banner. */}
          <div className="border-b border-cata-border pb-8">
            {/* The landing's eyebrow: a red rule fill, a `cata-red-dark` label (AA as text). */}
            <p className="mb-4 flex items-center gap-3 text-xs font-extrabold uppercase tracking-caps-wide text-cata-red-dark">
              <span aria-hidden="true" className="h-0.5 w-8 flex-none bg-cata-red" />
              Documento público
            </p>
            <h1 className="text-balance font-display text-xl uppercase leading-crisp tracking-flat text-cata-text sm:text-2xl">{title}</h1>
            {/* The consent record keeps which version was accepted, so these are part of the document. */}
            <dl className="mt-8 grid gap-4 sm:grid-cols-2 sm:gap-x-8">
              <div>
                <dt className="text-2xs font-extrabold uppercase tracking-caps text-ink-3-strong">Versión</dt>
                <dd className="mt-1 text-sm font-semibold text-cata-text">1.0</dd>
              </div>
              <div>
                <dt className="text-2xs font-extrabold uppercase tracking-caps text-ink-3-strong">Vigente desde</dt>
                <dd className="mt-1 text-sm font-semibold text-cata-text">27 de agosto de 2026</dd>
              </div>
            </dl>
          </div>
          {/*
           * Same classes as the shared `LegalDocumentProse`, plus the anchor id
           * each heading needs for the contents list; that renderer is also the
           * wizard dialog's and has no ids to give.
           */}
          <article className="mt-10 space-y-6 leading-prose text-cata-text">
            {blocks.map((block, index) =>
              block.kind === "heading" ? (
                <h2
                  key={`${index}-${block.text.slice(0, 24)}`}
                  id={sectionId(block.text, index)}
                  className="scroll-mt-24 pt-8 font-display text-lg uppercase leading-tight tracking-flat text-cata-text first:pt-0"
                >
                  {block.text}
                </h2>
              ) : (
                <p key={`${index}-${block.text.slice(0, 24)}`}>{block.text}</p>
              ),
            )}
          </article>
        </div>
        {aside !== undefined && (
          <section aria-labelledby="preguntas-permiso" className="card p-6 sm:p-8">
            <p id="preguntas-permiso" className="mb-3 text-2xs font-extrabold uppercase tracking-caps text-ink-3-strong">
              Preguntas sobre este permiso
            </p>
            <p className="text-sm leading-prose text-cata-text">
              Si tiene dudas sobre el alcance de la difusión de imagen, consulte con la persona entrenadora o con la administración del club
              antes de aceptar el permiso. Puede revisar este documento las veces que lo necesite.
            </p>
          </section>
        )}
      </div>
      {/*
       * Below `lg` the rail dissolves (`contents`) so the summary reads before the
       * document and the reference cards (version, related, contact) after it.
       */}
      <div className="grid content-start gap-page max-lg:contents lg:sticky lg:top-24">
        {keyPoints !== null && <div className="grid max-lg:order-1">{keyPoints}</div>}
        {aside === undefined && (
          <section aria-label="Versión y vigencia" className="card p-5 text-sm text-ink-2 max-lg:order-3">
            <p className="mb-1 text-2xs font-extrabold uppercase tracking-caps text-ink-3-strong">Versión y vigencia</p>
            <p>Versión 1.0, vigente desde el 27 de agosto de 2026.</p>
          </section>
        )}
        <div className="grid gap-page max-lg:order-3">
          {related}
          {questions}
        </div>
      </div>
    </main>
  );
}
