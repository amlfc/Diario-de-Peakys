import { Currency, LiquidityEvent, Transaction } from '../types';

export const HISTORICAL_PRICE_FEED_KEY = 'HISTORICAL_PRICE_FEED_URL';

export type HistoricalReturnCoverage = 'loading' | 'complete' | 'incomplete' | 'not_configured';
export type HistoricalReturnIssue = 'missing_data' | 'invalid_period' | 'source_empty' | null;

export interface MonthlyPerformanceMetrics {
  timeWeightedReturnYtdPct: number | null;
  lastCompleteMonthReturnPct: number | null;
  historicalReturnCoverage: HistoricalReturnCoverage;
  historicalReturnIssue: HistoricalReturnIssue;
  historicalReturnMissingSymbols: string[];
}

type HistoricalPointType = 'ASSET' | 'FX';

export interface HistoricalPricePoint {
  date: string;
  type: HistoricalPointType;
  symbol: string;
  valueEur: number;
}

export interface PerformanceCalculationInput {
  transactions: Transaction[];
  liquidity: LiquidityEvent[];
  currentEquityEur: number;
  now?: Date;
}

interface ValuationResult {
  valueEur: number | null;
  missingSymbols: string[];
}

const HISTORICAL_CACHE_DURATION = 5 * 60 * 1000;
const MAX_PRICE_STALENESS_DAYS = 7;
const POSITION_EPSILON = 0.000001;

let historicalCache: { url: string; fetchedAt: number; points: HistoricalPricePoint[] } | null = null;

const toNumber = (value: unknown): number => {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (value === null || value === undefined || value === '') return 0;

  let normalized = String(value).trim().replace(/[\s\u00a0€$£¥]/g, '');
  if (normalized.includes(',') && normalized.includes('.')) {
    normalized = normalized.lastIndexOf(',') > normalized.lastIndexOf('.')
      ? normalized.replace(/\./g, '').replace(',', '.')
      : normalized.replace(/,/g, '');
  } else if (normalized.includes(',')) {
    normalized = normalized.replace(',', '.');
  }

  const parsed = Number.parseFloat(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
};

const resolveKey = (value: any, keys: string[]) => {
  for (const key of keys) {
    if (value?.[key] !== undefined && value?.[key] !== null) return value[key];
  }
  return undefined;
};

const splitCsvLine = (line: string, delimiter: string): string[] => {
  const values: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const next = line[index + 1];

    if (char === '"' && inQuotes && next === '"') {
      current += '"';
      index += 1;
    } else if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === delimiter && !inQuotes) {
      values.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }

  values.push(current.trim());
  return values;
};

const toDateKey = (date: Date): string => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const parseDateKey = (value: unknown): string | null => {
  const raw = String(value || '').trim();
  if (!raw) return null;

  const isoMatch = raw.match(/^(\d{4})[-\/]([01]?\d)[-\/]([0-3]?\d)/);
  if (isoMatch) {
    const date = new Date(Number(isoMatch[1]), Number(isoMatch[2]) - 1, Number(isoMatch[3]));
    return Number.isNaN(date.getTime()) ? null : toDateKey(date);
  }

  const localMatch = raw.match(/^([0-3]?\d)[-\/]([01]?\d)[-\/](\d{4})/);
  if (localMatch) {
    const date = new Date(Number(localMatch[3]), Number(localMatch[2]) - 1, Number(localMatch[1]));
    return Number.isNaN(date.getTime()) ? null : toDateKey(date);
  }

  return null;
};

const parseDate = (dateKey: string): Date => {
  const [year, month, day] = dateKey.split('-').map(Number);
  return new Date(year, month - 1, day);
};

const daysBetween = (fromDateKey: string, toDateKeyValue: string): number => {
  const milliseconds = parseDate(toDateKeyValue).getTime() - parseDate(fromDateKey).getTime();
  return Math.round(milliseconds / 86400000);
};

const endOfMonth = (year: number, monthIndex: number): string =>
  toDateKey(new Date(year, monthIndex + 1, 0));

const getCsvUrl = (rawUrl: string): string => {
  const trimmed = rawUrl.trim();
  const publishedMatch = trimmed.match(/\/spreadsheets\/d\/e\/([a-zA-Z0-9-_]+)/);
  const sheetMatch = trimmed.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);

  let gid = '';
  try {
    gid = new URL(trimmed).searchParams.get('gid') || '';
  } catch {
    return trimmed;
  }

  if (publishedMatch?.[1]) {
    const gidParam = gid ? `&gid=${encodeURIComponent(gid)}` : '';
    return `https://docs.google.com/spreadsheets/d/e/${publishedMatch[1]}/pub?output=csv&single=true${gidParam}`;
  }

  if (sheetMatch?.[1]) {
    const gidParam = gid ? `&gid=${encodeURIComponent(gid)}` : '';
    return `https://docs.google.com/spreadsheets/d/${sheetMatch[1]}/export?format=csv${gidParam}`;
  }

  return trimmed;
};

