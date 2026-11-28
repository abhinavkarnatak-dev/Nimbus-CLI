"use client";

import Link from "next/link";
import { useRef } from "react";
import { gsap, MOTION_OK, useGSAP } from "@/lib/gsap";
import { REPO_URL } from "@/lib/site";
import styles from "./BigFooter.module.css";

// Closing wordmark that rises out of the page
export function BigFooter() {
  const root = useRef<HTMLElement>(null);

  useGSAP(
    () => {
      const mm = gsap.matchMedia();
      mm.add(MOTION_OK, () => {
        gsap.fromTo(
          `.${styles.word}`,
          { yPercent: 55, opacity: 0.2 },
          {
            yPercent: 0,
            opacity: 1,
            ease: "none",
            scrollTrigger: {
              trigger: root.current,
              start: "top bottom",
              end: "bottom bottom",
              scrub: 1,
            },
          },
        );
      });
      return () => mm.revert();
    },
    { scope: root },
  );

  return (
    <footer ref={root} className={styles.footer}>
      <div className={styles.glow} aria-hidden="true" />
      <nav className={styles.links} aria-label="Footer">
        <Link href="/docs">Docs</Link>
        <a href={REPO_URL}>GitHub</a>
        <Link href="/privacy">Privacy</Link>
        <Link href="/terms">Terms</Link>
      </nav>
      <p className={styles.word} aria-hidden="true">
        nimbus
      </p>
    </footer>
  );
}
