
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

// Helper to properly split CSV lines respecting quotes
// Example: "TICKER","48,49","USD" -> ['TICKER', '"48,49"', 'USD']
const splitCsvLine = (text: string, delimiter: string): string[] => {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;
  
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (char === '"') {
      inQuotes = !inQuotes;
      current += char; // Keep quotes so parsePriceValue can strip them cleanly later
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
  
  // Handle Google Sheets specific errors
  if (val.startsWith('#') || val.toLowerCase().includes('loading') || val.toLowerCase().includes('error')) {
    return 0;
  }

  // First strip quotes which are common in CSVs with commas: "1.200,50" -> 1.200,50
  val = val.replace(/["']/g, '');
  val = val.replace(/[€$£¥\s\u00A0]/g, ''); // Strip currency symbols and spaces
  
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
    // Scan first 5 lines. If we find semicolons, it's European CSV. Defaults to comma.
    let delimiter = ',';
    const sampleText = lines.slice(0, 5).join('');
    if (sampleText.includes(';')) {
        delimiter = ';';
    }

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

      // Robust Split using custom logic
      const parts = splitCsvLine(line, delimiter);
      
      if (parts.length >= 2) {
        const ticker = parts[tickerIdx].replace(/['"]/g, '').trim().toUpperCase();
        const priceRaw = parts[priceIdx]; 
        const currencyRaw = parts.length > 2 ? parts[currencyIdx].replace(/['"\s]/g, '').trim().toUpperCase() : undefined;
        
        const price = parsePriceValue(priceRaw);

        // Only add if price is valid (>0)
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
  
  // Only use cached rate if it exists AND is greater than 0 (valid).
  const liveRate = cachedMarketData[pairTicker]?.price;
  
  if (typeof liveRate === 'number' && liveRate > 0) {
      return liveRate;
  }
  
  // If missing or 0, fallback silent or warn
  if (cachedMarketData[pairTicker] !== undefined && liveRate === 0) {
      console.warn(`FX Rate for ${currency} came as 0 from Sheet. Using fallback.`);
  }
  
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

    if (!pos) {
      pos = {
        ticker: tx.ticker,
        assetName: tx.assetName,
        portfolio: tx.portfolio,
        assetType: tx.assetType,
        currencyPlatform: tx.currencyPlatform,
        currencyOrigin: tx.currencyPlatform, // STRICTLY USE PLATFORM CURRENCY AS ORIGIN
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

    if (tx.type === TransactionType.Buy) {
      const totalCostOldEur = pos.quantity * pos.avgPriceEur;
      
      // --- COST BASIS CALCULATION ---
      // Net Cost = (Price * Qty) + Commission.
      // This effectively RAISES the average price (Break Even Price).
      const txCostOrigin = (tx.quantity * tx.price) + tx.commission;
      const txCostEur = txCostOrigin * tx.fxRateToEur;
      
      const newQuantity = pos.quantity + tx.quantity;
      
      // Add to running totals
      const newTotalCostOrigin = pos.totalCostOrigin + txCostOrigin;
      const newTotalCostEur = totalCostOldEur + txCostEur;

      if (newQuantity > 0) {
          pos.quantity = newQuantity;
          
          // Weighted Average Price in EUR (Inc Commission)
          pos.avgPriceEur = newTotalCostEur / newQuantity;
          
          // Weighted Average Price in Origin (Inc Commission) -> Break Even Price
          pos.avgPricePlatform = newTotalCostOrigin / newQuantity;
          
          pos.totalCostOrigin = newTotalCostOrigin;

          // FX Weighted Average
          // We assume the FX rate applies to the whole cost including commission
          if (pos.totalCostOrigin > 0) {
             pos.avgFxRate = newTotalCostEur / pos.totalCostOrigin;
          } else {
             pos.avgFxRate = tx.fxRateToEur;
          }
      }

    } else if (tx.type === TransactionType.Sell) {
      // Sell Proceeds = (Price * Qty) - Commission
      const sellValueEur = (tx.quantity * tx.price * tx.fxRateToEur) - (tx.commission * tx.fxRateToEur);
      
      // Cost of Goods Sold (Uses the Avg Price which includes Buy Commissions)
      const costOfSoldEur = tx.quantity * pos.avgPriceEur;
      
      // Reduce Origin Cost proportionally to keep Avg Price constant
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

    // Get Live Data
    const marketData = cachedMarketData[pos.ticker];
    const rawFeedPrice = marketData?.price || 0;
    
    // Determine Price Feed Currency (defaults to platform if not found)
    // NOTE: Feed currency (e.g. GBp) might differ from Platform/Origin currency (e.g. USD)
    const feedCurrency = marketData?.currency || pos.currencyPlatform;

    // Handle GBp / GBX (Pence) logic
    let adjustedFeedPrice = rawFeedPrice;
    if (feedCurrency === 'GBp' || feedCurrency === 'GBX') {
        adjustedFeedPrice = rawFeedPrice / 100;
    }
    
    // FX Rate from FEED CURRENCY to EUR
    // e.g. if Feed is GBp, we use GBP rate.
    const effectiveFeedCurrency = (feedCurrency === 'GBp' || feedCurrency === 'GBX') ? 'GBP' : feedCurrency;
    const fxFeedToEur = getFxRateToEur(effectiveFeedCurrency);

    // Calculate EUR Value (Truth)
    // If no live price, fallback to average platform price (and assumes platform currency for FX)
    const priceToUseInEur = rawFeedPrice > 0 
       ? adjustedFeedPrice * fxFeedToEur
       : pos.avgPricePlatform * pos.avgFxRate;

    if (!isClosed) {
      pos.currentValueEur = pos.quantity * priceToUseInEur;
      pos.totalCostEur = pos.quantity * pos.avgPriceEur; // Uses the commission-adjusted avg
      pos.unrealizedPnLEur = pos.currentValueEur - pos.totalCostEur;
      pos.unrealizedPnLPct = pos.totalCostEur !== 0 ? (pos.unrealizedPnLEur / pos.totalCostEur) : 0;
      
      // --- CROSS CURRENCY DISPLAY LOGIC ---
      // We want to display values in 'pos.currencyOrigin' (The currency user entered)
      // So we convert the Calculated EUR value BACK to Origin Currency.
      const fxOriginToEur = getFxRateToEur(pos.currencyOrigin);
      const safeFxOrigin = fxOriginToEur > 0 ? fxOriginToEur : 1;
      
      pos.currentFxRateToEur = safeFxOrigin; 
      pos.currentValueOrigin = pos.currentValueEur / safeFxOrigin;
      
      // Derived Price in Origin Currency
      pos.currentPriceOrigin = priceToUseInEur / safeFxOrigin; 
      
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
  
  // Available Cash = (Liquidity + Realized Gains) - Cost of Active Assets (Inc Comm)
  dashboard.availableCashEur = dashboard.totalLiquidityAddedEur + dashboard.realizedPnLEur - dashboard.totalCostEur;

  // Total Return = (Total Equity - Total Deposited) / Total Deposited
  const currentEquity = dashboard.totalValueEur + dashboard.availableCashEur;
  
  if (dashboard.totalLiquidityAddedEur > 0) {
      const totalGain = currentEquity - dashboard.totalLiquidityAddedEur;
      dashboard.totalReturnPct = totalGain / dashboard.totalLiquidityAddedEur;
  }

  dashboard.projectedCloseEur = currentEquity;

  return { activePositions, dashboard };
};