const parseHistoricalCsv = (csv: string): HistoricalPricePoint[] => {
  const lines = csv.split(/\r?\n/).filter(line => line.trim().length > 0);
  if (lines.length < 2) return [];

  const delimiter = lines[0].split(';').length > lines[0].split(',').length ? ';' : ',';
  const headers = splitCsvLine(lines[0], delimiter).map(header => header.trim().toLowerCase());
  const dateIndex = headers.indexOf('date');
  const typeIndex = headers.indexOf('type');
  const symbolIndex = headers.indexOf('symbol');
  const valueIndex = headers.findIndex(header => header === 'valueeur' || header === 'value_eur');

  if ([dateIndex, typeIndex, symbolIndex, valueIndex].some(index => index < 0)) return [];

  return lines.slice(1).flatMap(line => {
    const columns = splitCsvLine(line, delimiter);
    const date = parseDateKey(columns[dateIndex]);
    const type = String(columns[typeIndex] || '').trim().toUpperCase();
    const symbol = String(columns[symbolIndex] || '').trim().toUpperCase();
    const valueEur = toNumber(columns[valueIndex]);

    if (!date || (type !== 'ASSET' && type !== 'FX') || !symbol || valueEur <= 0) return [];
    return [{ date, type: type as HistoricalPointType, symbol, valueEur }];
  });
};

const fetchHistoricalPoints = async (): Promise<HistoricalPricePoint[] | null> => {
  const rawUrl = localStorage.getItem(HISTORICAL_PRICE_FEED_KEY)?.trim();
  if (!rawUrl) return null;

  const csvUrl = getCsvUrl(rawUrl);
  if (
    historicalCache
    && historicalCache.url === csvUrl
    && Date.now() - historicalCache.fetchedAt < HISTORICAL_CACHE_DURATION
  ) {
    return historicalCache.points;
  }

  try {
    const response = await fetch(csvUrl);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const points = parseHistoricalCsv(await response.text());
    historicalCache = { url: csvUrl, fetchedAt: Date.now(), points };
    return points;
  } catch (error) {
    console.error('Error fetching historical Google Sheets data:', error);
    return [];
  }
};

const isBuyOperation = (type: unknown): boolean => {
  const normalized = String(type || '').trim().toLowerCase();
  if (!normalized) return true;
  return normalized.includes('compra') || normalized.includes('buy') || normalized === 'b' || normalized === 'c';
};

const KNOWN_CURRENCIES = new Set([
  'EUR', 'USD', 'GBP', 'CHF', 'CAD', 'JPY', 'AUD', 'HKD',
  'NZD', 'SEK', 'NOK', 'DKK', 'PLN', 'CZK', 'HUF', 'RON',
  'TRY', 'MXN', 'BRL', 'ZAR', 'SGD', 'CNH', 'CNY'
]);

const isCurrencyExchangeTransaction = (rawTx: any): boolean => {
  const ticker = String(resolveKey(rawTx, ['ticker']) || '').toUpperCase().trim();
  const labels = [
    resolveKey(rawTx, ['assetType', 'asset_type', 'tipo_activo']),
    resolveKey(rawTx, ['assetName', 'asset_name', 'nombre']),
    resolveKey(rawTx, ['notes', 'nota'])
  ].map(value => String(value || '').toLowerCase());

  const pairMatch = ticker.match(/^([A-Z]{3})[.\/_-]?([A-Z]{3})$/);
  const isForexPair = !!pairMatch
    && pairMatch[1] !== pairMatch[2]
    && KNOWN_CURRENCIES.has(pairMatch[1])
    && KNOWN_CURRENCIES.has(pairMatch[2]);
  return isForexPair || labels.some(label =>
    label.includes('divisa') || label.includes('forex') || label.includes('fx') || label.includes('cambio')
  );
};

const buildPointIndex = (points: HistoricalPricePoint[]) => {
  const index = new Map<string, HistoricalPricePoint[]>();

  for (const point of points) {
    const key = `${point.type}:${point.symbol}`;
    const entries = index.get(key) || [];
    entries.push(point);
    index.set(key, entries);
  }

  for (const entries of index.values()) {
    entries.sort((a, b) => a.date.localeCompare(b.date));
  }

  return index;
};

