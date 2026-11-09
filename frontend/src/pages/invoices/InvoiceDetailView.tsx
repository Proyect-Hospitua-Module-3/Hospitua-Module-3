// Feature 008 · La factura persistida, sin recalcular ni modificar sus importes.
import type { InvoiceDetail } from '../../api/invoices';
import { useEffect, useRef } from 'react';
import { formatDateTime, formatPercent } from '../../lib/format';
import { formatInvoiceMoney, invoiceChannelLabel } from '../../lib/invoices';
import styles from './InvoicesPage.module.css';

export function InvoiceDetailView({ invoice }: { invoice: InvoiceDetail }) {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    heading.current?.focus({ preventScroll: true });
    heading.current?.scrollIntoView?.({ block: 'nearest' });
  }, [invoice.invoiceId]);
  const money = (value: string) => formatInvoiceMoney(value, invoice.currency);
  return (
    <div className={styles.detail}>
      <div className={styles.sectionHeader}>
        <h2 className={styles.sectionTitle} ref={heading} tabIndex={-1}>
          Factura {invoice.invoiceNumber}
        </h2>
        <span className={styles.badge}>Emitida</span>
      </div>
      <p className={styles.muted}>Inmutable · Solo lectura</p>
      <dl className={styles.metadata}>
        <div>
          <dt>Emisión (Colombia)</dt>
          <dd>{formatDateTime(invoice.issuedAt)}</dd>
        </div>
        <div>
          <dt>Canal</dt>
          <dd>{invoiceChannelLabel(invoice.channel, invoice.otaId)}</dd>
        </div>
        <div>
          <dt>Cliente de facturación</dt>
          <dd>{invoice.customer.name}</dd>
        </div>
        <div>
          <dt>Documento fiscal</dt>
          <dd>{invoice.customer.taxId}</dd>
        </div>
        <div>
          <dt>Reserva</dt>
          <dd>{invoice.reservationRef}</dd>
        </div>
        <div>
          <dt>Estancia</dt>
          <dd>{invoice.stayId}</dd>
        </div>
        <div>
          <dt>Liquidación de origen</dt>
          <dd>{invoice.settlementId}</dd>
        </div>
        <div>
          <dt>Identificador de factura</dt>
          <dd>{invoice.invoiceId}</dd>
        </div>
      </dl>
      <dl className={styles.breakdown}>
        <div>
          <dt>Hospedaje</dt>
          <dd>{money(invoice.lodgingAmount)}</dd>
        </div>
        <div>
          <dt>Comisión OTA (informativa)</dt>
          <dd>{money(invoice.otaCommissionAmount)}</dd>
        </div>
        <div>
          <dt>Ingreso neto</dt>
          <dd>{money(invoice.netIncome)}</dd>
        </div>
        <div>
          <dt>IVA aplicado</dt>
          <dd>{formatPercent(invoice.vatRateApplied)}</dd>
        </div>
        <div>
          <dt>Valor del IVA</dt>
          <dd>{money(invoice.vatAmount)}</dd>
        </div>
        <div className={styles.total}>
          <dt>Total facturado</dt>
          <dd>{money(invoice.totalAmount)}</dd>
        </div>
      </dl>
      <p className={styles.help}>
        Estos son los valores guardados al emitir la factura. La comisión OTA es informativa y ya
        está reflejada en el ingreso neto.
      </p>
    </div>
  );
}
