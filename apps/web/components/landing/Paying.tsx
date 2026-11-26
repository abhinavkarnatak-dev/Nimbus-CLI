"use client";

import { useRef, useState } from "react";
import { Reveal } from "@/components/motion/Reveal";
import { gsap, MOTION_OK, useGSAP } from "@/lib/gsap";
import styles from "./Paying.module.css";

type Mode = "credit" | "key";

const VIA_SERVER = "M 90 170 C 200 170 250 170 360 170 S 520 170 630 170";
const DIRECT = "M 90 170 C 220 20 500 20 630 170";

const COPY: Record<Mode, { title: string; body: string }> = {
  credit: {
    title: "Nimbus credit",
    body: "Every invited account starts with free credit. Log in with Google and start working, nothing else to set up.",
  },
  key: {
    title: "Your own OpenAI key",
    body: "Add it with /key. The key stays on your computer, and model calls go straight from your machine to OpenAI.",
  },
};

export function Paying() {
  const root = useRef<HTMLElement>(null);
  const [mode, setMode] = useState<Mode>("credit");

  // Draw the active route and send a pulse along it
  useGSAP(
    () => {
      const active = mode === "credit" ? "#route-credit" : "#route-key";
      const other = mode === "credit" ? "#route-key" : "#route-credit";
      const mm = gsap.matchMedia();
      mm.add(MOTION_OK, () => {
        gsap.to(other, { drawSVG: "100% 100%", duration: 0.6, ease: "power2.in" });
        gsap.fromTo(
          active,
          { drawSVG: "0% 0%" },
          {
            drawSVG: "0% 100%",
            duration: 1.3,
            ease: "expo.out",
            delay: 0.2,
            scrollTrigger: { trigger: root.current, start: "top 70%", once: true },
          },
        );
        gsap.fromTo(
          "#pulse",
          { opacity: 0 },
          {
            opacity: 1,
            duration: 2.4,
            ease: "power1.inOut",
            repeat: -1,
            delay: 0.8,
            motionPath: { path: active, align: active, alignOrigin: [0.5, 0.5] },
          },
        );
      });
      mm.add("(prefers-reduced-motion: reduce)", () => {
        gsap.set(active, { drawSVG: "0% 100%" });
        gsap.set(other, { drawSVG: "0% 0%" });
        gsap.set("#pulse", { opacity: 0 });
      });
      gsap.to(`.${styles.serverNode}`, { opacity: mode === "credit" ? 1 : 0.35, duration: 0.5 });
      gsap.fromTo(
        `.${styles.copy} > *`,
        { y: 16, opacity: 0, filter: "blur(6px)" },
        { y: 0, opacity: 1, filter: "blur(0px)", duration: 0.7, stagger: 0.06, ease: "expo.out" },
      );
      return () => mm.revert();
    },
    { scope: root, dependencies: [mode] },
  );

  const copy = COPY[mode];

  return (
    <section ref={root} className={styles.section} aria-labelledby="paying-title">
      <div className={styles.intro}>
        <Reveal as="h2" className={styles.title} id="paying-title">
          Pay the way that suits you.
        </Reveal>
        <div className={styles.toggle} role="radiogroup" aria-label="How Nimbus is paid for">
          <span className={styles.thumb} data-mode={mode} aria-hidden="true" />
          <button
            type="button"
            role="radio"
            aria-checked={mode === "credit"}
            onClick={() => setMode("credit")}
          >
            Nimbus credit
          </button>
          <button
            type="button"
            role="radio"
            aria-checked={mode === "key"}
            onClick={() => setMode("key")}
          >
            Your OpenAI key
          </button>
        </div>
      </div>

      <div className={styles.body}>
        <svg className={styles.map} viewBox="0 0 720 230" role="img" aria-label={copy.title}>
          <path id="route-credit" d={VIA_SERVER} className={styles.route} />
          <path id="route-key" d={DIRECT} className={styles.route} />
          <circle id="pulse" r="6" className={styles.pulse} opacity="0" />
          <g className={styles.node}>
            <circle cx="90" cy="170" r="9" />
            <text x="90" y="210">
              Your terminal
            </text>
          </g>
          <g className={`${styles.node} ${styles.serverNode}`}>
            <circle cx="360" cy="170" r="9" />
            <text x="360" y="210">
              Nimbus server
            </text>
          </g>
          <g className={styles.node}>
            <circle cx="630" cy="170" r="9" />
            <text x="630" y="210">
              OpenAI
            </text>
          </g>
        </svg>

        <div className={styles.copy} aria-live="polite">
          <h3>{copy.title}</h3>
          <p>{copy.body}</p>
          <p className={styles.both}>
            Switch any time with <code>/use</code>. If one side runs out in the middle of a task,
            Nimbus moves to the other and keeps going.
          </p>
        </div>
      </div>
    </section>
  );
}
