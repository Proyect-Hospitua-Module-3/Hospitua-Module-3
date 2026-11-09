// Feature 009 · Modificar precio tarifa según temporada
// Mismas reglas de nombre, color y ajuste que los value objects del backend.
import type { SeasonRuleInput } from '../api/seasonRules';

export const SEASON_NAME_MAX_LENGTH = 50;

export interface SeasonInputErrors {
  name?: string;
  color?: string;
  adjustmentPercent?: string;
}

export type SeasonInputResult =
  | { ok: true; value: SeasonRuleInput }
  | { ok: false; errors: SeasonInputErrors };

const COLOR_FORMAT = /^#[0-9a-fA-F]{6}$/;
const ADJUSTMENT_FORMAT = /^([+-]?)(\d+)(?:\.(\d{1,2}))?$/;

// Normaliza el porcentaje con operaciones de texto: no redondea ni convierte el
// decimal a coma flotante. "-0" se guarda como "0.00", igual que en el backend.
function parseAdjustment(raw: string): string | null {
  const text = raw.trim().replace('−', '-').replace(',', '.');
  const match = ADJUSTMENT_FORMAT.exec(text);
  if (!match) return null;

  const [, sign, digits, decimals = ''] = match;
  const whole = digits.replace(/^0+(?=\d)/, '');
  const fraction = decimals.padEnd(2, '0');
  if (whole.length > 3 || (whole.length === 3 && whole > '100')) return null;
  if (whole === '100' && fraction !== '00') return null;

  const negative = sign === '-' && (whole !== '0' || fraction !== '00');
  return `${negative ? '-' : ''}${whole}.${fraction}`;
}

export function parseSeasonInput(input: SeasonRuleInput): SeasonInputResult {
  const errors: SeasonInputErrors = {};
  const name = input.name.trim();
  const color = input.color.trim().toUpperCase();
  const adjustmentPercent = parseAdjustment(input.adjustmentPercent);

  if (name === '') {
    errors.name = 'Escribe el nombre de la temporada.';
  } else if (name.length > SEASON_NAME_MAX_LENGTH) {
    errors.name = `Usa como máximo ${SEASON_NAME_MAX_LENGTH} caracteres.`;
  }
  if (!COLOR_FORMAT.test(color)) {
    errors.color = 'Escribe un color hexadecimal de seis dígitos, por ejemplo #C0392B.';
  }
  if (adjustmentPercent === null) {
    errors.adjustmentPercent = 'Escribe un porcentaje entre -100 y 100, con hasta 2 decimales.';
  }

  if (Object.keys(errors).length > 0 || adjustmentPercent === null) {
    return { ok: false, errors };
  }
  return { ok: true, value: { name, color, adjustmentPercent } };
}
