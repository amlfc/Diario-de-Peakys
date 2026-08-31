
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

export interface User {
  id?: number;
  username: string;
  password?: string; // Only used for registration/check
  role: 'admin' | 'user';
}

export interface Portfolio {
  id?: number;
  name: string;
  owner_id?: number; // Link to User ID
  user_id?: number; // Owner scope for row-level filtering
}

export interface AssetTypeEntity {
  id?: number;
  name: string;
  user_id?: number;
}

export interface AssetAllocationTarget {
  id?: number;
  portfolio: string;
  assetType: string;
  targetPercentage: number; // e.g. 20 for 20%
  user_id?: number;
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
  fxRateToEur: number; // Stored as 0 for EUR; otherwise currency -> EUR rate at transaction time
  excludeFromMetrics?: boolean; // Si true, la operación se ignora en posiciones/P&L (útil para cambios de divisa)
  nonCash?: boolean; // Si true: ajusta posición/coste pero NO afecta a liquidez
  notes?: string;
  user_id?: number;
}

export interface LiquidityEvent {
  id?: number;
  date: string;
  portfolio: PortfolioOwner;
  amountEur: number;
  type: string; // e.g., "Ingreso", "Traspaso"
  notes?: string;
  user_id?: number;
}

// Notes linked to a specific "position instance" (same ticker can be opened/closed multiple times)
export interface PositionNote {
  id?: number;
  // Unique key for the position lifecycle: `${portfolio}-${ticker}-${openedDate}`
  positionKey: string;
  portfolio: PortfolioOwner;
  ticker: string;
  openedDate: string; // YYYY-MM-DD
  note: string;
  updatedAt: string; // ISO string
  user_id?: number;
}

// Derived Entities (Calculated on the fly like the Excel "Posiciones" sheet)

export interface Position {
  ticker: string;
  assetName: string;
  portfolio: PortfolioOwner;
  assetType: AssetType;
  
  // Currencies
  currencyPlatform: Currency; // The currency used in the broker (e.g. EUR for Trade Republic)
  currencyOrigin: string;   // The real asset currency (e.g. USD for AAPL), fetched from Feed
  
  quantity: number;
  
  // Platform Currency Metrics (e.g. What you see in Broker)
  avgPricePlatform: number; 
  
  // EUR Metrics (Base currency of the App)
  avgFxRate: number;
  avgPriceEur: number;
  totalCostEur: number;
  currentValueEur: number;
  unrealizedPnLEur: number;
  unrealizedPnLPct: number;
  realizedPnLEur: number; 

  // Origin Currency Metrics (Real asset performance excluding FX impact)
  totalCostOrigin: number;      // Calculated by reverse-engineering FX at time of purchase if needed
  currentPriceOrigin: number;   // Live data from sheet
  currentValueOrigin: number;
  unrealizedPnLOrigin: number;

  currentFxRateToEur: number; // Live data
}

export interface DashboardMetrics {
  totalValueEur: number; // Only Assets
  availableCashEur: number; // Liquidity
  totalCostEur: number;
  unrealizedPnLEur: number;
  unrealizedPnLPct: number;
  totalLiquidityAddedEur: number;
  realizedPnLEur: number;
  totalReturnPct: number; // The complex ROI formula
  timeWeightedReturnYtdPct: number | null;
  lastCompleteMonthReturnPct: number | null;
  historicalReturnCoverage: 'loading' | 'complete' | 'incomplete' | 'not_configured';
  historicalReturnIssue: 'missing_data' | 'invalid_period' | 'source_empty' | null;
  historicalReturnMissingSymbols: string[];
  projectedCloseEur: number; // If everything was sold today
}

// Static Reference Data
export interface FundamentalRef {
  metric: string;
  reference: string;
}
