import Link from "next/link";
import type { ReactNode } from "react";
import { Sky } from "./Sky";
import styles from "./Notice.module.css";

// Short full-screen message, used after login and for 404
export function Notice({ title, children }: { title: string; children: ReactNode }) {
  return (
    <>
      <Sky />
      <div className={styles.page}>
        <Link href="/" className={styles.home}>
          nimbus
        </Link>
        <main className={styles.main}>
          <h1 className={styles.title}>{title}</h1>
          <div className={styles.body}>{children}</div>
        </main>
      </div>
    </>
  );
}
