import type { Metadata } from "next";
import { LongPage } from "@/components/LongPage";
import { CONTACT_URL, OG_IMAGE } from "@/lib/site";

const description = "What Nimbus collects, why, and who it is shared with.";

export const metadata: Metadata = {
  title: "Privacy",
  description,
  alternates: { canonical: "/privacy" },
  openGraph: {
    type: "website",
    images: [OG_IMAGE],
    siteName: "Nimbus",
    url: "/privacy",
    title: "Privacy - Nimbus",
    description,
  },
  twitter: {
    card: "summary_large_image",
    images: [OG_IMAGE],
    title: "Privacy - Nimbus",
    description,
  },
};

export default function Privacy() {
  return (
    <LongPage title="Privacy" updated="27 November 2026">
      <p>
        Nimbus is an AI agent that runs in your terminal. This page explains what it collects when
        you use it, why, and who else sees it.
      </p>

      <h2>When you log in with Google</h2>
      <p>
        We receive your email address, your name and your Google account ID. We use them to know who
        you are, to check your invite and to keep track of your free credit. We do not get your
        Google password or access to anything else in your Google account.
      </p>

      <h2>When you use Nimbus credit</h2>
      <p>
        Your messages, and the files and command output Nimbus works with, pass through our server
        to OpenAI so the model can answer. We do not store them. For each model call we keep the
        model name, the number of tokens, the cost, how long it took and an ID for the session, so
        we can count your credit and keep the service running.
      </p>

      <h2>When Nimbus searches the web</h2>
      <p>
        The search words Nimbus writes are sent through our server to Tavily, our search provider.
        We keep only that a search happened and what it cost, not the words.
      </p>

      <h2>When you use your own OpenAI key</h2>
      <p>
        Your key is saved on your computer, in your system keychain when one is available. Model
        calls then go straight from your computer to OpenAI and never through our server. Web
        searches still go through our server as above.
      </p>

      <h2>On your computer</h2>
      <p>
        Nimbus saves your login token and settings on your computer. Our server keeps only a hashed
        copy of the token, so it cannot be read back.
      </p>

      <h2>Who else handles data</h2>
      <ul>
        <li>OpenAI, to run the model.</li>
        <li>Tavily, to search the web.</li>
        <li>Google, for login.</li>
        <li>Render, which hosts our server and keeps standard request logs.</li>
        <li>Supabase, which hosts our database.</li>
        <li>Vercel, which hosts this website.</li>
      </ul>
      <p>We do not sell your data or use it for ads.</p>

      <h2>This website</h2>
      <p>This website uses no cookies and no analytics.</p>

      <h2>Keeping and deleting data</h2>
      <p>
        We keep your account and usage records while your account exists. To delete your account and
        its records, or to ask anything about your data,{" "}
        <a href={CONTACT_URL}>contact us on GitHub</a>.
      </p>

      <h2>Changes</h2>
      <p>If this page changes, the date at the top changes with it.</p>
    </LongPage>
  );
}
