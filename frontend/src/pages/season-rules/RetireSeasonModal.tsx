// Feature 009 · Modificar precio tarifa según temporada
import { SeasonRule } from '../../api/seasonRules';
import { Button } from '../../components/ui/Button';
import { Modal } from '../../components/ui/Modal';
import { Notice } from '../../components/ui/Notice';
import styles from './SeasonRulesPage.module.css';

interface RetireSeasonModalProps {
  season: SeasonRule;
  retiring: boolean;
  error: string | null;
  onCancel(): void;
  onConfirm(): void;
}

export function RetireSeasonModal({
  season,
  retiring,
  error,
  onCancel,
  onConfirm,
}: RetireSeasonModalProps) {
  return (
    <Modal
      title="Retirar temporada"
      description={`¿Quieres retirar ${season.name}? Dejará de estar disponible para nuevas asignaciones. Su historial y las cotizaciones anteriores se conservarán.`}
      onClose={retiring ? undefined : onCancel}
      actions={
        <>
          <Button variant="secondary" onClick={onCancel} disabled={retiring}>
            Cancelar
          </Button>
          <Button onClick={onConfirm} disabled={retiring} className={styles.dangerButton}>
            {retiring ? 'Retirando…' : 'Retirar temporada'}
          </Button>
        </>
      }
    >
      {error && <Notice variant="danger" title="No se retiró la temporada" description={error} />}
    </Modal>
  );
}
