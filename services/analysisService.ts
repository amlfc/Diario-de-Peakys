// services/analysisService.ts

import { Transaction, TransactionType } from '../types';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { writeFile, utils } from 'xlsx';

export interface ClosedTrade {
  id: string;
  date: string;
  ticker: string;
  assetName: string;
  assetType: string;
  portfolio: string;
  type: 'Venta Total' | 'Venta Parcial';
  quantitySold: number;

  currency: string;

  // Origin currency amounts. They are kept exactly aligned with EUR values
  // through the same FX used in the transaction.
  sellPriceOrigin: number;
  costBasisOrigin: number;
  grossRevenueOrigin: number;
  grossCostOrigin: number;
  netPnLOrigin: number;

  sellPriceEur: number;
  costBasisEur: number;
  grossRevenueEur: number;
  grossCostEur: number;
  netPnLEur: number;

  returnPct: number;
}

export interface AnalysisMetrics {
  totalTrades: number;
  winRate: number;
  totalProfitEur: number;
  profitFactor: number;
  avgWinEur: number;
  avgLossEur: number;
  bestTrade: ClosedTrade | null;
  worstTrade: ClosedTrade | null;
}

const METRIC_EPSILON = 0.000001;

const toNumber = (val: any): number => {
  if (typeof val === 'number' && !isNaN(val)) return val;
  if (val === null || val === undefined || val === '') return 0;

  const str = String(val).trim();
  let normalized = str;
  if (str.includes(',') && !str.includes('.')) {
    normalized = str.replace(',', '.');
  }

  const parsed = parseFloat(normalized);
  return isNaN(parsed) ? 0 : parsed;
};

const KNOWN_CURRENCIES = new Set([
  'EUR', 'USD', 'GBP', 'CHF', 'CAD', 'JPY', 'AUD', 'HKD',
  'NZD', 'SEK', 'NOK', 'DKK', 'PLN', 'CZK', 'HUF', 'RON',
  'TRY', 'MXN', 'BRL', 'ZAR', 'SGD', 'CNH', 'CNY'
]);

const isCurrencyExchangeTransaction = (tx: Transaction): boolean => {
  const ticker = (tx.ticker || '').toUpperCase().trim();
  const assetType = (tx.assetType || '').toLowerCase();
  const assetName = (tx.assetName || '').toLowerCase();
  const notes = (tx.notes || '').toLowerCase();

  const pairMatch = ticker.match(/^([A-Z]{3})[.\/_-]?([A-Z]{3})$/);
  const isForexPair = !!pairMatch
    && pairMatch[1] !== pairMatch[2]
    && KNOWN_CURRENCIES.has(pairMatch[1])
    && KNOWN_CURRENCIES.has(pairMatch[2]);

  const looksLikeFxByLabels = [assetType, assetName, notes].some(field =>
    field.includes('divisa') || field.includes('forex') || field.includes('fx') || field.includes('cambio')
  );

  return isForexPair || looksLikeFxByLabels;
};

const fxOf = (tx: Transaction) => (
  tx.currencyPlatform === 'EUR' ? 1 : (toNumber(tx.fxRateToEur) || 1)
);

const toOriginFromEur = (amountEur: number, fxRateToEur: number): number => {
  const safeFx = fxRateToEur > METRIC_EPSILON ? fxRateToEur : 1;
  return amountEur / safeFx;
};

