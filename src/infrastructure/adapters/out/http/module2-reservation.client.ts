// Feature 007 · Generar liquidación
// Contrato: features/007-generar-liquidacion/2-technical/contracts/CLIENT-get-reservation.md
import { HttpService } from '@nestjs/axios';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import CircuitBreaker from 'opossum';
import { firstValueFrom } from 'rxjs';
import { Module2UnavailableError } from '../../../../domain/errors/settlement/module2-unavailable.error';
import { ReservationNotFoundError } from '../../../../domain/errors/settlement/reservation-not-found.error';
import { OTA_CHANNEL, ReservationData } from '../../../../domain/model/settlement/reservation-data';
import { ReservationClientPort } from '../../../../domain/ports/out/settlement/reservation.client.port';

// Mismos parámetros del circuito que el cliente de Módulo 1 (004).
export const CIRCUIT_FAILURE_THRESHOLD = 5;
export const CIRCUIT_RESET_TIMEOUT_MS = 30_000;
const CIRCUIT_ERROR_THRESHOLD_PERCENTAGE = 101;
const RESERVATION_NOT_FOUND_HTTP_STATUS = 404;

// Formato que aceptan 004, 005 y 005/findByIds: hexadecimal 8-4-4-4-12, sin exigir el RFC.
const UUID_FORMAT = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Respuesta 200 que no cumple el contrato. Se registra y sale como MODULE2_UNAVAILABLE.
class ReservationContractMismatch extends Error {}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isFilledText(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== '';
}

@Injectable()
export class Module2ReservationClient implements ReservationClientPort {
  private readonly logger = new Logger(Module2ReservationClient.name);
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private consecutiveFailures = 0;
  private readonly breaker: CircuitBreaker;

  constructor(
    private readonly http: HttpService,
    config: ConfigService,
  ) {
    const configuredBaseUrl = config.get<string>('MODULE2_BASE_URL');
    const configuredTimeout = config.get<string>('MODULE2_TIMEOUT_MS');
    if (!configuredBaseUrl?.trim()) {
      throw new Error('Falta configurar MODULE2_BASE_URL.');
    }
    if (!configuredTimeout?.trim()) {
      throw new Error('Falta configurar MODULE2_TIMEOUT_MS.');
    }
    const timeout = Number(configuredTimeout);
    if (!Number.isSafeInteger(timeout) || timeout <= 0) {
      throw new Error('MODULE2_TIMEOUT_MS debe ser un entero positivo.');
    }
    this.baseUrl = configuredBaseUrl.replace(/\/$/, '');
    this.timeoutMs = timeout;
    this.breaker = new CircuitBreaker(
      (reservationRef: string, correlationId?: string) =>
        this.request(reservationRef, correlationId),
      {
        // Igual que en 004: acota la ejecución de la acción del breaker, junto al timeout
        // de Axios.
        timeout: this.timeoutMs,
        resetTimeout: CIRCUIT_RESET_TIMEOUT_MS,
        // La apertura por porcentaje está desactivada; el contador de fallos consecutivos
        // de abajo abre el circuito exactamente en el quinto fallo.
        errorThresholdPercentage: CIRCUIT_ERROR_THRESHOLD_PERCENTAGE,
        volumeThreshold: 0,
        // Una reserva inexistente es una respuesta de negocio: no cuenta como fallo y, en
        // half-open, cierra el circuito.
        errorFilter: (error: unknown) => error instanceof ReservationNotFoundError,
      },
    );
    this.breaker.on('success', () => {
      this.consecutiveFailures = 0;
    });
  }

