"use client";

import { useEffect, useRef } from "react";
import { gsap, prefersReducedMotion } from "@/lib/gsap";
import styles from "./Cursor.module.css";

// Soft sunbreak glow that follows the pointer
export function Cursor() {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el || prefersReducedMotion() || !matchMedia("(pointer: fine)").matches) return;
    const xTo = gsap.quickTo(el, "x", { duration: 0.5, ease: "power3" });
    const yTo = gsap.quickTo(el, "y", { duration: 0.5, ease: "power3" });

    const move = (event: PointerEvent) => {
      el.dataset.on = "true";
      xTo(event.clientX);
      yTo(event.clientY);
      const target = (event.target as Element).closest("a, button, [data-cursor]");
      el.dataset.hover = target ? "true" : "false";
    };
    const leave = () => {
      el.dataset.on = "false";
    };
    window.addEventListener("pointermove", move);
    document.documentElement.addEventListener("pointerleave", leave);
    return () => {
      window.removeEventListener("pointermove", move);
      document.documentElement.removeEventListener("pointerleave", leave);
    };
  }, []);

  return (
    <div ref={ref} className={styles.cursor} aria-hidden="true">
      <div className={styles.dot} />
    </div>
  );
}
