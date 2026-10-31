// Error base de las reglas de negocio. Cada error define su `errorCode` estable;
// el ExceptionFilter global decide el código HTTP (el dominio no conoce HTTP).
export abstract class DomainError extends Error {
  abstract readonly errorCode: string;

  protected constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}
