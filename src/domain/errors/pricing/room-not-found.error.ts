import { DomainError } from '../domain.error';

export class RoomNotFoundError extends DomainError {
  readonly errorCode = 'ROOM_NOT_FOUND';

  constructor() {
    super('La habitación solicitada no existe en Módulo 1.');
  }
}
