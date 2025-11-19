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

  // If it matches a standard Google Sheets share/edit URL, extract ID and convert to CSV export
  // Matches patterns like: https://docs.google.com/spreadsheets/d/SPREADSHEET_ID/edit...
  const match = rawUrl.match(/\/d\/([a-zA-Z0-9-_]+)/);
  if (match && match[1]) {
    return `https://docs.google.com/spreadsheets/d/${match[1]}/export?format=csv`;
  }

  return rawUrl;
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
    
    // Parse CSV (Assumes formatting: Ticker, Price)
    // Handles common CSV issues like quotes or different delimiters
    const lines = text.split(/\r?\n/);
    
    lines.forEach(line => {
      if (!line.trim()) return;
      // Simple split by comma or semicolon
      const parts = line.split(/[,;]/);
      if (parts.length >= 2) {
        // Clean ticker name (remove quotes, whitespace)
        const ticker = parts[0].replace(/['"]/g, '').trim().toUpperCase();
        
        // Parse price (handle "1.200,50" vs "1200.50")
        let priceStr = parts[1].replace(/['"]/g, '').trim();
        
        // If the price string is something like "150.20" or "150,20"
        // We try to detect if comma is used as decimal separator (European) or thousand separator
        
        let price = NaN;
        
        if (priceStr.includes(',') && !priceStr.includes('.')) {
           // Only comma, likely European decimal: 120,50 -> 120.50
           price = parseFloat(priceStr.replace(',', '.'));
        } else if (priceStr.includes('.') && priceStr.includes(',')) {
           // Mixed, assume dot is thousand, comma is decimal (1.200,50) or vice versa
           // For Google Sheets export, it usually respects locale.
           // Simplest reliable fallback: remove all non-numeric except last separator
           // But let's stick to standard parsing first
           price = parseFloat(priceStr.replace(/,/g, '')); // Remove commas, assume USD style
           if (isNaN(price)) {
             price = parseFloat(priceStr.replace(/\./g, '').replace(',', '.')); // Swap for EU style
           }
        } else {
           price = parseFloat(priceStr);
        }

        if (ticker && !isNaN(price)) {
          newPrices[ticker] = price;
        }
      }
    });

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
  
  // Fallback to mock
  const base = MOCK_PRICES[ticker] || 100;
  // If no mock, return 0 or stable fallback to avoid NaN issues in UI
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
  // This ensures we do one fetch call (due to caching) instead of many
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

    // Mock Live Data Update (Now async aware)
    pos.currentPriceOrigin = await getCurrentPrice(pos.ticker);
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