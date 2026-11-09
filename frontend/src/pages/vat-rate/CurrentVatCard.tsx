// Feature 001 · Actualizar porcentaje de IVA
// Tarjeta "Vigente" del diseño (FR-003, BR-003, entidad "IVA vigente").
import { CurrentVatRate } from '../../api/vatRate';
import { Card } from '../../components/ui/Card';
import { StatusPill } from '../../components/ui/StatusPill';
import { formatDate, formatPercent } from '../../lib/format';
import styles from './VatRatePage.module.css';

export function CurrentVatCard({ current }: { current: CurrentVatRate | null }) {
  return (
    <Card className={styles.currentCard} aria-labelledby="iva-vigente">
      <div className={styles.currentHeader}>
        <p id="iva-vigente" className={styles.currentLabel}>
          IVA vigente
        </p>
        {current && <StatusPill label="Único vigente" />}
      </div>
      <p className={styles.currentValue}>{current ? formatPercent(current.value) : '—'}</p>
      <p className={styles.currentMeta}>
        {current
          ? `Desde el ${formatDate(current.updatedAt)} · ${current.updatedByUsername ?? 'Usuario desconocido'}`
          : 'Sin porcentaje configurado'}
      </p>
    </Card>
  );
}
