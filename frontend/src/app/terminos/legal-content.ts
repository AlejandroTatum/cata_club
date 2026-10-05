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
  | { readonly kind: "heading"; readonly text: string; readonly id?: string }
  | { readonly kind: "paragraph"; readonly text: string };

/**
 * A section heading. Renders as an `<h2>` inside the document outline. An
 * explicit `id` pins the anchor (the privacy chapter answers to `#privacidad`
 * so old links and the footer can point at it); without one it is derived.
 */
export function heading(text: string, id?: string): LegalBlock {
  return id === undefined ? { kind: "heading", text } : { kind: "heading", text, id };
}

/** The version and effective date every public legal document publishes. */
export const LEGAL_VERSION = "2.3";
export const LEGAL_EFFECTIVE_DATE = "4 de octubre de 2026";

/** The anchor of a heading block: its pinned id, or the one derived from its text. */
export function blockAnchor(block: Extract<LegalBlock, { kind: "heading" }>, index: number): string {
  return block.id ?? sectionId(block.text, index);
}

/** A paragraph of legal prose. Renders as a `<p>`. */
export function paragraph(text: string): LegalBlock {
  return { kind: "paragraph", text };
}

/**
 * The anchor a section heading answers to. It is derived from the heading text
 * (accents folded, punctuation dropped) so the contents list and the heading
 * agree without either keeping a second list; the index prefix keeps two
 * headings with the same wording from sharing an id.
 */
export function sectionId(text: string, index: number): string {
  const slug = text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `${slug}-${index + 1}`;
}
