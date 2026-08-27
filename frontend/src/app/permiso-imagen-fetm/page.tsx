import type { Metadata } from "next";
import LegalDocumentPage from "../terminos/LegalDocumentPage";
import { legalParagraphs } from "./content";

export const metadata: Metadata = { title: "Permiso público de imagen FETM", description: "Permiso público de difusión de imagen FETM, versión 1.0." };

export default function FETMImagePermissionPage(): React.ReactElement {
  return <LegalDocumentPage title="Permiso público de difusión de imagen FETM" paragraphs={legalParagraphs} />;
}