const findHistoricalValue = (
  index: Map<string, HistoricalPricePoint[]>,
  type: HistoricalPointType,
  symbol: string,
  targetDate: string
): number | null => {
  if (type === 'FX' && symbol === Currency.EUR) return 1;

  const entries = index.get(`${type}:${symbol.toUpperCase()}`) || [];
  for (let position = entries.length - 1; position >= 0; position -= 1) {
    const point = entries[position];
    if (point.date > targetDate) continue;
    if (daysBetween(point.date, targetDate) > MAX_PRICE_STALENESS_DAYS) return null;
    return point.valueEur;
  }

  return null;
};

const valuePortfolioAt = (
  targetDate: string,
  transactions: Transaction[],
  liquidity: LiquidityEvent[],
  pointIndex: Map<string, HistoricalPricePoint[]>
): ValuationResult => {
  const positions = new Map<string, number>();
  const cashByCurrency: Record<string, number> = { [Currency.EUR]: 0 };

  for (const rawLiquidity of liquidity as any[]) {
    const date = parseDateKey(rawLiquidity.date);
    if (!date || date > targetDate) continue;
    cashByCurrency[Currency.EUR] += toNumber(resolveKey(rawLiquidity, ['amountEur', 'amount_eur', 'amount', 'importe']));
  }

  const orderedTransactions = [...transactions].sort((a, b) => String(a.date).localeCompare(String(b.date)));
  for (const rawTx of orderedTransactions as any[]) {
    const date = parseDateKey(rawTx.date);
    if (!date || date > targetDate || rawTx.excludeFromMetrics || isCurrencyExchangeTransaction(rawTx)) continue;

    const ticker = String(rawTx.ticker || '').trim().toUpperCase();
    if (!ticker) continue;

    const quantity = Math.abs(toNumber(resolveKey(rawTx, ['quantity', 'qty', 'cantidad'])));
    const price = toNumber(resolveKey(rawTx, ['price', 'precio', 'coste']));
    const commission = Math.abs(toNumber(resolveKey(rawTx, ['commission', 'comision', 'fees'])));
    const currency = String(resolveKey(rawTx, ['currencyPlatform', 'currency_platform', 'divisa', 'currency']) || Currency.EUR)
      .trim()
      .toUpperCase();
    const isBuy = isBuyOperation(resolveKey(rawTx, ['type', 'tipo', 'operacion']));

    positions.set(ticker, (positions.get(ticker) || 0) + (isBuy ? quantity : -quantity));

    if (!rawTx.nonCash) {
      const cashChange = isBuy
        ? -((quantity * price) + commission)
        : (quantity * price) - commission;
      cashByCurrency[currency] = (cashByCurrency[currency] || 0) + cashChange;
    }
  }

  let valueEur = 0;
  const missingSymbols = new Set<string>();

  for (const [ticker, quantity] of positions.entries()) {
    if (Math.abs(quantity) <= POSITION_EPSILON) continue;
    const priceEur = findHistoricalValue(pointIndex, 'ASSET', ticker, targetDate);
    if (priceEur === null) {
      missingSymbols.add(ticker);
      continue;
    }
    valueEur += quantity * priceEur;
  }

  for (const [currency, amount] of Object.entries(cashByCurrency)) {
    if (Math.abs(amount) <= POSITION_EPSILON) continue;
    const fxRate = findHistoricalValue(pointIndex, 'FX', currency, targetDate);
    if (fxRate === null) {
      missingSymbols.add(`FX:${currency}`);
      continue;
    }
    valueEur += amount * fxRate;
  }

  return {
    valueEur: missingSymbols.size > 0 ? null : valueEur,
    missingSymbols: Array.from(missingSymbols)
  };
};

const calculatePeriodReturn = (
  startDate: string,
  endDate: string,
  transactions: Transaction[],
  liquidity: LiquidityEvent[],
  pointIndex: Map<string, HistoricalPricePoint[]>,
  endValueOverride?: number
): { value: number | null; missingSymbols: string[] } => {
  const startValuation = valuePortfolioAt(startDate, transactions, liquidity, pointIndex);
  const endValuation = endValueOverride === undefined
    ? valuePortfolioAt(endDate, transactions, liquidity, pointIndex)
    : { valueEur: endValueOverride, missingSymbols: [] };

  const missingSymbols = [...startValuation.missingSymbols, ...endValuation.missingSymbols];
  if (startValuation.valueEur === null || endValuation.valueEur === null) {
    return { value: null, missingSymbols };
  }

  const periodDays = Math.max(daysBetween(startDate, endDate), 1);
  let totalFlows = 0;
  let weightedFlows = 0;

  for (const rawLiquidity of liquidity as any[]) {
    const flowDate = parseDateKey(rawLiquidity.date);
    if (!flowDate || flowDate <= startDate || flowDate > endDate) continue;

    const amount = toNumber(resolveKey(rawLiquidity, ['amountEur', 'amount_eur', 'amount', 'importe']));
    const remainingDays = Math.max(daysBetween(flowDate, endDate) + 1, 0);
    const weight = Math.min(remainingDays / periodDays, 1);
    totalFlows += amount;
    weightedFlows += amount * weight;
  }

  const denominator = startValuation.valueEur + weightedFlows;
  const numerator = endValuation.valueEur - startValuation.valueEur - totalFlows;

  if (Math.abs(denominator) <= POSITION_EPSILON) {
    const noActivity = Math.abs(startValuation.valueEur) <= POSITION_EPSILON
      && Math.abs(endValuation.valueEur) <= POSITION_EPSILON
      && Math.abs(totalFlows) <= POSITION_EPSILON;
    return { value: noActivity ? 0 : null, missingSymbols };
  }

  return { value: numerator / denominator, missingSymbols };
};

