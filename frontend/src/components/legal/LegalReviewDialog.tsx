/**
 * LegalReviewDialog — the in-flow legal review for the public enrolment
 * wizard (issue #1368).
 *
 * The grouped consent names three public documents, and until #1368 each
 * name was a link to its public page: following one unmounted the wizard and
 * discarded every entered field plus the consent decision itself. All three
 * names are triggers for THIS one dialog now, and the dialog renders the
 * SAME content modules the public pages publish — the `content.ts` files are
 * the single source of legal text, so a review from the wizard can never
 * drift from the document the visitor is actually accepting.
 *
 * ## Why a modal, and which kind
 *
 * Reading a legal document mid-wizard is exactly the "interruption plus
 * protected focus" case a modal exists for: the visitor must be able to
 * finish the read and land back where the decision is made, with nothing
 * behind it reachable. The mechanics (Escape, initial focus, the Tab cycle,
 * focus restored to the trigger) are `useModalFocusTrap`, the shared hook
 * `EmergencyCardDialog` proved — not a second hand-rolled copy.
 *
 * ## Visual language
 *
 * The chrome is the public page's, transcribed: the landing eyebrow (2px red
 * rule + uppercase wide-tracked label), the Graduate uppercase title, the
 * reading measure. Inside the panel the document title takes the dialog's
 * `aria-labelledby` heading (h2) and the document's own section headings
 * step down to h3 — the same outline discipline the public page keeps with
 * h1/h2, one level deeper.
 */

"use client";

import { useEffect, useRef, type ReactElement } from "react";
import Button from "@/components/ui/Button";
import { useModalFocusTrap } from "@/lib/focus-trap";
import { holdSmoothScroll } from "@/lib/smooth-scroll";
import type { LegalBlock } from "@/app/terminos/legal-content";
import { legalBlocks as terminosBlocks } from "@/app/terminos/content";
import { legalBlocks as privacyBlocks } from "@/app/privacidad/content";
import { legalBlocks as fetmBlocks } from "@/app/permiso-imagen-fetm/content";

export type LegalReviewDocumentId = "terminos" | "privacidad" | "permiso-imagen-fetm";

interface LegalReviewDocument {
  /** The title the public page publishes, reused as the dialog's name. */
  readonly title: string;
  /** The canonical public route, one click away without leaving the wizard. */
  readonly href: string;
  /** The document itself — imported, never copied. */
  readonly blocks: readonly LegalBlock[];
}

/**
 * The three documents the grouped consent covers. Titles are transcribed
 * from the three `page.tsx` files (which own them for metadata); the blocks
 * are THE public content modules, shared not duplicated.
 */
export const LEGAL_REVIEW_DOCUMENTS: Record<LegalReviewDocumentId, LegalReviewDocument> = {
  terminos: {
    title: "Términos de uso de Cata Club",
    href: "/terminos",
    blocks: terminosBlocks,
  },
  privacidad: {
    title: "Aviso de privacidad de Cata Club",
    href: "/privacidad",
    blocks: privacyBlocks,
  },
  "permiso-imagen-fetm": {
    title: "Permiso público de difusión de imagen FETM",
    href: "/permiso-imagen-fetm",
    blocks: fetmBlocks,
  },
};

/**
 * The one renderer for a legal document's blocks — the public pages and the
 * wizard's review share it, so a heading stays a heading and a paragraph
 * stays a paragraph in both places by construction.
 *
 * `headingLevel` is the caller's outline context: the public page sits under
 * an `<h1>` and uses h2; inside the dialog the document title is the h2, so
 * sections step down to h3. Every other class is identical — the dialog's
 * prose reads exactly like the page's.
 */
export function LegalDocumentProse({
  blocks,
  headingLevel = 2,
  className,
}: {
  blocks: readonly LegalBlock[];
  headingLevel?: 2 | 3;
  className?: string;
}): ReactElement {
  const HeadingTag = (`h${headingLevel}` as const) satisfies "h2" | "h3";
  return (
    <article className={className}>
      {blocks.map((block, index) =>
        block.kind === "heading" ? (
          <HeadingTag
            key={`${index}-${block.text.slice(0, 24)}`}
            className="pt-8 font-display text-lg uppercase leading-tight tracking-flat text-cata-text first:pt-0"
          >
            {block.text}
          </HeadingTag>
        ) : (
          <p key={`${index}-${block.text.slice(0, 24)}`}>{block.text}</p>
        ),
      )}
    </article>
  );
}

