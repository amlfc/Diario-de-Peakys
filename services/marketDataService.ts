
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
  [Currency.USD]: 0.92, 
  [Currency.EUR]: 1.0,
  [Currency.GBP]: 1.17,
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
  val = val.replace(/[€$£¥\s\u00A0]/g, '');
  
  if (val.includes(',') && !val.includes('.')) {
    val = val.replace(',', '.');
  } else if (val.includes(',') && val.includes('.')) {
    if (val.indexOf('.') < val.indexOf(',')) {
      val = val.replace(/\./g, '').replace(',', '.');
    } else {
      val = val.replace(/,/g, '');
    }
  } else if (val.includes(',') && !val.includes('.')) {
      val = val.replace(',', '.');
  }
  
  return parseFloat(val);
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
    const lines = text.split(/\r?\n/);
    
    // Default Index: A=Ticker, B=Price, C=Currency
    let tickerIdx = 0;
    let priceIdx = 1;
    let currencyIdx = 2;

    lines.forEach((line, index) => {
      if (!line.trim()) return;
      const parts = line.split(/[,;]/);
      
      if (index === 0) {
        const firstCell = parts[0].toLowerCase().replace(/['"]/g, '').trim();
        if (firstCell.includes('ticker') || firstCell.includes('simbolo')) {
          return; 
        }
      }

      if (parts.length >= 2) {
        const ticker = parts[tickerIdx].replace(/['"]/g, '').trim().toUpperCase();
        const priceRaw = parts[priceIdx].replace(/['"]/g, '').trim();
        const currencyRaw = parts.length > 2 ? parts[currencyIdx].replace(/['"]/g, '').trim().toUpperCase() : undefined;
        
        const price = parsePriceValue(priceRaw);

        if (ticker && !isNaN(price)) {
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
  if (cachedMarketData[pairTicker]) return cachedMarketData[pairTicker].price;
  return FALLBACK_FX_RATES[currency] || 1;
};

export const calculatePositionsAndMetrics = async (selectedPortfolio: PortfolioOwner | 'ALL') => {
  
  // 1. Fetch Live Prices & Metadata FIRST
  // We need to know the "Real Asset Currency" (e.g. USD) to calculate Cost Basis in USD 
  // even if the user paid in EUR.
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
        totalCostOrigin: 0, // New Field
        currentPriceOrigin: 0,
        currentFxRateToEur: 0,
        currentValueEur: 0,
        currentValueOrigin: 0, // New Field
        unrealizedPnLEur: 0,
        unrealizedPnLOrigin: 0, // New Field
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
      const costNewEur = tx.quantity * tx.price * tx.fxRateToEur; 
      const newQuantity = pos.quantity + tx.quantity;
      
      // --- Origin Cost Calculation ---
      // Calculate how much "Origin Currency" was spent.
      // If I bought AAPL (USD) using EUR: CostUSD = CostEUR / FX_Rate(USD->EUR) 
      // Wait, tx.fxRateToEur represents "1 Unit of PlatCurr = X EUR".
      // If Plat=EUR, fx=1. If Plat=USD, fx=0.92.
      
      let costNewOrigin = 0;

      if (tx.currencyPlatform === pos.currencyOrigin) {
          // Easy case: Bought USD asset with USD
          costNewOrigin = tx.quantity * tx.price;
      } else if (tx.currencyPlatform === 'EUR' && pos.currencyOrigin !== 'EUR') {
          // Hard case: Bought USD asset with EUR (Broker converted)
          // We need the FX rate at that moment.
          // We only have tx.fxRateToEur which is 1 (since Plat is EUR).
          // We have to ESTIMATE the historical rate or assume the cost entered 
          // implies a specific FX.
          // Ideally, we'd reverse calculate, but without historical FX API, 
          // we assume the user *wants* to see the EUR cost mostly.
          // HOWEVER, for "G/P Origin", we need a base.
          // Let's try to use the CURRENT FX rate as a proxy if we lack history, 
          // OR if the user manually entered data...
          
          // BETTER APPROXIMATION:
          // We assume standard cross rate. 
          // If I paid 100 EUR for AAPL. AAPL is USD.
          // To know how many USD I "spent", I need the EUR/USD rate at that time.
          // If we don't have it, we can't be 100% accurate on "Origin P/L".
          // FALLBACK: Use the Live FX Rate to "backcast" the cost? No, that changes cost basis daily.
          
          // REVISED STRATEGY: 
          // If the platform currency differs from origin, strictly speaking we can't know the origin cost
          // without a historical FX rate. 
          // BUT, if the user provided `price` in EUR, we store it as EUR.
          // To calculate `totalCostOrigin`, we will try to convert.
          // Let's default `totalCostOrigin` to `totalCostEur` * `CurrentFX(EUR->Origin)`. 
          // This effectively pegs the "Origin Cost" to the current exchange rate relative to EUR cost,
          // which eliminates the FX effect on P/L *visually* for the user.
          // It means: "What would this cost in USD *today*?". 
          // Actually, the user wants: "How much did the stock move?".
          // So: `Quantity * (CurrentPriceOrigin - AvgPriceOrigin)`.
          // We need `AvgPriceOrigin`.
          
          // If Bought in EUR: Price = 100€. FX was 1.10 ($/€). Price in $ was 110.
          // Since we don't know 1.10, we can't know it was 110.
          
          // COMPROMISE: If currencies mismatch and we lack data, `totalCostOrigin` = 0 or hidden.
          // UNLESS: User enters data in Original Currency? 
          // Most users putting "Trade Republic" data enter the EUR price.
          // We will approximate using current FX rate to initialize, but it's imperfect.
          
          // LET'S STICK TO ROBUST LOGIC:
          // If Plat == Origin: Use Price.
          // If Plat != Origin: Use Price * (fxRateToEur / getFxRateToEur(Origin)). 
          // This uses current rate to estimate historical relation if unknown.
          // It's the best we can do without historical data.
          
          const currentFxOriginToEur = getFxRateToEur(pos.currencyOrigin);
          // Cost in EUR / Rate(Origin->EUR) = Cost in Origin
          costNewOrigin = (tx.quantity * tx.price * tx.fxRateToEur) / currentFxOriginToEur;
      } else {
          // Plat=USD, Origin=EUR? Rare.
          // Generic conversion via EUR base
          const currentFxOriginToEur = getFxRateToEur(pos.currencyOrigin);
          costNewOrigin = (tx.quantity * tx.price * tx.fxRateToEur) / currentFxOriginToEur;
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
      
      // Origin Metrics (The new Requirement)
      pos.currentValueOrigin = pos.quantity * pos.currentPriceOrigin;
      // If TotalCostOrigin was 0 (calculation issue), fallback to CostEur converted back
      if (pos.totalCostOrigin === 0 && pos.totalCostEur > 0) {
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
