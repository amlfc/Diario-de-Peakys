import { read, utils, writeFile } from 'xlsx';
import { db } from '../db';
import { Transaction, TransactionType, Currency, DefaultAssetTypes } from '../types';

export const importTransactionsFromExcel = async (file: File): Promise<{ success: boolean; count: number; error?: string }> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = async (e) => {
      try {
        const data = e.target?.result;
        const workbook = read(data, { type: 'binary', cellDates: true });

        // Look for a sheet named "Historial Transacciones" or default to first sheet
        const sheetName = workbook.SheetNames.find(n => n.toLowerCase().includes('transac')) || workbook.SheetNames[0];
        const sheet = workbook.Sheets[sheetName];

        // Convert to JSON
        const rawRows: any[] = utils.sheet_to_json(sheet);

        if (rawRows.length === 0) {
          resolve({ success: false, count: 0, error: 'La hoja está vacía o no tiene formato legible.' });
          return;
        }

        const transactionsToAdd: Transaction[] = [];

        // Map rows to Transaction Interface
        // Best effort matching based on the Excel description provided
        for (const row of rawRows) {
          // Basic validation: Must have Ticker and Type
          if (!row['Ticker'] && !row['ticker']) continue;

          const typeStr = (row['Tipo'] || row['Type'] || '').toString().toLowerCase();
          const type = typeStr.includes('venta') || typeStr.includes('sell') 
            ? TransactionType.Sell 
            : TransactionType.Buy;

          const dateRaw = row['Fecha'] || row['Date'];
          let dateStr = new Date().toISOString().split('T')[0];
          
          if (dateRaw instanceof Date) {
            dateStr = dateRaw.toISOString().split('T')[0];
          } else if (typeof dateRaw === 'number') {
            // Excel serial date
             dateStr = new Date(Math.round((dateRaw - 25569)*86400*1000)).toISOString().split('T')[0];
          } else if (typeof dateRaw === 'string') {
            dateStr = dateRaw;
          }

          const ticker = (row['Ticker'] || '').toString().toUpperCase();
          const assetName = (row['Nombre Activo'] || row['Nombre'] || ticker).toString();
          const portfolio = (row['Cartera'] || 'Alejandro').toString();
          
          // Try to map Asset Type if column exists, else default
          // Using DefaultAssetTypes constants to try and match common excel values
          let assetType = DefaultAssetTypes.ActionLong; 
          const rowAssetType = (row['Tipo Activo'] || '').toString().toLowerCase();
          if (rowAssetType.includes('etf')) assetType = DefaultAssetTypes.ETFLong;
          else if (rowAssetType.includes('swing')) assetType = DefaultAssetTypes.ActionSwing;
          else if (rowAssetType.includes('penny')) assetType = DefaultAssetTypes.ActionPenny;
          else if (rowAssetType.includes('cripto') || rowAssetType.includes('crypto')) assetType = DefaultAssetTypes.Crypto;
          else if (rowAssetType.includes('fija') || rowAssetType.includes('renta')) assetType = DefaultAssetTypes.FixedIncome;

          // Currency Parsing
          const currStr = (row['Divisa Moneda Plataforma'] || row['Divisa'] || 'EUR').toString().toUpperCase().trim();
          let currency = Currency.EUR;
          if (currStr === 'USD') currency = Currency.USD;
          else if (currStr === 'GBP') currency = Currency.GBP;
          else if (currStr === 'CHF') currency = Currency.CHF;
          else if (currStr === 'CAD') currency = Currency.CAD;
          else if (currStr === 'JPY') currency = Currency.JPY;
          else if (currStr === 'AUD') currency = Currency.AUD;
          else if (currStr === 'HKD') currency = Currency.HKD;

          const tx: Transaction = {
            date: dateStr,
            portfolio: portfolio,
            type: type,
            ticker: ticker,
            assetName: assetName,
            assetType: assetType,
            quantity: Number(row['Cantidad'] || row['Quantity'] || 0),
            price: Number(row['Precio'] || row['Price'] || 0),
            commission: Number(row['Comisión'] || row['Commission'] || 0),
            currencyPlatform: currency,
            fxRateToEur: Number(row['Tipo Cambio'] || row['FX Rate'] || 1),
            notes: (row['Notas'] || '').toString()
          };

          transactionsToAdd.push(tx);
        }

        if (transactionsToAdd.length > 0) {
          // Cast db to any to avoid TS error on transaction method
          await (db as any).transaction('rw', db.transactions, db.portfolios, db.assetTypes, async () => {
             await db.transactions.bulkAdd(transactionsToAdd);
             
             // Auto-add unknown portfolios
             const distinctPortfolios = Array.from(new Set(transactionsToAdd.map(t => t.portfolio)));
             const existingPortfolios = await db.portfolios.toArray();
             const existingPortfolioNames = existingPortfolios.map(p => p.name);
             const newPortfolios = distinctPortfolios.filter(p => !existingPortfolioNames.includes(p)).map(name => ({ name }));
             if (newPortfolios.length > 0) await db.portfolios.bulkAdd(newPortfolios);

             // Auto-add unknown asset types (simple check)
             const distinctAssetTypes = Array.from(new Set(transactionsToAdd.map(t => t.assetType)));
             const existingAssetTypes = await db.assetTypes.toArray();
             const existingAssetTypeNames = existingAssetTypes.map(a => a.name);
             const newAssetTypes = distinctAssetTypes.filter(a => !existingAssetTypeNames.includes(a)).map(name => ({ name }));
             if (newAssetTypes.length > 0) await db.assetTypes.bulkAdd(newAssetTypes);
          });
          
          resolve({ success: true, count: transactionsToAdd.length });
        } else {
          resolve({ success: false, count: 0, error: 'No se encontraron filas válidas.' });
        }

      } catch (err) {
        console.error(err);
        resolve({ success: false, count: 0, error: 'Error al procesar el archivo. Asegúrate de que es un Excel válido.' });
      }
    };

    reader.onerror = () => {
      resolve({ success: false, count: 0, error: 'Error de lectura del archivo.' });
    };

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

    // Format data matching the structure we prefer for imports (and user's excel)
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