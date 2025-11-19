
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

const getCsvUrl = (): string | null => {
  const rawUrl = localStorage.getItem('PRICE_FEED_URL');
  if (!rawUrl) return null;

  const match = rawUrl.match(/\/d\/([a-zA-Z0-9-_]+)/);
  if (match && match[1]) {
    return `https://docs.google.com/spreadsheets/d/${match[1]}/export?format=csv`;
  }

  return rawUrl;
};

const parsePriceValue = (str: string): number => {
  if (!str) return 0;
  let val = str.toString().trim();
  
  // Handle Google Sheets specific errors
  if (val.startsWith('#') || val.toLowerCase().includes('loading') || val.toLowerCase().includes('error')) {
    return 0;
  }

  val = val.replace(/[€$£¥\s\u00A0"']/g, ''); // Strip quotes and symbols
  
  // Handle European format (1.200,50) vs US format (1,200.50)
  if (val.includes(',') && val.includes('.')) {
    if (val.indexOf('.') < val.indexOf(',')) {
      // EU: 1.200,50 -> Remove dot, replace comma with dot
      val = val.replace(/\./g, '').replace(',', '.');
    } else {
      // US: 1,200.50 -> Remove comma
      val = val.replace(/,/g, '');
    }
  } else if (val.includes(',')) {
      // Only comma -> Decimal separator (standard for this app context)
      val = val.replace(',', '.');
  }
  // If only dot, usually standard decimal, unless it's a thousand separator for integer.
  // We assume standard decimal if single dot.

  const result = parseFloat(val);
  return isNaN(result) ? 0 : result;
};

const fetchPricesFromSheet = async (): Promise<Record<string, MarketData>> => {
  const csvUrl = getCsvUrl();
  
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

    // DETECT DELIMITER: 
    // If the header or first row contains semicolons, we assume European CSV format (where comma is decimal)
    // Otherwise we fallback to comma.
    const sampleLine = lines[0];
    const delimiter = sampleLine.includes(';') ? ';' : ',';

    // Default Index: A=Ticker, B=Price, C=Currency
    let tickerIdx = 0;
    let priceIdx = 1;
    let currencyIdx = 2;

    lines.forEach((line, index) => {
      // Skip header if it looks like a header
      if (index === 0) {
        const lowerLine = line.toLowerCase();
        if (lowerLine.includes('ticker') || lowerLine.includes('simbolo')) {
          return; 
        }
      }

      // Robust Split using detected delimiter
      const parts = line.split(delimiter);
      
      if (parts.length >= 2) {
        const ticker = parts[tickerIdx].replace(/['"]/g, '').trim().toUpperCase();
        const priceRaw = parts[priceIdx]; // Do not clean here, let parsePriceValue handle it
        const currencyRaw = parts.length > 2 ? parts[currencyIdx].replace(/['"\s]/g, '').trim().toUpperCase() : undefined;
        
        const price = parsePriceValue(priceRaw);

        if (ticker && !isNaN(price) && price > 0) {
          newMarketData[ticker] = {
            price,
            currency: currencyRaw && currencyRaw.length === 3 ? currencyRaw : undefined
          };
        }
      }
    });

    console.log("Live Data Fetched:", Object.keys(newMarketData).length);

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
  
  // CRITICAL FIX: Only use cached rate if it exists AND is greater than 0.
  // If CSV parsing failed (returning 0), this must fall through to the fallback.
  const liveRate = cachedMarketData[pairTicker]?.price;
  
  if (typeof liveRate === 'number' && liveRate > 0) {
      return liveRate;
  }
  
  // Log only in development or if debugging needed
  console.warn(`FX Rate missing for ${currency} (Live value: ${liveRate}). Using fallback.`);
  return FALLBACK_FX_RATES[currency] || 1;
};

export const calculatePositionsAndMetrics = async (selectedPortfolio: PortfolioOwner | 'ALL') => {
  
  // 1. Fetch Live Prices & Metadata FIRST
  await fetchPricesFromSheet(); 

  let transactions: Transaction[] = [];
  let liquidity: LiquidityEvent[] = [];

  if (selectedPortfolio === 'ALL') {
    transactions = await db.transactions.toArray();
    liquidity = await db.liquidity.toArray();
  } else {
    transactions = await db.transactions.where('portfolio').equals(selectedPortfolio).toArray();
    liquidity = await db.liquidity.where('portfolio').equals(selectedPortfolio).toArray();
  }

  const positionMap = new Map<string, Position>();
  transactions.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

  transactions.forEach(tx => {
    const key = `${tx.portfolio}-${tx.ticker}`;
    let pos = positionMap.get(key);

    // Determine Origin Currency from Cache (Feed) or Fallback to Transaction Platform Currency
    const cachedMeta = cachedMarketData[tx.ticker];
    const originCurrency = cachedMeta?.currency || tx.currencyPlatform;

    if (!pos) {
      pos = {
        ticker: tx.ticker,
        assetName: tx.assetName,
        portfolio: tx.portfolio,
        assetType: tx.assetType,
        currencyPlatform: tx.currencyPlatform,
        currencyOrigin: originCurrency, // Set real origin
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
    } else {
       // Ensure origin currency is up to date if feed loaded late
       if (pos.currencyOrigin === pos.currencyPlatform && cachedMeta?.currency) {
           pos.currencyOrigin = cachedMeta.currency;
       }
    }

    if (tx.type === TransactionType.Buy) {
      const totalCostOldEur = pos.quantity * pos.avgPriceEur;
      // const costNewEur = tx.quantity * tx.price * tx.fxRateToEur; 
      const newQuantity = pos.quantity + tx.quantity;
      
      // --- Origin Cost Calculation ---
      let costNewOrigin = 0;
      
      // If transaction currency matches origin (e.g. Buy US Stock with USD account)
      if (tx.currencyPlatform === pos.currencyOrigin) {
          costNewOrigin = tx.quantity * tx.price;
      } else {
          // If Bought USD asset with EUR, we need to estimate the USD cost.
          // We use the CURRENT FX rate to approximate the historical "Origin Cost" base
          // because we don't have historical FX data. This keeps the "Origin P/L" sanity 
          // aligned with the asset's price movement, filtering out FX noise approx.
          const currentFxOriginToEur = getFxRateToEur(pos.currencyOrigin);
          
          // Safety: Prevent division by zero if FX is somehow 0 (though guarded above)
          const safeFx = currentFxOriginToEur > 0 ? currentFxOriginToEur : 1;
          
          costNewOrigin = (tx.quantity * tx.price * tx.fxRateToEur) / safeFx;
      }

      pos.totalCostOrigin += costNewOrigin;
      
      if (newQuantity > 0) {
          // Weighted Averages for EUR
          const newAvgPricePlatform = ((pos.quantity * pos.avgPricePlatform) + (tx.quantity * tx.price)) / newQuantity;
          // Weighted Average FX Rate
          const totalFxWeighted = (pos.avgFxRate * totalCostOldEur) + (tx.fxRateToEur * (tx.quantity * tx.price));
          const newAvgFx = totalFxWeighted / (totalCostOldEur + (tx.quantity * tx.price)) || tx.fxRateToEur;
    
          pos.quantity = newQuantity;
          pos.avgPricePlatform = newAvgPricePlatform;
          pos.avgFxRate = newAvgFx;
          pos.avgPriceEur = pos.avgPricePlatform * pos.avgFxRate;
      }

    } else if (tx.type === TransactionType.Sell) {
      const sellValueEur = (tx.quantity * tx.price * tx.fxRateToEur) - (tx.commission * tx.fxRateToEur);
      const costOfSoldEur = tx.quantity * pos.avgPriceEur;
      
      // Reduce Origin Cost proportionally
      if (pos.quantity > 0) {
          const proportion = tx.quantity / pos.quantity;
          pos.totalCostOrigin -= (pos.totalCostOrigin * proportion);
      }

      const pnl = sellValueEur - costOfSoldEur;
      pos.realizedPnLEur += pnl;
      
      pos.quantity -= tx.quantity;
    }

    positionMap.set(key, pos);
  });

  // 2. Final Metrics with Live Data
  const activePositions: Position[] = [];
  const dashboard: DashboardMetrics = {
    totalValueEur: 0,
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

    // Get Live Data
    const marketData = cachedMarketData[pos.ticker];
    const livePrice = marketData?.price || 0;
    
    // Fallback if feed didn't have currency but price was there
    if (marketData?.currency) pos.currencyOrigin = marketData.currency;

    pos.currentPriceOrigin = livePrice > 0 ? livePrice : pos.avgPricePlatform;
    
    // Calculate Rates
    pos.currentFxRateToEur = getFxRateToEur(pos.currencyOrigin);
    
    if (!isClosed) {
      // EUR Metrics
      pos.currentValueEur = pos.quantity * pos.currentPriceOrigin * pos.currentFxRateToEur;
      pos.totalCostEur = pos.quantity * pos.avgPriceEur;
      pos.unrealizedPnLEur = pos.currentValueEur - pos.totalCostEur;
      pos.unrealizedPnLPct = pos.totalCostEur !== 0 ? (pos.unrealizedPnLEur / pos.totalCostEur) : 0;
      
      // Origin Metrics
      pos.currentValueOrigin = pos.quantity * pos.currentPriceOrigin;
      
      // Safety Check for Origin Cost
      if (pos.totalCostOrigin <= 0 && pos.totalCostEur > 0 && pos.currentFxRateToEur > 0) {
           pos.totalCostOrigin = pos.totalCostEur / pos.currentFxRateToEur;
      }
      
      pos.unrealizedPnLOrigin = pos.currentValueOrigin - pos.totalCostOrigin;

      activePositions.push(pos);

      dashboard.totalValueEur += pos.currentValueEur;
      dashboard.totalCostEur += pos.totalCostEur;
      dashboard.unrealizedPnLEur += pos.unrealizedPnLEur;
    }
    
    dashboard.realizedPnLEur += pos.realizedPnLEur;
  }

  dashboard.totalLiquidityAddedEur = liquidity.reduce((acc, curr) => acc + curr.amountEur, 0);
  dashboard.unrealizedPnLPct = dashboard.totalCostEur > 0 ? (dashboard.unrealizedPnLEur / dashboard.totalCostEur) : 0;
  
  if (dashboard.totalLiquidityAddedEur > 0) {
      const totalGain = (dashboard.totalValueEur + dashboard.realizedPnLEur) - dashboard.totalLiquidityAddedEur;
      dashboard.totalReturnPct = totalGain / dashboard.totalLiquidityAddedEur;
  }

  dashboard.projectedCloseEur = dashboard.totalValueEur + dashboard.realizedPnLEur;

  return { activePositions, dashboard };
};
