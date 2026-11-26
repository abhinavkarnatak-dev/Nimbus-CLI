"use client";

import { COMMANDS } from "@nimbus/cli/commands";
import { useRef } from "react";
import { FadeIn, Reveal } from "@/components/motion/Reveal";
import { gsap, prefersReducedMotion } from "@/lib/gsap";
import styles from "./Commands.module.css";

function scramble(el: HTMLElement | null, text: string) {
  if (!el || prefersReducedMotion()) return;
  gsap.to(el, {
    duration: 0.6,
    scrambleText: { text, chars: "/abcdefghijklmnopqrstuvwxyz", speed: 0.6 },
  });
}

export function Commands() {
  const names = useRef<(HTMLElement | null)[]>([]);

  return (
    <section className={styles.section} aria-labelledby="commands-title">
      <div className={styles.head}>
        <Reveal as="h2" className={styles.title} id="commands-title">
          A few slash commands. That is the whole manual.
        </Reveal>
        <FadeIn className={styles.lede}>
          <p>
            Type <code>/</code> inside Nimbus to see them, with arrow keys to pick one.
          </p>
        </FadeIn>
      </div>
      <ul className={styles.list}>
        {COMMANDS.map((command, i) => (
          <li
            key={command.name}
            onPointerEnter={() => scramble(names.current[i] ?? null, command.name)}
          >
            <code
              ref={(el) => {
                names.current[i] = el;
              }}
            >
              {command.name}
            </code>
            <span>{command.description}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