export interface LegalReviewDialogProps {
  /** Which document is open, or `null` for closed. The caller owns the state. */
  documentId: LegalReviewDocumentId | null;
  onClose: () => void;
}

export default function LegalReviewDialog({
  documentId,
  onClose,
}: LegalReviewDialogProps): ReactElement | null {
  const panelRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const document_ = documentId === null ? null : LEGAL_REVIEW_DOCUMENTS[documentId];

  // Focus lands on Cerrar when the dialog opens, Escape closes it, Tab and
  // Shift+Tab cycle the panel's controls, and focus returns to the trigger
  // that opened the review.
  useModalFocusTrap({
    open: document_ !== null,
    onClose,
    panelRef,
    initialFocusRef: closeButtonRef,
  });

  // Stop the page scrolling behind the dialog, compose-safely: the body's
  // previous value is restored rather than cleared, and the smooth-scroll
  // engine (a no-op on the wizard, which mounts no Lenis) is held through
  // its own documented lock — the same two locks ChatWidget keeps.
  useEffect((): undefined | (() => void) => {
    if (document_ === null) return undefined;
    const { body } = document;
    const previous = body.style.overflow;
    body.style.overflow = "hidden";
    const releaseSmoothScroll = holdSmoothScroll();
    return (): void => {
      releaseSmoothScroll();
      body.style.overflow = previous;
    };
  }, [document_]);

  if (document_ === null) return null;

  return (
    // A phone reads a long document from the bottom edge up, so under `sm`
    // the panel docks to the bottom; from `sm` it floats centred like every
    // other dialog in the product.
    <div className="fixed inset-0 z-50 flex items-end justify-center px-4 pt-4 sm:items-center sm:pb-4">
      {/*
       * The backdrop is a SIBLING of the panel, not its wrapper — the shape
       * EmergencyCardDialog settled (Sonar S1082): a click inside the panel
       * has no path to a close handler here.
       */}
      <div
        aria-hidden="true"
        data-testid="legal-review-backdrop"
        onClick={onClose}
        className="absolute inset-0 bg-cata-black/40"
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="legal-review-title"
        className="card relative flex max-h-[85dvh] w-full max-w-measure flex-col overflow-hidden p-0 shadow-elevated"
      >
        {/*
         * The public page's heading group, transcribed: red rule, uppercase
         * wide-tracked label, then the Graduate title. `text-cata-red-dark`
         * on the label because the fill red as TEXT misses AA — the same
         * measurement the page already recorded.
         */}
        <header className="flex-none border-b border-line px-page pb-section pt-page">
          <p className="mb-4 flex items-center gap-3 text-xs font-extrabold uppercase tracking-caps-wide text-cata-red-dark">
            <span aria-hidden="true" className="h-0.5 w-8 flex-none bg-cata-red" />
            Documento público
          </p>
          <h2
            id="legal-review-title"
            className="text-balance font-display text-lg uppercase leading-crisp tracking-flat text-cata-text sm:text-xl"
          >
            {document_.title}
          </h2>
        </header>

        {/*
         * `min-h-0` is what lets the body actually shrink inside the flex
         * column: without it a long document pushes the footer off-screen
         * instead of scrolling. `overscroll-contain` keeps the scroll inside
         * the document once it ends.
         */}
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-page py-section">
          <LegalDocumentProse
            blocks={document_.blocks}
            headingLevel={3}
            className="space-y-6 leading-prose text-cata-text"
          />
        </div>

        <footer className="flex flex-none flex-wrap items-center justify-between gap-3 border-t border-line bg-sunken px-page py-section">
          <a
            href={document_.href}
            target="_blank"
            rel="noreferrer"
            className="text-sm font-semibold text-cata-red-dark underline underline-offset-4 hover:text-cata-red"
          >
            Ver documento completo
            <span className="sr-only"> (abre en una pestaña nueva)</span>
          </a>
          {/*
           * Dark, not primary: closing a reader is an emphatic exit, and red
           * stays reserved for the screen's one action — "Confirmar
           * inscripción", behind this overlay.
           */}
          <Button ref={closeButtonRef} variant="dark" onClick={onClose}>
            Cerrar
          </Button>
        </footer>
      </div>
    </div>
  );
}
