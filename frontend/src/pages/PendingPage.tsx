import { Notice } from '../components/ui/Notice';
import styles from './PendingPage.module.css';

// Secciones de la barra lateral cuyo frontend todavía no está hecho.
export function PendingPage({ title, spec }: { title: string; spec: string }) {
  return (
    <div className={styles.page}>
      <h1 className={styles.title}>{title}</h1>
      <Notice
        variant="neutral"
        title="Pantalla en construcción"
        description={`El frontend de la spec ${spec} todavía no está implementado.`}
      />
    </div>
  );
}
