import { Currency } from '../types';

export const FALLBACK_FX_RATES: Record<string, number> = {
  [Currency.USD]: 0.94,
  [Currency.EUR]: 1,
  [Currency.GBP]: 1.15,
  [Currency.CHF]: 1.06,
  [Currency.CAD]: 0.68,
  [Currency.JPY]: 0.006,
  [Currency.AUD]: 0.60,
  [Currency.HKD]: 0.12,
};

export const parseFxNumber = (value: unknown): number => {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (value === null || value === undefined || value === '') return 0;

  const normalized = String(value).trim().replace(',', '.');
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
};

export const normalizeFxRateToEur = (currency: string, rate: unknown): number => {
  if (currency === Currency.EUR) return 1;

  const parsedRate = parseFxNumber(rate);
  if (!parsedRate || parsedRate <= 0) {
    return FALLBACK_FX_RATES[currency] || 1;
  }

  // USD is often entered as EURUSD, e.g. 1.17 USD per EUR.
  // Internally the app stores USD -> EUR, so values above 1 are inverted.
  if (currency === Currency.USD && parsedRate > 1) {
    return 1 / parsedRate;
  }

  return parsedRate;
};

export const isInvalidFxRate = (currency: string, rate: unknown): boolean => {
  if (currency === Currency.EUR) return false;
  const parsedRate = parseFxNumber(rate);
  return !parsedRate || parsedRate <= 0;
};
