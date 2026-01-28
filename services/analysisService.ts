
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
  
  // Financials in EUR
  sellPriceEur: number; // Avg Price of this sell event
  costBasisEur: number; // Weighted Avg Cost at moment of sale
  
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

// --- CORE LOGIC: Replay History ---
export const calculateClosedTrades = (transactions: Transaction[]): ClosedTrade[] => {
  // 1. Sort chronologically
  const sortedTxs = [...transactions].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

  // 2. Inventory State
  // Map Key: "Portfolio-Ticker" -> { quantity, totalCostEur }
  const inventory = new Map<string, { quantity: number, totalCostEur: number }>();
  const closedTrades: ClosedTrade[] = [];

  sortedTxs.forEach((rawTx, index) => {
    // SANITIZE INPUTS to prevent NaN in Analysis
    const tx = {
        ...rawTx,
        quantity: toNumber(rawTx.quantity),
        price: toNumber(rawTx.price),
        commission: Math.abs(toNumber(rawTx.commission)),
        fxRateToEur: toNumber(rawTx.fxRateToEur) || 1
    };

    const key = `${tx.portfolio}-${tx.ticker}`;
    const currentPos = inventory.get(key) || { quantity: 0, totalCostEur: 0 };

    // Calculate FX aware values
    // If currency is EUR, fx is 1. If not, use the rate recorded at transaction time.
    const fxRate = tx.currencyPlatform === 'EUR' ? 1 : tx.fxRateToEur;
    
    if (tx.type === TransactionType.Buy) {
      // --- BUY LOGIC ---
      // Cost = (Price * Qty * FX) + (Comm * FX)
      const txCostEur = (tx.price * tx.quantity * fxRate) + (tx.commission * fxRate);
      
      currentPos.quantity += tx.quantity;
      currentPos.totalCostEur += txCostEur;
      
      inventory.set(key, currentPos);

    } else if (tx.type === TransactionType.Sell) {
      // --- SELL LOGIC (FIFO/Weighted Avg simulation) ---
      
      // We use Weighted Average Cost logic as per the main app.
      // Avg Cost per Share = TotalCost / TotalQty
      const avgCostPerShareEur = currentPos.quantity > 0.000001 ? (currentPos.totalCostEur / currentPos.quantity) : 0;
      
      const sellRevenueGrossEur = (tx.price * tx.quantity * fxRate);
      const sellCommEur = (tx.commission * fxRate);
      const sellRevenueNetEur = sellRevenueGrossEur - sellCommEur;

      // Cost of Goods Sold
      const costOfSoldEur = avgCostPerShareEur * tx.quantity;

      // PnL
      const pnlEur = sellRevenueNetEur - costOfSoldEur;
      
      // Determine Return %
      const returnPct = costOfSoldEur !== 0 ? (pnlEur / costOfSoldEur) : 0;

      // Record Closed Trade
      closedTrades.push({
        id: `trade-${index}`,
        date: tx.date,
        ticker: tx.ticker,
        assetName: tx.assetName,
        assetType: tx.assetType,
        portfolio: tx.portfolio,
        type: currentPos.quantity - tx.quantity < 0.001 ? 'Venta Total' : 'Venta Parcial',
        quantitySold: tx.quantity,
        sellPriceEur: tx.quantity > 0 ? (sellRevenueNetEur / tx.quantity) : 0, // Net effective price per share
        costBasisEur: avgCostPerShareEur,
        grossRevenueEur: sellRevenueNetEur,
        grossCostEur: costOfSoldEur,
        netPnLEur: pnlEur,
        returnPct: returnPct
      });

      // Update Inventory
      currentPos.quantity -= tx.quantity;
      currentPos.totalCostEur -= costOfSoldEur; // Reduce cost basis proportionally
      
      // Cleanup small decimals
      if (currentPos.quantity < 0.00001) {
         currentPos.quantity = 0;
         currentPos.totalCostEur = 0;
      }
      inventory.set(key, currentPos);
    }
  });

  // Return newest first
  return closedTrades.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
};

