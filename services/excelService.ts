import { read, utils, writeFile } from 'xlsx';
import { db } from '../db';
import { Transaction, TransactionType, Currency, DefaultAssetTypes } from '../types';

// --- HELPER FUNCTIONS ---

// 1. Robust Date Parsing
const parseExcelDate = (raw: any): string => {
  if (!raw) return new Date().toISOString().split('T')[0];

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

// --- MAIN FUNCTIONS ---

export const importTransactionsFromExcel = async (file: File): Promise<{ success: boolean; count: number; error?: string }> => {
  return new Promise((resolve) => {
    const reader = new FileReader();

    reader.onload = async (e) => {
      try {
        const data = e.target?.result;
        const workbook = read(data, { type: 'binary', cellDates: true });

        // Try to find relevant sheet or default to first
        const sheetName = workbook.SheetNames.find(n => 
          n.toLowerCase().includes('transac') || 
          n.toLowerCase().includes('historial') ||
          n.toLowerCase().includes('cartera')
        ) || workbook.SheetNames[0];
        
        const sheet = workbook.Sheets[sheetName];
        const rows = utils.sheet_to_json(sheet, { header: 1, range: 0, defval: '' }) as any[][];

        if (!rows || rows.length === 0) {
          resolve({ success: false, count: 0, error: 'La hoja está vacía.' });
          return;
        }

        // 1. Improved Header Detection
        let headerIndex = -1;
        // Keywords expanded to catch more variations
        const keywords = ['ticker', 'simbolo', 'symbol', 'activo', 'code', 'isin', 'producto', 'instrumento', 'security', 'name', 'nombre'];
        
        for (let i = 0; i < Math.min(rows.length, 20); i++) {
          const rowStr = JSON.stringify(rows[i]).toLowerCase();
          if (keywords.some(k => rowStr.includes(k))) {
             headerIndex = i;
             break;
          }
        }

        // Fallback: if no header found but data exists, maybe row 0 is header?
        if (headerIndex === -1) headerIndex = 0;

        // 2. Map Columns
        const headerRow = rows[headerIndex].map((cell: any) => (cell?.toString() || '').toLowerCase().trim());
        const colMap: Record<string, number> = {};
        headerRow.forEach((val, idx) => { if(val) colMap[val] = idx; });

        const getCell = (row: any[], aliases: string[]) => {
           for (const alias of aliases) {
              const key = alias.toLowerCase();
              if (colMap[key] !== undefined) return row[colMap[key]];
           }
           return undefined;
        };

        const transactionsToAdd: Transaction[] = [];
        
        // 3. Process Rows
        for (let i = headerIndex + 1; i < rows.length; i++) {
          const row = rows[i];
          if (!row || row.length === 0) continue;

          // Ticker / Asset Identifiers
          const tickerRaw = getCell(row, ['Ticker', 'Simbolo', 'Symbol', 'Activo', 'Code', 'ISIN', 'Producto', 'Instrumento', 'Security']);
          
          // Skip if no identifier found
          if (!tickerRaw) continue; 

          const ticker = tickerRaw.toString().toUpperCase().trim();
          // If ticker is suspiciously long (description) and no Asset Name provided, we might swap later, but for now Ticker is key.

          // Parse Numbers with Sign
          const rawQty = cleanNumber(getCell(row, ['Cantidad', 'Quantity', 'Units', 'Unidades', 'Shares', 'Títulos', 'Titulos', 'Volumen']));
          const rawPrice = cleanNumber(getCell(row, ['Precio', 'Price', 'Coste', 'Cost', 'Amount', 'Valor']));
          const commRaw = cleanNumber(getCell(row, ['Comision', 'Commission', 'Fees', 'Fee', 'Gastos']));
          const fxRaw = cleanNumber(getCell(row, ['Tipo Cambio', 'FX', 'FX Rate', 'Exchange Rate', 'Cambio']));
          
          // Determine Type
          const typeRaw = getCell(row, ['Tipo', 'Type', 'Operacion', 'Direction', 'B/S', 'Side']);
          const typeStr = (typeRaw || '').toString().toLowerCase();
          
          let type = TransactionType.Buy; // Default
          
          // Explicit Type Column
          if (typeStr.includes('venta') || typeStr.includes('sell') || typeStr === 's' || typeStr === 'v') {
              type = TransactionType.Sell;
          } else if (typeStr.includes('compra') || typeStr.includes('buy') || typeStr === 'b' || typeStr === 'c') {
              type = TransactionType.Buy;
          } else {
              // Infer from Quantity Sign if Type column is missing or ambiguous
              if (rawQty < 0) type = TransactionType.Sell;
          }

          // Other Fields
          const portfolio = (getCell(row, ['Cartera', 'Portfolio', 'Cuenta', 'Account', 'Nombre Cartera']) || 'Alejandro').toString().trim();
          const assetName = getCell(row, ['Nombre', 'Nombre Activo', 'Name', 'Description', 'Security Name', 'Empresa'])?.toString().trim() || ticker;
          
          // Asset Type Parsing
          const assetTypeRaw = getCell(row, ['Tipo Activo', 'Asset Type', 'Categoria', 'Category', 'Clase']);
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

          // Store absolute values
          const quantity = Math.abs(rawQty);
          const price = Math.abs(rawPrice);
          
          // Only add if valid quantity (Price can be 0 for free shares)
          if (quantity > 0) {
             transactionsToAdd.push({
                date: parseExcelDate(getCell(row, ['Fecha', 'Date', 'Time', 'Day'])),
                portfolio,
                type,
                ticker,
                assetName,
                assetType,
                quantity,
                price,
                commission: Math.abs(commRaw),
                currencyPlatform: (getCell(row, ['Divisa', 'Currency', 'Moneda', 'Curr']) || 'EUR').toString().toUpperCase().trim() as Currency,
                fxRateToEur: fxRaw > 0 ? fxRaw : 1,
                notes: getCell(row, ['Notas', 'Notes', 'Comentarios'])?.toString() || ''
             });
          }
        }

        console.log(`Imported ${transactionsToAdd.length} transactions`);

        if (transactionsToAdd.length > 0) {
          await (db as any).transaction('rw', db.transactions, db.portfolios, db.assetTypes, async () => {
             await db.transactions.bulkAdd(transactionsToAdd);
             
             // Create missing portfolios dynamically
             const distinctPortfolios = Array.from(new Set(transactionsToAdd.map(t => t.portfolio)));
             const existingPortfolios = await db.portfolios.toArray();
             const newPortfolios = distinctPortfolios
                .filter(p => !existingPortfolios.some(ep => ep.name === p))
                .map(name => ({ name }));
             
             if (newPortfolios.length > 0) await db.portfolios.bulkAdd(newPortfolios);
          });
          
          resolve({ success: true, count: transactionsToAdd.length });
        } else {
          resolve({ success: false, count: 0, error: 'No se encontraron filas válidas. Verifica los nombres de columnas (Ticker, Cantidad, Precio).' });
        }

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
    
    if (transactions.length === 0) {
      alert('No hay transacciones para exportar.');
      return;
    }

    const data = transactions.map(t => ({
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

    const ws = utils.json_to_sheet(data);
    const wb = utils.book_new();
    utils.book_append_sheet(wb, ws, "Historial");

    writeFile(wb, "Historial_Peakys.xlsx");
  } catch (error) {
    console.error('Export error:', error);
    alert('Error al exportar.');
  }
};
