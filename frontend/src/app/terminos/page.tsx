import type { Metadata } from "next";
import LegalDocumentPage from "./LegalDocumentPage";
import { legalBlocks, summary } from "./content";

export const metadata: Metadata = { title: "Términos de uso", description: "Términos de uso públicos de Cata Club, versión 1.0." };

const PHOTO = { src: "/landing/photo-podium-away.jpeg", alt: "Deportistas del club en el podio de un torneo de tenis de mesa, con sus medallas.", position: "50% 35%" } as const;

export default function TermsPage(): React.ReactElement {
  return <LegalDocumentPage title="Términos de uso de Cata Club" blocks={legalBlocks} summary={summary} photo={PHOTO} path="/terminos" />;
}
