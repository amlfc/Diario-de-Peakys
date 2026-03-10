// services/analysisService.ts

import { Transaction, TransactionType } from '../types';
import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
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

  // Moneda de la operación (USD, GBP, CHF, etc.)
  currency: string;

  // --- En moneda de origen ---
  sellPriceOrigin: number;
  costBasisOrigin: number;
  grossRevenueOrigin: number; // ingreso neto (tras comisiones) en moneda
  grossCostOrigin: number;    // coste FIFO en moneda
  netPnLOrigin: number;

  // --- En EUR (equivalente) ---
  sellPriceEur: number;
  costBasisEur: number;
  grossRevenueEur: number;
  grossCostEur: number;
  netPnLEur: number;

  returnPct: number; // lo calculamos sobre coste EUR
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

// --- DATA SANITIZATION HELPERS ---
const toNumber = (val: any): number => {
  if (typeof val === 'number' && !isNaN(val)) return val;
  if (val === null || val === undefined || val === '') return 0;

  const str = String(val).trim();
  let normalized = str;
  // Handle European format (comma decimal) if no dot is present
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

// --- CORE LOGIC: Replay History (FIFO real por lotes) ---
export const calculateClosedTrades = (transactions: Transaction[]): ClosedTrade[] => {
  const sortedTxs = [...transactions].sort(
    (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()
  );

  type Lot = {
    remainingQty: number;
    unitCostOrigin: number; // coste unitario en moneda (incluye comisión prorrateada)
    unitCostEur: number;    // coste unitario en EUR (unitCostOrigin * fxCompra)
    date: string;
  };

  // MUY IMPORTANTE: incluimos la moneda en la clave para NO mezclar inventarios
  const lotsByKey = new Map<string, Lot[]>();
  const closedTrades: ClosedTrade[] = [];

  const fxOf = (tx: Transaction) => (tx.currencyPlatform === 'EUR' ? 1 : (toNumber(tx.fxRateToEur) || 1));

  sortedTxs.forEach((rawTx, index) => {
    // Movimientos internos (cambios de divisa, traspasos no-cash, etc.)
    // no deben contaminar el histórico de operaciones cerradas.
    if ((rawTx as any).excludeFromMetrics || (rawTx as any).nonCash || isCurrencyExchangeTransaction(rawTx)) return;
    const tx: Transaction = {
      ...rawTx,
      quantity: toNumber(rawTx.quantity),
      price: toNumber(rawTx.price),
      commission: Math.abs(toNumber(rawTx.commission)),
      fxRateToEur: toNumber(rawTx.fxRateToEur) || 1
    };

    if (!tx.ticker || !tx.portfolio) return;

    const ccy = tx.currencyPlatform;
    const fx = fxOf(tx);

    // robustez: a veces SELL llega con qty negativa
    const qty = Math.abs(tx.quantity);
    if (qty <= 0.000001) return;

    const key = `${tx.portfolio}-${tx.ticker}-${ccy}`;
    const lots = lotsByKey.get(key) || [];

    if (tx.type === TransactionType.Buy) {
      // BUY (moneda)
      const buyCostOrigin = (tx.price * qty) + tx.commission; // comisión en moneda
      const unitCostOrigin = buyCostOrigin / qty;

      // BUY (EUR)
      const buyCostEur = buyCostOrigin * fx;
      const unitCostEur = buyCostEur / qty;

      lots.push({ remainingQty: qty, unitCostOrigin, unitCostEur, date: tx.date });
      lotsByKey.set(key, lots);
      return;
    }

    if (tx.type === TransactionType.Sell) {
      // Inventario antes (para coste medio “informativo”)
      const qtyBefore = lots.reduce((s, l) => s + l.remainingQty, 0);
      const costBeforeOrigin = lots.reduce((s, l) => s + (l.remainingQty * l.unitCostOrigin), 0);
      const costBeforeEur = lots.reduce((s, l) => s + (l.remainingQty * l.unitCostEur), 0);

      const avgCostOrigin = qtyBefore > 0.000001 ? costBeforeOrigin / qtyBefore : 0;
      const avgCostEur = qtyBefore > 0.000001 ? costBeforeEur / qtyBefore : 0;

      // Coste FIFO en moneda y en EUR
      let remainingToSell = qty;
      let fifoCostOrigin = 0;
      let fifoCostEur = 0;

      while (remainingToSell > 0.000001 && lots.length > 0) {
        const lot = lots[0];
        const takeQty = Math.min(lot.remainingQty, remainingToSell);

        fifoCostOrigin += takeQty * lot.unitCostOrigin;
        fifoCostEur += takeQty * lot.unitCostEur;

        lot.remainingQty -= takeQty;
        remainingToSell -= takeQty;

        if (lot.remainingQty <= 0.000001) lots.shift();
      }

      const qtySoldEffective = qty - Math.max(0, remainingToSell);
      if (qtySoldEffective <= METRIC_EPSILON) {
        lotsByKey.set(key, lots);
        return;
      }

      const matchedRatio = qtySoldEffective / qty;
      const sellRevenueGrossOrigin = tx.price * qtySoldEffective;
      const sellCommissionOrigin = tx.commission * matchedRatio;
      const sellRevenueNetOrigin = sellRevenueGrossOrigin - sellCommissionOrigin;
      const sellRevenueNetEur = sellRevenueNetOrigin * fx;

      const pnlOrigin = sellRevenueNetOrigin - fifoCostOrigin;
      const pnlEur = sellRevenueNetEur - fifoCostEur;

      const returnPct = fifoCostEur !== 0 ? (pnlEur / fifoCostEur) : 0;

      const qtyAfter = lots.reduce((s, l) => s + l.remainingQty, 0);
      const saleType: 'Venta Total' | 'Venta Parcial' = qtyAfter < 0.000001 ? 'Venta Total' : 'Venta Parcial';

      closedTrades.push({
        id: `trade-${index}`,
        date: tx.date,
        ticker: tx.ticker,
        assetName: tx.assetName,
        assetType: tx.assetType,
        portfolio: tx.portfolio,
        type: saleType,
        quantitySold: qtySoldEffective,

        currency: ccy,

        sellPriceOrigin: qtySoldEffective > 0 ? (sellRevenueNetOrigin / qtySoldEffective) : 0,
        costBasisOrigin: avgCostOrigin,
        grossRevenueOrigin: sellRevenueNetOrigin,
        grossCostOrigin: fifoCostOrigin,
        netPnLOrigin: pnlOrigin,

        sellPriceEur: qtySoldEffective > 0 ? (sellRevenueNetEur / qtySoldEffective) : 0,
        costBasisEur: avgCostEur,
        grossRevenueEur: sellRevenueNetEur,
        grossCostEur: fifoCostEur,
        netPnLEur: pnlEur,

        returnPct
      });

      lotsByKey.set(key, lots);
    }
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

// --- EXPORTERS ---

const formatProfitFactor = (profitFactor: number): string =>
  Number.isFinite(profitFactor) ? profitFactor.toFixed(2) : '∞';

export const exportAnalysisToExcel = (trades: ClosedTrade[], metrics: AnalysisMetrics) => {
  const wb = utils.book_new();

  // Sheet 1: Summary
  const summaryData = [
    { Métrica: 'Total Operaciones', Valor: metrics.totalTrades },
    { Métrica: 'Beneficio Neto Total (€)', Valor: metrics.totalProfitEur },
    { Métrica: 'Tasa de Acierto %', Valor: (metrics.winRate * 100).toFixed(2) + '%' },
    { Métrica: 'Factor de Beneficio', Valor: formatProfitFactor(metrics.profitFactor) },
    { Métrica: 'Promedio Ganancia (€)', Valor: metrics.avgWinEur },
    { Métrica: 'Promedio Pérdida (€)', Valor: metrics.avgLossEur },
  ];
  const wsSummary = utils.json_to_sheet(summaryData);
  utils.book_append_sheet(wb, wsSummary, "Resumen");

 // Sheet 2: Detail
const detailData = trades.map((t: any) => ({
  Fecha: t.date,
  Cartera: t.portfolio,
  Ticker: t.ticker,
  Activo: t.assetName,
  'Tipo Venta': t.type,
  'Cantidad': t.quantitySold,

  // NUEVO: moneda
  'Divisa': t.currency || t.currencyPlatform || 'EUR',

  // NUEVO: en moneda de origen (si existe)
  'Ingreso (moneda)': t.grossRevenueOrigin ?? '',
  'Coste (moneda)': t.grossCostOrigin ?? '',
  'P&L (moneda)': t.netPnLOrigin ?? '',

  // EUR (lo que ya tenías)
  'Precio Venta Neto (€)': t.sellPriceEur,
  'Coste Base (€)': t.costBasisEur,
  'Ingreso Total (€)': t.grossRevenueEur,
  'Coste Total (€)': t.grossCostEur,
  'P&L Neto (€)': t.netPnLEur,
  'Retorno %': t.returnPct
}));

const wsDetail = utils.json_to_sheet(detailData);
utils.book_append_sheet(wb, wsDetail, "Detalle Operaciones");

writeFile(wb, `Peakys_Informe_Analisis_${new Date().toISOString().split('T')[0]}.xlsx`);
};

export const exportAnalysisToPDF = (trades: ClosedTrade[], metrics: AnalysisMetrics) => {
const doc = new jsPDF();
const pageWidth = doc.internal.pageSize.width;

// Header
doc.setFontSize(18);
doc.setTextColor(40, 40, 40);
doc.text("Informe de Operaciones Cerradas - Diario de Peakys", 14, 20);

doc.setFontSize(10);
doc.setTextColor(100, 100, 100);
doc.text(`Generado el: ${new Date().toLocaleDateString()}`, 14, 26);

// KPI Summary Box
const startY = 35;
const boxHeight = 30;

doc.setFillColor(240, 245, 250);
doc.rect(14, startY, pageWidth - 28, boxHeight, 'F');

doc.setFontSize(12);
doc.setTextColor(0, 0, 0);

// Row 1
doc.text(
  `Total P&L: ${new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' }).format(metrics.totalProfitEur)}`,
  20, startY + 10
);
doc.text(`Tasa Acierto: ${(metrics.winRate * 100).toFixed(1)}%`, 80, startY + 10);
doc.text(`Factor Beneficio: ${formatProfitFactor(metrics.profitFactor)}`, 140, startY + 10);

// Row 2
doc.setFontSize(10);
doc.text(`Ops Totales: ${metrics.totalTrades}`, 20, startY + 20);
doc.text(`Media Gan.: €${metrics.avgWinEur.toFixed(2)}`, 80, startY + 20);
doc.text(`Media Pérd.: €${metrics.avgLossEur.toFixed(2)}`, 140, startY + 20);

// Table (NUEVO: añadimos Divisa y P&L moneda)
const tableColumn = ["Fecha", "Cartera", "Ticker", "Divisa", "Venta", "Coste (€)", "P&L (moneda)", "P&L (€)", "%"];

const tableRows = trades.map((t: any) => {
  const ccy = (t.currency || t.currencyPlatform || 'EUR') as string;

  const pnlOrigin = typeof t.netPnLOrigin === 'number' ? t.netPnLOrigin : null;
  const pnlOriginStr =
    pnlOrigin === null
      ? '-'
      : new Intl.NumberFormat('es-ES', { style: 'currency', currency: ccy, minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(pnlOrigin);

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
    7: { fontStyle: 'bold' } // columna P&L (€)
  },
  didParseCell: function (data: any) {
    // Color P&L (€) column (index 7)
    if (data.section === 'body' && data.column.index === 7) {
      const val = parseFloat(data.cell.raw);
      if (!isNaN(val)) {
        if (val >= 0) data.cell.styles.textColor = [20, 160, 100];
        else data.cell.styles.textColor = [200, 60, 60];
      }
    }
  }
});

doc.save(`Peakys_Informe_PDF_${new Date().toISOString().split('T')[0]}.pdf`);
};
