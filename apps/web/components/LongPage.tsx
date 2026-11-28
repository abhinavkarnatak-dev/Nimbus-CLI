import Link from "next/link";
import type { ReactNode } from "react";
import { Footer } from "./Footer";
import styles from "./LongPage.module.css";

// Plain reading page: docs, privacy, terms
export function LongPage({
  title,
  updated,
  children,
}: {
  title: string;
  updated: string;
  children: ReactNode;
}) {
  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <Link href="/" className={styles.home}>
          nimbus
        </Link>
      </header>
      <main className={styles.main}>
        <h1 className={styles.title}>{title}</h1>
        <p className={styles.updated}>Last updated {updated}</p>
        <div className={styles.prose}>{children}</div>
      </main>
      <Footer />
    </div>
  );
}
