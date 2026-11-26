"use client";

import { useLayoutEffect, useRef, useState } from "react";
import { Reveal } from "@/components/motion/Reveal";
import { gsap, MOTION_OK, useGSAP, WIDE } from "@/lib/gsap";
import { NOTES, PROMPT, ROWS } from "@/lib/session";
import { PromptLine, TerminalHeader, TerminalRow } from "./Terminal";
import styles from "./SessionReplay.module.css";

// Scroll plays a real recorded session, row by row
export function SessionReplay() {
  const root = useRef<HTMLElement>(null);
  const screen = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const [shown, setShown] = useState(ROWS.length);
  const [offset, setOffset] = useState(0);

  useGSAP(
    () => {
      const mm = gsap.matchMedia();
      mm.add(`${MOTION_OK} and ${WIDE}`, () => {
        setShown(0);
        gsap.to(root.current, {
          scrollTrigger: {
            trigger: root.current,
            start: "top top",
            end: "bottom bottom",
            onUpdate: (self) => {
              setShown(Math.min(ROWS.length, Math.floor(self.progress * (ROWS.length + 0.8))));
            },
          },
        });
        return () => setShown(ROWS.length);
      });
      return () => mm.revert();
    },
    { scope: root },
  );

  // Keep the newest row in view, like a real terminal
  useLayoutEffect(() => {
    const box = screen.current;
    const content = list.current;
    if (!box || !content) return;
    const pad = parseFloat(getComputedStyle(box).paddingTop) * 2;
    setOffset(Math.max(0, content.scrollHeight - (box.clientHeight - pad)));
  }, [shown]);

  const active = NOTES.findIndex((note) => shown <= note.upTo);
  const current = shown >= ROWS.length ? NOTES.length - 1 : Math.max(0, active);

  return (
    <section ref={root} className={styles.section} aria-labelledby="session-title">
      <div className={styles.stage}>
        <div className={styles.side}>
          <Reveal as="h2" className={styles.title} id="session-title">
            One real session, start to finish.
          </Reveal>
          <ol className={styles.notes}>
            {NOTES.map((note, i) => (
              <li key={note.title} data-active={i === current} data-done={i < current}>
                <span className={styles.num}>{i + 1}</span>
                <div>
                  <h3>{note.title}</h3>
                  <p>{note.body}</p>
                </div>
              </li>
            ))}
          </ol>
        </div>

        <div className={styles.terminal} ref={screen}>
          <div ref={list} className={styles.list} style={{ transform: `translateY(${-offset}px)` }}>
            <TerminalHeader />
            <PromptLine text={PROMPT} />
            {ROWS.slice(0, shown).map((row, i) => (
              <TerminalRow key={i} row={row} />
            ))}
            <div className={styles.cursor} aria-hidden="true">
              <span>›</span>
              <i />
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
