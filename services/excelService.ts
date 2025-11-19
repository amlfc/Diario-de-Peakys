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

// 2. Strict European Number Parsing
const cleanNumber = (val: any): number => {
  if (typeof val === 'number') return val;
  if (!val) return 0;

  let str = val.toString().trim();
  // Remove currency symbols and spaces (including non-breaking spaces)
  str = str.replace(/[€$£¥\s\u00A0]/g, '');

  // RULE: User confirmed "Decimals are Commas" (European Format)
  
  if (str.includes(',')) {
    // CASE A: Comma exists. It IS the decimal separator.
    // 1. Remove all dots (they are definitely thousands separators: 1.200,50)
    str = str.replace(/\./g, '');
    // 2. Replace comma with dot for JS parsing
    str = str.replace(',', '.');
  } else if (str.includes('.')) {
    // CASE B: No comma, but has dot. Ambiguous (1.000 vs 1.5).
    
    const parts = str.split('.');
    if (parts.length > 2) {
       // Multiple dots (1.000.000) -> Definitely thousands
       str = str.replace(/\./g, '');
    } else {
       // Single dot (1.000 or 1.5)
       const rightSide = parts[1];
       if (rightSide.length === 3) {
          // Exactly 3 digits (1.200) -> Highly likely a thousand separator
          str = str.replace(/\./g, '');
       } else {
          // Not 3 digits (1.5, 10.50, 500.1) -> Likely a US format slip-through or raw float
          // We leave the dot as is so parseFloat handles it as a decimal
       }
    }
  }

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

        // Read as Array of Arrays (Row Scanning Mode) to find headers manually
        const rows = utils.sheet_to_json(sheet, { header: 1, range: 0, defval: '' }) as any[][];

        if (!rows || rows.length === 0) {
          resolve({ success: false, count: 0, error: 'La hoja está vacía.' });
          return;
        }

        // 1. Find Header Row Index
        let headerIndex = -1;
        const tickerKeywords = ['ticker', 'simbolo', 'symbol', 'activo', 'code'];
        
        for (let i = 0; i < Math.min(rows.length, 20); i++) { // Scan first 20 rows
          const rowStr = JSON.stringify(rows[i]).toLowerCase();
          if (tickerKeywords.some(k => rowStr.includes(k))) {
             headerIndex = i;
             break;
          }
        }

        if (headerIndex === -1) {
           console.warn("No header found, assuming row 0");
           headerIndex = 0;
        }

        // 2. Map Column Indices
        const headerRow = rows[headerIndex].map((cell: any) => (cell?.toString() || '').toLowerCase().trim());
        const colMap: Record<string, number> = {};
        
        headerRow.forEach((val, idx) => {
           if(val) colMap[val] = idx;
        });

        // Helper to grab value from row using aliases
        const getCell = (row: any[], aliases: string[]) => {
           for (const alias of aliases) {
              const key = alias.toLowerCase();
              // Find column index for this alias
              // We iterate the map because exact match might fail if we don't check carefully, 
              // but here we use the colMap keys.
              if (colMap[key] !== undefined) return row[colMap[key]];
           }
           return undefined;
        };

        const transactionsToAdd: Transaction[] = [];
        
        // 3. Process Data Rows
        for (let i = headerIndex + 1; i < rows.length; i++) {
          const row = rows[i];
          if (!row || row.length === 0) continue;

          // Find Ticker (Mandatory)
          const tickerRaw = getCell(row, ['Ticker', 'Simbolo', 'Symbol', 'Activo', 'Code']);
          if (!tickerRaw) continue; 

          const ticker = tickerRaw.toString().toUpperCase().trim();

          // Determine Type
          const typeRaw = getCell(row, ['Tipo', 'Type', 'Operacion', 'Direction', 'B/S']);
          const typeStr = (typeRaw || '').toString().toLowerCase();
          const type = (typeStr.includes('venta') || typeStr.includes('sell') || typeStr === 's') 
            ? TransactionType.Sell 
            : TransactionType.Buy;

          // Portfolio
          const portfolioRaw = getCell(row, ['Cartera', 'Portfolio', 'Cuenta', 'Account', 'Nombre Cartera']);
          const portfolio = (portfolioRaw || 'Alejandro').toString().trim();

          // Asset Name
          const nameRaw = getCell(row, ['Nombre', 'Nombre Activo', 'Name', 'Description', 'Security Name']);
          const assetName = nameRaw ? nameRaw.toString().trim() : ticker;

          // Asset Type
          const assetTypeRaw = getCell(row, ['Tipo Activo', 'Asset Type', 'Categoria', 'Category', 'Class']);
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
          const qtyRaw = getCell(row, ['Cantidad', 'Quantity', 'Units', 'Unidades', 'Shares', 'Títulos', 'Titulos']);
          const priceRaw = getCell(row, ['Precio', 'Price', 'Coste', 'Cost', 'Amount']);
          const commRaw = getCell(row, ['Comision', 'Commission', 'Fees', 'Fee']);
          const fxRaw = getCell(row, ['Tipo Cambio', 'FX', 'FX Rate', 'Exchange Rate', 'Cambio']);
          const currRaw = getCell(row, ['Divisa', 'Currency', 'Moneda', 'Curr']);
          const dateRaw = getCell(row, ['Fecha', 'Date', 'Time', 'Day']);
          const notesRaw = getCell(row, ['Notas', 'Notes', 'Comentarios']);

          const tx: Transaction = {
            date: parseExcelDate(dateRaw),
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
            notes: notesRaw ? notesRaw.toString() : ''
          };

          if (tx.quantity > 0 && tx.price >= 0) {
            transactionsToAdd.push(tx);
          }
        }

        console.log("Excel Import Debug - Parsed Transactions:", transactionsToAdd.length);

        if (transactionsToAdd.length > 0) {
          await (db as any).transaction('rw', db.transactions, db.portfolios, db.assetTypes, async () => {
             await db.transactions.bulkAdd(transactionsToAdd);
             
             // Add missing portfolios
             const distinctPortfolios = Array.from(new Set(transactionsToAdd.map(t => t.portfolio)));
             const existingPortfolios = await db.portfolios.toArray();
             const newPortfolios = distinctPortfolios
                .filter(p => !existingPortfolios.some(ep => ep.name === p))
                .map(name => ({ name }));
             
             if (newPortfolios.length > 0) await db.portfolios.bulkAdd(newPortfolios);
          });
          
          resolve({ success: true, count: transactionsToAdd.length });
        } else {
          resolve({ success: false, count: 0, error: 'No se encontraron filas válidas. Revisa los nombres de las columnas.' });
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
