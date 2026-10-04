import { blockAnchor, LEGAL_EFFECTIVE_DATE, LEGAL_VERSION, type LegalBlock } from "./legal-content";
import LegalToc from "./LegalToc";
import LegalPhoto, { type LegalPhotoSource } from "./LegalPhoto";
import { LegalQuestions, LegalRelated, SIDE_TITLE } from "./LegalSideCards";
import { cn } from "@/components/ui/cn";
import { PAGE_RAIL } from "@/components/ui/layout";

/**
 * From `xl` the page leaves the layout wrapper's 88rem cap (`.app-main` in the
 * root layout, which this page cannot edit) and takes up to 1600px, so a wide
 * monitor gets columns instead of grey margins. The `7rem` is the wrapper's
 * own 48px side padding twice plus a classic scrollbar, which keeps the page
 * aligned with the header's content.
 */
const BREAKOUT = "xl:relative xl:left-1/2 xl:w-[min(1600px,calc(100vw-7rem))] xl:-translate-x-1/2";

/**
 * A pinned rail. The whole rail is the sticky element and it scrolls inside
 * itself when the viewport is shorter than it, so a rail never hides its own
 * bottom. `p-2 -m-2` keeps the cards' shadows out of the scroll clip.
 */
const STICKY_RAIL = "max-xl:contents xl:sticky xl:top-24 xl:-m-2 xl:grid xl:max-h-[calc(100dvh-7rem)] xl:content-start xl:gap-page xl:overflow-y-auto xl:p-2";

interface LegalDocumentPageProps {
  title: string;
  blocks: readonly LegalBlock[];
  /**
   * Optional side summary. A document too short to need a contents list
   * passes one: the page is then composed as a short, complete page (photo
   * beside the statement, a row of cards below) instead of a narrow column.
   */
  aside?: React.ReactNode;
  /** Three to five key points, shown under "En resumen" in the right rail. */
  summary?: readonly string[];
  /** The document's own route, marked as current in the document links. */
  path?: string;
  /** A club photograph: closes the right rail of a long document, leads a short one. */
  photo?: LegalPhotoSource;
}

