
import { read, utils, writeFile } from 'xlsx';
import { db } from '../db';
import { Transaction, TransactionType, Currency, DefaultAssetTypes, LiquidityEvent } from '../types';
import { getLiveFxRateToEur, refreshMarketData } from './marketDataService';
import { normalizeStoredFxRateToEur } from '../utils/fx';

// --- HELPER FUNCTIONS ---

// 1. Robust Date Parsing for MySQL (YYYY-MM-DD)
const parseExcelDate = (raw: any): string => {
  if (!raw) return new Date().toISOString().split('T')[0];

  try {
    let dateObj: Date | null = null;

    // Handle "Inicio" text
    if (typeof raw === 'string' && raw.toLowerCase().trim() === 'inicio') {
       return '2023-01-01';
    }

    // JS Date Object
    if (raw instanceof Date) {
      dateObj = raw;
    }
    // Excel Serial Number
    else if (typeof raw === 'number') {
      // Adjust for Excel leap year bug if needed, but usually this standard calc works for modern dates
      dateObj = new Date(Math.round((raw - 25569) * 86400 * 1000));
    }
    // String parsing
    else if (typeof raw === 'string') {
      const clean = raw.trim();
      
      // Try EU Format: DD/MM/YYYY
      const euMatch = clean.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})/);
      if (euMatch) {
        const day = parseInt(euMatch[1]);
        const month = parseInt(euMatch[2]) - 1; // JS months are 0-indexed
        const year = parseInt(euMatch[3]);
        dateObj = new Date(year, month, day);
      } 
      // Try ISO Format: YYYY-MM-DD
      else if (clean.match(/^\d{4}-\d{2}-\d{2}/)) {
         return clean.substring(0, 10);
      }
      else {
         dateObj = new Date(clean);
      }
    }

    if (dateObj && !isNaN(dateObj.getTime())) {
        // Ensure we get YYYY-MM-DD without timezone shifts causing day jumps
        const year = dateObj.getFullYear();
        const month = String(dateObj.getMonth() + 1).padStart(2, '0');
        const day = String(dateObj.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
    }
  } catch (e) {
    console.warn("Date parsing error", e);
  }

  return new Date().toISOString().split('T')[0];
};

// 2. Robust Number Parsing (Handles EU/US and currency text)
const cleanNumber = (val: any): number => {
  if (typeof val === 'number') return val;
  if (!val) return 0;

  let str = val.toString().trim();

  // Remove currency codes and generic text, keep digits, dots, commas, minus
  str = str.replace(/[^0-9.,-]/g, '');
  
  if (!str) return 0;

  const isNegative = str.startsWith('-');
  if (isNegative) str = str.substring(1);

  // European vs US Logic
  if (str.includes(',') && str.includes('.')) {
     // Both present
     if (str.indexOf('.') < str.indexOf(',')) {
        // 1.200,50 (EU)
        str = str.replace(/\./g, '').replace(',', '.');
     } else {
        // 1,200.50 (US)
        str = str.replace(/,/g, '');
     }
  } else if (str.includes(',')) {
     // Only comma -> Decimal (Standard for ES app)
     str = str.replace(',', '.');
  } else if (str.includes('.')) {
     // Only dot -> Ambiguous
     const parts = str.split('.');
     // If looks like 1.000 or 1.000.000 (Thousand)
     if (parts.length > 2 || (parts.length === 2 && parts[1].length === 3)) {
        str = str.replace(/\./g, '');
     }
     // else 10.5 -> keep dot
  }

  let result = parseFloat(str);
  if (isNegative) result = result * -1;

  return isNaN(result) ? 0 : result;
};

const getCell = (row: any[], colMap: Record<string, number>, aliases: string[]) => {
   for (const alias of aliases) {
      const key = alias.toLowerCase();
      if (colMap[key] !== undefined) return row[colMap[key]];
   }
   return undefined;
};

// --- MAIN FUNCTIONS ---