  async getReservation(reservationRef: string, correlationId?: string): Promise<ReservationData> {
    try {
      return (await this.breaker.fire(reservationRef, correlationId)) as ReservationData;
    } catch (error: unknown) {
      const translated =
        error instanceof ReservationNotFoundError || error instanceof Module2UnavailableError
          ? error
          : // Circuito abierto o timeout del breaker.
            new Module2UnavailableError(reservationRef, error);
      if (translated instanceof Module2UnavailableError) {
        this.consecutiveFailures += 1;
        if (this.consecutiveFailures >= CIRCUIT_FAILURE_THRESHOLD) {
          this.consecutiveFailures = 0;
          this.breaker.open();
        }
      } else {
        this.consecutiveFailures = 0;
      }
      throw translated;
    }
  }

  private async request(reservationRef: string, correlationId?: string): Promise<ReservationData> {
    try {
      const response = await firstValueFrom(
        this.http.get<unknown>(
          `${this.baseUrl}/api/reservations/${encodeURIComponent(reservationRef)}`,
          {
            headers: {
              Accept: 'application/json',
              ...(correlationId ? { 'X-Correlation-Id': correlationId } : {}),
            },
            // Este timeout cancela la petición HTTP; el del circuito (arriba) también sigue activo.
            timeout: this.timeoutMs,
          },
        ),
      );
      return this.parseResponse(response.data, reservationRef);
    } catch (error: unknown) {
      if (error instanceof ReservationContractMismatch) {
        // Solo el campo que falla, nunca el cuerpo: puede traer datos personales (NFR-006).
        this.logger.warn(
          `Respuesta de Módulo 2 fuera de contrato para la reserva ${reservationRef}: ${error.message}`,
        );
        throw new Module2UnavailableError(reservationRef, error);
      }
      if (isRecord(error) && isRecord(error.response)) {
        if (error.response.status === RESERVATION_NOT_FOUND_HTTP_STATUS) {
          throw new ReservationNotFoundError(reservationRef);
        }
      }
      // 5xx, otro 4xx (problema de configuración o de contrato), timeout o fallo de red.
      throw new Module2UnavailableError(reservationRef, error);
    }
  }

  // Solo se toman los campos del contrato; el resto se descarta (NFR-006).
  private parseResponse(body: unknown, reservationRef: string): ReservationData {
    if (!isRecord(body)) {
      throw new ReservationContractMismatch('el cuerpo no es un objeto JSON');
    }
    if (body.reservationRef !== reservationRef) {
      throw new ReservationContractMismatch('reservationRef no coincide con el solicitado');
    }
    const quoteIds = body.quoteIds;
    if (
      !Array.isArray(quoteIds) ||
      !quoteIds.every((id): id is string => typeof id === 'string' && UUID_FORMAT.test(id))
    ) {
      throw new ReservationContractMismatch('quoteIds debe ser una lista de UUID');
    }
    const channel = body.channel ?? null;
    if (channel !== null && typeof channel !== 'string') {
      throw new ReservationContractMismatch('channel debe ser texto');
    }

    // Cualquier canal distinto de OTA es directo y sus campos de OTA se ignoran.
    if (channel !== OTA_CHANNEL) {
      return { reservationRef, quoteIds, channel };
    }
    if (!isFilledText(body.otaId)) {
      throw new ReservationContractMismatch('otaId es obligatorio con channel = OTA');
    }
    if (!isFilledText(body.otaConfirmationCode)) {
      throw new ReservationContractMismatch('otaConfirmationCode es obligatorio con channel = OTA');
    }
    const percentage = body.otaCommissionPercentage;
    if (
      percentage !== undefined &&
      percentage !== null &&
      typeof percentage !== 'number' &&
      typeof percentage !== 'string'
    ) {
      throw new ReservationContractMismatch('otaCommissionPercentage debe ser número o texto');
    }
    // Si falta o es inválido, lo rechaza el servicio (MISSING_COMMISSION / INVALID_COMMISSION).
    return {
      reservationRef,
      quoteIds,
      channel,
      otaId: body.otaId,
      otaConfirmationCode: body.otaConfirmationCode,
      otaCommissionPercentage: percentage,
    };
  }
}
