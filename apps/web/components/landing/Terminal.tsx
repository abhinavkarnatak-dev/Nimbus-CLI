import type { ReactNode } from "react";
import type { Line, Row } from "@/lib/session";
import styles from "./Terminal.module.css";

const HIGHLIGHT =
  /((?<![\w/])(?:src|test)\/[\w.-]*\w|package\.json|test:watch|--watch|npm test|slugify|https:\/\/\S+[^\s).])/g;

function highlight(text: string): ReactNode[] {
  return text.split(HIGHLIGHT).map((part, i) =>
    i % 2 === 1 ? (
      <span key={i} className={styles.accent}>
        {part}
      </span>
    ) : (
      part
    ),
  );
}

function CodeLines({ lines }: { lines: Line[] }) {
  return (
    <div className={styles.code}>
      {lines.map((line, i) => (
        <div key={i} className={styles[line.kind]}>
          {line.n !== undefined && <span className={styles.n}>{line.n}</span>}
          {line.kind === "add" && <span className={styles.sign}>+</span>}
          {line.kind === "del" && <span className={styles.sign}>-</span>}
          {line.kind === "ctx" && <span className={styles.sign}> </span>}
          <span>{line.text || " "}</span>
        </div>
      ))}
    </div>
  );
}

// One transcript row, styled like the CLI
export function TerminalRow({ row }: { row: Row }) {
  if (row.kind === "reply") {
    return (
      <div className={`${styles.row} ${styles.reply}`}>
        <span className={`${styles.dot} ${styles.yellow}`} />
        <div>
          {row.paragraphs.map((p, i) => (
            <p key={i}>{highlight(p)}</p>
          ))}
        </div>
      </div>
    );
  }
  return (
    <div className={styles.row}>
      <span className={styles.dot} />
      <div className={styles.toolBody}>
        <div>
          <b>{row.tool}</b>
          <span className={styles.arg}>({row.arg})</span>
        </div>
        <div className={styles.result}>
          <span className={styles.elbow}>└</span> {row.result}
        </div>
        {row.lines && <CodeLines lines={row.lines} />}
      </div>
    </div>
  );
}

export function TerminalHeader() {
  return (
    <div className={styles.header}>
      <div className={styles.brand}>nimbus</div>
      <dl>
        <dt>cwd</dt>
        <dd>~/Downloads/AK-Dev/AI/Projects/CLI Test</dd>
        <dt>model</dt>
        <dd>gpt-6-luna</dd>
        <dt>shell</dt>
        <dd>Git Bash (bash)</dd>
      </dl>
    </div>
  );
}

export function PromptLine({ text }: { text: string }) {
  return (
    <div className={styles.prompt}>
      <span className={styles.chevron}>›</span>
      <span>{text}</span>
    </div>
  );
}
