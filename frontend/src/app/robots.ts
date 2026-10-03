import type { MetadataRoute } from "next";
import { buildRobots } from "@/lib/seo";

// Read at request time: the same image serves production and non-production.
export const dynamic = "force-dynamic";

export default function robots(): MetadataRoute.Robots {
  return buildRobots();
}