export const calculateMonthlyPerformanceFromPoints = ({
  transactions,
  liquidity,
  currentEquityEur,
  now = new Date()
}: PerformanceCalculationInput, points: HistoricalPricePoint[]): MonthlyPerformanceMetrics => {
  if (points.length === 0) {
    return {
      timeWeightedReturnYtdPct: null,
      lastCompleteMonthReturnPct: null,
      historicalReturnCoverage: 'incomplete',
      historicalReturnIssue: 'source_empty',
      historicalReturnMissingSymbols: []
    };
  }

  const pointIndex = buildPointIndex(points);
  const today = toDateKey(now);
  const year = now.getFullYear();
  const currentMonth = now.getMonth();
  let periodStart = endOfMonth(year - 1, 11);
  let accumulatedFactor = 1;
  const missingSymbols = new Set<string>();

  for (let monthIndex = 0; monthIndex <= currentMonth; monthIndex += 1) {
    const isCurrentMonth = monthIndex === currentMonth;
    const periodEnd = isCurrentMonth ? today : endOfMonth(year, monthIndex);
    const period = calculatePeriodReturn(
      periodStart,
      periodEnd,
      transactions,
      liquidity,
      pointIndex,
      isCurrentMonth ? currentEquityEur : undefined
    );

    period.missingSymbols.forEach(symbol => missingSymbols.add(symbol));
    if (period.value === null || !Number.isFinite(period.value)) {
      console.warn('Historical return unavailable for period', { periodStart, periodEnd, missingSymbols: Array.from(missingSymbols) });
      return {
        timeWeightedReturnYtdPct: null,
        lastCompleteMonthReturnPct: null,
        historicalReturnCoverage: 'incomplete',
        historicalReturnIssue: missingSymbols.size > 0 ? 'missing_data' : 'invalid_period',
        historicalReturnMissingSymbols: Array.from(missingSymbols)
      };
    }

    accumulatedFactor *= 1 + period.value;
    periodStart = periodEnd;
  }

  const previousMonthEnd = endOfMonth(year, currentMonth - 1);
  const previousMonthStart = endOfMonth(year, currentMonth - 2);
  const lastCompleteMonth = calculatePeriodReturn(
    previousMonthStart,
    previousMonthEnd,
    transactions,
    liquidity,
    pointIndex
  );

  lastCompleteMonth.missingSymbols.forEach(symbol => missingSymbols.add(symbol));
  if (lastCompleteMonth.value === null || !Number.isFinite(lastCompleteMonth.value)) {
    console.warn('Last complete month return unavailable', {
      previousMonthStart,
      previousMonthEnd,
      missingSymbols: Array.from(missingSymbols)
    });
    return {
      timeWeightedReturnYtdPct: null,
      lastCompleteMonthReturnPct: null,
      historicalReturnCoverage: 'incomplete',
      historicalReturnIssue: missingSymbols.size > 0 ? 'missing_data' : 'invalid_period',
      historicalReturnMissingSymbols: Array.from(missingSymbols)
    };
  }

  return {
    timeWeightedReturnYtdPct: accumulatedFactor - 1,
    lastCompleteMonthReturnPct: lastCompleteMonth.value,
    historicalReturnCoverage: 'complete',
    historicalReturnIssue: null,
    historicalReturnMissingSymbols: []
  };
};

export const calculateMonthlyPerformanceMetrics = async (
  input: PerformanceCalculationInput
): Promise<MonthlyPerformanceMetrics> => {
  const points = await fetchHistoricalPoints();
  if (points === null) {
    return {
      timeWeightedReturnYtdPct: null,
      lastCompleteMonthReturnPct: null,
      historicalReturnCoverage: 'not_configured',
      historicalReturnIssue: null,
      historicalReturnMissingSymbols: []
    };
  }

  return calculateMonthlyPerformanceFromPoints(input, points);
};
