import { CommandLine } from "@/components/CommandLine";
import { FadeIn, Reveal } from "@/components/motion/Reveal";
import { INSTALL_COMMAND } from "@/lib/site";
import styles from "./GetStarted.module.css";

const STEPS = [
  {
    title: "Install it",
    body: "One command, and nimbus works in every folder.",
    command: INSTALL_COMMAND,
  },
  {
    title: "Log in, or bring your key",
    body: "An invite code gives you free credit and opens a browser tab for Google. No invite? Run nimbus key set to use your own OpenAI key instead.",
    command: "nimbus login --code <your code>",
  },
  {
    title: "Start it in your project",
    body: "Open your project folder and ask it anything. The docs cover every command.",
    command: "nimbus",
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
          <p className={styles.needs}>You need Node.js 24.15 or newer.</p>
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
