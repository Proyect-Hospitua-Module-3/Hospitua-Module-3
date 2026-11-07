// Feature 001 · Actualizar porcentaje de IVA
// Validación del campo "Nuevo porcentaje" antes de llamar al backend. Son las mismas
// reglas del dominio (VatRateValue): de 0 a 100, con a lo sumo 2 decimales (FR-002,
// NFR-004). El backend vuelve a validar; esto solo evita un viaje inútil.

export type VatInputError = 'empty' | 'format' | 'range' | 'decimals';

export type VatInputResult = { ok: true; value: string } | { ok: false; error: VatInputError };

// Acepta coma o punto decimal y el signo menos tipográfico (−), para que "-5" y "−5"
// se rechacen igual por estar fuera de rango.
const NUMBER_FORMAT = /^-?\d+(\.\d+)?$/;

export function parseVatInput(raw: string): VatInputResult {
  const text = raw.trim().replace(',', '.').replace('−', '-');
  if (text === '') return { ok: false, error: 'empty' };
  if (!NUMBER_FORMAT.test(text)) return { ok: false, error: 'format' };

  const value = Number(text);
  if (value < 0 || value > 100) return { ok: false, error: 'range' };

  const decimals = text.split('.')[1] ?? '';
  if (decimals.replace(/0+$/, '').length > 2) return { ok: false, error: 'decimals' };

  // Mismo formato que devuelve el backend: "19.00".
  return { ok: true, value: value.toFixed(2) };
}

// Mensaje bajo el campo (estado 2 del diseño). `current` es el vigente ya formateado, p. ej.
// "19 %", o null si todavía no hay ninguno.
export function vatInputErrorMessage(error: VatInputError, current: string | null): string {
  const keeps = current ? ` Se conserva ${current}.` : '';
  switch (error) {
    case 'empty':
      return 'Escribe el nuevo porcentaje.';
    case 'format':
      return `Escribe un número, por ejemplo 19 o 19,5.${keeps}`;
    case 'range':
      return `No puede ser negativo ni mayor a 100 %.${keeps}`;
    case 'decimals':
      return `Usa a lo sumo 2 decimales.${keeps}`;
  }
}