export const importTransactionsFromExcel = async (file: File): Promise<{ success: boolean; count: number; error?: string }> => {
  return new Promise((resolve) => {
    const reader = new FileReader();

    reader.onload = async (e) => {
      try {
        const data = e.target?.result;
        const workbook = read(data, { type: 'binary', cellDates: true });
        await refreshMarketData();

        let totalTransactions = 0;
        let totalLiquidity = 0;

        // Using bulk operations is critical for performance with API
        const transactionsToAdd: Transaction[] = [];
        const liquidityToAdd: LiquidityEvent[] = [];
        const newPortfolios = new Set<string>();

        // --- 1. READ TRANSACTIONS ---
        const txSheetName = workbook.SheetNames.find(n => 
            n.toLowerCase().includes('transac') || 
            n.toLowerCase().includes('historial') ||
            n.toLowerCase().includes('operaciones')
        ) || workbook.SheetNames[0];

        const txSheet = workbook.Sheets[txSheetName];
        const txRows = utils.sheet_to_json(txSheet, { header: 1, range: 0, defval: '' }) as any[][];

        if (txRows && txRows.length > 0) {
            let headerIndex = -1;
            const keywords = ['ticker', 'simbolo', 'symbol', 'activo', 'code', 'isin', 'producto'];
            
            for (let i = 0; i < Math.min(txRows.length, 20); i++) {
                const rowStr = JSON.stringify(txRows[i]).toLowerCase();
                if (keywords.some(k => rowStr.includes(k))) {
                    headerIndex = i;
                    break;
                }
            }
            if (headerIndex === -1) headerIndex = 0;

            const headerRow = txRows[headerIndex].map((cell: any) => (cell?.toString() || '').toLowerCase().trim());
            const colMap: Record<string, number> = {};
            headerRow.forEach((val, idx) => { if(val) colMap[val] = idx; });

            for (let i = headerIndex + 1; i < txRows.length; i++) {
                const row = txRows[i];
                if (!row || row.length === 0) continue;

                const tickerRaw = getCell(row, colMap, ['Ticker', 'Simbolo', 'Symbol', 'Activo', 'Code', 'ISIN', 'Producto']);
                if (!tickerRaw) continue; 

                const ticker = tickerRaw.toString().toUpperCase().trim();
                const rawQty = cleanNumber(getCell(row, colMap, ['Cantidad', 'Quantity', 'Units', 'Unidades', 'Shares']));
                const rawPrice = cleanNumber(getCell(row, colMap, ['Precio', 'Price', 'Coste', 'Cost', 'Amount']));
                const commRaw = cleanNumber(getCell(row, colMap, ['Comision', 'Comisión', 'Commission', 'Fees', 'Gastos']));
                const fxRaw = cleanNumber(getCell(row, colMap, ['Tipo Cambio', 'FX', 'FX Rate', 'Cambio']));
                const excludeRaw = (getCell(row, colMap, ['Ignorar Métricas', 'Exclude Metrics', 'Excluir']) || '').toString().toLowerCase().trim();
                
                const typeRaw = getCell(row, colMap, ['Tipo', 'Type', 'Operacion', 'B/S']);
                const typeStr = (typeRaw || '').toString().toLowerCase();
                
                let type = TransactionType.Buy;
                if (typeStr.includes('venta') || typeStr.includes('sell') || typeStr === 's' || typeStr === 'v') {
                    type = TransactionType.Sell;
                } else if (typeStr.includes('compra') || typeStr.includes('buy') || typeStr === 'b' || typeStr === 'c') {
                    type = TransactionType.Buy;
                } else {
                    if (rawQty < 0) type = TransactionType.Sell;
                }

                const portfolio = (getCell(row, colMap, ['Cartera', 'Portfolio', 'Cuenta', 'Account']) || 'Alejandro').toString().trim();
                const assetName = getCell(row, colMap, ['Nombre', 'Nombre Activo', 'Name', 'Description', 'Empresa'])?.toString().trim() || ticker;
                
                const assetTypeRaw = getCell(row, colMap, ['Tipo Activo', 'Asset Type', 'Categoria', 'Clase']);
                let assetType = DefaultAssetTypes.ActionLong;
                if (assetTypeRaw) {
                    const atStr = assetTypeRaw.toString().toLowerCase();
                    if (atStr.includes('etf')) assetType = DefaultAssetTypes.ETFLong;
                    else if (atStr.includes('swing')) assetType = DefaultAssetTypes.ActionSwing;
                    else if (atStr.includes('penny')) assetType = DefaultAssetTypes.ActionPenny;
                    else if (atStr.includes('cripto') || atStr.includes('crypto')) assetType = DefaultAssetTypes.Crypto;
                    else if (atStr.includes('fija') || atStr.includes('bono')) assetType = DefaultAssetTypes.FixedIncome;
                    else if (atStr.includes('materia') || atStr.includes('gold')) assetType = DefaultAssetTypes.Commodity;
                }

                const quantity = Math.abs(rawQty);
                const price = Math.abs(rawPrice);
                const currencyPlatform = (getCell(row, colMap, ['Divisa', 'Currency', 'Moneda']) || 'EUR').toString().toUpperCase().trim() as Currency;
                const liveFxRate = getLiveFxRateToEur(currencyPlatform);
                const fxRateToEur = currencyPlatform === Currency.EUR
                  ? 0
                  : fxRaw > 0
                    ? normalizeStoredFxRateToEur(currencyPlatform, fxRaw)
                    : liveFxRate ?? normalizeStoredFxRateToEur(currencyPlatform, fxRaw);
                
                if (quantity > 0) {
                    newPortfolios.add(portfolio);
                    transactionsToAdd.push({
                        date: parseExcelDate(getCell(row, colMap, ['Fecha', 'Date', 'Time', 'Day'])),
                        portfolio,
                        type,
                        ticker,
                        assetName,
                        assetType,
                        quantity,
                        price,
                        commission: Math.abs(commRaw),
                        currencyPlatform,
                        fxRateToEur,
                        excludeFromMetrics: ['1', 'si', 'sí', 'true', 'x', 'yes', 'y'].includes(excludeRaw),
                        notes: getCell(row, colMap, ['Notas', 'Notes', 'Comentarios'])?.toString() || ''
                    });
                }
            }
        }

        // --- 2. READ LIQUIDITY ---
        const liqSheetName = workbook.SheetNames.find(n => 
            n.toLowerCase().includes('aportacion') || 
            n.toLowerCase().includes('liquidez') ||
            n.toLowerCase().includes('ingreso')
        );

        if (liqSheetName) {
            const liqSheet = workbook.Sheets[liqSheetName];
            const liqRows = utils.sheet_to_json(liqSheet, { header: 1, range: 0, defval: '' }) as any[][];
            
            if (liqRows && liqRows.length > 0) {
                let liqHeaderIndex = -1;
                const liqKeywords = ['aportacion', 'importe', 'amount', 'ingreso'];
                
                for (let i = 0; i < Math.min(liqRows.length, 20); i++) {
                    const rowStr = JSON.stringify(liqRows[i]).toLowerCase();
                    if (liqKeywords.some(k => rowStr.includes(k))) {
                        liqHeaderIndex = i;
                        break;
                    }
                }
                if (liqHeaderIndex === -1) liqHeaderIndex = 0;

                const liqHeaderRow = liqRows[liqHeaderIndex].map((cell: any) => (cell?.toString() || '').toLowerCase().trim());
                const liqColMap: Record<string, number> = {};
                liqHeaderRow.forEach((val, idx) => { if(val) liqColMap[val] = idx; });
                
                for (let i = liqHeaderIndex + 1; i < liqRows.length; i++) {
                    const row = liqRows[i];
                    if (!row || row.length === 0) continue;

                    const amountRaw = cleanNumber(getCell(row, liqColMap, ['Aportación', 'Importe', 'Amount', 'Ingreso']));
                    if (amountRaw === 0) continue;

                    const portfolio = (getCell(row, liqColMap, ['Cartera', 'Portfolio', 'Cuenta']) || 'Alejandro').toString().trim();
                    const rawDate = getCell(row, liqColMap, ['Fecha', 'Date']);
                    const type = (getCell(row, liqColMap, ['Tipo', 'Type', 'Concepto']) || 'Ingreso').toString().trim();
                    
                    liquidityToAdd.push({
                        date: parseExcelDate(rawDate),
                        portfolio,
                        amountEur: amountRaw,
                        type,
                        notes: getCell(row, liqColMap, ['Notas', 'Notes'])?.toString() || ''
                    });
                }
            }
        }

        // --- EXECUTE DB OPERATIONS ---
        try {
             if (transactionsToAdd.length > 0) {
                 console.log("Bulk Adding Transactions:", transactionsToAdd.length);
                 await db.transactions.bulkAdd(transactionsToAdd);
                 
                 // Ensure Portfolios
                 const existingPortfolios = await db.portfolios.toArray();
                 const portsToAdd = Array.from(newPortfolios)
                    .filter(p => !existingPortfolios.some(ep => ep.name === p))
                    .map(name => ({ name }));
                 
                 if (portsToAdd.length > 0) {
                     await db.portfolios.bulkAdd(portsToAdd);
                 }
             }

             if (liquidityToAdd.length > 0) {
                 console.log("Bulk Adding Liquidity:", liquidityToAdd.length);
                 await db.liquidity.bulkAdd(liquidityToAdd);
             }

             resolve({ 
                success: true, 
                count: transactionsToAdd.length, 
                error: liquidityToAdd.length > 0 ? ` (+ ${liquidityToAdd.length} Aportaciones)` : undefined 
            });

        } catch (err: any) {
             console.error("Bulk Write Error:", err);
             resolve({ success: false, count: 0, error: "Error guardando en Base de Datos (Revisa logs)" });
        }

      } catch (err: any) {
        console.error("Excel Read Error:", err);
        resolve({ success: false, count: 0, error: 'Error crítico: ' + err.message });
      }
    };

    reader.onerror = () => resolve({ success: false, count: 0, error: 'Error de lectura de archivo.' });
    reader.readAsBinaryString(file);
  });
};

