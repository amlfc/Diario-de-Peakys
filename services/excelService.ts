import { read, utils, writeFile } from 'xlsx';
import { db } from '../db';
import { Transaction, TransactionType, Currency, DefaultAssetTypes } from '../types';

// --- HELPER FUNCTIONS ---

// 1. Robust Date Parsing
const parseExcelDate = (raw: any): string => {
  if (!raw) return new Date().toISOString().split('T')[0];

  // JS Date Object
  if (raw instanceof Date) {
    // Adjust for timezone offset issues commonly found in Excel parsing
    const offset = raw.getTimezoneOffset() * 60000;
    return new Date(raw.getTime() - offset).toISOString().split('T')[0];
  }

  // Excel Serial Number (e.g., 45321)
  if (typeof raw === 'number') {
    // Excel base date adjustment
    return new Date(Math.round((raw - 25569) * 86400 * 1000)).toISOString().split('T')[0];
  }

  // String parsing
  if (typeof raw === 'string') {
    const clean = raw.trim();
    
    // EU Format: DD/MM/YYYY or DD-MM-YYYY
    const euMatch = clean.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})/);
    if (euMatch) {
      const day = euMatch[1].padStart(2, '0');
      const month = euMatch[2].padStart(2, '0');
      const year = euMatch[3];
      return `${year}-${month}-${day}`;
    }

    // ISO Format: YYYY-MM-DD
    const isoMatch = clean.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
    if (isoMatch) {
      return clean.replace(/\//g, '-');
    }
  }

  // Fallback
  const d = new Date(raw);
  if (!isNaN(d.getTime())) return d.toISOString().split('T')[0];

  return new Date().toISOString().split('T')[0];
};

// 2. Flexible Column Finder
// Looks for a value in a row object checking multiple potential header names (case insensitive)
const getValue = (row: any, aliases: string[]): any => {
  const rowKeys = Object.keys(row);
  const normalizedKeys = rowKeys.reduce((acc, k) => {
    acc[k.toLowerCase().trim()] = k; // Map normalized key to original key
    return acc;
  }, {} as Record<string, string>);

  for (const alias of aliases) {
    const key = alias.toLowerCase().trim();
    if (normalizedKeys[key]) {
      const val = row[normalizedKeys[key]];
      if (val !== undefined && val !== null && val !== '') return val;
    }
  }
  return undefined;
};

// 3. Robust Number Parsing (Handles 1.000,00 vs 1,000.00)
const cleanNumber = (val: any): number => {
  if (typeof val === 'number') return val;
  if (!val) return 0;

  let str = val.toString().trim();
  // Remove currency symbols and spaces
  str = str.replace(/[€$£¥\s]/g, '');

  // Logic to detect format
  if (str.includes(',') && str.includes('.')) {
    // Mixed separators. The last one is usually the decimal.
    const lastComma = str.lastIndexOf(',');
    const lastDot = str.lastIndexOf('.');
    
    if (lastComma > lastDot) {
      // 1.234,56 (EU) -> Remove dots, replace comma with dot
      str = str.replace(/\./g, '').replace(',', '.');
    } else {
      // 1,234.56 (US) -> Remove commas
      str = str.replace(/,/g, '');
    }
  } else if (str.includes(',')) {
    // Only commas. Ambiguous: 1,234 (US 1234) or 12,34 (EU 12.34)
    // Heuristic: Check matching regex for thousands
    // But simplified: In finance exports here, comma usually means decimal if single.
    // Let's assume standard EU input if Spanish app context, but try to be safe.
    // We simply replace , with . to make it JS float.
    str = str.replace(',', '.');
  }
  // If only dots (1.234), usually thousands in EU, but JS parse float handles 1.234 as 1.234. 
  // If it looks like 1.000 (integer-ish), it might be 1000. 
  // NOTE: This is the trickiest part. We'll assume standard JS float format if only dots, 
  // UNLESS it has multiple dots (1.234.567).
  
  return parseFloat(str) || 0;
};


// --- MAIN FUNCTIONS ---

