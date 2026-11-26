import "@fontsource/commit-mono/400.css";
import "@fontsource/commit-mono/700.css";
import "lenis/dist/lenis.css";
import "./globals.css";
import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { Cursor } from "@/components/motion/Cursor";
import { SmoothScroll } from "@/components/motion/SmoothScroll";
import { SITE_URL } from "@/lib/site";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: { default: "Nimbus", template: "%s - Nimbus" },
  description:
    "An AI agent that lives in your terminal. Ask it anything: it searches the web, works through your files, runs commands and writes the code.",
  openGraph: { type: "website", siteName: "Nimbus", url: SITE_URL },
  twitter: { card: "summary_large_image" },
};

export const viewport: Viewport = {
  themeColor: "#dce3e8",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://api.fontshare.com" />
        <link rel="preconnect" href="https://cdn.fontshare.com" crossOrigin="" />
        {/* Fontshare license allows its CDN, not files in a public repo */}
        <link
          rel="stylesheet"
          href="https://api.fontshare.com/v2/css?f[]=sentient@1,2&display=swap"
        />
      </head>
      <body>
        <SmoothScroll />
        <Cursor />
        {children}
      </body>
    </html>
  );
}
