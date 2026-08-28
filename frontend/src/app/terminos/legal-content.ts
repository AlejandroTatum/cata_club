/**
 * The shape a public legal document is written in.
 *
 * These documents used to be a flat `readonly string[]`, and `LegalDocumentPage`
 * decided which of those strings was a section heading by testing each one for
 * membership in a `Set` of seventeen literals it kept beside itself. That made
 * the outline a property of a list in a component rather than of the document,
 * with two consequences worth naming:
 *
 *  · Rewording a heading in a `content.ts` demoted it to a paragraph. No error,
 *    no failing test — the document just lost a level of the heading outline a
 *    screen reader navigates by, and read on as prose.
 *  · The set mixed the headings of all three documents together, so it also
 *    could not be read to learn the structure of any one of them.
 *
 * So structure is declared where the content is, once, by the document itself.
 * The two constructors below exist so a content file reads as the document it
 * transcribes — `heading("…")`, `paragraph("…")` — instead of as object
 * literals, and so a block can never be written without saying which it is.
 */

/** One block of a legal document: a section heading, or a paragraph of prose. */
export type LegalBlock =
  | { readonly kind: "heading"; readonly text: string }
  | { readonly kind: "paragraph"; readonly text: string };

/** A section heading. Renders as an `<h2>` inside the document outline. */
export function heading(text: string): LegalBlock {
  return { kind: "heading", text };
}

/** A paragraph of legal prose. Renders as a `<p>`. */
export function paragraph(text: string): LegalBlock {
  return { kind: "paragraph", text };
}
