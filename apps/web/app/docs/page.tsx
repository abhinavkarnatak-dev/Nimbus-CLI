import { COMMANDS } from "@nimbus/cli/commands";
import type { Metadata } from "next";
import Link from "next/link";
import { CommandLine } from "@/components/CommandLine";
import { LongPage } from "@/components/LongPage";
import { INSTALL_COMMAND, OG_IMAGE } from "@/lib/site";
import styles from "./docs.module.css";

const description =
  "How to install Nimbus, log in or use your own OpenAI key, and use its commands, models, permissions, memory and skills.";

export const metadata: Metadata = {
  title: "Docs",
  description,
  alternates: { canonical: "/docs" },
  openGraph: {
    type: "website",
    images: [OG_IMAGE],
    siteName: "Nimbus",
    url: "/docs",
    title: "Docs - Nimbus",
    description,
  },
  twitter: { card: "summary_large_image", images: [OG_IMAGE], title: "Docs - Nimbus", description },
};

const SECTIONS = [
  ["install", "Install"],
  ["start", "Log in or use your key"],
  ["use", "Working with Nimbus"],
  ["commands", "Commands"],
  ["permissions", "Permissions"],
  ["models", "Models"],
  ["project", "AGENTS.md and memory"],
  ["skills", "Skills"],
  ["conversations", "Conversations"],
  ["cost", "Cost and usage"],
] as const;

function Command({ command }: { command: string }) {
  return (
    <div className={styles.command}>
      <CommandLine command={command} />
    </div>
  );
}

