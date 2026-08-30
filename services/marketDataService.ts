import { db } from '../db';
import { api } from './apiService';
import { 
  Transaction, 
  Position, 
  TransactionType, 
  Currency, 
  PortfolioOwner, 
  DashboardMetrics,
  LiquidityEvent
} from '../types';
import {
  FALLBACK_FX_RATES,
  isInvalidFxRate,
  normalizeCurrencyCode,
  normalizeFxRateToEur,
  parseFxNumber
} from '../utils/fx';

// Simulates GOOGLEFINANCE calls (Fallback)
const MOCK_PRICES: Record<string, number> = {
  'AAPL': 175.50,
  'MSFT': 320.10,
  'VWRL': 105.20,
  'TSLA': 240.00,
  'GOOGL': 140.00,
  'AMZN': 130.00,
  'NVDA': 450.00,
  'BTC': 35000.00
};

// Cache for fetched data: Price AND Currency
interface MarketData {
  price: number;
  currency?: string; // 'USD', 'EUR', etc.
}

let cachedMarketData: Record<string, MarketData> = {};
let lastFetchTime = 0;
const CACHE_DURATION = 60 * 1000; // 1 minute cache

// --- DATA SANITIZATION HELPERS (Fixes NaN Issues) ---

const toNumber = (val: any): number => {
  if (typeof val === 'number' && !isNaN(val)) return val;
  if (val === null || val === undefined || val === '') return 0;
  
  const str = String(val).trim();
  
  // Estándar decimal: si tiene coma pero no punto, tratamos la coma como punto
  let normalized = str;
  if (str.includes(',') && !str.includes('.')) {
    normalized = str.replace(',', '.');
  }
  
  const parsed = parseFloat(normalized);
  return isNaN(parsed) ? 0 : parsed;
};

const resolveKey = (obj: any, keys: string[]): any => {
  for (const k of keys) {
    if (obj[k] !== undefined && obj[k] !== null) return obj[k];
  }
  return undefined;
};

const isBuyOperation = (type: string): boolean => {
  if (!type) return true; // Default más seguro
  const t = String(type).toLowerCase();
  return t.includes('compra') || t.includes('buy') || t === 'b' || t === 'c';
};

const KNOWN_CURRENCIES = new Set([
  'EUR', 'USD', 'GBP', 'CHF', 'CAD', 'JPY', 'AUD', 'HKD',
  'NZD', 'SEK', 'NOK', 'DKK', 'PLN', 'CZK', 'HUF', 'RON',
  'TRY', 'MXN', 'BRL', 'ZAR', 'SGD', 'CNH', 'CNY'
]);

const isCurrencyExchangeTransaction = (rawTx: any): boolean => {
  const ticker = String(resolveKey(rawTx, ['ticker']) || '').toUpperCase().trim();
  const assetType = String(resolveKey(rawTx, ['assetType', 'asset_type', 'tipo_activo']) || '').toLowerCase();
  const assetName = String(resolveKey(rawTx, ['assetName', 'asset_name', 'nombre']) || '').toLowerCase();
  const notes = String(resolveKey(rawTx, ['notes', 'nota']) || '').toLowerCase();

  const pairMatch = ticker.match(/^([A-Z]{3})[.\/_-]?([A-Z]{3})$/);
  const isForexPair = !!pairMatch
    && pairMatch[1] !== pairMatch[2]
    && KNOWN_CURRENCIES.has(pairMatch[1])
    && KNOWN_CURRENCIES.has(pairMatch[2]);

  const looksLikeFxByLabels = [assetType, assetName, notes].some(field =>
    field.includes('divisa') || field.includes('forex') || field.includes('fx') || field.includes('cambio')
  );

  return isForexPair || looksLikeFxByLabels;
};

// --- END HELPERS ---

const getCsvUrl = (): string | null => {
  const rawUrl = localStorage.getItem('PRICE_FEED_URL');
  if (!rawUrl) return null;

  const match = rawUrl.match(/\/d\/([a-zA-Z0-9-_]+)/);
  if (match && match[1]) {
    return `https://docs.google.com/spreadsheets/d/${match[1]}/export?format=csv`;
  }

  return rawUrl;
};

