import type { Metadata } from "next";
import InfoPanel from "@/components/ui/InfoPanel";
import LegalDocumentPage from "../terminos/LegalDocumentPage";
import { legalBlocks } from "./content";

export const metadata: Metadata = { title: "Permiso público de imagen FETM", description: "Permiso público de difusión de imagen FETM, versión 1.0." };

/** The document is one paragraph long, so a card beside it says what it authorizes. */
function PermissionSummary(): React.ReactElement {
  return (
    <InfoPanel title="Qué autoriza este permiso">
      <p>La difusión de la imagen de la persona deportista por parte de la Federación Ecuatoriana de Tenis de Mesa.</p>
      <p>Las condiciones completas están en el documento de Difusión de Imagen de Deportistas FETM.</p>
    </InfoPanel>
  );
}

const PHOTO = {
  src: "/landing/hero-competition.jpg",
  alt: "Dos deportistas de Cata Club con la camiseta del club, de pie en la sala de competencia.",
  position: "50% 35%",
} as const;

export default function FETMImagePermissionPage(): React.ReactElement {
  return <LegalDocumentPage title="Permiso público de difusión de imagen FETM" blocks={legalBlocks} aside={<PermissionSummary />} photo={PHOTO} path="/permiso-imagen-fetm" />;
}
