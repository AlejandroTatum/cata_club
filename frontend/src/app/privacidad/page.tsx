import type { Metadata } from "next";
import LegalDocumentPage from "../terminos/LegalDocumentPage";
import { legalParagraphs } from "./content";

export const metadata: Metadata = { title: "Aviso de privacidad", description: "Aviso de privacidad público de Cata Club, versión 1.0." };

export default function PrivacyPage(): React.ReactElement {
  return <LegalDocumentPage title="Aviso de privacidad de Cata Club" paragraphs={legalParagraphs} />;
}
