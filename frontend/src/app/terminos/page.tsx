import type { Metadata } from "next";
import { publicPageMetadata } from "@/lib/seo";
import LegalDocumentPage from "./LegalDocumentPage";
import { legalBlocks, summary } from "./content";

export const metadata: Metadata = { title: "Términos, condiciones y acuerdo de responsabilidad", description: "Términos, condiciones y acuerdo de responsabilidad de Cata Club, con su aviso de privacidad, versión 2.2.", ...publicPageMetadata("/terminos") };

const PHOTO = { src: "/landing/vision-team-1329.jpg", alt: "Equipo de Cata Club con la camiseta del club, junto a sus entrenadores, en la sala de entrenamiento.", position: "50% 60%" } as const;

export default function TermsPage(): React.ReactElement {
  return <LegalDocumentPage title="Términos, condiciones y acuerdo de responsabilidad de Cata Club" blocks={legalBlocks} summary={summary} photo={PHOTO} path="/terminos" />;
}
