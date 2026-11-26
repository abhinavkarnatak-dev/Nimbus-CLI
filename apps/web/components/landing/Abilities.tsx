"use client";

import { useRef } from "react";
import { gsap, MOTION_OK, useGSAP, WIDE } from "@/lib/gsap";
import type { Row } from "@/lib/session";
import { TerminalRow } from "./Terminal";
import styles from "./Abilities.module.css";

const ABILITIES: { word: string; body: string; rows: Row[] }[] = [
  {
    word: "Answers",
    body: "Ask about anything, not just code. It searches the web and tells you what it found, with the source.",
    rows: [
      {
        kind: "tool",
        tool: "Search",
        arg: '"most recent Formula 1 Grand Prix race winner margin Novembe…"',
        result: "Found 5 results · 2.7s",
      },
      {
        kind: "tool",
        tool: "Search",
        arg: '"site:formula1.com Las Vegas Grand Prix 2026 Verstappen 0.63…"',
        result: "Found 5 results · 3.6s",
      },
      {
        kind: "tool",
        tool: "Search",
        arg: '"2026 Las Vegas Grand Prix final classification Verstappen N…"',
        result: "Found 5 results · 2.8s",
      },
      {
        kind: "reply",
        paragraphs: [
          "Max Verstappen won the most recent F1 race, the Las Vegas Grand Prix, by 0.639 seconds over Lando Norris. Formula 1 (https://www.formula1.com/en/latest/article/verstappen-wins-exhilarating-las-vegas-grand-prix-from-norris-and-piastri.2eeBWqekZdir9mdDVK9YVX)",
        ],
      },
    ],
  },
  {
    word: "Reads",
    body: "Finds the right files with glob and grep, then reads them before it changes anything.",
    rows: [
      {
        kind: "tool",
        tool: "Glob",
        arg: "**/{package.json,src/**,test/**}",
        result: "Found 5 files",
      },
      { kind: "tool", tool: "Read", arg: "package.json", result: "Read 10 lines" },
    ],
  },
  {
    word: "Runs",
    body: "Runs commands in your own shell, reads the output and reacts to it.",
    rows: [
      {
        kind: "tool",
        tool: "Bash",
        arg: "npm test",
        result: "> cli-test@1.0.0 test · 1.5s",
        lines: [
          { kind: "out", text: "✓ add (1.2691ms)" },
          { kind: "out", text: "✓ multiply (0.3915ms)" },
        ],
      },
    ],
  },
  {
    word: "Changes",
    body: "Writes new files and edits existing ones, and shows you every line it touched.",
    rows: [
      {
        kind: "tool",
        tool: "Edit",
        arg: "package.json",
        result: "Changed with 2 additions and 1 removal",
        lines: [
          { kind: "del", n: 8, text: '    "test": "node --test"' },
          { kind: "add", n: 8, text: '    "test": "node --test",' },
          { kind: "add", n: 9, text: '    "test:watch": "node --test --watch"' },
        ],
      },
    ],
  },
];

// Pinned row of panels that slides sideways as you scroll
export function Abilities() {
  const root = useRef<HTMLElement>(null);
  const track = useRef<HTMLDivElement>(null);

  useGSAP(
    () => {
      const mm = gsap.matchMedia();
      mm.add(`${MOTION_OK} and ${WIDE}`, () => {
        const el = track.current!;
        const slide = gsap.to(el, {
          x: () => -(el.scrollWidth - window.innerWidth),
          ease: "none",
          scrollTrigger: {
            trigger: root.current,
            start: "top top",
            end: () => `+=${el.scrollWidth - window.innerWidth}`,
            pin: true,
            scrub: 1,
            invalidateOnRefresh: true,
          },
        });
        // Solid word and its outline drift in opposite directions
        gsap.utils.toArray<HTMLElement>(`.${styles.ghost}`).forEach((ghost) => {
          gsap.fromTo(
            ghost,
            { xPercent: -30 },
            {
              xPercent: 30,
              ease: "none",
              scrollTrigger: {
                trigger: ghost.parentElement,
                containerAnimation: slide,
                start: "left right",
                end: "right left",
                scrub: true,
              },
            },
          );
        });
        gsap.utils.toArray<HTMLElement>(`.${styles.word}`).forEach((word) => {
          gsap.fromTo(
            word,
            { xPercent: 18 },
            {
              xPercent: -18,
              ease: "none",
              scrollTrigger: {
                trigger: word,
                containerAnimation: slide,
                start: "left right",
                end: "right left",
                scrub: true,
              },
            },
          );
        });
      });
      return () => mm.revert();
    },
    { scope: root },
  );

  return (
    <section ref={root} className={styles.section} aria-label="What Nimbus can do">
      <div ref={track} className={styles.track}>
        {ABILITIES.map((ability) => (
          <article key={ability.word} className={styles.panel}>
            <span className={styles.ghost} aria-hidden="true">
              {ability.word}
            </span>
            <h2 className={styles.word}>{ability.word}</h2>
            <div className={styles.detail}>
              <p>{ability.body}</p>
              <div className={styles.snippet}>
                {ability.rows.map((row, i) => (
                  <TerminalRow key={i} row={row} />
                ))}
              </div>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
