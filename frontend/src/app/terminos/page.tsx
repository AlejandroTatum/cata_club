import type { Metadata } from "next";
import { publicPageMetadata } from "@/lib/seo";
import LegalDocumentPage from "./LegalDocumentPage";
import { legalBlocks, summary } from "./content";

export const metadata: Metadata = { title: "Términos de uso", description: "Términos de uso públicos de Cata Club, versión 1.0.", ...publicPageMetadata("/terminos") };

const PHOTO = { src: "/landing/vision-team-1329.jpg", alt: "Equipo de Cata Club con la camiseta del club, junto a sus entrenadores, en la sala de entrenamiento.", position: "50% 60%" } as const;

export default function TermsPage(): React.ReactElement {
  return <LegalDocumentPage title="Términos de uso de Cata Club" blocks={legalBlocks} summary={summary} photo={PHOTO} path="/terminos" />;
}
