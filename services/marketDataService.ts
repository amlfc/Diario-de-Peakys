import { db } from '../db';
import { 
  Transaction, 
  Position, 
  TransactionType, 
  Currency, 
  PortfolioOwner, 
  DashboardMetrics,
  LiquidityEvent
} from '../types';

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

// STATIC FALLBACK RATES 
const FALLBACK_FX_RATES: Record<string, number> = {
  [Currency.USD]: 0.94, 
  [Currency.EUR]: 1.0,
  [Currency.GBP]: 1.15,
  [Currency.CHF]: 1.06,
  [Currency.CAD]: 0.68,
  [Currency.JPY]: 0.006,
  [Currency.AUD]: 0.60,
  [Currency.HKD]: 0.12,
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

export const getFxRateToEur = (currency: string): number => {
  if (currency === Currency.EUR) return 1;
  const pairTicker = `${currency}EUR`; 
  
  const liveRate = cachedMarketData[pairTicker]?.price;
  
  if (typeof liveRate === 'number' && liveRate > 0) {
    return liveRate;
  }
  
  return FALLBACK_FX_RATES[currency] || 1;
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
    if ((rawTx as any).excludeFromMetrics) return;
    // --- Sanitización de campos numéricos ---
    const rawQuantity = toNumber(resolveKey(rawTx, ['quantity', 'qty', 'cantidad']));
    const quantity = Math.abs(rawQuantity); // signo lo decide el tipo (Compra/Venta)
    const price = toNumber(resolveKey(rawTx, ['price', 'precio', 'coste']));
    const commission = Math.abs(toNumber(resolveKey(rawTx, ['commission', 'comision', 'fees'])));
    const rawFx = resolveKey(rawTx, ['fxRateToEur', 'fx_rate_to_eur', 'tipo_cambio', 'fxRate']);
    const fxRateToEur = toNumber(rawFx) || 1; // si no hay dato, asumimos 1

    const ticker = (rawTx.ticker || '').toUpperCase();
    const portfolio = rawTx.portfolio || 'Unknown';
    const assetName = resolveKey(rawTx, ['assetName', 'asset_name', 'nombre']) || ticker;
    const assetType = resolveKey(rawTx, ['assetType', 'asset_type', 'tipo_activo']) || 'Sin Clasificar';
    const currencyPlatform = resolveKey(rawTx, ['currencyPlatform', 'currency_platform', 'divisa']) || Currency.EUR;
    const typeStr = resolveKey(rawTx, ['type', 'tipo', 'operacion']);

    const isBuy = isBuyOperation(typeStr);

    const key = `${portfolio}-${ticker}`;
    let pos = positionMap.get(key);

    // FX efectivo: si la divisa es EUR forzamos 1
    let effectiveFxRate = fxRateToEur;
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

    if (isBuy) {
      // === COMPRA ===
      const totalCostOldEur = pos.quantity * pos.avgPriceEur;

      const buyCommissionEur = commission * effectiveFxRate;
      const txCostOrigin = (quantity * price) + commission;               // en divisa de plataforma
      const txCostEur    = (quantity * price * effectiveFxRate) + buyCommissionEur;

      const newQuantity = pos.quantity + quantity;

      const newTotalCostOrigin = pos.totalCostOrigin + txCostOrigin;
      const newTotalCostEur    = totalCostOldEur + txCostEur;

      if (newQuantity > 0) {
        pos.quantity = newQuantity;

        pos.avgPriceEur      = newTotalCostEur / newQuantity;
        pos.avgPricePlatform = newTotalCostOrigin / newQuantity;

        pos.totalCostOrigin = newTotalCostOrigin;

        if (pos.totalCostOrigin > 0) {
          pos.avgFxRate = newTotalCostEur / pos.totalCostOrigin;
        } else {
          pos.avgFxRate = effectiveFxRate;
        }
      }

      // La caja baja por el coste total de la compra EN LA DIVISA de la operación
      // (la conversión a EUR se hace al final con el FX actual)
      const cashCcy = currencyPlatform as string;
      if (!(rawTx as any).nonCash) {
        cashByCurrency[cashCcy] = (cashByCurrency[cashCcy] || 0) - txCostOrigin;
      }

    } else {
      // === VENTA ===
      if (pos.quantity <= 0) {
        // Venta sin posición previa: seguridad mínima
        return;
      }

      const sellCommissionEur = commission * effectiveFxRate;
      const sellValueGrossEur = quantity * price * effectiveFxRate;
      const sellValueNetEur   = sellValueGrossEur - sellCommissionEur;

      const costOfSoldEur = quantity * pos.avgPriceEur;

      // Reducimos coste de origen proporcionalmente al tamaño vendido
      const proportion = quantity / pos.quantity;
      pos.totalCostOrigin -= (pos.totalCostOrigin * proportion);

      const pnl = sellValueNetEur - costOfSoldEur;
      pos.realizedPnLEur += pnl;

      pos.quantity -= quantity;

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
    projectedCloseEur: 0
  };

  for (const pos of positionMap.values()) {
    const isClosed = pos.quantity <= 0.0001;

    const marketData = cachedMarketData[pos.ticker];
    const rawFeedPrice = marketData?.price || 0;
    const feedCurrency = marketData?.currency || pos.currencyPlatform;

    let adjustedFeedPrice = rawFeedPrice;
    if (feedCurrency === 'GBp' || feedCurrency === 'GBX') {
      adjustedFeedPrice = rawFeedPrice / 100;
    }

    const effectiveFeedCurrency =
      (feedCurrency === 'GBp' || feedCurrency === 'GBX') ? 'GBP' : feedCurrency;
    const fxFeedToEur = getFxRateToEur(effectiveFeedCurrency);

    const priceToUseInEur = rawFeedPrice > 0
      ? adjustedFeedPrice * fxFeedToEur
      : pos.avgPricePlatform * pos.avgFxRate;

    if (!isClosed) {
      pos.currentValueEur   = pos.quantity * priceToUseInEur;
      pos.totalCostEur      = pos.quantity * pos.avgPriceEur;
      pos.unrealizedPnLEur  = pos.currentValueEur - pos.totalCostEur;
      pos.unrealizedPnLPct  = pos.totalCostEur !== 0 ? (pos.unrealizedPnLEur / pos.totalCostEur) : 0;

      const fxOriginToEur = getFxRateToEur(pos.currencyOrigin);
      const safeFxOrigin  = fxOriginToEur > 0 ? fxOriginToEur : 1;

      pos.currentFxRateToEur = safeFxOrigin;
      pos.currentValueOrigin = pos.currentValueEur / safeFxOrigin;
      pos.currentPriceOrigin = priceToUseInEur / safeFxOrigin;
      pos.unrealizedPnLOrigin = pos.currentValueOrigin - pos.totalCostOrigin;

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
