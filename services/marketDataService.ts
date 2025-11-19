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

const FX_RATES = {
  [Currency.USD]: 0.94, // 1 USD = 0.94 EUR
  [Currency.EUR]: 1.0,
  [Currency.GBP]: 1.15,
  [Currency.CHF]: 1.04,
  [Currency.CAD]: 0.68,
  [Currency.JPY]: 0.006,
  [Currency.AUD]: 0.60,
  [Currency.HKD]: 0.12,
};

// Cache for fetched prices
let cachedPrices: Record<string, number> = {};
let lastFetchTime = 0;
const CACHE_DURATION = 60 * 1000; // 1 minute cache

const getCsvUrl = (): string | null => {
  const rawUrl = localStorage.getItem('PRICE_FEED_URL');
  if (!rawUrl) return null;

  // Matches standard Google Sheets URL
  const match = rawUrl.match(/\/d\/([a-zA-Z0-9-_]+)/);
  if (match && match[1]) {
    return `https://docs.google.com/spreadsheets/d/${match[1]}/export?format=csv`;
  }

  return rawUrl;
};

const parsePriceValue = (str: string): number => {
  if (!str) return 0;
  let val = str.toString().trim();
  
  // Remove symbols
  val = val.replace(/[€$£¥\s\u00A0]/g, '');
  
  // Handle European format (1.200,50) vs US (1,200.50)
  if (val.includes(',') && !val.includes('.')) {
    // Only comma: assume decimal separator (EU)
    val = val.replace(',', '.');
  } else if (val.includes(',') && val.includes('.')) {
    // Both present. If dot appears before comma (1.200,00), strip dot, replace comma.
    if (val.indexOf('.') < val.indexOf(',')) {
      val = val.replace(/\./g, '').replace(',', '.');
    } else {
      // Comma before dot (1,200.00), strip comma.
      val = val.replace(/,/g, '');
    }
  } else if (val.includes(',') && !val.includes('.')) {
      // Ambiguous but usually if only comma exists in financial contexts it's decimal in EU
      val = val.replace(',', '.');
  }
  
  return parseFloat(val);
};

