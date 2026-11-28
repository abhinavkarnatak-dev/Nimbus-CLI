import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/site";

// Built once into sitemap.xml; login result pages stay out
export const dynamic = "force-static";

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    { url: SITE_URL, lastModified: new Date(), changeFrequency: "weekly", priority: 1 },
    {
      url: `${SITE_URL}/docs`,
      lastModified: new Date("2026-11-28"),
      changeFrequency: "monthly",
      priority: 0.8,
    },
    {
      url: `${SITE_URL}/privacy`,
      lastModified: new Date("2026-11-27"),
      changeFrequency: "yearly",
      priority: 0.3,
    },
    {
      url: `${SITE_URL}/terms`,
      lastModified: new Date("2026-11-28"),
      changeFrequency: "yearly",
      priority: 0.3,
    },
  ];
}