export const exportTransactionsToExcel = async (): Promise<void> => {
  try {
    const transactions = await db.transactions.toArray();
    const liquidity = await db.liquidity.toArray();
    
    if (transactions.length === 0 && liquidity.length === 0) {
      alert('No hay datos para exportar.');
      return;
    }

    const wb = utils.book_new();

    // Sheet 1: Transactions
    if (transactions.length > 0) {
        const txData = transactions.map(t => ({
        'Fecha': t.date,
        'Cartera': t.portfolio,
        'Tipo': t.type,
        'Ticker': t.ticker,
        'Nombre Activo': t.assetName,
        'Tipo Activo': t.assetType,
        'Cantidad': t.quantity,
        'Precio': t.price,
        'Comisión': t.commission,
        'Divisa': t.currencyPlatform,
        'Tipo Cambio': t.fxRateToEur,
        'Ignorar Métricas': t.excludeFromMetrics ? 'Sí' : '',
        'Notas': t.notes || ''
        }));
        const wsTx = utils.json_to_sheet(txData);
        utils.book_append_sheet(wb, wsTx, "Transacciones");
    }

    // Sheet 2: Liquidity
    if (liquidity.length > 0) {
        const liqData = liquidity.map(l => ({
            'Fecha': l.date,
            'Cartera': l.portfolio,
            'Aportación (EUR)': l.amountEur,
            'Tipo': l.type,
            'Notas': l.notes || ''
        }));
        const wsLiq = utils.json_to_sheet(liqData);
        utils.book_append_sheet(wb, wsLiq, "Aportaciones");
    }

    writeFile(wb, "Historial_Peakys.xlsx");
  } catch (error) {
    console.error('Export error:', error);
    alert('Error al exportar.');
  }
};
