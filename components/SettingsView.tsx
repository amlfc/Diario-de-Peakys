
import React, { useRef, useState } from 'react';
import { db } from '../db';
import { useLiveData } from '../hooks/useLiveData';
import { Card } from './ui/Card';
import { Icons } from './ui/Icons';
import { importTransactionsFromExcel, exportTransactionsToExcel } from '../services/excelService';
import { DEFAULT_RISK_LEVELS, getRiskLevelsConfig, saveRiskLevelsConfig } from '../utils/riskLevels';

const SettingsView: React.FC = () => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const backupInputRef = useRef<HTMLInputElement>(null);
  const [isImporting, setIsImporting] = useState(false);
  const portfolios = useLiveData(() => db.portfolios.toArray()) || [];
  
  // API Config State
  const [apiUrl, setApiUrl] = useState(localStorage.getItem('HOSTINGER_API_URL') || '');
  const [isSavingApi, setIsSavingApi] = useState(false);

  // Price Feed State
  const [priceFeedUrl, setPriceFeedUrl] = useState(localStorage.getItem('PRICE_FEED_URL') || '');
  const [isSavingUrl, setIsSavingUrl] = useState(false);

  // Risk management levels (Stops / TP-Trailing activation)
  const initialRiskConfig = getRiskLevelsConfig();
  const [stopLevels, setStopLevels] = useState<string[]>(initialRiskConfig.stopPercents.map(String));
  const [trailingLevels, setTrailingLevels] = useState<string[]>(initialRiskConfig.trailingPercents.map(String));
  const [isSavingRiskLevels, setIsSavingRiskLevels] = useState(false);

  // Portfolio State
  const [newPortfolioName, setNewPortfolioName] = useState('');
  const [isSavingPortfolio, setIsSavingPortfolio] = useState(false);

  const handleSaveApiUrl = () => {
    setIsSavingApi(true);
    // Remove trailing slash if present for consistency
    const cleanUrl = apiUrl.trim().replace(/\/$/, '');
    localStorage.setItem('HOSTINGER_API_URL', cleanUrl);
    setTimeout(() => {
        setIsSavingApi(false);
        alert('Conexión API Guardada. La aplicación se recargará.');
        window.location.reload();
    }, 500);
  };

  const handleSavePriceUrl = () => {
    setIsSavingUrl(true);
    localStorage.setItem('PRICE_FEED_URL', priceFeedUrl.trim());
    setTimeout(() => {
        setIsSavingUrl(false);
        alert('URL de precios guardada. Los precios y divisas se actualizarán en el Dashboard.');
        window.location.reload();
    }, 500);
  };

  const handleCreatePortfolio = async () => {
    const cleanName = newPortfolioName.trim();
    if (!cleanName) {
      alert('Escribe un nombre de cartera.');
      return;
    }

    const exists = portfolios.some(p => p.name.trim().toLowerCase() === cleanName.toLowerCase());
    if (exists) {
      alert('Ya existe una cartera con ese nombre.');
      return;
    }

    setIsSavingPortfolio(true);
    try {
      await db.portfolios.add({ name: cleanName });
      setNewPortfolioName('');
    } catch (error) {
      console.error('Error creating portfolio:', error);
      alert('No se pudo crear la cartera. Revisa la conexión API.');
    } finally {
      setIsSavingPortfolio(false);
    }
  };

  const updateLevel = (
    setter: React.Dispatch<React.SetStateAction<string[]>>,
    index: number,
    value: string
  ) => {
    setter(prev => prev.map((level, i) => (i === index ? value : level)));
  };

  const parseLevel = (value: string, fallback: number) => {
    const normalized = value.replace(',', '.').trim();
    if (!normalized) return fallback;
    const parsed = Number(normalized);
    if (!Number.isFinite(parsed) || parsed < 0) return fallback;
    return Number(parsed.toFixed(2));
  };

  const handleSaveRiskLevels = () => {
    setIsSavingRiskLevels(true);
    const nextConfig = {
      stopPercents: [
        parseLevel(stopLevels[0], DEFAULT_RISK_LEVELS.stopPercents[0]),
        parseLevel(stopLevels[1], DEFAULT_RISK_LEVELS.stopPercents[1]),
        parseLevel(stopLevels[2], DEFAULT_RISK_LEVELS.stopPercents[2])
      ] as [number, number, number],
      trailingPercents: [
        parseLevel(trailingLevels[0], DEFAULT_RISK_LEVELS.trailingPercents[0]),
        parseLevel(trailingLevels[1], DEFAULT_RISK_LEVELS.trailingPercents[1]),
        parseLevel(trailingLevels[2], DEFAULT_RISK_LEVELS.trailingPercents[2])
      ] as [number, number, number]
    };

    saveRiskLevelsConfig(nextConfig);
    setStopLevels(nextConfig.stopPercents.map(String));
    setTrailingLevels(nextConfig.trailingPercents.map(String));

    setTimeout(() => {
      setIsSavingRiskLevels(false);
      alert('Niveles de stop y trailing guardados. Se aplicarán en Posiciones Abiertas.');
    }, 300);
  };

  const handleDeletePortfolio = async (portfolioId?: number, portfolioName?: string) => {
    if (!portfolioId || !portfolioName) return;

    const hasTransactions = (await db.transactions.where('portfolio').equals(portfolioName).toArray()).length > 0;
    const hasLiquidity = (await db.liquidity.where('portfolio').equals(portfolioName).toArray()).length > 0;

    if (hasTransactions || hasLiquidity) {
      alert('No puedes borrar esta cartera porque tiene transacciones o movimientos de liquidez asociados.');
      return;
    }

    if (!confirm(`¿Borrar la cartera "${portfolioName}"?`)) return;

    try {
      await db.portfolios.delete(portfolioId);
    } catch (error) {
      console.error('Error deleting portfolio:', error);
      alert('No se pudo borrar la cartera. Revisa la conexión API.');
    }
  };

  const handleClear = async () => {
    if (confirm('ATENCIÓN: ¿Estás seguro de que quieres borrar TODA la base de datos en el servidor?')) {
        try {
            await db.transactions.clear();
            await db.liquidity.clear();
            await db.portfolios.clear();
            await db.assetTypes.clear();
            await db.allocationTargets.clear();
            alert('Base de datos vaciada correctamente.');
        } catch (error) {
            console.error("Error al vaciar DB:", error);
            alert("Ocurrió un error al borrar la base de datos. Revisa la conexión API.");
        }
    }
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsImporting(true);
    const result = await importTransactionsFromExcel(file);
    setIsImporting(false);

    if (result.success) {
      alert(`Importación completada. Se añadieron ${result.count} transacciones.`);
      window.location.reload();
    } else {
      alert(`Error: ${result.error}`);
    }
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleExportExcel = async () => {
    await exportTransactionsToExcel();
  };

  const handleExportBackupJson = async () => {
    try {
      const data = {
        transactions: await db.transactions.toArray(),
        liquidity: await db.liquidity.toArray(),
        portfolios: await db.portfolios.toArray(),
        assetTypes: await db.assetTypes.toArray(),
        allocationTargets: await db.allocationTargets.toArray(),
        positionNotes: await db.positionNotes.toArray(),
        metadata: {
          priceFeedUrl: localStorage.getItem('PRICE_FEED_URL') || '',
          riskLevels: getRiskLevelsConfig(),
          exportedAt: new Date().toISOString()
        }
      };

      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `peakys_backup_${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (error) {
      console.error('Error exporting backup JSON:', error);
      alert('No se pudo generar la copia JSON. Revisa la conexión API.');
    }
  };

  const handleImportBackupJson = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      const text = await file.text();
      const parsed = JSON.parse(text);

      if (!confirm('Se restaurará la copia seleccionada y se reemplazarán los datos actuales. ¿Continuar?')) {
        return;
      }

      await db.transactions.clear();
      await db.liquidity.clear();
      await db.portfolios.clear();
      await db.assetTypes.clear();
      await db.allocationTargets.clear();
      await db.positionNotes.clear();

      await db.transactions.bulkAdd(Array.isArray(parsed.transactions) ? parsed.transactions : []);
      await db.liquidity.bulkAdd(Array.isArray(parsed.liquidity) ? parsed.liquidity : []);
      await db.portfolios.bulkAdd(Array.isArray(parsed.portfolios) ? parsed.portfolios : []);
      await db.assetTypes.bulkAdd(Array.isArray(parsed.assetTypes) ? parsed.assetTypes : []);
      await db.allocationTargets.bulkAdd(Array.isArray(parsed.allocationTargets) ? parsed.allocationTargets : []);
      await db.positionNotes.bulkAdd(Array.isArray(parsed.positionNotes) ? parsed.positionNotes : []);

      if (typeof parsed?.metadata?.priceFeedUrl === 'string') {
        localStorage.setItem('PRICE_FEED_URL', parsed.metadata.priceFeedUrl);
      }
      if (parsed?.metadata?.riskLevels) {
        saveRiskLevelsConfig(parsed.metadata.riskLevels);
      }

      alert('Copia restaurada correctamente. Se recargará la aplicación.');
      window.location.reload();
    } catch (error) {
      console.error('Error importing backup JSON:', error);
      alert('No se pudo restaurar la copia JSON. Verifica el archivo.');
    } finally {
      if (backupInputRef.current) backupInputRef.current.value = '';
    }
  };

  return (
    <div className="space-y-6 animate-fade-in pb-10">
      <h2 className="text-2xl font-bold text-white flex items-center gap-2">
        <Icons.Settings className="text-blue-500" /> Configuración Global
      </h2>

      <div className="grid grid-cols-1 gap-6">

        <Card title="Conexión Base de Datos (Hostinger MySQL)">
            <div className="space-y-2">
                <p className="text-xs text-slate-400 mb-2">Introduce la URL completa donde alojaste el archivo <code>index.php</code>.</p>
                <div className="flex gap-2">
                    <input 
                        type="text" 
                        value={apiUrl} 
                        onChange={(e) => setApiUrl(e.target.value)} 
                        placeholder="https://tudominio.com/api-peakys/index.php" 
                        className="flex-1 bg-slate-900 border border-slate-700 rounded p-2 text-white focus:border-blue-500 outline-none text-sm font-mono"
                    />
                    <button onClick={handleSaveApiUrl} disabled={isSavingApi} className="bg-blue-600 hover:bg-blue-500 text-white px-4 py-2 rounded-lg text-sm font-medium whitespace-nowrap">
                        {isSavingApi ? '...' : 'Guardar Conexión'}
                    </button>
                </div>
            </div>
        </Card>

        <Card title="Mis Carteras">
          <div className="space-y-4">
            <p className="text-xs text-slate-400">Cada usuario puede gestionar su propia lista de carteras. Estas carteras aparecerán en transacciones y liquidez de tu cuenta.</p>

            <div className="flex gap-2">
              <input
                type="text"
                value={newPortfolioName}
                onChange={(e) => setNewPortfolioName(e.target.value)}
                placeholder="Ej. DeGiro, Trading 212, Largo Plazo"
                className="flex-1 bg-slate-900 border border-slate-700 rounded p-2 text-white focus:border-blue-500 outline-none text-sm"
              />
              <button
                onClick={handleCreatePortfolio}
                disabled={isSavingPortfolio}
                className="bg-emerald-600 hover:bg-emerald-500 text-white px-4 py-2 rounded-lg text-sm font-medium whitespace-nowrap"
              >
                {isSavingPortfolio ? '...' : 'Añadir Cartera'}
              </button>
            </div>

            <div className="border border-slate-700 rounded-lg overflow-hidden">
              {portfolios.length === 0 ? (
                <div className="px-4 py-4 text-sm text-slate-500">No tienes carteras todavía. Crea la primera arriba.</div>
              ) : (
                <ul className="divide-y divide-slate-700">
                  {portfolios.map((portfolio) => (
                    <li key={portfolio.id} className="px-4 py-3 flex items-center justify-between">
                      <span className="text-sm text-slate-100">{portfolio.name}</span>
                      <button
                        onClick={() => handleDeletePortfolio(portfolio.id, portfolio.name)}
                        className="text-rose-400 hover:text-rose-300 text-xs flex items-center gap-1"
                        title="Eliminar cartera"
                      >
                        <Icons.Trash size={14} /> Eliminar
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </Card>

        <Card title="Fuente de Datos (Google Sheets)">
           <div className="space-y-4">
              <div className="flex gap-2 mt-2">
                 <input type="text" value={priceFeedUrl} onChange={(e) => setPriceFeedUrl(e.target.value)} placeholder="https://docs.google.com/spreadsheets/d/..." className="flex-1 bg-slate-900 border border-slate-700 rounded p-2 text-white focus:border-blue-500 outline-none text-sm"/>
                 <button onClick={handleSavePriceUrl} disabled={isSavingUrl} className="bg-blue-600 hover:bg-blue-500 text-white px-4 py-2 rounded-lg text-sm font-medium whitespace-nowrap">
                   {isSavingUrl ? '...' : 'Guardar URL'}
                 </button>
              </div>
           </div>
        </Card>

        <Card title="Niveles de Stops y Take Profit / Trailing">
          <div className="space-y-4">
            <p className="text-xs text-slate-400">
              Define aquí los porcentajes que se usarán para calcular automáticamente 3 precios de stop y 3 precios de activación de take profit / trailing
              en cada posición abierta, tomando como base el precio medio de compra.
            </p>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="bg-slate-900/60 border border-slate-700 rounded-lg p-3 space-y-2">
                <p className="text-sm text-rose-300 font-medium">Stops (%)</p>
                {stopLevels.map((level, index) => (
                  <div key={`stop-${index}`} className="flex items-center gap-2">
                    <label className="text-xs text-slate-400 w-14">Stop {index + 1}</label>
                    <input
                      type="number"
                      step="0.1"
                      min="0"
                      value={level}
                      onChange={(e) => updateLevel(setStopLevels, index, e.target.value)}
                      className="flex-1 bg-slate-900 border border-slate-700 rounded p-2 text-white focus:border-blue-500 outline-none text-sm"
                    />
                    <span className="text-xs text-slate-500">%</span>
                  </div>
                ))}
              </div>

              <div className="bg-slate-900/60 border border-slate-700 rounded-lg p-3 space-y-2">
                <p className="text-sm text-emerald-300 font-medium">Take Profit / Trailing Activación (%)</p>
                {trailingLevels.map((level, index) => (
                  <div key={`trail-${index}`} className="flex items-center gap-2">
                    <label className="text-xs text-slate-400 w-14">TP {index + 1}</label>
                    <input
                      type="number"
                      step="0.1"
                      min="0"
                      value={level}
                      onChange={(e) => updateLevel(setTrailingLevels, index, e.target.value)}
                      className="flex-1 bg-slate-900 border border-slate-700 rounded p-2 text-white focus:border-blue-500 outline-none text-sm"
                    />
                    <span className="text-xs text-slate-500">%</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="flex justify-end">
              <button
                onClick={handleSaveRiskLevels}
                disabled={isSavingRiskLevels}
                className="bg-blue-600 hover:bg-blue-500 text-white px-4 py-2 rounded-lg text-sm font-medium whitespace-nowrap"
              >
                {isSavingRiskLevels ? 'Guardando...' : 'Guardar Niveles'}
              </button>
            </div>
          </div>
        </Card>
        
        <Card title="Herramientas Excel (Operativas)">
          <div className="space-y-4">
            <div className="flex flex-col sm:flex-row items-center gap-4">
               <input type="file" ref={fileInputRef} accept=".xlsx, .xls" onChange={handleFileChange} className="hidden"/>
               <button disabled={isImporting} onClick={() => fileInputRef.current?.click()} className="w-full sm:w-auto flex-1 bg-emerald-600 hover:bg-emerald-500 text-white px-4 py-3 rounded-lg flex items-center justify-center gap-2 font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed">
                 {isImporting ? <span>Procesando...</span> : <><Icons.Add size={18} className="rotate-45" /> Subir Excel Transacciones</>}
               </button>
               <button onClick={handleExportExcel} className="w-full sm:w-auto flex-1 bg-emerald-600 hover:bg-emerald-500 text-white px-4 py-3 rounded-lg flex items-center justify-center gap-2 font-medium transition-colors">
                  <Icons.Arrow size={18} className="rotate-90" /> Descargar Excel Transacciones
               </button>
            </div>
          </div>
        </Card>

        <Card title="Copia de Seguridad JSON">
          <div className="space-y-4">
            <p className="text-xs text-slate-400">
              Exporta una copia completa de tus datos y restáurala cuando necesites recuperar la información.
            </p>
            <input
              type="file"
              ref={backupInputRef}
              accept="application/json,.json"
              onChange={handleImportBackupJson}
              className="hidden"
            />
            <div className="flex flex-col sm:flex-row items-center gap-4">
              <button
                onClick={handleExportBackupJson}
                className="w-full sm:w-auto flex-1 bg-blue-600 hover:bg-blue-500 text-white px-4 py-3 rounded-lg flex items-center justify-center gap-2 font-medium transition-colors"
              >
                <Icons.Save size={18} /> Descargar Copia JSON
              </button>
              <button
                onClick={() => backupInputRef.current?.click()}
                className="w-full sm:w-auto flex-1 bg-slate-700 hover:bg-slate-600 text-white px-4 py-3 rounded-lg flex items-center justify-center gap-2 font-medium transition-colors"
              >
                <Icons.Add size={18} className="rotate-45" /> Restaurar Copia JSON
              </button>
            </div>
          </div>
        </Card>

        <Card title="Gestión de Datos (Server)" className="md:col-span-2">
            <div className="space-y-4">
              <div className="pt-2 space-y-3 md:flex md:space-y-0 md:gap-4">
                 <button onClick={handleClear} className="flex-1 py-3 px-4 bg-rose-900/20 hover:bg-rose-900/40 border border-rose-900/50 text-rose-400 rounded-lg text-sm font-medium transition-colors flex items-center justify-center gap-2">
                  <Icons.Trash size={16} /> Borrar Todo en Servidor (Peligro)
                </button>
              </div>
            </div>
        </Card>

      </div>
    </div>
  );
};

export default SettingsView;
