
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
  fxRateToEur: number; // Exchange rate at time of transaction
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
  projectedCloseEur: number; // If everything was sold today
}

// Static Reference Data
export interface FundamentalRef {
  metric: string;
  reference: string;
}

export type FxAlertSeverity = 'high' | 'medium' | 'low';

export interface FxAlert {
  kind: string;
  severity: FxAlertSeverity;
  title: string;
  message: string;
  value?: number;
  threshold?: number;
}

export interface FxOverviewPair {
  ticker: string;
  pair: string;
  type: string;
  currency?: string | null;
  last_price: number;
  day_change_pct: number;
  z_score_52w: number;
  percentile_1y?: number | null;
  signal: string;
}

export interface FxOverviewResponse {
  generated_at: string;
  base_currency: string;
  pairs: FxOverviewPair[];
  alerts: FxAlert[];
  excluded_tickers: string[];
}

export interface FxCarryRow {
  currency: string;
  pair: string;
  ticker: string;
  reference_rate_pct: number;
  eur_rate_pct: number;
  carry_pct: number;
  volatility_30d_pct: number;
  momentum_1m_pct: number;
  carry_to_risk: number;
  last_price: number;
  signal: string;
}

export interface FxCarryResponse {
  generated_at: string;
  base_currency: string;
  reference_rates_pct: Record<string, number>;
  ranking: FxCarryRow[];
  alerts: FxAlert[];
  excluded_tickers: string[];
}

export interface FxExposureRow {
  currency: string;
  fx_pair: string;
  positions_eur: number;
  cash_eur: number;
  exposure_eur: number;
  share_pct: number;
  hedge_ratio: number;
  beta: number;
  correlation: number;
  observations: number;
  notional_to_hedge_eur: number;
  covered_share_pct: number;
}

export interface FxExposureResponse {
  generated_at: string;
  base_currency: string;
  visible_portfolios: string[];
  total_equity_eur: number;
  currency_breakdown: FxExposureRow[];
  donut: Array<{ name: string; value: number; share_pct: number }>;
  usd_traffic_light: {
    state: 'green' | 'orange' | 'red';
    uncovered_share_pct: number;
  };
  excluded_tickers: string[];
}

export interface FxHedgeRatioResponse {
  generated_at: string;
  asset_ticker: string;
  fx_pair: string;
  window: number;
  beta: number;
  correlation: number;
  hedge_ratio: number;
  current_value_eur: number;
  notional_to_hedge_eur: number;
  observations: number;
  excluded_tickers: string[];
}

export interface FxCorrelationMatrixResponse {
  generated_at: string;
  labels: string[];
  matrix: Array<Array<number | null>>;
  excluded_tickers: string[];
}

export interface FxDxyImpactResponse {
  generated_at: string;
  percentile_1y: number | null;
  zone: 'weak' | 'neutral' | 'strong';
  dxy_last: number | null;
  eurusd_last: number | null;
  eurusd_zscore_52w: number;
  correlation_30d: number;
  beta_30d: number;
  usd_exposure_eur: number;
  estimated_portfolio_impact_eur: number;
  impact_example: {
    dxy_shock_pct: number;
    predicted_eurusd_change_pct: number;
    usd_notional: number;
    current_value_eur: number;
    shocked_value_eur: number;
    impact_eur: number;
  };
  chart: Array<{ date: string; eurusd: number; z_score: number }>;
  alerts: FxAlert[];
  excluded_tickers: string[];
}

export interface FxStressPositionImpact {
  kind: 'position' | 'cash';
  ticker?: string;
  asset_name?: string;
  currency: string;
  portfolio?: string;
  amount_origin?: number;
  value_eur_current: number;
  value_eur_shocked: number;
  pnl_eur: number;
  pnl_pct: number;
  shock_pct: number;
}

export interface FxStressCurrencyImpact {
  currency: string;
  shock_pct: number;
  current_eur: number;
  shocked_eur: number;
  pnl_eur: number;
  pnl_pct: number;
}

export interface FxStressHedgeSuggestion {
  currency: string;
  fx_pair: string;
  exposure_eur: number;
  suggested_hedge_notional_eur: number;
  scenario_shock_pct: number;
}

export interface FxStressResponse {
  generated_at: string;
  scenario: string;
  shocks: Record<string, number>;
  positions: FxStressPositionImpact[];
  cash: FxStressPositionImpact[];
  currency_impact: FxStressCurrencyImpact[];
  portfolio_totals: {
    current_value_eur: number;
    shocked_value_eur: number;
    pnl_eur: number;
    pnl_pct: number;
  };
  how_to_hedge: FxStressHedgeSuggestion[];
  excluded_tickers: string[];
}