/**
 * The surface behind `/terminos`, the single public legal document.
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
export default function LegalDocumentPage({ title, blocks, aside, summary, path, photo }: LegalDocumentPageProps): React.ReactElement {
  const sections = blocks.flatMap((block, index) => (block.kind === "heading" ? [{ id: blockAnchor(block, index), label: block.text }] : []));
  const hasToc = sections.length > 1;

  const header = (
    <div className={hasToc ? "order-1 max-lg:card max-lg:p-6" : undefined}>
      {/* The landing's eyebrow: a red rule fill, a `cata-red-dark` label (AA as text). */}
      <p className="mb-4 flex items-center gap-3 text-xs font-extrabold uppercase tracking-caps-wide text-cata-red-dark">
        <span aria-hidden="true" className="h-0.5 w-8 flex-none bg-cata-red" />
        Documento público
      </p>
      <h1 className="text-balance font-display text-xl uppercase leading-crisp tracking-flat text-cata-text sm:text-2xl">{title}</h1>
      {/* The consent record keeps which version was accepted, so these are part of the document. */}
      <dl className="mt-3 flex flex-wrap gap-x-10 gap-y-1">
        <div className="flex items-baseline gap-2">
          <dt className="text-2xs font-extrabold uppercase tracking-caps text-ink-3-strong">Versión</dt>
          <dd className="text-sm font-semibold text-cata-text">{LEGAL_VERSION}</dd>
        </div>
        <div className="flex items-baseline gap-2">
          <dt className="text-2xs font-extrabold uppercase tracking-caps text-ink-3-strong">Vigente desde</dt>
          <dd className="text-sm font-semibold text-cata-text">{LEGAL_EFFECTIVE_DATE}</dd>
        </div>
      </dl>
      <div aria-hidden="true" className="mt-3 h-px bg-cata-border" />
    </div>
  );

  /*
   * Same classes as the shared `LegalDocumentProse`, plus the anchor id each
   * heading needs for the contents list; that renderer is also the wizard
   * dialog's and has no ids to give.
   */
  const article = (
    <article className={cn("space-y-4 leading-snug text-cata-text", hasToc ? "order-3 mt-8 max-lg:card max-lg:mt-0 max-lg:p-6" : "mt-6 text-lg sm:text-xl xl:text-2xl 2xl:text-5xl")}>
      {blocks.map((block, index) =>
        block.kind === "heading" ? (
          <h2
            key={`${index}-${block.text.slice(0, 24)}`}
            id={blockAnchor(block, index)}
            className="scroll-mt-24 pt-8 font-display text-lg uppercase leading-tight tracking-flat text-cata-text first:pt-0"
          >
            {block.text}
          </h2>
        ) : (
          <p key={`${index}-${block.text.slice(0, 24)}`}>{block.text}</p>
        ),
      )}
    </article>
  );

  /*
   * A short document, composed as a short page. The photo spans the height of
   * the statement and the four cards beside it (its own grid cell, the only
   * thing that takes a neighbour's height); every card is content-height and no
   * min-height holds the page open. The footer follows the content.
   */
  const shortDocument = (
    <div className="grid gap-page lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
      {photo !== undefined && <LegalPhoto photo={photo} className="aspect-[4/3] lg:aspect-auto" sizes="(min-width: 1024px) 40vw, 100vw" />}
      <div className="grid min-w-0 content-start gap-page">
        {/* A DIV, not a `<header>`: the institutional bar is the page's one banner. */}
        <div className="card p-6 sm:p-10 2xl:p-20">
          {header}
          {article}
        </div>
        <div className="grid items-start gap-page sm:grid-cols-2">
          {aside}
          <section aria-labelledby="preguntas-permiso" className="card p-5">
            <h2 id="preguntas-permiso" className={cn(SIDE_TITLE, "mb-2")}>
              Preguntas sobre este permiso
            </h2>
            <p className="text-sm leading-prose text-ink-2">
              Si tiene dudas sobre el alcance de la difusión de imagen, consulte con la persona entrenadora o con la administración del club antes de aceptar el permiso.
            </p>
          </section>
          <LegalRelated path={path} />
          <LegalQuestions />
        </div>
      </div>
    </div>
  );

  /*
   * A long document: two pinned rails around the text. The left rail holds the
   * way through the document (contents, other documents, contact), the right
   * rail what it says (summary, version) and a photograph. Both are sticky and
   * about the same height, so neither reads as a strip left empty beside the
   * text. Below `xl` the rails dissolve (`contents`): on a phone the title comes first, then
   * the summary, then the article and the reference cards (VIS-07).
   */
  const longDocument = (
    <>
      <div className={cn(STICKY_RAIL, "xl:col-start-1 xl:row-start-1")}>
        <div className="hidden xl:block">
          <LegalToc items={sections} />
        </div>
        <LegalRelated path={path} className="order-4 lg:max-xl:col-start-2" />
        <LegalQuestions className="order-5 lg:max-xl:col-start-2" />
      </div>
      {/* Below `lg` this wrapper dissolves so the title card, the summary and the article each take their own `order-*` slot (VIS-07). */}
      <div className="min-w-0 max-lg:contents lg:card lg:col-start-1 lg:row-span-5 lg:row-start-1 lg:p-10 xl:col-start-2 xl:row-span-1">
        {header}
        {article}
      </div>
      <div className={cn(STICKY_RAIL, "xl:col-start-3 xl:row-start-1")}>
        {summary !== undefined && (
          <section aria-labelledby="legal-resumen" className="card order-2 grid gap-3 p-5 lg:max-xl:col-start-2">
            <h2 id="legal-resumen" className={SIDE_TITLE}>
              En resumen
            </h2>
            <ul className="grid list-disc gap-2 pl-5 text-sm leading-prose text-ink-2">
              {summary.map((point) => (
                <li key={point}>{point}</li>
              ))}
            </ul>
          </section>
        )}
        <section aria-label="Versión y vigencia" className="card order-3 p-5 text-sm text-ink-2 lg:max-xl:col-start-2">
          <p className="mb-1 text-2xs font-extrabold uppercase tracking-caps text-ink-3-strong">Versión y vigencia</p>
          <p>Versión {LEGAL_VERSION}, vigente desde el {LEGAL_EFFECTIVE_DATE}.</p>
        </section>
        {photo !== undefined && <LegalPhoto photo={photo} className="order-3 hidden aspect-[16/10] lg:max-xl:col-start-2 lg:block" sizes="(min-width: 1280px) 380px, 340px" />}
      </div>
    </>
  );

  return (
    <main id="contenido" className={cn("w-full text-base", BREAKOUT, hasToc ? cn(PAGE_RAIL, "xl:grid-cols-[minmax(232px,260px)_minmax(0,1fr)_minmax(300px,380px)]") : "grid gap-page")}>
      {hasToc ? longDocument : shortDocument}
    </main>
  );
}
