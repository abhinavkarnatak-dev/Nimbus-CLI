import styles from "./Sky.module.css";

// Soft drifting clouds behind short pages
export function Sky() {
  return (
    <div className={styles.sky} aria-hidden="true">
      <div className={styles.glow} />
      <div className={`${styles.cloud} ${styles.a}`} />
      <div className={`${styles.cloud} ${styles.b}`} />
      <div className={`${styles.cloud} ${styles.c}`} />
      <div className={`${styles.cloud} ${styles.d}`} />
    </div>
  );
}
