import type { Metadata } from "next";
import { publicPageMetadata } from "@/lib/seo";
import LegalDocumentPage from "../terminos/LegalDocumentPage";
import { legalBlocks, summary } from "./content";

export const metadata: Metadata = { title: "Aviso de privacidad", description: "Aviso de privacidad público de Cata Club, versión 1.0.", ...publicPageMetadata("/privacidad") };

const PHOTO = { src: "/landing/hero-community.jpg", alt: "Grupo de deportistas y entrenadores de Cata Club reunidos en la sala de entrenamiento.", position: "50% 70%" } as const;

export default function PrivacyPage(): React.ReactElement {
  return <LegalDocumentPage title="Aviso de privacidad de Cata Club" blocks={legalBlocks} summary={summary} photo={PHOTO} path="/privacidad" />;
}
