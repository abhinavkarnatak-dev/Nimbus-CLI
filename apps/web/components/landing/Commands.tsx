"use client";

import { COMMANDS } from "@nimbus/cli/commands";
import { useRef, useState } from "react";
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
  // Fade the bottom edge until the last command is in view
  const [atEnd, setAtEnd] = useState(false);

  return (
    <section className={styles.section} aria-labelledby="commands-title">
      <div className={styles.head}>
        <Reveal as="h2" className={styles.title} id="commands-title">
          A few slash commands. That is the whole manual.
        </Reveal>
        <FadeIn className={styles.lede}>
          <p>
            Type <code>/</code> inside Nimbus to see all {COMMANDS.length}, with arrow keys to pick
            one.
          </p>
        </FadeIn>
      </div>
      <div
        className={styles.scroller}
        data-end={atEnd || undefined}
        data-lenis-prevent
        tabIndex={0}
        role="region"
        aria-label="All slash commands"
        onScroll={(event) => {
          const el = event.currentTarget;
          setAtEnd(el.scrollTop + el.clientHeight >= el.scrollHeight - 2);
        }}
      >
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
      </div>
    </section>
  );
}