export const calculateClosedTrades = (transactions: Transaction[]): ClosedTrade[] => {
  const sortedTxs = [...transactions].sort(
    (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()
  );

  type Lot = {
    remainingQty: number;
    unitCostOrigin: number;
    unitCostEur: number;
    date: string;
  };

  const lotsByKey = new Map<string, Lot[]>();
  const closedTrades: ClosedTrade[] = [];

  sortedTxs.forEach((rawTx, index) => {
    if ((rawTx as any).excludeFromMetrics || (rawTx as any).nonCash || isCurrencyExchangeTransaction(rawTx)) {
      return;
    }

    const tx: Transaction = {
      ...rawTx,
      quantity: toNumber(rawTx.quantity),
      price: toNumber(rawTx.price),
      commission: Math.abs(toNumber(rawTx.commission)),
      fxRateToEur: toNumber(rawTx.fxRateToEur) || 1
    };

    if (!tx.ticker || !tx.portfolio) return;

    const currency = tx.currencyPlatform;
    const fx = fxOf(tx);
    const qty = Math.abs(tx.quantity);

    if (qty <= METRIC_EPSILON) return;

    const key = `${tx.portfolio}-${tx.ticker}-${currency}`;
    const lots = lotsByKey.get(key) || [];

    if (tx.type === TransactionType.Buy) {
      const buyCostEur = ((tx.price * qty) + tx.commission) * fx;
      const unitCostEur = buyCostEur / qty;
      const buyCostOrigin = toOriginFromEur(buyCostEur, fx);
      const unitCostOrigin = buyCostOrigin / qty;

      lots.push({ remainingQty: qty, unitCostOrigin, unitCostEur, date: tx.date });
      lotsByKey.set(key, lots);
      return;
    }

    if (tx.type !== TransactionType.Sell) return;

    const qtyBefore = lots.reduce((sum, lot) => sum + lot.remainingQty, 0);
    const costBeforeOrigin = lots.reduce((sum, lot) => sum + (lot.remainingQty * lot.unitCostOrigin), 0);
    const costBeforeEur = lots.reduce((sum, lot) => sum + (lot.remainingQty * lot.unitCostEur), 0);

    const avgCostOrigin = qtyBefore > METRIC_EPSILON ? (costBeforeOrigin / qtyBefore) : 0;
    const avgCostEur = qtyBefore > METRIC_EPSILON ? (costBeforeEur / qtyBefore) : 0;

    let remainingToSell = qty;
    let fifoCostEur = 0;

    while (remainingToSell > METRIC_EPSILON && lots.length > 0) {
      const lot = lots[0];
      const takeQty = Math.min(lot.remainingQty, remainingToSell);

      fifoCostEur += takeQty * lot.unitCostEur;

      lot.remainingQty -= takeQty;
      remainingToSell -= takeQty;

      if (lot.remainingQty <= METRIC_EPSILON) {
        lots.shift();
      }
    }

    const qtySoldEffective = qty - Math.max(0, remainingToSell);
    if (qtySoldEffective <= METRIC_EPSILON) {
      lotsByKey.set(key, lots);
      return;
    }

    const matchedRatio = qtySoldEffective / qty;
    const sellRevenueNetEur = (tx.price * qtySoldEffective * fx) - ((tx.commission * matchedRatio) * fx);
    const pnlEur = sellRevenueNetEur - fifoCostEur;

    const grossRevenueOrigin = toOriginFromEur(sellRevenueNetEur, fx);
    const grossCostOrigin = toOriginFromEur(fifoCostEur, fx);
    const netPnLOrigin = toOriginFromEur(pnlEur, fx);
    const returnPct = fifoCostEur !== 0 ? (pnlEur / fifoCostEur) : 0;

    const qtyAfter = lots.reduce((sum, lot) => sum + lot.remainingQty, 0);
    const saleType: 'Venta Total' | 'Venta Parcial' = qtyAfter < METRIC_EPSILON ? 'Venta Total' : 'Venta Parcial';

    closedTrades.push({
      id: `trade-${index}`,
      date: tx.date,
      ticker: tx.ticker,
      assetName: tx.assetName,
      assetType: tx.assetType,
      portfolio: tx.portfolio,
      type: saleType,
      quantitySold: qtySoldEffective,
      currency,
      sellPriceOrigin: qtySoldEffective > 0 ? (grossRevenueOrigin / qtySoldEffective) : 0,
      costBasisOrigin: avgCostOrigin,
      grossRevenueOrigin,
      grossCostOrigin,
      netPnLOrigin,
      sellPriceEur: qtySoldEffective > 0 ? (sellRevenueNetEur / qtySoldEffective) : 0,
      costBasisEur: avgCostEur,
      grossRevenueEur: sellRevenueNetEur,
      grossCostEur: fifoCostEur,
      netPnLEur: pnlEur,
      returnPct
    });

    lotsByKey.set(key, lots);
  });

  return closedTrades.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
};

export const calculateAnalysisMetrics = (trades: ClosedTrade[]): AnalysisMetrics => {
  const totalTrades = trades.length;
  const winners = trades.filter(t => t.netPnLEur > METRIC_EPSILON);
  const losers = trades.filter(t => t.netPnLEur < -METRIC_EPSILON);

  const totalProfit = trades.reduce((sum, t) => sum + t.netPnLEur, 0);
  const grossProfit = winners.reduce((sum, t) => sum + t.netPnLEur, 0);
  const grossLoss = Math.abs(losers.reduce((sum, t) => sum + t.netPnLEur, 0));

  const profitFactor = grossLoss <= METRIC_EPSILON
    ? (grossProfit > METRIC_EPSILON ? Number.POSITIVE_INFINITY : 0)
    : (grossProfit / grossLoss);

  return {
    totalTrades,
    winRate: totalTrades > 0 ? (winners.length / totalTrades) : 0,
    totalProfitEur: totalProfit,
    profitFactor,
    avgWinEur: winners.length > 0 ? (grossProfit / winners.length) : 0,
    avgLossEur: losers.length > 0 ? (grossLoss / losers.length) : 0,
    bestTrade: winners.length > 0
      ? winners.reduce((prev, current) => (prev.netPnLEur > current.netPnLEur) ? prev : current)
      : null,
    worstTrade: losers.length > 0
      ? losers.reduce((prev, current) => (prev.netPnLEur < current.netPnLEur) ? prev : current)
      : null
  };
};

const formatProfitFactor = (profitFactor: number): string =>
  Number.isFinite(profitFactor) ? profitFactor.toFixed(2) : '∞';

export const exportAnalysisToExcel = (trades: ClosedTrade[], metrics: AnalysisMetrics) => {
  const wb = utils.book_new();

  const summaryData = [
    { Metrica: 'Total Operaciones', Valor: metrics.totalTrades },
    { Metrica: 'Beneficio Neto Total (€)', Valor: metrics.totalProfitEur },
    { Metrica: 'Tasa de Acierto %', Valor: (metrics.winRate * 100).toFixed(2) + '%' },
    { Metrica: 'Factor de Beneficio', Valor: formatProfitFactor(metrics.profitFactor) },
    { Metrica: 'Promedio Ganancia (€)', Valor: metrics.avgWinEur },
    { Metrica: 'Promedio Perdida (€)', Valor: metrics.avgLossEur },
  ];
  const wsSummary = utils.json_to_sheet(summaryData);
  utils.book_append_sheet(wb, wsSummary, 'Resumen');

  const detailData = trades.map((t: ClosedTrade) => ({
    Fecha: t.date,
    Cartera: t.portfolio,
    Ticker: t.ticker,
    Activo: t.assetName,
    'Tipo Venta': t.type,
    Cantidad: t.quantitySold,
    Divisa: t.currency || 'EUR',
    'Ingreso (moneda)': t.grossRevenueOrigin,
    'Coste (moneda)': t.grossCostOrigin,
    'P&L (moneda)': t.netPnLOrigin,
    'Precio Venta Neto (€)': t.sellPriceEur,
    'Coste Base (€)': t.costBasisEur,
    'Ingreso Total (€)': t.grossRevenueEur,
    'Coste Total (€)': t.grossCostEur,
    'P&L Neto (€)': t.netPnLEur,
    'Retorno %': t.returnPct
  }));

  const wsDetail = utils.json_to_sheet(detailData);
  utils.book_append_sheet(wb, wsDetail, 'Detalle Operaciones');

  writeFile(wb, `Peakys_Informe_Analisis_${new Date().toISOString().split('T')[0]}.xlsx`);
};

export const exportAnalysisToPDF = (trades: ClosedTrade[], metrics: AnalysisMetrics) => {
  const doc = new jsPDF();
  const pageWidth = doc.internal.pageSize.width;

  doc.setFontSize(18);
  doc.setTextColor(40, 40, 40);
  doc.text('Informe de Operaciones Cerradas - Diario de Peakys', 14, 20);

  doc.setFontSize(10);
  doc.setTextColor(100, 100, 100);
  doc.text(`Generado el: ${new Date().toLocaleDateString()}`, 14, 26);

  const startY = 35;
  const boxHeight = 30;

  doc.setFillColor(240, 245, 250);
  doc.rect(14, startY, pageWidth - 28, boxHeight, 'F');

  doc.setFontSize(12);
  doc.setTextColor(0, 0, 0);
  doc.text(
    `Total P&L: ${new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' }).format(metrics.totalProfitEur)}`,
    20, startY + 10
  );
  doc.text(`Tasa Acierto: ${(metrics.winRate * 100).toFixed(1)}%`, 80, startY + 10);
  doc.text(`Factor Beneficio: ${formatProfitFactor(metrics.profitFactor)}`, 140, startY + 10);

  doc.setFontSize(10);
  doc.text(`Ops Totales: ${metrics.totalTrades}`, 20, startY + 20);
  doc.text(`Media Gan.: €${metrics.avgWinEur.toFixed(2)}`, 80, startY + 20);
  doc.text(`Media Perd.: €${metrics.avgLossEur.toFixed(2)}`, 140, startY + 20);

  const tableColumn = ['Fecha', 'Cartera', 'Ticker', 'Divisa', 'Venta', 'Coste (€)', 'P&L (moneda)', 'P&L (€)', '%'];
  const tableRows = trades.map((t: ClosedTrade) => {
    const ccy = t.currency || 'EUR';
    const pnlOriginStr = new Intl.NumberFormat('es-ES', {
      style: 'currency',
      currency: ccy,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }).format(t.netPnLOrigin);

    return [
      t.date,
      t.portfolio,
      t.ticker,
      ccy,
      (t.type === 'Venta Total' ? 'Total' : 'Parcial'),
      t.grossCostEur.toFixed(2),
      pnlOriginStr,
      t.netPnLEur.toFixed(2),
      (t.returnPct * 100).toFixed(2) + '%'
    ];
  });

  autoTable(doc, {
    head: [tableColumn],
    body: tableRows,
    startY: startY + boxHeight + 10,
    styles: { fontSize: 8 },
    headStyles: { fillColor: [41, 128, 185] },
    columnStyles: {
      7: { fontStyle: 'bold' }
    },
    didParseCell: function (data: any) {
      if (data.section === 'body' && data.column.index === 7) {
        const val = parseFloat(data.cell.raw);
        if (!isNaN(val)) {
          data.cell.styles.textColor = val >= 0 ? [20, 160, 100] : [200, 60, 60];
        }
      }
    }
  });

  doc.save(`Peakys_Informe_PDF_${new Date().toISOString().split('T')[0]}.pdf`);
};