export default function Docs() {
  return (
    <LongPage title="Docs" updated="28 November 2026">
      <ul className={styles.contents}>
        {SECTIONS.map(([id, label]) => (
          <li key={id}>
            <a href={`#${id}`}>{label}</a>
          </li>
        ))}
      </ul>

      <h2 id="install">Install</h2>
      <p>Nimbus needs Node.js 24.15 or newer. Install it once, then run it from any folder.</p>
      <Command command={INSTALL_COMMAND} />
      <p>
        Check it worked with <code>nimbus --version</code>. <code>nimbus --help</code> lists
        everything you can type before Nimbus starts.
      </p>

      <h2 id="start">Log in or use your key</h2>
      <p>Nimbus needs something to pay for model calls. Pick one:</p>
      <ul>
        <li>
          An invite code gives you free Nimbus credit. A browser tab opens to log in with Google.
        </li>
      </ul>
      <Command command="nimbus login --code <your code>" />
      <ul>
        <li>
          Your own OpenAI key works without an invite. It stays on your computer, and model calls go
          straight to OpenAI.
        </li>
      </ul>
      <Command command="nimbus key set" />
      <p>
        Switch between them later with <code>/use</code>. Web search goes through the Nimbus server,
        so it only works when you are logged in.
      </p>

      <h2 id="use">Working with Nimbus</h2>
      <p>Start it in your project folder, or give it the folder:</p>
      <Command command="nimbus" />
      <ul>
        <li>
          <code>Enter</code> sends, <code>Shift+Enter</code> or <code>Ctrl+J</code> adds a new line.
        </li>
        <li>
          <code>Esc</code> stops the current reply. <code>Ctrl+C</code> twice quits.
        </li>
        <li>
          <code>Ctrl+L</code> clears the screen and keeps the conversation.
        </li>
        <li>For bigger tasks Nimbus keeps a checklist you can watch as it works.</li>
        <li>
          Changed your mind about an edit? Ask Nimbus to undo or revert it. It puts the files back
          from saved copies and keeps edits you made yourself. Changes made by commands it ran
          cannot be undone.
        </li>
        <li>
          If your internet drops for a moment, Nimbus tries again by itself, up to 5 times, and
          shows a countdown.
        </li>
      </ul>

      <h2 id="commands">Commands</h2>
      <p>
        Type <code>/</code> inside Nimbus to see them, with arrow keys to pick one.
      </p>
      <ul className={styles.commands}>
        {COMMANDS.map((command) => (
          <li key={command.name}>
            <code>{command.name}</code>
            <span>{command.description}</span>
          </li>
        ))}
      </ul>

      <h2 id="permissions">Permissions</h2>
      <p>
        Nimbus asks before it edits files or runs commands. Pick how much it asks with{" "}
        <code>/permissions</code>, or press <code>Shift+Tab</code> to switch:
      </p>
      <ul>
        <li>Ask: asks before edits and commands.</li>
        <li>Auto edits: edits files without asking, asks before commands.</li>
        <li>Don&apos;t ask: does not ask.</li>
      </ul>
      <p>
        In every mode it still asks before git pushes and commits, and it never reads secret files
        like <code>.env</code>. Nimbus works in the folder you start it in. It can read a file or
        folder anywhere else when you give it the path, after asking you, and it never changes files
        outside your folder.
      </p>

      <h2 id="models">Models</h2>
      <p>
        <code>/model</code> picks the model (GPT-6.2 Astra, GPT-6.2 Sol, GPT-6.1 Terra, GPT-6 Luna
        and older ones) and how much it thinks before answering (the levels depend on the model).
        Your choice is saved. GPT-6 Luna on medium is the default.
      </p>

      <h2 id="project">AGENTS.md and memory</h2>
      <p>
        Nimbus reads your project&apos;s <code>AGENTS.md</code> (or <code>CLAUDE.md</code>) at the
        start of every session, plus <code>~/.nimbus/AGENTS.md</code> for rules that apply
        everywhere. <code>/init</code> writes an <code>AGENTS.md</code> for your project.
      </p>
      <p>
        Tell Nimbus to remember something and it will know it in your next sessions.{" "}
        <code>/memory</code> shows what it remembers, and <code>/memory forget 2</code> removes a
        fact.
      </p>

      <h2 id="skills">Skills</h2>
      <p>
        A skill is a set of saved instructions for one kind of task, like reviewing changes or
        writing release notes. Nimbus uses a skill by itself when your request fits it, and you can
        run one yourself by typing <code>/</code> and its name, with optional text after it.
      </p>
      <p>
        Each skill is a folder with a <code>SKILL.md</code> file, in{" "}
        <code>.nimbus/skills/&lt;name&gt;/</code> for one project or{" "}
        <code>~/.nimbus/skills/&lt;name&gt;/</code> for every project. The file starts with a{" "}
        <code>name</code> and a <code>description</code> that tells Nimbus when to use it. Add{" "}
        <code>disable-model-invocation: true</code> if only you should run it, and use{" "}
        <code>$ARGUMENTS</code> where the text after the name should go. The easiest way to make one
        is <code>/create-skill</code>, or just ask Nimbus. New skills show up after{" "}
        <code>/clear</code>.
      </p>

      <h2 id="conversations">Conversations</h2>
      <ul>
        <li>
          Conversations are saved on your computer and get a short name from what you are working
          on. <code>/rename</code> gives one your own name.
        </li>
        <li>
          <code>/resume</code> (or <code>nimbus --resume</code>) opens an earlier one,{" "}
          <code>nimbus --continue</code> the latest in that folder, and <code>/clear</code> starts a
          new one.
        </li>
        <li>
          The status bar shows how full the conversation is and <code>/context</code> shows what
          fills it. Long conversations shrink by themselves when they get full;{" "}
          <code>/compact</code> does it now.
        </li>
      </ul>

      <h2 id="cost">Cost and usage</h2>
      <ul>
        <li>
          <code>/usage</code> shows what the session cost, and your remaining Nimbus credit.
        </li>
        <li>
          <code>/budget 0.50</code> makes Nimbus stop and ask before spending more than $0.50 in the
          session.
        </li>
        <li>
          <code>/trace</code> shows each model call of the last reply: tokens, cache, cost, time and
          the tools it used.
        </li>
      </ul>
      <p>
        What Nimbus stores and sends is on the <Link href="/privacy">privacy page</Link>.
      </p>
    </LongPage>
  );
}
