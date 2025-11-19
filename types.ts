// Enums based on Excel Dropdowns

// Changed from Enum to string type to support dynamic creation
export type PortfolioOwner = string;

export const DefaultPortfolios = {
  Alejandro: 'Alejandro',
  Marta: 'Marta',
  Sara: 'Sara',
  Mama: 'Mama'
};

// Changed from Enum to string type to support dynamic creation/editing
export type AssetType = string;

export const DefaultAssetTypes = {
  ETFLong: 'ETF largo',
  ActionSwing: 'Acción swing',
  ActionLong: 'Acción largo',
  ActionPenny: 'Acción penny',
  Commodity: 'Materia prima',
  Crypto: 'Criptomonedas',
  FixedIncome: 'Renta fija',
  Unclassified: 'Sin Clasificar'
};

export enum Currency {
  EUR = 'EUR',
  USD = 'USD',
  GBP = 'GBP',
  CHF = 'CHF',
  CAD = 'CAD',
  JPY = 'JPY',
  AUD = 'AUD',
  HKD = 'HKD'
}

export enum TransactionType {
  Buy = 'Compra',
  Sell = 'Venta'
}

// Database Entities

export interface Portfolio {
  id?: number;
  name: string;
}

export interface AssetTypeEntity {
  id?: number;
  name: string;
}

export interface AssetAllocationTarget {
  id?: number;
  portfolio: string;
  assetType: string;
  targetPercentage: number; // e.g. 20 for 20%
}

export interface Transaction {
  id?: number; // Auto-incremented by Dexie
  date: string;
  portfolio: PortfolioOwner;
  type: TransactionType;
  ticker: string;
  assetName: string;
  assetType: AssetType; // Needed to link to diversification
  quantity: number;
  price: number; // In platform currency
  commission: number; // In platform currency
  currencyPlatform: Currency;
  fxRateToEur: number; // Exchange rate at time of transaction
  notes?: string;
}

export interface LiquidityEvent {
  id?: number;
  date: string;
  portfolio: PortfolioOwner;
  amountEur: number;
  type: string; // e.g., "Ingreso", "Traspaso"
  notes?: string;
}

// Derived Entities (Calculated on the fly like the Excel "Posiciones" sheet)

export interface Position {
  ticker: string;
  assetName: string;
  portfolio: PortfolioOwner;
  assetType: AssetType;
  currencyPlatform: Currency;
  currencyOrigin: Currency; // Simplified: assumed same as platform for this demo unless mapped
  
  quantity: number;
  avgPricePlatform: number; // CMP Compra
  avgFxRate: number;
  avgPriceEur: number;
  
  totalCostEur: number;
  totalCostUsd: number;
  
  currentPriceOrigin: number; // Live data
  currentFxRateToEur: number; // Live data
  
  currentValueEur: number;
  currentValueUsd: number;
  
  unrealizedPnLEur: number;
  unrealizedPnLPct: number;
  
  realizedPnLEur: number; // From closed transactions
}

export interface DashboardMetrics {
  totalValueEur: number;
  totalCostEur: number;
  unrealizedPnLEur: number;
  unrealizedPnLPct: number;
  totalLiquidityAddedEur: number;
  realizedPnLEur: number;
  totalReturnPct: number; // The complex ROI formula
  projectedCloseEur: number; // If everything was sold today
}

// Static Reference Data
export interface FundamentalRef {
  metric: string;
  reference: string;
}