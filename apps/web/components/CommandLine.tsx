"use client";

import { useRef, useState } from "react";
import { gsap, MOTION_OK, useGSAP } from "@/lib/gsap";
import styles from "./CommandLine.module.css";

// One shell command with a copy button
export function CommandLine({ command, typed = false }: { command: string; typed?: boolean }) {
  const [copied, setCopied] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const text = useRef<HTMLSpanElement>(null);

  // Types itself out the first time it scrolls into view
  useGSAP(
    () => {
      if (!typed) return;
      const mm = gsap.matchMedia();
      mm.add(MOTION_OK, () => {
        // textContent, so commands like <your code> are not read as HTML
        const el = text.current!;
        const state = { n: 0 };
        el.textContent = "";
        gsap.to(state, {
          n: command.length,
          duration: Math.min(1.6, command.length * 0.03),
          ease: "none",
          onUpdate: () => {
            el.textContent = command.slice(0, Math.round(state.n));
          },
          scrollTrigger: { trigger: root.current, start: "top 95%", once: true },
        });
        return () => {
          el.textContent = command;
        };
      });
      return () => mm.revert();
    },
    { scope: root },
  );

  async function copy() {
    try {
      await navigator.clipboard.writeText(command);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div ref={root} className={styles.line}>
      <code>
        <span className={styles.prompt} aria-hidden="true">
          $
        </span>
        <span className={styles.text}>
          <span className={styles.ghost} aria-hidden="true">
            {command}
          </span>
          <span ref={text} className={styles.typed}>
            {command}
          </span>
        </span>
      </code>
      <button type="button" className={styles.copy} onClick={copy}>
        {copied ? "Copied" : "Copy"}
      </button>
      <span className="visually-hidden" aria-live="polite">
        {copied ? "Command copied" : ""}
      </span>
    </div>
  );
}
