import type { Metadata } from "next";
import LegalDocumentPage from "../terminos/LegalDocumentPage";
import { legalBlocks, summary } from "./content";

export const metadata: Metadata = { title: "Aviso de privacidad", description: "Aviso de privacidad público de Cata Club, versión 1.0." };

const PHOTO = { src: "/landing/photo-first-medals.jpeg", alt: "Entrenadora con tres niñas del club mostrando sus medallas tras un torneo.", position: "50% 30%" } as const;

export default function PrivacyPage(): React.ReactElement {
  return <LegalDocumentPage title="Aviso de privacidad de Cata Club" blocks={legalBlocks} summary={summary} photo={PHOTO} path="/privacidad" />;
}
