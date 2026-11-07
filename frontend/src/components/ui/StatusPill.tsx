import successDot from '../../assets/dot-success-6.svg';
import styles from './StatusPill.module.css';

// "etiqueta" del diseño: píldora verde con un punto (p. ej. "Único vigente").
export function StatusPill({ label }: { label: string }) {
  return (
    <span className={styles.pill}>
      <img className={styles.dot} src={successDot} alt="" width={6} height={6} />
      {label}
    </span>
  );
}
