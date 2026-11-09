// Feature 008 · Resultados paginados de la búsqueda aplicada.
import type { InvoiceSearchQuery, InvoiceSearchResult } from '../../api/invoices';
import { Button } from '../../components/ui/Button';
import { Notice } from '../../components/ui/Notice';
import { formatDateTime } from '../../lib/format';
import { formatInvoiceMoney, invoiceChannelLabel } from '../../lib/invoices';
import styles from './InvoicesPage.module.css';

interface Props {
  result: InvoiceSearchResult;
  query: InvoiceSearchQuery;
  busy: boolean;
  onPage(page: number): void;
  onDetail(invoiceId: string): void;
}

export function InvoiceResults({ result, query, busy, onPage, onDetail }: Props) {
  const criteria = [
    query.reservationRef && `Reserva: ${query.reservationRef}`,
    query.stayId && `Estancia: ${query.stayId}`,
    query.customerName &&
      `Cliente: ${query.customerName} (${query.customerMatch === 'PARTIAL' ? 'parcial' : 'exacta'})`,
    query.customerTaxId && `Documento: ${query.customerTaxId}`,
    query.channel && `Canal: ${invoiceChannelLabel(query.channel, query.otaId ?? null)}`,
    query.issuedFrom && query.issuedTo && `Emisión: ${query.issuedFrom} al ${query.issuedTo}`,
  ]
    .filter(Boolean)
    .join(' · ');
  return (
    <section className={styles.results} aria-labelledby="invoices-results-title">
      <div className={styles.sectionHeader}>
        <div>
          <h2 id="invoices-results-title" className={styles.sectionTitle}>
            Facturas encontradas
          </h2>
          <p className={styles.muted} role="status">
            {result.totalItems}{' '}
            {result.totalItems === 1 ? 'factura encontrada' : 'facturas encontradas'}
            {result.customerMatchMode &&
              ` · Coincidencia ${result.customerMatchMode === 'EXACT' ? 'exacta' : 'parcial'} del nombre`}
          </p>
        </div>
        <p className={styles.help}>Consulta al {formatDateTime(result.asOf)} · Colombia</p>
      </div>
      <p className={styles.appliedFilters}>
        Filtros aplicados: {criteria}. Los cambios escritos en el formulario se aplican al pulsar
        Buscar facturas.
      </p>
      {result.totalItems === 0 ? (
        <Notice
          variant="neutral"
          title="No se encontraron facturas"
          description="Ninguna factura coincide con los criterios aplicados. Revisa los filtros y vuelve a buscar."
        />
      ) : (
        <>
          <div
            className={styles.tableWrapper}
            tabIndex={0}
            role="region"
            aria-label="Resultados de facturas"
          >
            <table className={styles.table} aria-label="Facturas encontradas">
              <thead>
                <tr>
                  <th scope="col">Factura</th>
                  <th scope="col">Emisión (Colombia)</th>
                  <th scope="col">Reserva</th>
                  <th scope="col">Cliente</th>
                  <th scope="col">Canal</th>
                  <th scope="col">Total facturado</th>
                  <th scope="col">Detalle</th>
                </tr>
              </thead>
              <tbody>
                {result.items.map((invoice) => (
                  <tr key={invoice.invoiceId}>
                    <th scope="row">
                      {invoice.invoiceNumber}
                      <span className={styles.cellMeta}>Emitida</span>
                    </th>
                    <td className={styles.nowrap}>{formatDateTime(invoice.issuedAt)}</td>
                    <td>
                      {invoice.reservationRef}
                      <span className={styles.identifier}>Estancia: {invoice.stayId}</span>
                    </td>
                    <td>
                      {invoice.customerName}
                      <span className={styles.cellMeta}>{invoice.customerTaxId}</span>
                    </td>
                    <td>{invoiceChannelLabel(invoice.channel, invoice.otaId)}</td>
                    <td className={styles.money}>
                      {formatInvoiceMoney(invoice.totalAmount, invoice.currency)}
                    </td>
                    <td>
                      <Button
                        variant="secondary"
                        aria-label={`Ver factura ${invoice.invoiceNumber}`}
                        onClick={() => onDetail(invoice.invoiceId)}
                      >
                        Ver detalle
                      </Button>
                    </td>
                  </tr>
                ))}
                {result.items.length === 0 && (
                  <tr>
                    <td colSpan={7} className={styles.empty}>
                      Esta página no contiene facturas. Regresa a una página anterior.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <nav className={styles.pagination} aria-label="Paginación de facturas">
            <p className={styles.muted}>
              Página {result.page} de {result.totalPages}
            </p>
            <div className={styles.actions}>
              <Button
                variant="secondary"
                disabled={busy || result.page <= 1}
                onClick={() => onPage(result.page - 1)}
              >
                Anterior
              </Button>
              <Button
                variant="secondary"
                disabled={busy || result.page >= result.totalPages}
                onClick={() => onPage(result.page + 1)}
              >
                Siguiente
              </Button>
            </div>
          </nav>
        </>
      )}
    </section>
  );
}