// Helper para partir CSV respetando comillas
const splitCsvLine = (text: string, delimiter: string): string[] => {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;
  
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (char === '"') {
      inQuotes = !inQuotes;
      current += char; 
    } else if (char === delimiter && !inQuotes) {
      result.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  result.push(current);
  return result;
};

const parsePriceValue = (str: string): number => {
  if (!str) return 0;
  let val = str.toString().trim();
  
  if (val.startsWith('#') || val.toLowerCase().includes('loading') || val.toLowerCase().includes('error')) {
    return 0;
  }

  val = val.replace(/["']/g, '');
  val = val.replace(/[€$£¥\s\u00A0]/g, ''); 
  
  if (val.includes(',') && val.includes('.')) {
    if (val.indexOf('.') < val.indexOf(',')) {
      val = val.replace(/\./g, '').replace(',', '.');
    } else {
      val = val.replace(/,/g, '');
    }
  } else if (val.includes(',')) {
    val = val.replace(',', '.');
  }

  const result = parseFloat(val);
  return isNaN(result) ? 0 : result;
};

const fetchPricesFromSheet = async (): Promise<Record<string, MarketData>> => {
  const csvUrl = getCsvUrl();
  
  // Cache de 1 minuto
  if (Date.now() - lastFetchTime < CACHE_DURATION && Object.keys(cachedMarketData).length > 0) {
    return cachedMarketData;
  }

  if (!csvUrl) return {};

  try {
    const response = await fetch(csvUrl);
    if (!response.ok) throw new Error('Network response was not ok');
    const text = await response.text();
    
    const newMarketData: Record<string, MarketData> = {};
    const lines = text.split(/\r?\n/).filter(l => l.trim().length > 0);
    
    if (lines.length === 0) return {};

    let delimiter = ',';
    const sampleText = lines.slice(0, 5).join('');
    if (sampleText.includes(';')) {
      delimiter = ';';
    }

    let tickerIdx = 0;
    let priceIdx = 1;
    let currencyIdx = 2;

    lines.forEach((line, index) => {
      if (index === 0) {
        const lowerLine = line.toLowerCase();
        if (lowerLine.includes('ticker') || lowerLine.includes('simbolo')) {
          return; 
        }
      }

      const parts = splitCsvLine(line, delimiter);
      
      if (parts.length >= 2) {
        const ticker = parts[tickerIdx].replace(/['"]/g, '').trim().toUpperCase();
        const priceRaw = parts[priceIdx]; 
        const currencyRaw = parts.length > 2 ? parts[currencyIdx].replace(/['"\s]/g, '').trim().toUpperCase() : undefined;
        
        const price = parsePriceValue(priceRaw);

        if (ticker && !isNaN(price) && price > 0) {
          newMarketData[ticker] = {
            price,
            currency: currencyRaw && currencyRaw.length >= 3 ? currencyRaw : undefined
          };
        }
      }
    });

    console.log(`Live Data Fetched. Items: ${Object.keys(newMarketData).length}. Delimiter: '${delimiter}'`);

    cachedMarketData = newMarketData;
    lastFetchTime = Date.now();
    return newMarketData;

  } catch (error) {
    console.error("Error fetching live prices:", error);
    return {};
  }
};

const getCachedFxPairPrice = (base: string, quote: string): number | undefined => {
  const pairVariants = [
    `${base}${quote}`,
    `${base}/${quote}`,
    `${base}.${quote}`,
    `${base}-${quote}`,
    `${base}_${quote}`,
    `${base}${quote}=X`,
  ];
  const prefixes = ['', 'CURRENCY:', 'FX:'];

  for (const prefix of prefixes) {
    for (const pair of pairVariants) {
      const price = cachedMarketData[`${prefix}${pair}`]?.price;
      if (typeof price === 'number' && price > 0) return price;
    }
  }

  return undefined;
};

export const getLiveFxRateToEur = (currency: string): number | undefined => {
  const normalizedCurrency = normalizeCurrencyCode(currency);
  if (normalizedCurrency === Currency.EUR) return 1;

  const liveRate = getCachedFxPairPrice(normalizedCurrency, Currency.EUR);
  if (liveRate !== undefined) {
    return liveRate;
  }

  const inverseLiveRate = getCachedFxPairPrice(Currency.EUR, normalizedCurrency);
  if (inverseLiveRate !== undefined) {
    return 1 / inverseLiveRate;
  }

  return undefined;
};

export const getFxRateToEur = (currency: string): number => {
  const normalizedCurrency = normalizeCurrencyCode(currency);
  if (normalizedCurrency === Currency.EUR) return 1;

  return getLiveFxRateToEur(normalizedCurrency)
    ?? FALLBACK_FX_RATES[normalizedCurrency]
    ?? 1;
};

export const refreshMarketData = async (): Promise<void> => {
  await fetchPricesFromSheet();
};

let transactionFxRepairPromise: Promise<number> | null = null;

const repairLoadedTransactionFxRates = async (transactions: any[]): Promise<number> => {
  let updatedCount = 0;

  for (const tx of transactions) {
    if (!tx?.id) continue;

    const currencyPlatform = normalizeCurrencyCode(
      resolveKey(tx, ['currencyPlatform', 'currency_platform', 'divisa', 'currency']) || Currency.EUR
    );
    const rawFx = resolveKey(tx, ['fxRateToEur', 'fx_rate_to_eur', 'tipo_cambio', 'fxRate']);
    let nextFxRate: number | undefined;

    if (currencyPlatform === Currency.EUR) {
      const hasStoredFx = tx.fxRateToEur !== undefined && tx.fxRateToEur !== null && tx.fxRateToEur !== '';
      const isCanonicalCurrency = tx.currencyPlatform === Currency.EUR;
      if (!hasStoredFx || parseFxNumber(tx.fxRateToEur) !== 0 || !isCanonicalCurrency) {
        nextFxRate = 0;
      }
    } else if (isInvalidFxRate(currencyPlatform, rawFx)) {
      // Historical transaction FX must come from the linked sheet, not a static fallback.
      nextFxRate = getLiveFxRateToEur(currencyPlatform);
    }

    if (nextFxRate === undefined) continue;

    const changes = {
      currencyPlatform: currencyPlatform as Currency,
      fxRateToEur: nextFxRate,
    };

    await api.update('pky_transactions', tx.id, changes);
    Object.assign(tx, changes);
    updatedCount += 1;
  }

  if (updatedCount > 0) {
    db.notify();
  }

  return updatedCount;
};

export const repairTransactionFxRates = async (transactions?: any[]): Promise<number> => {
  if (transactionFxRepairPromise) return transactionFxRepairPromise;

  transactionFxRepairPromise = (async () => {
    await fetchPricesFromSheet();
    const sourceTransactions = transactions ?? await db.transactions.toArray();
    return repairLoadedTransactionFxRates(sourceTransactions);
  })();

  try {
    return await transactionFxRepairPromise;
  } finally {
    transactionFxRepairPromise = null;
  }
};

export const calculatePositionsAndMetrics = async (selectedPortfolio: PortfolioOwner | 'ALL') => {
  // 1. Cargamos precios y divisas de la hoja
  await fetchPricesFromSheet();

  let transactions: any[] = [];
  let liquidity: any[] = [];

  // Cargar datos crudos (pueden venir con snake_case, etc.)
  if (selectedPortfolio === 'ALL') {
    transactions = await db.transactions.toArray();
    liquidity = await db.liquidity.toArray();
  } else {
    transactions = await db.transactions.where('portfolio').equals(selectedPortfolio).toArray();
    liquidity = await db.liquidity.where('portfolio').equals(selectedPortfolio).toArray();
  }

  // IBKR and other external integrations may create rows with FX at 0.
  // Repair them as soon as the polling calculation sees them.
  try {
    const repairedCount = await repairTransactionFxRates(transactions);
    if (repairedCount > 0) {
      transactions = selectedPortfolio === 'ALL'
        ? await db.transactions.toArray()
        : await db.transactions.where('portfolio').equals(selectedPortfolio).toArray();
    }
  } catch (error) {
    console.error('Error repairing transaction FX rates:', error);
  }

  const positionMap = new Map<string, Position>();

  // Liquidez inicial (tabla liquidity) ya en EUR
  const baseCashEur = liquidity.reduce((acc, rawItem) => {
    const val = toNumber(resolveKey(rawItem, ['amountEur', 'amount_eur', 'amount', 'importe']));
    return acc + val;
  }, 0);

  // Caja por divisa (para cuadrar con bróker y evitar deriva por FX histórico)
  const cashByCurrency: Record<string, number> = {};
  cashByCurrency[Currency.EUR] = baseCashEur;

  // Ordenamos TODAS las operaciones cronológicamente
  transactions.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

  transactions.forEach(rawTx => {
    if ((rawTx as any).excludeFromMetrics || isCurrencyExchangeTransaction(rawTx)) return;
    // --- Sanitización de campos numéricos ---
    const rawQuantity = toNumber(resolveKey(rawTx, ['quantity', 'qty', 'cantidad']));
    const quantity = Math.abs(rawQuantity); // signo lo decide el tipo (Compra/Venta)
    const price = toNumber(resolveKey(rawTx, ['price', 'precio', 'coste']));
    const commission = Math.abs(toNumber(resolveKey(rawTx, ['commission', 'comision', 'fees'])));
    const rawFx = resolveKey(rawTx, ['fxRateToEur', 'fx_rate_to_eur', 'tipo_cambio', 'fxRate']);
    const fxRateToEurRaw = toNumber(rawFx);

    const ticker = (rawTx.ticker || '').toUpperCase();
    const portfolio = rawTx.portfolio || 'Unknown';
    const assetName = resolveKey(rawTx, ['assetName', 'asset_name', 'nombre']) || ticker;
    const assetType = resolveKey(rawTx, ['assetType', 'asset_type', 'tipo_activo']) || 'Sin Clasificar';
    const currencyPlatform = resolveKey(rawTx, ['currencyPlatform', 'currency_platform', 'divisa', 'currency']) || Currency.EUR;
    const typeStr = resolveKey(rawTx, ['type', 'tipo', 'operacion']);

    const isBuy = isBuyOperation(typeStr);

    const key = `${portfolio}-${ticker}`;
    let pos = positionMap.get(key);

    // FX efectivo: si la divisa es EUR forzamos 1
    let effectiveFxRate = normalizeFxRateToEur(currencyPlatform, fxRateToEurRaw);
    if (currencyPlatform === Currency.EUR) {
      effectiveFxRate = 1;
    }

    if (!pos) {
      pos = {
        ticker,
        assetName,
        portfolio,
        assetType,
        currencyPlatform,
        currencyOrigin: currencyPlatform,
        quantity: 0,
        avgPricePlatform: 0,
        avgFxRate: 0,
        avgPriceEur: 0,
        totalCostEur: 0,
        totalCostOrigin: 0,
        currentPriceOrigin: 0,
        currentFxRateToEur: 0,
        currentValueEur: 0,
        currentValueOrigin: 0,
        unrealizedPnLEur: 0,
        unrealizedPnLOrigin: 0,
        unrealizedPnLPct: 0,
        realizedPnLEur: 0
      };
    }

    const addLong = (qty: number, fee: number) => {
      const currentQty = Math.max(pos.quantity, 0);
      const totalCostOldEur = currentQty * pos.avgPriceEur;
      const txCostOrigin = (qty * price) + fee;
      const txCostEur = txCostOrigin * effectiveFxRate;
      const newQuantity = currentQty + qty;

      if (newQuantity <= 0.000001) return;

      const newTotalCostOrigin = (currentQty > 0 ? pos.totalCostOrigin : 0) + txCostOrigin;
      const newTotalCostEur = totalCostOldEur + txCostEur;

      pos.quantity = newQuantity;
      pos.avgPriceEur = newTotalCostEur / newQuantity;
      pos.avgPricePlatform = newTotalCostOrigin / newQuantity;
      pos.totalCostOrigin = newTotalCostOrigin;
      pos.avgFxRate = pos.totalCostOrigin > 0 ? newTotalCostEur / pos.totalCostOrigin : effectiveFxRate;
    };

    const addShort = (qty: number, fee: number) => {
      const currentQty = Math.max(Math.abs(pos.quantity), 0);
      const proceedsOrigin = (qty * price) - fee;
      const proceedsEur = proceedsOrigin * effectiveFxRate;
      const oldProceedsEur = currentQty * pos.avgPriceEur;
      const newQuantityAbs = currentQty + qty;

      if (newQuantityAbs <= 0.000001) return;

      const newProceedsOrigin = (pos.quantity < 0 ? pos.totalCostOrigin : 0) + proceedsOrigin;
      const newProceedsEur = oldProceedsEur + proceedsEur;

      pos.quantity = -newQuantityAbs;
      pos.avgPriceEur = newProceedsEur / newQuantityAbs;
      pos.avgPricePlatform = newProceedsOrigin / newQuantityAbs;
      pos.totalCostOrigin = newProceedsOrigin;
      pos.avgFxRate = pos.totalCostOrigin > 0 ? newProceedsEur / pos.totalCostOrigin : effectiveFxRate;
    };

    if (isBuy) {
      // === COMPRA ===
      let remainingQty = quantity;

      if (pos.quantity < -0.000001) {
        const coverQty = Math.min(remainingQty, Math.abs(pos.quantity));
        const coverFee = commission * (coverQty / quantity);
        const coverCostOrigin = (coverQty * price) + coverFee;
        const coverCostEur = coverCostOrigin * effectiveFxRate;
        const entryProceedsEur = coverQty * pos.avgPriceEur;
        const proportion = coverQty / Math.abs(pos.quantity);

        pos.realizedPnLEur += entryProceedsEur - coverCostEur;
        pos.totalCostOrigin -= (pos.totalCostOrigin * proportion);
        pos.quantity += coverQty;
        remainingQty -= coverQty;
      }

      if (Math.abs(pos.quantity) <= 0.000001) {
        pos.quantity = 0;
        pos.avgPriceEur = 0;
        pos.avgPricePlatform = 0;
        pos.totalCostOrigin = 0;
        pos.avgFxRate = 0;
      }

      if (remainingQty > 0.000001) {
        addLong(remainingQty, commission * (remainingQty / quantity));
      }

      // La caja baja por el coste total de la compra EN LA DIVISA de la operación
      // (la conversión a EUR se hace al final con el FX actual)
      const cashCcy = currencyPlatform as string;
      const txCostOrigin = (quantity * price) + commission;
      if (!(rawTx as any).nonCash) {
        cashByCurrency[cashCcy] = (cashByCurrency[cashCcy] || 0) - txCostOrigin;
      }

    } else {
      // === VENTA ===
      let remainingQty = quantity;

      if (pos.quantity > 0.000001) {
        const sellQty = Math.min(remainingQty, pos.quantity);
        const sellFee = commission * (sellQty / quantity);
        const sellValueNetOrigin = (sellQty * price) - sellFee;
        const sellValueNetEur = sellValueNetOrigin * effectiveFxRate;
        const costOfSoldEur = sellQty * pos.avgPriceEur;
        const proportion = sellQty / pos.quantity;

        pos.totalCostOrigin -= (pos.totalCostOrigin * proportion);
        pos.realizedPnLEur += sellValueNetEur - costOfSoldEur;
        pos.quantity -= sellQty;
        remainingQty -= sellQty;
      }

      if (Math.abs(pos.quantity) <= 0.000001) {
        pos.quantity = 0;
        pos.avgPriceEur = 0;
        pos.avgPricePlatform = 0;
        pos.totalCostOrigin = 0;
        pos.avgFxRate = 0;
      }

      if (remainingQty > 0.000001) {
        addShort(remainingQty, commission * (remainingQty / quantity));
      }

      // La caja sube por el ingreso neto de la venta EN LA DIVISA de la operación
      const cashCcy = currencyPlatform as string;
      const sellValueNetOrigin = (quantity * price) - commission;
      if (!(rawTx as any).nonCash) {
        cashByCurrency[cashCcy] = (cashByCurrency[cashCcy] || 0) + sellValueNetOrigin;
      }
    }

    positionMap.set(key, pos);
  });

  // 2. Métricas finales a partir de posiciones y precios en tiempo real
  const activePositions: Position[] = [];
  const dashboard: DashboardMetrics = {
    totalValueEur: 0,
    availableCashEur: 0,
    totalCostEur: 0,
    unrealizedPnLEur: 0,
    unrealizedPnLPct: 0,
    totalLiquidityAddedEur: 0,
    realizedPnLEur: 0,
    totalReturnPct: 0,
    timeWeightedReturnYtdPct: null,
    lastCompleteMonthReturnPct: null,
    historicalReturnCoverage: 'loading',
    projectedCloseEur: 0
  };

  for (const pos of positionMap.values()) {
    const isClosed = Math.abs(pos.quantity) <= 0.0001;

    const marketData = cachedMarketData[pos.ticker];
    const rawFeedPrice = marketData?.price || 0;
    const feedCurrency = marketData?.currency || pos.currencyPlatform;

    let adjustedFeedPrice = rawFeedPrice;
    if (feedCurrency === 'GBp' || feedCurrency === 'GBX') {
      adjustedFeedPrice = rawFeedPrice / 100;
    }

    const effectiveFeedCurrency =
      (feedCurrency === 'GBp' || feedCurrency === 'GBX') ? 'GBP' : feedCurrency;
    pos.currencyOrigin = effectiveFeedCurrency || pos.currencyPlatform;
    const fxFeedToEur = getFxRateToEur(effectiveFeedCurrency);

    const priceToUseInEur = rawFeedPrice > 0
      ? adjustedFeedPrice * fxFeedToEur
      : pos.avgPricePlatform * pos.avgFxRate;

    if (!isClosed) {
      const quantityAbs = Math.abs(pos.quantity);
      const direction = pos.quantity >= 0 ? 1 : -1;

      pos.currentValueEur   = direction * quantityAbs * priceToUseInEur;
      pos.totalCostEur      = quantityAbs * pos.avgPriceEur;
      pos.unrealizedPnLEur  = pos.quantity >= 0
        ? pos.currentValueEur - pos.totalCostEur
        : pos.totalCostEur + pos.currentValueEur;
      pos.unrealizedPnLPct  = pos.totalCostEur !== 0 ? (pos.unrealizedPnLEur / pos.totalCostEur) : 0;

      const fxOriginToEur = getFxRateToEur(pos.currencyOrigin);
      const safeFxOrigin  = fxOriginToEur > 0 ? fxOriginToEur : 1;

      pos.currentFxRateToEur = safeFxOrigin;
      pos.currentValueOrigin = pos.currentValueEur / safeFxOrigin;
      pos.currentPriceOrigin = priceToUseInEur / safeFxOrigin;
      pos.unrealizedPnLOrigin = pos.quantity >= 0
        ? pos.currentValueOrigin - pos.totalCostOrigin
        : pos.totalCostOrigin + pos.currentValueOrigin;

      activePositions.push(pos);

      dashboard.totalValueEur += pos.currentValueEur;
      dashboard.totalCostEur  += pos.totalCostEur;
      dashboard.unrealizedPnLEur += pos.unrealizedPnLEur;
    }

    dashboard.realizedPnLEur += pos.realizedPnLEur;
  }

  // Liquidez inicial (depósitos/retiros manuales en la tabla liquidity)
  dashboard.totalLiquidityAddedEur = baseCashEur;

  // Caja actual en EUR: sumatorio por divisa con el FX vigente (mismo criterio que el bróker al mostrar 'base')
  const cashEur = Object.entries(cashByCurrency).reduce((acc, [ccy, amt]) => {
    const fx = getFxRateToEur(ccy);
    return acc + (toNumber(amt) * fx);
  }, 0);

  dashboard.availableCashEur = cashEur;

  dashboard.unrealizedPnLPct = dashboard.totalCostEur > 0
    ? (dashboard.unrealizedPnLEur / dashboard.totalCostEur)
    : 0;

  const currentEquity = dashboard.totalValueEur + dashboard.availableCashEur;

  if (dashboard.totalLiquidityAddedEur > 0) {
    const totalGain = currentEquity - dashboard.totalLiquidityAddedEur;
    dashboard.totalReturnPct = totalGain / dashboard.totalLiquidityAddedEur;
  }

  dashboard.projectedCloseEur = currentEquity;

  return { activePositions, dashboard };
};
