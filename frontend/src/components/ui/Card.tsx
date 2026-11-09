import { HTMLAttributes } from 'react';
import styles from './Card.module.css';

// Tarjeta blanca con borde del diseño ("Vigente", "Actualizar").
export function Card({ className, ...props }: HTMLAttributes<HTMLElement>) {
  return <section className={`${styles.card} ${className ?? ''}`} {...props} />;
}