export const importTransactionsFromExcel = async (file: File): Promise<{ success: boolean; count: number; error?: string }> => {
  return new Promise((resolve) => {
    const reader = new FileReader();

    reader.onload = async (e) => {
      try {
        const data = e.target?.result;
        const workbook = read(data, { type: 'binary', cellDates: true });

        // Try to find relevant sheet
        const sheetName = workbook.SheetNames.find(n => n.toLowerCase().includes('transac') || n.toLowerCase().includes('historial')) || workbook.SheetNames[0];
        const sheet = workbook.Sheets[sheetName];

        // Convert to JSON with raw values to handle parsing ourselves
        const rawRows: any[] = utils.sheet_to_json(sheet);

        console.log("Excel Import Debug - Raw Rows found:", rawRows.length);
        if (rawRows.length > 0) {
           console.log("Excel Import Debug - First Row Keys:", Object.keys(rawRows[0]));
        }

        if (rawRows.length === 0) {
          resolve({ success: false, count: 0, error: 'La hoja está vacía.' });
          return;
        }

        const transactionsToAdd: Transaction[] = [];
        
        // Process Rows
        for (const row of rawRows) {
          // Find Ticker (Mandatory)
          const tickerRaw = getValue(row, ['Ticker', 'Simbolo', 'Symbol', 'Activo', 'Code']);
          if (!tickerRaw) continue; // Skip empty rows

          const ticker = tickerRaw.toString().toUpperCase().trim();

          // Determine Type
          const typeRaw = getValue(row, ['Tipo', 'Type', 'Operacion', 'Direction', 'B/S']);
          const typeStr = (typeRaw || '').toString().toLowerCase();
          const type = (typeStr.includes('venta') || typeStr.includes('sell') || typeStr === 's') 
            ? TransactionType.Sell 
            : TransactionType.Buy;

          // Portfolio
          const portfolioRaw = getValue(row, ['Cartera', 'Portfolio', 'Cuenta', 'Account', 'Nombre Cartera']);
          const portfolio = (portfolioRaw || 'Alejandro').toString().trim();

          // Asset Name
          const nameRaw = getValue(row, ['Nombre', 'Nombre Activo', 'Name', 'Description', 'Security Name']);
          const assetName = nameRaw ? nameRaw.toString().trim() : ticker;

          // Asset Type
          const assetTypeRaw = getValue(row, ['Tipo Activo', 'Asset Type', 'Categoria', 'Category', 'Class']);
          let assetType = DefaultAssetTypes.ActionLong;
          if (assetTypeRaw) {
            const atStr = assetTypeRaw.toString().toLowerCase();
             if (atStr.includes('etf')) assetType = DefaultAssetTypes.ETFLong;
             else if (atStr.includes('swing')) assetType = DefaultAssetTypes.ActionSwing;
             else if (atStr.includes('penny')) assetType = DefaultAssetTypes.ActionPenny;
             else if (atStr.includes('cripto') || atStr.includes('crypto')) assetType = DefaultAssetTypes.Crypto;
             else if (atStr.includes('fija') || atStr.includes('renta')) assetType = DefaultAssetTypes.FixedIncome;
             else if (atStr.includes('materia') || atStr.includes('commodity')) assetType = DefaultAssetTypes.Commodity;
          }

          // Values
          const qtyRaw = getValue(row, ['Cantidad', 'Quantity', 'Units', 'Unidades', 'Shares', 'Títulos', 'Titulos']);
          const priceRaw = getValue(row, ['Precio', 'Price', 'Coste', 'Cost', 'Amount']);
          const commRaw = getValue(row, ['Comision', 'Commission', 'Fees', 'Fee']);
          const fxRaw = getValue(row, ['Tipo Cambio', 'FX', 'FX Rate', 'Exchange Rate', 'Cambio']);
          const currRaw = getValue(row, ['Divisa', 'Currency', 'Moneda', 'Curr']);

          const tx: Transaction = {
            date: parseExcelDate(getValue(row, ['Fecha', 'Date', 'Time', 'Day'])),
            portfolio: portfolio,
            type: type,
            ticker: ticker,
            assetName: assetName,
            assetType: assetType,
            quantity: cleanNumber(qtyRaw),
            price: cleanNumber(priceRaw),
            commission: cleanNumber(commRaw),
            currencyPlatform: (currRaw || 'EUR').toString().toUpperCase().trim() as Currency,
            fxRateToEur: fxRaw ? cleanNumber(fxRaw) : 1,
            notes: getValue(row, ['Notas', 'Notes', 'Comentarios']) || ''
          };

          // Validation: Ensure quantity and price are valid numbers to avoid ghost transactions
          if (tx.quantity > 0 && tx.price >= 0) {
            transactionsToAdd.push(tx);
          }
        }

        console.log("Excel Import Debug - Parsed Transactions:", transactionsToAdd.length);

        if (transactionsToAdd.length > 0) {
          await (db as any).transaction('rw', db.transactions, db.portfolios, db.assetTypes, async () => {
             await db.transactions.bulkAdd(transactionsToAdd);
             
             // Update auxiliary tables (Portfolios, Asset Types)
             const distinctPortfolios = Array.from(new Set(transactionsToAdd.map(t => t.portfolio)));
             const existingPortfolios = await db.portfolios.toArray();
             const newPortfolios = distinctPortfolios
                .filter(p => !existingPortfolios.some(ep => ep.name === p))
                .map(name => ({ name }));
             
             if (newPortfolios.length > 0) await db.portfolios.bulkAdd(newPortfolios);
          });
          
          resolve({ success: true, count: transactionsToAdd.length });
        } else {
          resolve({ success: false, count: 0, error: 'No se encontraron filas válidas. Revisa los nombres de las columnas (Ticker, Fecha, Cantidad, Precio).' });
        }

      } catch (err: any) {
        console.error("Excel Import Error:", err);
        resolve({ success: false, count: 0, error: 'Error procesando el archivo: ' + err.message });
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

    // Format for export
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
    utils.book_append_sheet(wb, ws, "Historial Transacciones");

    writeFile(wb, "Historial_Transacciones_Peakys.xlsx");
  } catch (error) {
    console.error('Error exporting to excel:', error);
    alert('Ocurrió un error al intentar generar el archivo Excel.');
  }
};
