import { resolveSiteUrl } from "@/lib/seo";
import { buildSportsClubJsonLd, serializeJsonLd } from "@/lib/seo-structured-data";

/**
 * JSON-LD for the landing. Renders nothing when the deployment has no
 * canonical URL (non-production hosts): structured data pointing at a
 * guessed origin would be worse than none.
 */
export default function StructuredData(): React.ReactElement | null {
  const siteUrl = resolveSiteUrl();
  if (!siteUrl) return null;
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: serializeJsonLd(buildSportsClubJsonLd(siteUrl)) }}
    />
  );
}
