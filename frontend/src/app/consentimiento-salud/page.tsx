import type { Metadata } from "next";
import { publicPageMetadata } from "@/lib/seo";
import LegalDocumentPage from "../terminos/LegalDocumentPage";
import { legalBlocks, summary } from "./content";

export const metadata: Metadata = { title: "Consentimiento de datos de salud", description: "Consentimiento para el tratamiento de datos de salud de Cata Club, versión 2.2.", ...publicPageMetadata("/consentimiento-salud") };

const PHOTO = { src: "/landing/hero-community.jpg", alt: "Grupo de deportistas y entrenadores de Cata Club reunidos en la sala de entrenamiento.", position: "50% 70%" } as const;

export default function HealthConsentPage(): React.ReactElement {
  return <LegalDocumentPage title="Consentimiento para el tratamiento de datos de salud" blocks={legalBlocks} summary={summary} photo={PHOTO} path="/consentimiento-salud" />;
}