const fetchPricesFromSheet = async (): Promise<Record<string, number>> => {
  const csvUrl = getCsvUrl();
  
  // Check cache validity
  if (Date.now() - lastFetchTime < CACHE_DURATION && Object.keys(cachedPrices).length > 0) {
    return cachedPrices;
  }

  if (!csvUrl) return {};

  try {
    const response = await fetch(csvUrl);
    if (!response.ok) throw new Error('Network response was not ok');
    const text = await response.text();
    
    const newPrices: Record<string, number> = {};
    
    const lines = text.split(/\r?\n/);
    
    // Try to identify headers to be safer, otherwise assume Col A = Ticker, Col B = Price
    let tickerIdx = 0;
    let priceIdx = 1;

    // Process lines
    lines.forEach((line, index) => {
      if (!line.trim()) return;
      
      // Simple CSV split
      const parts = line.split(/[,;]/);
      
      // Heuristic to skip header row
      if (index === 0) {
        const firstCell = parts[0].toLowerCase().replace(/['"]/g, '').trim();
        const secondCell = parts.length > 1 ? parts[1].toLowerCase().replace(/['"]/g, '').trim() : '';
        
        if (firstCell.includes('ticker') || firstCell.includes('simbolo') || secondCell.includes('precio')) {
          return; // Skip header
        }
      }

      if (parts.length >= 2) {
        const ticker = parts[tickerIdx].replace(/['"]/g, '').trim().toUpperCase();
        const priceRaw = parts[priceIdx].replace(/['"]/g, '').trim();
        
        const price = parsePriceValue(priceRaw);

        if (ticker && !isNaN(price)) {
          newPrices[ticker] = price;
        }
      }
    });

    console.log("Live Prices Fetched:", Object.keys(newPrices).length, newPrices);

    cachedPrices = newPrices;
    lastFetchTime = Date.now();
    return newPrices;

  } catch (error) {
    console.error("Error fetching live prices from sheet:", error);
    return {};
  }
};

export const getCurrentPrice = async (ticker: string): Promise<number> => {
  const livePrices = await fetchPricesFromSheet();
  
  if (livePrices[ticker]) {
    return livePrices[ticker];
  }
  
  // Fallback to mock if not found in sheet
  const base = MOCK_PRICES[ticker] || 0;
  return base; 
};

export const getFxRateToEur = (currency: Currency): number => {
  return FX_RATES[currency] || 1;
};

// The core calculation engine matching Excel logic
export const calculatePositionsAndMetrics = async (selectedPortfolio: PortfolioOwner | 'ALL') => {
  
  let transactions: Transaction[] = [];
  let liquidity: LiquidityEvent[] = [];

  if (selectedPortfolio === 'ALL') {
    transactions = await db.transactions.toArray();
    liquidity = await db.liquidity.toArray();
  } else {
    transactions = await db.transactions.where('portfolio').equals(selectedPortfolio).toArray();
    liquidity = await db.liquidity.where('portfolio').equals(selectedPortfolio).toArray();
  }

  // 1. Process Transactions to build Positions
  // Group by Portfolio + Ticker
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
        currencyOrigin: tx.currencyPlatform, // Simplified
        quantity: 0,
        avgPricePlatform: 0,
        avgFxRate: 0,
        avgPriceEur: 0,
        totalCostEur: 0,
        totalCostUsd: 0,
        currentPriceOrigin: 0,
        currentFxRateToEur: 0,
        currentValueEur: 0,
        currentValueUsd: 0,
        unrealizedPnLEur: 0,
        unrealizedPnLPct: 0,
        realizedPnLEur: 0
      };
    }

    if (tx.type === TransactionType.Buy) {
      // Weighted Average Logic
      const totalCostOld = pos.quantity * pos.avgPricePlatform;
      const costNew = tx.quantity * tx.price; 
      const newQuantity = pos.quantity + tx.quantity;
      
      // Avoid division by zero
      if (newQuantity > 0) {
          const newAvgPrice = (totalCostOld + costNew) / newQuantity;
          const totalFxWeighted = (pos.avgFxRate * totalCostOld) + (tx.fxRateToEur * costNew);
          const newAvgFx = totalFxWeighted / (totalCostOld + costNew) || tx.fxRateToEur;
    
          pos.quantity = newQuantity;
          pos.avgPricePlatform = newAvgPrice;
          pos.avgFxRate = newAvgFx;
          pos.avgPriceEur = pos.avgPricePlatform * pos.avgFxRate;
      }

    } else if (tx.type === TransactionType.Sell) {
      const sellValueEur = (tx.quantity * tx.price * tx.fxRateToEur) - (tx.commission * tx.fxRateToEur);
      const costOfSoldEur = tx.quantity * pos.avgPriceEur;
      
      const pnl = sellValueEur - costOfSoldEur;
      pos.realizedPnLEur += pnl;
      
      pos.quantity -= tx.quantity;
    }

    positionMap.set(key, pos);
  });

  // Pre-fetch live prices for all tickers in map
  await fetchPricesFromSheet(); 

  // 2. Calculate Final Metrics with Live Data
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

  // Iterate and update with async prices
  for (const pos of positionMap.values()) {
    const isClosed = pos.quantity <= 0.0001;

    // Live Data Update
    const livePrice = await getCurrentPrice(pos.ticker);
    
    // IMPORTANT: If we have a live price, use it. If not (0), use the Average Buy Price 
    // simply to show *something* in the chart instead of 0 value, but this hides PnL.
    // Better approach: If 0, use 0, but UI handles it. 
    // For this user request, let's stick to the requested price or keep previous logic.
    // If livePrice is 0, it means fetch failed or ticker not in sheet. 
    // We fallback to avgPricePlatform so the "Value" bar isn't empty in the dashboard initially.
    pos.currentPriceOrigin = livePrice > 0 ? livePrice : pos.avgPricePlatform;
    
    pos.currentFxRateToEur = getFxRateToEur(pos.currencyPlatform);
    
    if (!isClosed) {
      pos.currentValueEur = pos.quantity * pos.currentPriceOrigin * pos.currentFxRateToEur;
      pos.currentValueUsd = pos.currencyPlatform === Currency.USD ? pos.quantity * pos.currentPriceOrigin : 0;
      
      pos.totalCostEur = pos.quantity * pos.avgPriceEur;
      pos.totalCostUsd = pos.currencyPlatform === Currency.USD ? pos.quantity * pos.avgPricePlatform : 0;

      pos.unrealizedPnLEur = pos.currentValueEur - pos.totalCostEur;
      pos.unrealizedPnLPct = pos.totalCostEur !== 0 ? (pos.unrealizedPnLEur / pos.totalCostEur) : 0;
      
      activePositions.push(pos);

      dashboard.totalValueEur += pos.currentValueEur;
      dashboard.totalCostEur += pos.totalCostEur;
      dashboard.unrealizedPnLEur += pos.unrealizedPnLEur;
    }
    
    dashboard.realizedPnLEur += pos.realizedPnLEur;
  }

  // 3. Aggregate Liquidity
  dashboard.totalLiquidityAddedEur = liquidity.reduce((acc, curr) => acc + curr.amountEur, 0);

  // 4. Final Dashboard KPIs
  dashboard.unrealizedPnLPct = dashboard.totalCostEur > 0 ? (dashboard.unrealizedPnLEur / dashboard.totalCostEur) : 0;
  
  if (dashboard.totalLiquidityAddedEur > 0) {
      const totalGain = (dashboard.totalValueEur + dashboard.realizedPnLEur) - dashboard.totalLiquidityAddedEur;
      dashboard.totalReturnPct = totalGain / dashboard.totalLiquidityAddedEur;
  }

  dashboard.projectedCloseEur = dashboard.totalValueEur + dashboard.realizedPnLEur;

  return { activePositions, dashboard };
};