import Link from "next/link";

const SECTION_HEADINGS = new Set([
  "Objetivo y alcance",
  "Cuenta y responsabilidades",
  "Uso aceptable",
  "Pagos y comprobantes",
  "Seguridad, suspensión y cambios",
  "Contacto y revocación",
  "Interacción de aceptación agrupada",
  "Propósito y alcance",
  "Categorías de información",
  "Finalidades operativas",
  "Acceso y proveedores",
  "Seguridad e incidentes",
  "Conservación",
  "Derechos, consultas y revocación",
  "Menores y representantes",
  "Aceptación, versiones y auditoría",
  "Finalidad",
]);

interface LegalDocumentPageProps {
  title: string;
  paragraphs: readonly string[];
}

export default function LegalDocumentPage({ title, paragraphs }: LegalDocumentPageProps): React.ReactElement {
  return (
    <div id="contenido" className="mx-auto w-full max-w-4xl py-8 sm:py-12">
      <Link href="/" className="mb-8 inline-flex text-sm font-semibold text-cata-red underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-4">
        Volver a Cata Club
      </Link>
      <header className="border-b border-cata-border pb-8">
        <p className="mb-3 text-xs font-bold uppercase tracking-widest text-cata-red">Documento público</p>
        <h1 className="max-w-3xl text-3xl font-bold tracking-tight text-cata-text sm:text-5xl">{title}</h1>
        <dl className="mt-6 grid gap-3 text-sm text-cata-muted sm:grid-cols-2">
          <div><dt className="font-semibold text-cata-text">Versión</dt><dd>1.0</dd></div>
          <div><dt className="font-semibold text-cata-text">Vigente desde</dt><dd>27 de agosto de 2026</dd></div>
        </dl>
      </header>
      <article className="legal-document mt-10 space-y-6 text-base leading-8 text-cata-text">
        {paragraphs.map((paragraph, index) => SECTION_HEADINGS.has(paragraph)
          ? <h2 key={`${index}-${paragraph}`} className="pt-5 text-xl font-bold leading-tight text-cata-text sm:text-2xl">{paragraph}</h2>
          : <p key={`${index}-${paragraph.slice(0, 24)}`}>{paragraph}</p>)}
      </article>
      <nav aria-label="Otros documentos públicos" className="mt-12 border-t border-cata-border pt-6">
        <p className="mb-3 text-sm font-semibold text-cata-text">Otros documentos públicos</p>
        <div className="flex flex-wrap gap-x-5 gap-y-2 text-sm text-cata-red underline underline-offset-4">
          <Link href="/terminos">Términos de uso</Link>
          <Link href="/privacidad">Aviso de privacidad</Link>
          <Link href="/permiso-imagen-fetm">Permiso público de imagen FETM</Link>
        </div>
      </nav>
    </div>
  );
}
