import { Abilities } from "@/components/landing/Abilities";
import { BigFooter } from "@/components/landing/BigFooter";
import { Commands } from "@/components/landing/Commands";
import { GetStarted } from "@/components/landing/GetStarted";
import { Hero } from "@/components/landing/Hero";
import { Paying } from "@/components/landing/Paying";
import { SessionReplay } from "@/components/landing/SessionReplay";

export default function Home() {
  return (
    <>
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
