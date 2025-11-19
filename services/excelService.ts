import { read, utils, writeFile } from 'xlsx';
import { db } from '../db';
import { Transaction, TransactionType, Currency, DefaultAssetTypes, LiquidityEvent } from '../types';

// --- HELPER FUNCTIONS ---

// 1. Robust Date Parsing
const parseExcelDate = (raw: any): string => {
  if (!raw) return new Date().toISOString().split('T')[0];

  const strVal = raw.toString().toLowerCase().trim();
  if (strVal === 'inicio') {
      // Return a distinct 'start' date or just keep it as string if logic allows. 
      // To keep sorting working, let's pick a convention or simply today's date minus a few years 
      // OR we assume the user handles sorting. 
      // Best approach: Use a fixed early date for sorting, but maybe store the label? 
      // Since our DB type is string, we'll stick to ISO dates for consistency in charts, 
      // but we can default to a "start of year" if needed.
      return '2023-01-01'; // Default fallback for "Inicio" text to ensure it sorts at start
  }

  // JS Date Object
  if (raw instanceof Date) {
    const offset = raw.getTimezoneOffset() * 60000;
    return new Date(raw.getTime() - offset).toISOString().split('T')[0];
  }

  // Excel Serial Number
  if (typeof raw === 'number') {
    return new Date(Math.round((raw - 25569) * 86400 * 1000)).toISOString().split('T')[0];
  }

  // String parsing
  if (typeof raw === 'string') {
    const clean = raw.trim();
    // EU Format: DD/MM/YYYY
    const euMatch = clean.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})/);
    if (euMatch) {
      const day = euMatch[1].padStart(2, '0');
      const month = euMatch[2].padStart(2, '0');
      const year = euMatch[3];
      return `${year}-${month}-${day}`;
    }
    // ISO Format
    const isoMatch = clean.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
    if (isoMatch) return clean.replace(/\//g, '-');
  }

  const d = new Date(raw);
  if (!isNaN(d.getTime())) return d.toISOString().split('T')[0];

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

        let totalTransactions = 0;
        let totalLiquidity = 0;

        await (db as any).transaction('rw', db.transactions, db.liquidity, db.portfolios, db.assetTypes, async () => {
            
            // --- 1. IMPORT TRANSACTIONS ---
            const txSheetName = workbook.SheetNames.find(n => 
                n.toLowerCase().includes('transac') || 
                n.toLowerCase().includes('historial') ||
                n.toLowerCase().includes('operaciones')
            ) || workbook.SheetNames[0];

            const txSheet = workbook.Sheets[txSheetName];
            const txRows = utils.sheet_to_json(txSheet, { header: 1, range: 0, defval: '' }) as any[][];

            if (txRows && txRows.length > 0) {
                let headerIndex = -1;
                const keywords = ['ticker', 'simbolo', 'symbol', 'activo', 'code', 'isin', 'producto', 'instrumento', 'security', 'name', 'nombre'];
                
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

                const transactionsToAdd: Transaction[] = [];

                for (let i = headerIndex + 1; i < txRows.length; i++) {
                    const row = txRows[i];
                    if (!row || row.length === 0) continue;

                    const tickerRaw = getCell(row, colMap, ['Ticker', 'Simbolo', 'Symbol', 'Activo', 'Code', 'ISIN', 'Producto', 'Instrumento', 'Security']);
                    if (!tickerRaw) continue; 

                    const ticker = tickerRaw.toString().toUpperCase().trim();
                    const rawQty = cleanNumber(getCell(row, colMap, ['Cantidad', 'Quantity', 'Units', 'Unidades', 'Shares', 'Títulos', 'Titulos', 'Volumen']));
                    const rawPrice = cleanNumber(getCell(row, colMap, ['Precio', 'Price', 'Coste', 'Cost', 'Amount', 'Valor']));
                    const commRaw = cleanNumber(getCell(row, colMap, ['Comision', 'Comisiones', 'Commission', 'Fees', 'Fee', 'Gastos']));
                    const fxRaw = cleanNumber(getCell(row, colMap, ['Tipo Cambio', 'FX', 'FX Rate', 'Exchange Rate', 'Cambio']));
                    
                    const typeRaw = getCell(row, colMap, ['Tipo', 'Type', 'Operacion', 'Direction', 'B/S', 'Side']);
                    const typeStr = (typeRaw || '').toString().toLowerCase();
                    
                    let type = TransactionType.Buy;
                    if (typeStr.includes('venta') || typeStr.includes('sell') || typeStr === 's' || typeStr === 'v') {
                        type = TransactionType.Sell;
                    } else if (typeStr.includes('compra') || typeStr.includes('buy') || typeStr === 'b' || typeStr === 'c') {
                        type = TransactionType.Buy;
                    } else {
                        if (rawQty < 0) type = TransactionType.Sell;
                    }

                    const portfolio = (getCell(row, colMap, ['Cartera', 'Portfolio', 'Cuenta', 'Account', 'Nombre Cartera']) || 'Alejandro').toString().trim();
                    const assetName = getCell(row, colMap, ['Nombre', 'Nombre Activo', 'Name', 'Description', 'Security Name', 'Empresa'])?.toString().trim() || ticker;
                    
                    const assetTypeRaw = getCell(row, colMap, ['Tipo Activo', 'Asset Type', 'Categoria', 'Category', 'Clase']);
                    let assetType = DefaultAssetTypes.ActionLong;
                    if (assetTypeRaw) {
                        const atStr = assetTypeRaw.toString().toLowerCase();
                        if (atStr.includes('etf')) assetType = DefaultAssetTypes.ETFLong;
                        else if (atStr.includes('swing')) assetType = DefaultAssetTypes.ActionSwing;
                        else if (atStr.includes('penny')) assetType = DefaultAssetTypes.ActionPenny;
                        else if (atStr.includes('cripto') || atStr.includes('crypto') || atStr.includes('btc') || atStr.includes('eth')) assetType = DefaultAssetTypes.Crypto;
                        else if (atStr.includes('fija') || atStr.includes('bono') || atStr.includes('letra')) assetType = DefaultAssetTypes.FixedIncome;
                        else if (atStr.includes('materia') || atStr.includes('gold') || atStr.includes('oro')) assetType = DefaultAssetTypes.Commodity;
                    }

                    const quantity = Math.abs(rawQty);
                    const price = Math.abs(rawPrice);
                    
                    if (quantity > 0) {
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
                            currencyPlatform: (getCell(row, colMap, ['Divisa', 'Currency', 'Moneda', 'Curr']) || 'EUR').toString().toUpperCase().trim() as Currency,
                            fxRateToEur: fxRaw > 0 ? fxRaw : 1,
                            notes: getCell(row, colMap, ['Notas', 'Notes', 'Comentarios'])?.toString() || ''
                        });
                    }
                }
                if (transactionsToAdd.length > 0) {
                    await db.transactions.bulkAdd(transactionsToAdd);
                    totalTransactions = transactionsToAdd.length;
                    
                    // Ensure Portfolios exist
                    const distinctPortfolios = Array.from(new Set(transactionsToAdd.map(t => t.portfolio)));
                    const existingPortfolios = await db.portfolios.toArray();
                    const newPortfolios = distinctPortfolios
                        .filter(p => !existingPortfolios.some(ep => ep.name === p))
                        .map(name => ({ name }));
                    if (newPortfolios.length > 0) await db.portfolios.bulkAdd(newPortfolios);
                }
            }

            // --- 2. IMPORT LIQUIDITY (APORTACIONES) ---
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
                    const liqKeywords = ['aportacion', 'importe', 'amount', 'ingreso', 'dinero'];
                    
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
                    
                    const liquidityToAdd: LiquidityEvent[] = [];

                    for (let i = liqHeaderIndex + 1; i < liqRows.length; i++) {
                        const row = liqRows[i];
                        if (!row || row.length === 0) continue;

                        const amountRaw = cleanNumber(getCell(row, liqColMap, ['Aportación', 'Aportacion', 'Aportacion (EUR)', 'Importe', 'Amount', 'Ingreso']));
                        if (amountRaw === 0) continue;

                        const portfolio = (getCell(row, liqColMap, ['Cartera', 'Portfolio', 'Cuenta']) || 'Alejandro').toString().trim();
                        const rawDate = getCell(row, liqColMap, ['Fecha', 'Date', 'Dia']);
                        const type = (getCell(row, liqColMap, ['Tipo', 'Type', 'Concepto', 'Descripcion']) || 'Ingreso').toString().trim();
                        
                        // Handle "Inicio" date text specifically for display context if needed, 
                        // parseExcelDate will handle the sorting value
                        const date = parseExcelDate(rawDate);
                        const notes = getCell(row, liqColMap, ['Notas', 'Notes'])?.toString() || '';

                        // If the raw date was literally "Inicio", append it to notes to preserve context
                        const finalNotes = rawDate && rawDate.toString().toLowerCase().includes('inicio') 
                            ? `${notes} (Aportación Inicial)`.trim() 
                            : notes;

                        liquidityToAdd.push({
                            date,
                            portfolio,
                            amountEur: amountRaw,
                            type,
                            notes: finalNotes
                        });
                    }

                    if (liquidityToAdd.length > 0) {
                         await db.liquidity.bulkAdd(liquidityToAdd);
                         totalLiquidity = liquidityToAdd.length;
                    }
                }
            }

        }); // End Transaction

        resolve({ 
            success: true, 
            count: totalTransactions, 
            error: totalLiquidity > 0 ? ` (+ ${totalLiquidity} Aportaciones)` : undefined 
        });

      } catch (err: any) {
        console.error("Excel Import Error:", err);
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