import { Abilities } from "@/components/landing/Abilities";
import { BigFooter } from "@/components/landing/BigFooter";
import { Commands } from "@/components/landing/Commands";
import { GetStarted } from "@/components/landing/GetStarted";
import { Hero } from "@/components/landing/Hero";
import { Paying } from "@/components/landing/Paying";
import { SessionReplay } from "@/components/landing/SessionReplay";
import { REPO_URL, SITE_DESCRIPTION, SITE_URL } from "@/lib/site";

// Tells search engines this page is about a software app
const structuredData = {
  "@context": "https://schema.org",
  "@type": "SoftwareApplication",
  name: "Nimbus",
  description: SITE_DESCRIPTION,
  url: SITE_URL,
  applicationCategory: "DeveloperApplication",
  operatingSystem: "Windows, macOS, Linux",
  license: "https://opensource.org/licenses/MIT",
  sameAs: [REPO_URL],
};

export default function Home() {
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData) }}
      />
      <main>
        <Hero />
        <SessionReplay />
        <Abilities />
        <Paying />
        <Commands />
        <GetStarted />
      </main>
      <BigFooter />
    </>
  );
}
