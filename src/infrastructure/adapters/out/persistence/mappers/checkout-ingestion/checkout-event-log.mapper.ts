// Feature 010 · Registrar Check-out
import { CheckoutAuditPayload } from '../../../../../../domain/model/checkout-ingestion/checkout-event';
import { CheckoutEventLog } from '../../../../../../domain/model/checkout-ingestion/checkout-event-log';
import { CheckoutStatus } from '../../../../../../domain/model/checkout-ingestion/checkout-status.enum';

export interface CheckoutEventLogRow {
  id: string;
  event_id: string | null;
  event_type: string | null;
  occurred_at: Date | null;
  payload: CheckoutAuditPayload | null;
  stay_id: string | null;
  status: string;
  error_code: string | null;
  reason: string | null;
  result_note: string | null;
  processed_at: Date | null;
  created_at: Date;
}

export class CheckoutEventLogMapper {
  static toDomain(row: CheckoutEventLogRow): CheckoutEventLog {
    return new CheckoutEventLog(
      row.id,
      row.event_id,
      row.event_type,
      row.occurred_at,
      row.payload,
      row.stay_id,
      // El CHECK de la migración solo admite los cuatro estados.
      row.status as CheckoutStatus,
      row.error_code,
      row.reason,
      row.result_note,
      row.processed_at,
      row.created_at,
    );
  }
}
