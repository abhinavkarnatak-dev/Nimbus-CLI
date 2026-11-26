import Link from "next/link";
import { REPO_URL } from "@/lib/site";
import styles from "./Footer.module.css";

export function Footer() {
  return (
    <footer className={styles.footer}>
      <span className={styles.name}>nimbus</span>
      <nav aria-label="Footer">
        <a href={REPO_URL}>GitHub</a>
        <Link href="/privacy">Privacy</Link>
        <Link href="/terms">Terms</Link>
      </nav>
    </footer>
  );
}
