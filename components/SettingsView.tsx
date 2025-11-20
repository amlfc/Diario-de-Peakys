
import React, { useRef, useState } from 'react';
import { db } from '../db';
import { useLiveData } from '../hooks/useLiveData';
import { Card } from './ui/Card';
import { Icons } from './ui/Icons';
import { importTransactionsFromExcel, exportTransactionsToExcel } from '../services/excelService';

const SettingsView: React.FC = () => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isImporting, setIsImporting] = useState(false);
  
  // API Config State
  const [apiUrl, setApiUrl] = useState(localStorage.getItem('HOSTINGER_API_URL') || '');
  const [isSavingApi, setIsSavingApi] = useState(false);

  // Price Feed State
  const [priceFeedUrl, setPriceFeedUrl] = useState(localStorage.getItem('PRICE_FEED_URL') || '');
  const [isSavingUrl, setIsSavingUrl] = useState(false);

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
