import dangerDot from '../../assets/notice-dot-danger.svg';
import infoDot from '../../assets/notice-dot-info.svg';
import neutralDot from '../../assets/notice-dot-neutral.svg';
import successDot from '../../assets/notice-dot-success.svg';
import styles from './Notice.module.css';

export type NoticeVariant = 'info' | 'success' | 'neutral' | 'danger';

const DOTS: Record<NoticeVariant, string> = {
  info: infoDot,
  success: successDot,
  neutral: neutralDot,
  danger: dangerDot,
};

interface NoticeProps {
  variant: NoticeVariant;
  title: string;
  description?: string;
  children?: React.ReactNode;
}

// "aviso" del diseño: punto de color, título y descripción opcional.
export function Notice({ variant, title, description, children }: NoticeProps) {
  return (
    <div
      className={`${styles.notice} ${styles[variant]}`}
      role={variant === 'danger' ? 'alert' : 'status'}
    >
      <img className={styles.dot} src={DOTS[variant]} alt="" width={7} height={13} />
      <div className={styles.body}>
        <p className={styles.title}>{title}</p>
        {description && <p className={styles.description}>{description}</p>}
        {children}
      </div>
    </div>
  );
}
