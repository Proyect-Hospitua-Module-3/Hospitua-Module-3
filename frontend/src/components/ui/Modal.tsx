import { ReactNode, useEffect, useId, useRef } from 'react';
import styles from './Modal.module.css';

interface ModalProps {
  title: string;
  description: string;
  actions: ReactNode;
}

// "Modal" del diseño. Se muestra mientras está montado; el foco pasa a la primera acción.
export function Modal({ title, description, actions }: ModalProps) {
  const titleId = useId();
  const descriptionId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    dialogRef.current?.querySelector('button')?.focus();
  }, []);

  return (
    <div className={styles.backdrop}>
      <div
        ref={dialogRef}
        className={styles.modal}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
      >
        <p id={titleId} className={styles.title}>
          {title}
        </p>
        <p id={descriptionId} className={styles.description}>
          {description}
        </p>
        <div className={styles.actions}>{actions}</div>
      </div>
    </div>
  );
}