export const calculateAnalysisMetrics = (trades: ClosedTrade[]): AnalysisMetrics => {
   const totalTrades = trades.length;
   const winners = trades.filter(t => t.netPnLEur > 0);
   const losers = trades.filter(t => t.netPnLEur <= 0);

   const totalProfit = trades.reduce((sum, t) => sum + t.netPnLEur, 0);
   
   const grossProfit = winners.reduce((sum, t) => sum + t.netPnLEur, 0);
   const grossLoss = Math.abs(losers.reduce((sum, t) => sum + t.netPnLEur, 0));

   const profitFactor = grossLoss === 0 ? grossProfit : (grossProfit / grossLoss);

   return {
     totalTrades,
     winRate: totalTrades > 0 ? (winners.length / totalTrades) : 0,
     totalProfitEur: totalProfit,
     profitFactor,
     avgWinEur: winners.length > 0 ? (grossProfit / winners.length) : 0,
     avgLossEur: losers.length > 0 ? (grossLoss / losers.length) : 0, // Positive number representing loss magnitude
     
     // Fix: Ensure we have trades before reducing to avoid crash
     bestTrade: winners.length > 0 ? winners.reduce((prev, current) => (prev.netPnLEur > current.netPnLEur) ? prev : current) : null,
     worstTrade: losers.length > 0 ? losers.reduce((prev, current) => (prev.netPnLEur < current.netPnLEur) ? prev : current) : null
   };
};

// --- EXPORTERS ---

export const exportAnalysisToExcel = (trades: ClosedTrade[], metrics: AnalysisMetrics) => {
   const wb = utils.book_new();
   
   // Sheet 1: Summary
   const summaryData = [
     { Métrica: 'Total Operaciones', Valor: metrics.totalTrades },
     { Métrica: 'Beneficio Neto Total (€)', Valor: metrics.totalProfitEur },
     { Métrica: 'Tasa de Acierto %', Valor: (metrics.winRate * 100).toFixed(2) + '%' },
     { Métrica: 'Factor de Beneficio', Valor: metrics.profitFactor.toFixed(2) },
     { Métrica: 'Promedio Ganancia (€)', Valor: metrics.avgWinEur },
     { Métrica: 'Promedio Pérdida (€)', Valor: metrics.avgLossEur },
   ];
   const wsSummary = utils.json_to_sheet(summaryData);
   utils.book_append_sheet(wb, wsSummary, "Resumen");

   // Sheet 2: Detail
   const detailData = trades.map(t => ({
     Fecha: t.date,
     Cartera: t.portfolio,
     Ticker: t.ticker,
     Activo: t.assetName,
     'Tipo Venta': t.type,
     'Cantidad': t.quantitySold,
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
  
  doc.setFillColor(240, 245, 250); // Light blue bg
  doc.rect(14, startY, pageWidth - 28, boxHeight, 'F');
  
  doc.setFontSize(12);
  doc.setTextColor(0, 0, 0);
  
  // Row 1
  doc.text(`Total P&L: ${new Intl.NumberFormat('es-ES', {style: 'currency', currency: 'EUR'}).format(metrics.totalProfitEur)}`, 20, startY + 10);
  doc.text(`Tasa Acierto: ${(metrics.winRate * 100).toFixed(1)}%`, 80, startY + 10);
  doc.text(`Factor Beneficio: ${metrics.profitFactor.toFixed(2)}`, 140, startY + 10);
  
  // Row 2
  doc.setFontSize(10);
  doc.text(`Ops Totales: ${metrics.totalTrades}`, 20, startY + 20);
  doc.text(`Media Gan.: €${metrics.avgWinEur.toFixed(2)}`, 80, startY + 20);
  doc.text(`Media Pérd.: €${metrics.avgLossEur.toFixed(2)}`, 140, startY + 20);

  // Table
  const tableColumn = ["Fecha", "Cartera", "Ticker", "Venta", "Coste (€)", "P&L (€)", "%"];
  const tableRows = trades.map(t => [
    t.date,
    t.portfolio,
    t.ticker,
    t.type === 'Venta Total' ? 'Total' : 'Parcial',
    t.grossCostEur.toFixed(0),
    t.netPnLEur.toFixed(2),
    (t.returnPct * 100).toFixed(2) + '%'
  ]);

  autoTable(doc, {
    head: [tableColumn],
    body: tableRows,
    startY: startY + boxHeight + 10,
    styles: { fontSize: 8 },
    headStyles: { fillColor: [41, 128, 185] }, // Blue header
    columnStyles: {
        5: { fontStyle: 'bold' } // P&L column bold
    },
    didParseCell: function(data: any) {
        // Color P&L column
        if (data.section === 'body' && data.column.index === 5) {
            const val = parseFloat(data.cell.raw);
            if (val >= 0) data.cell.styles.textColor = [20, 160, 100]; // Green
            else data.cell.styles.textColor = [200, 60, 60]; // Red
        }
    }
  });

  doc.save(`Peakys_Informe_PDF_${new Date().toISOString().split('T')[0]}.pdf`);
};
