import { describe, expect, it } from 'vitest';
import { Currency, TransactionType } from '../types';
import {
  calculateMonthlyPerformanceFromPoints,
  HistoricalPricePoint,
  PerformanceCalculationInput
} from './performanceService';

const assetPoint = (date: string, symbol: string, valueEur: number): HistoricalPricePoint => ({
  date,
  type: 'ASSET',
  symbol,
  valueEur
});

const baseInput = (): PerformanceCalculationInput => ({
  now: new Date(2026, 2, 15),
  currentEquityEur: 133.1,
  liquidity: [{ date: '2025-12-01', portfolio: 'Principal', amountEur: 100, type: 'Ingreso' }],
  transactions: [{
    date: '2025-12-01',
    portfolio: 'Principal',
    type: TransactionType.Buy,
    ticker: 'TEST',
    assetName: 'Test Asset',
    assetType: 'Acción',
    quantity: 1,
    price: 100,
    commission: 0,
    currencyPlatform: Currency.EUR,
    fxRateToEur: 0
  }]
});

describe('calculateMonthlyPerformanceFromPoints', () => {
  it('chains monthly returns for YTD and reports the last complete month', () => {
    const result = calculateMonthlyPerformanceFromPoints(baseInput(), [
      assetPoint('2025-12-31', 'TEST', 100),
      assetPoint('2026-01-31', 'TEST', 110),
      assetPoint('2026-02-28', 'TEST', 121)
    ]);

    expect(result.historicalReturnCoverage).toBe('complete');
    expect(result.timeWeightedReturnYtdPct).toBeCloseTo(0.331, 8);
    expect(result.lastCompleteMonthReturnPct).toBeCloseTo(0.1, 8);
  });

  it('weights external flows by the days remaining in the month', () => {
    const input = baseInput();
    input.now = new Date(2026, 0, 31);
    input.currentEquityEur = 220;
    input.liquidity.push({ date: '2026-01-15', portfolio: 'Principal', amountEur: 100, type: 'Ingreso' });
    input.transactions.push({
      ...input.transactions[0],
      date: '2026-01-15',
      quantity: 1,
      price: 100
    });

    const result = calculateMonthlyPerformanceFromPoints(input, [
      assetPoint('2025-11-30', 'TEST', 100),
      assetPoint('2025-12-31', 'TEST', 100),
      assetPoint('2026-01-31', 'TEST', 110)
    ]);

    const expectedJanuaryReturn = 20 / (100 + (100 * 17 / 31));
    expect(result.historicalReturnCoverage).toBe('complete');
    expect(result.timeWeightedReturnYtdPct).toBeCloseTo(expectedJanuaryReturn, 8);
  });

  it('handles short positions as negative assets with positive sale cash', () => {
    const input = baseInput();
    input.currentEquityEur = 110;
    input.transactions = [{
      ...input.transactions[0],
      type: TransactionType.Sell,
      ticker: 'SHORT'
    }];

    const result = calculateMonthlyPerformanceFromPoints(input, [
      assetPoint('2025-12-31', 'SHORT', 100),
      assetPoint('2026-01-31', 'SHORT', 95),
      assetPoint('2026-02-28', 'SHORT', 92)
    ]);

    expect(result.historicalReturnCoverage).toBe('complete');
    expect(result.timeWeightedReturnYtdPct).toBeCloseTo(0.1, 8);
  });

  it('values foreign-currency cash with historical FX rates', () => {
    const input = baseInput();
    input.currentEquityEur = 114;
    input.transactions = [{
      ...input.transactions[0],
      currencyPlatform: Currency.USD
    }];

    const fxPoint = (date: string, valueEur: number): HistoricalPricePoint => ({
      date,
      type: 'FX',
      symbol: 'USD',
      valueEur
    });

    const result = calculateMonthlyPerformanceFromPoints(input, [
      assetPoint('2025-12-31', 'TEST', 90),
      assetPoint('2026-01-31', 'TEST', 99),
      assetPoint('2026-02-28', 'TEST', 99),
      fxPoint('2025-12-31', 0.9),
      fxPoint('2026-01-31', 0.9),
      fxPoint('2026-02-28', 0.85)
    ]);

    expect(result.historicalReturnCoverage).toBe('complete');
    expect(result.timeWeightedReturnYtdPct).toBeCloseTo(0.14, 8);
    expect(result.lastCompleteMonthReturnPct).toBeCloseTo((114 / 109) - 1, 8);
  });

  it('marks the metric incomplete when a required quote is missing or stale', () => {
    const result = calculateMonthlyPerformanceFromPoints(baseInput(), [
      assetPoint('2025-12-20', 'TEST', 100),
      assetPoint('2026-01-31', 'TEST', 110),
      assetPoint('2026-02-28', 'TEST', 121)
    ]);

    expect(result.historicalReturnCoverage).toBe('incomplete');
    expect(result.timeWeightedReturnYtdPct).toBeNull();
    expect(result.lastCompleteMonthReturnPct).toBeNull();
  });
});
