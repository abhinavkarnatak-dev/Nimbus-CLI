import type { MetadataRoute } from "next";
import { SITE_DESCRIPTION, SITE_TITLE } from "@/lib/site";

// Built once into manifest.webmanifest
export const dynamic = "force-static";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: SITE_TITLE,
    short_name: "Nimbus",
    description: SITE_DESCRIPTION,
    start_url: "/",
    display: "standalone",
    background_color: "#dce3e8",
    theme_color: "#dce3e8",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml" },
    ],
  };
}
