"use client";

import { useRef } from "react";
import { gsap, MOTION_OK, SplitText, useGSAP } from "@/lib/gsap";
import { REPO_URL } from "@/lib/site";
import { CloudCanvas } from "./CloudCanvas";
import styles from "./Hero.module.css";

export function Hero() {
  const root = useRef<HTMLElement>(null);
  const ascent = useRef(0);

  useGSAP(
    () => {
      const mm = gsap.matchMedia();
      mm.add(MOTION_OK, () => {
        const word = SplitText.create(`.${styles.wordmark}`, { type: "chars", mask: "chars" });
        // Lines are measured again once the web font arrives
        const lede = SplitText.create(`.${styles.lede}`, {
          type: "lines",
          mask: "lines",
          autoSplit: true,
          onSplit: (self) =>
            gsap.from(self.lines, {
              yPercent: 110,
              duration: 1.3,
              stagger: 0.1,
              delay: 1.1,
              ease: "expo.out",
            }),
        });

        // Opening: letters condense out of the haze
        gsap
          .timeline({ defaults: { ease: "expo.out" } })
          .from(word.chars, {
            yPercent: 120,
            filter: "blur(14px)",
            opacity: 0,
            duration: 1.8,
            stagger: 0.07,
            delay: 0.25,
          })
          .from(
            `.${styles.actions} > *`,
            { y: 24, opacity: 0, duration: 1.1, stagger: 0.08 },
            "-=0.9",
          )
          .from(`.${styles.hint}`, { opacity: 0, duration: 1 }, "-=0.6");

        // Scrolling lifts the camera up through the cloud
        gsap
          .timeline({
            defaults: { ease: "none" },
            scrollTrigger: {
              trigger: root.current,
              start: "top top",
              end: "bottom bottom",
              scrub: 1.2,
              onUpdate: (self) => {
                ascent.current = self.progress;
              },
            },
          })
          .to(`.${styles.hint}`, { opacity: 0, duration: 0.05 }, 0)
          .to(`.${styles.copy}`, { opacity: 0, y: -60, filter: "blur(10px)", duration: 0.22 }, 0)
          .to(
            `.${styles.wordmark}`,
            { scale: 2.6, yPercent: -55, opacity: 0, filter: "blur(18px)", duration: 0.5 },
            0,
          )
          .to(`.${styles.near}`, { yPercent: -160, duration: 0.7 }, 0)
          .to(`.${styles.mid}`, { yPercent: -90, duration: 0.8 }, 0)
          .to(`.${styles.far}`, { yPercent: -40, duration: 0.9 }, 0)
          .fromTo(
            `.${styles.caption}`,
            { opacity: 0, y: 40, filter: "blur(12px)" },
            { opacity: 1, y: 0, filter: "blur(0px)", duration: 0.18 },
            0.5,
          )
          .to(
            `.${styles.caption}`,
            { opacity: 0, y: -40, filter: "blur(12px)", duration: 0.14 },
            0.82,
          )
          .to(`.${styles.fade}`, { opacity: 1, duration: 0.12 }, 0.88);

        // Cloud wisps drift against the pointer
        const layers = gsap.utils.toArray<HTMLElement>(`.${styles.wisp}`);
        const onMove = (event: PointerEvent) => {
          const x = event.clientX / window.innerWidth - 0.5;
          const y = event.clientY / window.innerHeight - 0.5;
          layers.forEach((layer, i) => {
            gsap.to(layer, { x: x * (i + 1) * -28, y: y * (i + 1) * -14, duration: 1.6 });
          });
        };
        window.addEventListener("pointermove", onMove);

        return () => {
          window.removeEventListener("pointermove", onMove);
          word.revert();
          lede.revert();
        };
      });
      return () => mm.revert();
    },
    { scope: root },
  );

  return (
    <section ref={root} className={styles.hero} aria-label="Nimbus">
      <div className={styles.stage}>
        <CloudCanvas ascent={ascent} />
        <div className={`${styles.wisp} ${styles.far}`} aria-hidden="true" />
        <div className={`${styles.wisp} ${styles.mid}`} aria-hidden="true" />

        <div className={styles.content}>
          <h1 className={styles.wordmark}>nimbus</h1>
          <div className={styles.copy}>
            <p className={styles.lede}>
              An AI agent that lives in your terminal. Ask it anything: it searches the web, works
              through your files, runs commands and writes the code.
            </p>
            <div className={styles.actions}>
              <a href="#start" className={styles.primary}>
                Get started
              </a>
              <a href={REPO_URL} className={styles.secondary}>
                View on GitHub
              </a>
              <span className={styles.note}>Invite only for now</span>
            </div>
          </div>
        </div>

        <div className={`${styles.wisp} ${styles.near}`} aria-hidden="true" />
        <p className={styles.caption}>Ask in plain words. Watch it work.</p>
        <div className={styles.hint} aria-hidden="true">
          <span>Scroll</span>
          <i />
        </div>
        <div className={styles.fade} aria-hidden="true" />
      </div>
    </section>
  );
}
