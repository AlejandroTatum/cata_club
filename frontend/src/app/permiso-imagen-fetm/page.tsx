import type { Metadata } from "next";
import InfoPanel from "@/components/ui/InfoPanel";
import LegalDocumentPage from "../terminos/LegalDocumentPage";
import { legalBlocks } from "./content";

export const metadata: Metadata = { title: "Permiso público de imagen FETM", description: "Permiso público de difusión de imagen FETM, versión 1.0." };

/** The document is one paragraph long, so its rail says what it authorizes. */
function PermissionSummary(): React.ReactElement {
  return (
    <div className="grid content-start gap-page">
      <InfoPanel title="Qué autoriza este permiso">
        <p>La difusión de la imagen de la persona deportista por parte de la Federación Ecuatoriana de Tenis de Mesa.</p>
        <p>Las condiciones completas están en el documento de Difusión de Imagen de Deportistas FETM.</p>
        <p>Versión 1.0, vigente desde el 27 de agosto de 2026.</p>
      </InfoPanel>
    </div>
  );
}

export default function FETMImagePermissionPage(): React.ReactElement {
  return <LegalDocumentPage title="Permiso público de difusión de imagen FETM" blocks={legalBlocks} aside={<PermissionSummary />} path="/permiso-imagen-fetm" />;
}
