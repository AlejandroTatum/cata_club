import type { Metadata } from "next";
import { publicPageMetadata } from "@/lib/seo";
import LegalDocumentPage from "../terminos/LegalDocumentPage";
import { legalBlocks, summary } from "./content";

export const metadata: Metadata = { title: "Permiso de uso de imagen", description: "Permiso de uso de imagen de Cata Club y de la FETM, versión 2.2.", ...publicPageMetadata("/permiso-imagen-fetm") };

const PHOTO = {
  src: "/landing/hero-competition.jpg",
  alt: "Dos deportistas de Cata Club con la camiseta del club, de pie en la sala de competencia.",
  position: "50% 35%",
} as const;

export default function ImagePermissionPage(): React.ReactElement {
  return <LegalDocumentPage title="Permiso de uso de imagen" blocks={legalBlocks} summary={summary} photo={PHOTO} path="/permiso-imagen-fetm" />;
}
