import { CommandLine } from "@/components/CommandLine";
import { FadeIn, Reveal } from "@/components/motion/Reveal";
import { REPO_URL } from "@/lib/site";
import styles from "./GetStarted.module.css";

const STEPS = [
  {
    title: "Clone the repository",
    body: "Nimbus is not on npm yet, so it runs from source for now.",
    command: `git clone ${REPO_URL}.git`,
  },
  {
    title: "Install what the CLI needs",
    body: "Inside the Nimbus-CLI folder. This skips the website and server packages.",
    command: 'pnpm install --filter "@abhinavk-dev/nimbus..."',
  },
  {
    title: "Log in with your invite code",
    body: "A browser tab opens for Google. After that, start Nimbus in any project with pnpm nimbus followed by the folder path.",
    command: "pnpm nimbus login --code <your code>",
  },
];

export function GetStarted() {
  return (
    <section id="start" className={styles.section} aria-labelledby="start-title">
      <div className={styles.head}>
        <Reveal as="h2" className={styles.title} id="start-title">
          Get started in three commands.
        </Reveal>
        <FadeIn>
          <p className={styles.needs}>You need Node.js 24 or newer, pnpm and Git.</p>
        </FadeIn>
      </div>
      <ol className={styles.steps}>
        {STEPS.map((step, i) => (
          <li key={step.title}>
            <span className={styles.num}>{i + 1}</span>
            <FadeIn className={styles.step} delay={i * 0.08}>
              <h3>{step.title}</h3>
              <p>{step.body}</p>
              <CommandLine command={step.command} typed />
            </FadeIn>
          </li>
        ))}
      </ol>
    </section>
  );
}
