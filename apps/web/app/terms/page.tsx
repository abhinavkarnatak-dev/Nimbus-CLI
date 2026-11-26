import type { Metadata } from "next";
import { LongPage } from "@/components/LongPage";
import { CONTACT_URL } from "@/lib/site";

export const metadata: Metadata = {
  title: "Terms",
  description: "The rules for using Nimbus.",
};

export default function Terms() {
  return (
    <LongPage title="Terms" updated="27 November 2026">
      <p>By using Nimbus you agree to these terms.</p>

      <h2>What Nimbus is</h2>
      <p>
        Nimbus is an early, invite only AI agent for your terminal. It can read and change files and
        run commands on your computer. It starts in the folder you choose, but the commands it runs
        can reach anything your user account can.
      </p>

      <h2>Your responsibility</h2>
      <p>
        You decide where Nimbus runs and what you ask it to do. Review its changes, keep backups and
        use version control. You are responsible for what happens on your computer and in your
        projects while you use it.
      </p>

      <h2>Free credit</h2>
      <p>
        Invited accounts get a small amount of free credit. When it runs out you can add your own
        OpenAI key. The amount of free credit can change, and the free service can pause or stop at
        any time.
      </p>

      <h2>Fair use</h2>
      <ul>
        <li>Do not use Nimbus for anything illegal or harmful.</li>
        <li>Do not share your login or resell access.</li>
        <li>Do not try to get around the credit limits or attack the service.</li>
        <li>Follow the usage policies of OpenAI, whose models Nimbus uses.</li>
      </ul>
      <p>We may block accounts that break these rules.</p>

      <h2>Your own OpenAI key</h2>
      <p>When you use your own key, OpenAI bills you directly and its terms apply to that use.</p>

      <h2>No warranty</h2>
      <p>
        Nimbus is provided as it is, without any warranty. Models make mistakes. To the extent the
        law allows, we are not liable for any loss or damage from using it.
      </p>

      <h2>Contact</h2>
      <p>
        Questions about these terms? <a href={CONTACT_URL}>Contact us on GitHub</a>.
      </p>
    </LongPage>
  );
}
