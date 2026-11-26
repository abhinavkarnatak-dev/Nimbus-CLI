"use client";

import { useEffect, useRef, type RefObject } from "react";
import { prefersReducedMotion } from "@/lib/gsap";
import { FRAGMENT, VERTEX } from "./cloud-shader";
import styles from "./CloudCanvas.module.css";

function compile(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader | null {
  const shader = gl.createShader(type);
  if (!shader) return null;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  return gl.getShaderParameter(shader, gl.COMPILE_STATUS) ? shader : null;
}

// Full screen WebGL clouds; falls back to the CSS sky
export function CloudCanvas({ ascent }: { ascent: RefObject<number> }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const gl = canvas?.getContext("webgl2", { antialias: false, alpha: false });
    if (!canvas || !gl) {
      canvas?.setAttribute("data-fallback", "true");
      return;
    }
    const vs = compile(gl, gl.VERTEX_SHADER, VERTEX);
    const fs = compile(gl, gl.FRAGMENT_SHADER, FRAGMENT);
    const program = gl.createProgram();
    if (!vs || !fs || !program) {
      canvas.setAttribute("data-fallback", "true");
      return;
    }
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      canvas.setAttribute("data-fallback", "true");
      return;
    }
    gl.useProgram(program);

    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const pos = gl.getAttribLocation(program, "aPos");
    gl.enableVertexAttribArray(pos);
    gl.vertexAttribPointer(pos, 2, gl.FLOAT, false, 0, 0);

    const uRes = gl.getUniformLocation(program, "uRes");
    const uTime = gl.getUniformLocation(program, "uTime");
    const uMouse = gl.getUniformLocation(program, "uMouse");
    const uAscent = gl.getUniformLocation(program, "uAscent");

    // Clouds are soft, so a low render scale looks the same and runs fast
    const small = matchMedia("(max-width: 899px)").matches;
    const scale = Math.min(window.devicePixelRatio, 2) * (small ? 0.32 : 0.42);
    const resize = () => {
      canvas.width = Math.max(1, Math.round(canvas.clientWidth * scale));
      canvas.height = Math.max(1, Math.round(canvas.clientHeight * scale));
      gl.viewport(0, 0, canvas.width, canvas.height);
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);

    const target = { x: 0, y: 0 };
    const mouse = { x: 0, y: 0 };
    const onMove = (event: PointerEvent) => {
      target.x = (event.clientX / window.innerWidth) * 2 - 1;
      target.y = -((event.clientY / window.innerHeight) * 2 - 1);
    };
    window.addEventListener("pointermove", onMove);

    const still = prefersReducedMotion();
    const draw = (seconds: number) => {
      mouse.x += (target.x - mouse.x) * 0.04;
      mouse.y += (target.y - mouse.y) * 0.04;
      gl.uniform2f(uRes, canvas.width, canvas.height);
      gl.uniform1f(uTime, seconds);
      gl.uniform2f(uMouse, mouse.x, mouse.y);
      gl.uniform1f(uAscent, ascent.current ?? 0);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    };

    let frame = 0;
    let visible = true;
    const start = performance.now();
    const loop = (now: number) => {
      if (visible) draw(20 + (now - start) / 1000);
      frame = requestAnimationFrame(loop);
    };
    const io = new IntersectionObserver(([entry]) => {
      visible = entry?.isIntersecting ?? true;
    });
    io.observe(canvas);

    if (still) draw(20);
    else frame = requestAnimationFrame(loop);
    canvas.setAttribute("data-ready", "true");

    return () => {
      cancelAnimationFrame(frame);
      io.disconnect();
      observer.disconnect();
      window.removeEventListener("pointermove", onMove);
      // Free our objects but keep the context: a remount reuses it
      gl.deleteBuffer(buffer);
      gl.deleteProgram(program);
      gl.deleteShader(vs);
      gl.deleteShader(fs);
    };
  }, [ascent]);

  return <canvas ref={canvasRef} className={styles.canvas} aria-hidden="true" />;
}
