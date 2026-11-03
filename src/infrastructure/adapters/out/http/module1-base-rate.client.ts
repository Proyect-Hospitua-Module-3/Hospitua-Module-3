import { HttpService } from '@nestjs/axios';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import CircuitBreaker from 'opossum';
import { firstValueFrom } from 'rxjs';
import { InvalidBaseRateError } from '../../../../domain/errors/pricing/invalid-base-rate.error';
import { MalformedBaseRateResponseError } from '../../../../domain/errors/pricing/malformed-base-rate-response.error';
import { Module1UnavailableError } from '../../../../domain/errors/pricing/module1-unavailable.error';
import { RoomNotFoundError } from '../../../../domain/errors/pricing/room-not-found.error';
import {
  BASE_RATE_DECIMAL_TEXT_FORMAT,
  BaseRate,
  hasAtMostTwoSignificantDecimalPlaces,
} from '../../../../domain/model/pricing/base-rate';
import { BaseRateClientPort } from '../../../../domain/ports/out/pricing/base-rate.client.port';

export const CIRCUIT_FAILURE_THRESHOLD = 5;
export const CIRCUIT_RESET_TIMEOUT_MS = 30_000;
const CIRCUIT_ERROR_THRESHOLD_PERCENTAGE = 101;
const ROOM_NOT_FOUND_HTTP_STATUS = 404;

interface Module1BaseRateResponse {
  roomId: string;
  date: string;
  baseRate: string;
  currency: string;
}

interface Module1ApiError {
  errorCode: string;
  message: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

@Injectable()
export class Module1BaseRateClient implements BaseRateClientPort {
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private consecutiveFailures = 0;
  private nextRequestId = 0;
  // errorFilter suppresses business errors; requestId maps each filtered result back to its error.
  private readonly filteredErrors = new Map<number, RoomNotFoundError | InvalidBaseRateError>();
  private readonly breaker: CircuitBreaker;

  constructor(
    private readonly http: HttpService,
    config: ConfigService,
  ) {
    const configuredBaseUrl = config.get<string>('MODULE1_BASE_URL');
    const configuredTimeout = config.get<string>('MODULE1_TIMEOUT_MS');
    if (!configuredBaseUrl?.trim()) {
      throw new Error('Falta configurar MODULE1_BASE_URL.');
    }
    if (!configuredTimeout?.trim()) {
      throw new Error('Falta configurar MODULE1_TIMEOUT_MS.');
    }
    const timeout = Number(configuredTimeout);
    if (!Number.isSafeInteger(timeout) || timeout <= 0) {
      throw new Error('MODULE1_TIMEOUT_MS debe ser un entero positivo.');
    }
    this.baseUrl = configuredBaseUrl.replace(/\/$/, '');
    this.timeoutMs = timeout;
    this.breaker = new CircuitBreaker(
      (requestId: number, roomId: string, date: string) => this.request(requestId, roomId, date),
      {
        // Deliberately kept with Axios timeout to bound the breaker action's execution.
        timeout: this.timeoutMs,
        resetTimeout: CIRCUIT_RESET_TIMEOUT_MS,
        // Automatic percentage trips are disabled. The explicit consecutive
        // failure counter below opens the breaker exactly on failure five.
        errorThresholdPercentage: CIRCUIT_ERROR_THRESHOLD_PERCENTAGE,
        volumeThreshold: 0,
        errorFilter: (...args: unknown[]) => {
          const [error, requestId] = args;
          if (typeof requestId !== 'number') return false;
          if (error instanceof RoomNotFoundError || error instanceof InvalidBaseRateError) {
            this.filteredErrors.set(requestId, error);
            return true;
          }
          return false;
        },
      },
    );
    this.breaker.on('success', () => {
      this.consecutiveFailures = 0;
    });
  }

  async getBaseRate(roomId: string, date: string): Promise<BaseRate> {
    const requestId = ++this.nextRequestId;
    try {
      const result = (await this.breaker.fire(requestId, roomId, date)) as BaseRate | boolean;
      if (result === true) {
        const filteredError = this.filteredErrors.get(requestId);
        this.filteredErrors.delete(requestId);
        if (filteredError) throw filteredError;
        throw new Module1UnavailableError();
      }
      if (result === false) throw new Module1UnavailableError();
      return result;
    } catch (error: unknown) {
      this.filteredErrors.delete(requestId);
      const translated = this.translateFailure(error);
      if (this.isDependencyFailure(translated)) {
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

  // Opossum passes _requestId to errorFilter to correlate a filtered result with its request.
  private async request(_requestId: number, roomId: string, date: string): Promise<BaseRate> {
    try {
      const response = await firstValueFrom(
        this.http.get<unknown>(`${this.baseUrl}/api/rooms/${roomId}/base-rate`, {
          params: { date },
          // This timeout cancels the HTTP request; the breaker timeout above also remains active.
          timeout: this.timeoutMs,
        }),
      );
      return this.parseResponse(response.data, roomId, date);
    } catch (error: unknown) {
      if (error instanceof RoomNotFoundError || error instanceof InvalidBaseRateError) {
        throw error;
      }
      if (error instanceof MalformedBaseRateResponseError) throw error;
      if (isRecord(error) && isRecord(error.response)) {
        const status = error.response.status;
        if (status === ROOM_NOT_FOUND_HTTP_STATUS && this.isRoomNotFoundBody(error.response.data)) {
          throw new RoomNotFoundError();
        }
        throw new Module1UnavailableError(error);
      }
      throw new Module1UnavailableError(error);
    }
  }

  private parseResponse(body: unknown, roomId: string, date: string): BaseRate {
    if (!isRecord(body)) throw new MalformedBaseRateResponseError();
    const response = body as Partial<Module1BaseRateResponse>;
    if (
      typeof response.roomId !== 'string' ||
      typeof response.date !== 'string' ||
      typeof response.baseRate !== 'string' ||
      typeof response.currency !== 'string' ||
      response.roomId !== roomId ||
      response.date !== date ||
      response.currency !== 'COP' ||
      !BASE_RATE_DECIMAL_TEXT_FORMAT.test(response.baseRate) ||
      !hasAtMostTwoSignificantDecimalPlaces(response.baseRate)
    ) {
      throw new MalformedBaseRateResponseError();
    }
    return BaseRate.create(response.baseRate);
  }

  private isRoomNotFoundBody(body: unknown): body is Module1ApiError {
    return (
      isRecord(body) && body.errorCode === 'ROOM_NOT_FOUND' && typeof body.message === 'string'
    );
  }

  private translateFailure(
    error: unknown,
  ):
    | RoomNotFoundError
    | InvalidBaseRateError
    | MalformedBaseRateResponseError
    | Module1UnavailableError {
    if (
      error instanceof RoomNotFoundError ||
      error instanceof InvalidBaseRateError ||
      error instanceof MalformedBaseRateResponseError ||
      error instanceof Module1UnavailableError
    ) {
      return error;
    }
    return new Module1UnavailableError(error);
  }

  private isDependencyFailure(
    error:
      | RoomNotFoundError
      | InvalidBaseRateError
      | MalformedBaseRateResponseError
      | Module1UnavailableError,
  ): boolean {
    return (
      error instanceof MalformedBaseRateResponseError || error instanceof Module1UnavailableError
    );
  }
}
