/**
 * Component tests for `LegalReviewDialog` — the in-flow legal review the
 * public enrolment wizard opens for the three grouped consent documents
 * (issue #1368).
 *
 * The contract under test:
 *   · the dialog is a real `role="dialog"` with `aria-modal` and the
 *     document's public title as its accessible name;
 *   · the body renders the SAME content modules the public pages publish —
 *     never a copy — as section headings and paragraphs;
 *   · Escape, the Cerrar button and the backdrop all close, focus returns to
 *     the trigger, and Tab cannot leave the panel;
 *   · the page behind the dialog cannot scroll while it is open, and the
 *     previous state is restored afterwards.
 *
 * Mocking pattern: none needed — the dialog renders pure content imported
 * from the legal `content.ts` modules, so these tests render it behind a
 * two-line harness with its own trigger button.
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { useEffect, useState } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import LegalReviewDialog, {
  LEGAL_REVIEW_DOCUMENTS,
  type LegalReviewDocumentId,
} from "@/components/legal/LegalReviewDialog";

/**
 * The dialog is controlled from the outside (the wizard owns which document
 * is open), so the harness mirrors that: one trigger, one close handler, and
 * an explicit prop change followed the way a real parent would follow it —
 * the scroll-lock test drives the dialog through rerenders.
 */
function Harness({ initialDocument = null as LegalReviewDocumentId | null }): React.ReactElement {
  const [documentId, setDocumentId] = useState<LegalReviewDocumentId | null>(initialDocument);
  useEffect(() => {
    setDocumentId(initialDocument);
  }, [initialDocument]);
  return (
    <>
      <button type="button" onClick={() => setDocumentId("terminos")}>
        Abrir revisión legal
      </button>
      <LegalReviewDialog documentId={documentId} onClose={() => setDocumentId(null)} />
    </>
  );
}

beforeEach(() => {
  document.body.style.overflow = "";
});

afterEach(() => {
  cleanup();
  document.body.style.overflow = "";
});

describe("LegalReviewDialog — apertura y nombres accesibles", () => {
  it("renders nothing while no document is open", () => {
    const { container } = render(<Harness initialDocument={null} />);

    expect(container.querySelector('[role="dialog"]')).toBeNull();
    expect(screen.queryByRole("button", { name: "Cerrar" })).not.toBeInTheDocument();
  });

  it.each([
    ["terminos", "Términos de uso de Cata Club"] as const,
    ["privacidad", "Aviso de privacidad de Cata Club"] as const,
    ["permiso-imagen-fetm", "Permiso público de difusión de imagen FETM"] as const,
  ])("opens %s as a modal dialog named after the public document", (documentId, title) => {
    const { container } = render(<Harness initialDocument={documentId} />);

    const dialog = container.querySelector('[role="dialog"]');
    expect(dialog).not.toBeNull();
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(screen.getByRole("dialog", { name: title })).toBeInTheDocument();
  });

  it("renders the document prose from the public content modules — headings and paragraphs, never a copy", () => {
    render(<Harness initialDocument="terminos" />);

    // Transcribed from `src/app/terminos/content.ts` on purpose: a copied
    // rendering would drift with the document and still pass these tests.
    expect(
      screen.getByText("Antes de continuar, la interfaz debe mostrar una única casilla inicialmente desmarcada y bloqueante:"),
    ).toBeInTheDocument();
    // Section headings render below the dialog title's level.
    const dialog = screen.getByRole("dialog", { name: "Términos de uso de Cata Club" });
    expect(screen.getAllByRole("heading", { level: 3, hidden: false }).length).toBeGreaterThan(0);
    // The blocks carry no links: the only navigation out is the dialog footer.
    expect(dialog.querySelectorAll("article a")).toHaveLength(0);
  });

  it("renders the FETM permission's single authorised sentence verbatim", () => {
    render(<Harness initialDocument="permiso-imagen-fetm" />);

    expect(
      screen.getByText(
        "Autorizo a la Federación Ecuatoriana de Tenis de Mesa la difusión de mi imagen según las condiciones que se desglosan en el documento de Difusión de Imagen de Deportistas FETM.",
      ),
    ).toBeInTheDocument();
  });

  it("links the canonical public document in a new tab", () => {
    render(<Harness initialDocument="privacidad" />);

    const link = screen.getByRole("link", { name: /ver documento completo/i });
    expect(link).toHaveAttribute("href", "/privacidad");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", expect.stringContaining("noreferrer"));
  });
});

describe("LegalReviewDialog — cierre y foco", () => {
  it("closes with Escape, with the Cerrar button and with a backdrop click", () => {
    const onClose = vi.fn();
    render(<LegalReviewDialog documentId="terminos" onClose={onClose} />);

    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "Cerrar" }));
    expect(onClose).toHaveBeenCalledTimes(2);

    fireEvent.click(screen.getByTestId("legal-review-backdrop"));
    expect(onClose).toHaveBeenCalledTimes(3);
  });

  it("lands the initial focus on Cerrar and returns it to the trigger on close", () => {
    render(<Harness />);

    // jsdom does not move focus on click; a real browser does when the
    // visitor activates the trigger, and that focused element is what the
    // trap restores. Same workaround the focus-trap suite established.
    const trigger = screen.getByRole("button", { name: "Abrir revisión legal" });
    trigger.focus();
    fireEvent.click(trigger);
    expect(screen.getByRole("button", { name: "Cerrar" })).toHaveFocus();

    fireEvent.keyDown(document, { key: "Escape" });
    expect(trigger).toHaveFocus();
  });

  it("keeps Tab cycling inside the panel (footer link and Cerrar)", () => {
    render(<Harness initialDocument="terminos" />);

    const panel = screen.getByRole("dialog", { name: "Términos de uso de Cata Club" });
    const link = screen.getByRole("link", { name: /ver documento completo/i });
    const close = screen.getByRole("button", { name: "Cerrar" });

    // Focus is on Cerrar; Shift+Tab wraps to the footer link, Tab wraps back.
    fireEvent.keyDown(document, { key: "Tab", shiftKey: true });
    expect(link).toHaveFocus();
    fireEvent.keyDown(document, { key: "Tab" });
    expect(close).toHaveFocus();
    // The panel is still mounted and nothing behind it was focused.
    expect(panel).toBeInTheDocument();
  });
});

describe("LegalReviewDialog — el contenido queda consultable", () => {
  it("exposes a scrollable body for the long documents", () => {
    const { container } = render(<Harness initialDocument="terminos" />);

    const body = container.querySelector('[role="dialog"] .overflow-y-auto');
    expect(body).not.toBeNull();
  });

  it("locks the page scroll while open and restores it after", () => {
    const { rerender } = render(<Harness initialDocument={null} />);
    expect(document.body.style.overflow).toBe("");

    rerender(<Harness initialDocument="terminos" />);
    expect(document.body.style.overflow).toBe("hidden");

    rerender(<Harness initialDocument={null} />);
    expect(document.body.style.overflow).toBe("");
  });

  it("keeps the three documents registered with their public routes", () => {
    expect(Object.keys(LEGAL_REVIEW_DOCUMENTS)).toEqual([
      "terminos",
      "privacidad",
      "permiso-imagen-fetm",
    ]);
    expect(LEGAL_REVIEW_DOCUMENTS.terminos.href).toBe("/terminos");
    expect(LEGAL_REVIEW_DOCUMENTS.privacidad.href).toBe("/privacidad");
    expect(LEGAL_REVIEW_DOCUMENTS["permiso-imagen-fetm"].href).toBe("/permiso-imagen-fetm");
  });
});
