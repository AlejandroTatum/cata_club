import Link from "next/link";
import type { LegalBlock } from "./legal-content";

interface LegalDocumentPageProps {
  title: string;
  blocks: readonly LegalBlock[];
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
 */
export default function LegalDocumentPage({ title, blocks }: LegalDocumentPageProps): React.ReactElement {
  return (
    /*
     * `max-w-measure` sits on the OUTER element, not on the `<article>`, so the
     * kicker, the title, the prose and the document links all share one column
     * edge. `text-base` is here for the same reason: `ch` resolves against the
     * element's own font size, so pinning it to the body step is what makes the
     * measure the article's measure rather than the browser default's.
     */
    <div id="contenido" className="mx-auto w-full max-w-measure text-base py-8 sm:py-12">
      {/*
       * No `focus-visible:*` utilities here. `globals.css:330-344` gives every
       * `a[href]` outside the landing the two-tone coal + ball ring from a
       * selector at specificity 0,3,0 — so the `focus-visible:outline-2
       * focus-visible:outline-offset-4` this link used to carry (0,2,0) could
       * never win, and only made it look like the link had a ring of its own.
       * It focuses exactly like the three document links at the foot.
       */}
      <Link href="/" className="mb-10 inline-flex text-sm font-semibold text-cata-red-dark underline-offset-4 hover:underline">
        Volver a Cata Club
      </Link>
      <header className="border-b border-cata-border pb-8">
        {/*
         * The landing's eyebrow, transcribed: a 2px red rule, a gap, then an
         * uppercase wide-tracked label. `cata-red` is the rule because a rule
         * is a FILL; the label is `cata-red-dark` because the same red as TEXT
         * measures 4.10:1 on the page grey and misses AA.
         */}
        <p className="mb-4 flex items-center gap-3 text-xs font-extrabold uppercase tracking-caps-wide text-cata-red-dark">
          <span aria-hidden="true" className="h-0.5 w-8 flex-none bg-cata-red" />
          Documento público
        </p>
        <h1 className="text-balance font-display text-xl uppercase leading-crisp tracking-flat text-cata-text sm:text-2xl">{title}</h1>
        {/*
         * Metadata, not headings: the label step in Barlow. Both values are
         * load-bearing — the public enrollment's grouped consent records which
         * version of which document was accepted, so the version and the
         * effective date are part of the document, not a byline.
         */}
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
      </header>
      {/*
       * `leading-prose` (1.55) is the step the config names for exactly this —
       * "long-form paragraph: help text, legal copy, empty-state prose". The
       * `leading-8` it replaces was a raw 32px, i.e. 2.13 at the body size, and
       * that much air between lines pulls a paragraph apart into stripes.
       *
       * The dead `legal-document` class went with it: it had no rule anywhere
       * in the repository, in any sheet, and had not had one for as long as the
       * page has existed.
       */}
      <article className="mt-10 space-y-6 leading-prose text-cata-text">
        {blocks.map((block, index) => block.kind === "heading"
          ? <h2 key={`${index}-${block.text.slice(0, 24)}`} className="pt-8 font-display text-lg uppercase leading-tight tracking-flat text-cata-text first:pt-0">{block.text}</h2>
          : <p key={`${index}-${block.text.slice(0, 24)}`}>{block.text}</p>)}
      </article>
      <nav aria-label="Otros documentos públicos" className="mt-16 border-t border-cata-border pt-8">
        {/* A label for the link group, and no red rule: the rule is the
            document's kicker and it stays singular to keep meaning anything. */}
        <p className="mb-3 text-2xs font-extrabold uppercase tracking-caps text-ink-3-strong">Otros documentos públicos</p>
        <div className="flex flex-wrap gap-x-5 gap-y-2 text-sm font-semibold text-cata-red-dark underline underline-offset-4">
          <Link href="/terminos">Términos de uso</Link>
          <Link href="/privacidad">Aviso de privacidad</Link>
          <Link href="/permiso-imagen-fetm">Permiso público de imagen FETM</Link>
        </div>
      </nav>
    </div>
  );
}
