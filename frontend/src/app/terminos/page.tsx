import type { Metadata } from "next";
import LegalDocumentPage from "./LegalDocumentPage";
import { legalBlocks } from "./content";

export const metadata: Metadata = { title: "Términos de uso", description: "Términos de uso públicos de Cata Club, versión 1.0." };

export default function TermsPage(): React.ReactElement {
  return <LegalDocumentPage title="Términos de uso de Cata Club" blocks={legalBlocks} />;
}
