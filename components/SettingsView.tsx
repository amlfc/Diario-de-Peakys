import React, { useRef, useState, useEffect } from 'react';
import { db } from '../db';
import { useLiveQuery } from 'dexie-react-hooks';
import { Card } from './ui/Card';
import { Icons } from './ui/Icons';
import { importTransactionsFromExcel, exportTransactionsToExcel } from '../services/excelService';

const SettingsView: React.FC = () => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isImporting, setIsImporting] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  
  // Portfolio & Asset State
  const [newPortfolioName, setNewPortfolioName] = useState('');
  const [newAssetTypeName, setNewAssetTypeName] = useState('');
  
  // Price Feed State
  const [priceFeedUrl, setPriceFeedUrl] = useState('');
  const [isSavingUrl, setIsSavingUrl] = useState(false);

  const portfolios = useLiveQuery(() => db.portfolios.toArray()) || [];
  const assetTypes = useLiveQuery(() => db.assetTypes.toArray()) || [];

  useEffect(() => {
    // Load saved URL from local storage on mount
    const savedUrl = localStorage.getItem('PRICE_FEED_URL');
    if (savedUrl) setPriceFeedUrl(savedUrl);
  }, []);

  const handleSavePriceUrl = () => {
    setIsSavingUrl(true);
    localStorage.setItem('PRICE_FEED_URL', priceFeedUrl.trim());
    setTimeout(() => {
        setIsSavingUrl(false);
        alert('URL de precios guardada. Los precios se actualizarán en el Dashboard.');
        window.location.reload();
    }, 500);
  };

  const handleReset = async () => {
    if (confirm('¿Estás seguro de que quieres borrar todos los datos y restaurar los datos de ejemplo? Esta acción no se puede deshacer.')) {
      await (db as any).delete();
      localStorage.removeItem('PRICE_FEED_URL');
      window.location.reload();
    }
  };

  const handleClear = async () => {
    if (confirm('¿Estás seguro de que quieres borrar TODAS las transacciones y datos? Quedará vacío.')) {
        await (db as any).transaction('rw', db.transactions, db.liquidity, async () => {
            await db.transactions.clear();
            await db.liquidity.clear();
        });
        alert('Base de datos vaciada.');
        window.location.reload();
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
      window.location.reload(); // Reload to refresh calculations
    } else {
      alert(`Error: ${result.error}`);
    }
    
    // Reset input
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleExport = async () => {
    setIsExporting(true);
    await exportTransactionsToExcel();
    setIsExporting(false);
  };

  // Portfolio Handlers
  const handleAddPortfolio = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newPortfolioName.trim()) return;
    const exists = portfolios.some(p => p.name.toLowerCase() === newPortfolioName.trim().toLowerCase());
    if (exists) {
      alert('Esta cartera ya existe.');
      return;
    }
    await db.portfolios.add({ name: newPortfolioName.trim() });
    setNewPortfolioName('');
  };

  const handleDeletePortfolio = async (id: number, name: string) => {
    if (confirm(`¿Eliminar cartera "${name}"? Las transacciones asociadas NO se borran, pero quedarán huérfanas.`)) {
      await db.portfolios.delete(id);
    }
  };

  // Asset Type Handlers
  const handleAddAssetType = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newAssetTypeName.trim()) return;
    const exists = assetTypes.some(a => a.name.toLowerCase() === newAssetTypeName.trim().toLowerCase());
    if (exists) {
      alert('Este tipo de activo ya existe.');
      return;
    }
    await db.assetTypes.add({ name: newAssetTypeName.trim() });
    setNewAssetTypeName('');
  };

  const handleDeleteAssetType = async (id: number, name: string) => {
    if (confirm(`¿Eliminar tipo de activo "${name}"?`)) {
      await db.assetTypes.delete(id);
    }
  };

  return (
    <div className="space-y-6 animate-fade-in pb-10">
      <h2 className="text-2xl font-bold text-white flex items-center gap-2">
        <Icons.Settings className="text-blue-500" /> Configuración Global
      </h2>

      <div className="grid grid-cols-1 gap-6">

        {/* PRICE FEED CONFIGURATION */}
        <Card title="Fuente de Datos de Precios (Google Sheets)">
           <div className="space-y-4">
              <p className="text-sm text-slate-400">
                Conecta una hoja de Google Sheets para tener precios actualizados automáticamente.
              </p>
              
              <div className="bg-slate-900/50 p-4 rounded border border-slate-700 text-sm space-y-2">
                 <p className="font-medium text-slate-300">Instrucciones:</p>
                 <ol className="list-decimal list-inside text-slate-500 space-y-1">
                   <li>Crea un Sheet con dos columnas: <strong>A (Ticker)</strong> y <strong>B (Precio)</strong>.</li>
                   <li>En la columna B usa fórmulas como <code>=GOOGLEFINANCE(A2)</code>.</li>
                   <li>Haz clic en el botón <strong>Compartir</strong> (arriba a la derecha).</li>
                   <li>Cambia el acceso a <strong>"Cualquier persona con el enlace"</strong>.</li>
                   <li>Copia el enlace y pégalo aquí abajo.</li>
                 </ol>
              </div>

              <div className="flex gap-2 mt-2">
                 <input 
                    type="text" 
                    value={priceFeedUrl} 
                    onChange={(e) => setPriceFeedUrl(e.target.value)}
                    placeholder="https://docs.google.com/spreadsheets/d/..."
                    className="flex-1 bg-slate-900 border border-slate-700 rounded p-2 text-white focus:border-blue-500 outline-none text-sm"
                 />
                 <button 
                   onClick={handleSavePriceUrl}
                   disabled={isSavingUrl}
                   className="bg-blue-600 hover:bg-blue-500 text-white px-4 py-2 rounded-lg text-sm font-medium"
                 >
                   {isSavingUrl ? 'Guardando...' : 'Guardar URL'}
                 </button>
              </div>
           </div>
        </Card>
        
        {/* IMPORT/EXPORT SECTION */}
        <Card title="Datos (Importar / Exportar)">
          <div className="space-y-4">
            <p className="text-sm text-slate-400">
              Sincroniza tus datos entre dispositivos o haz copias de seguridad.
            </p>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* IMPORT */}
               <div className="flex items-center">
                 <input 
                   type="file" 
                   ref={fileInputRef}
                   accept=".xlsx, .xls"
                   onChange={handleFileChange}
                   className="hidden"
                 />
                 <button 
                    disabled={isImporting}
                    onClick={() => fileInputRef.current?.click()}
                    className="w-full bg-blue-600 hover:bg-blue-500 text-white px-4 py-3 rounded-lg flex justify-center items-center gap-2 font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                 >
                   {isImporting ? (
                     <span>Procesando...</span>
                   ) : (
                     <>
                       <Icons.Add size={18} className="rotate-45" />
                       Subir Excel (Importar)
                     </>
                   )}
                 </button>
               </div>

               {/* EXPORT */}
               <button 
                  disabled={isExporting}
                  onClick={handleExport}
                  className="w-full bg-emerald-600 hover:bg-emerald-500 text-white px-4 py-3 rounded-lg flex justify-center items-center gap-2 font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
               >
                 {isExporting ? (
                   <span>Generando...</span>
                 ) : (
                   <>
                     <Icons.Down size={18} />
                     Descargar Excel (Exportar)
                   </>
                 )}
               </button>
            </div>
             <p className="text-xs italic text-slate-500 mt-2">
                La exportación genera un archivo compatible con la importación. Úsalo para mover datos al móvil.
             </p>
          </div>
        </Card>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* PORTFOLIO MANAGEMENT */}
          <Card title="Gestión de Carteras">
             <div className="space-y-4">
                <p className="text-sm text-slate-400 mb-2">
                  Crea o elimina carteras.
                </p>

                <form onSubmit={handleAddPortfolio} className="flex gap-2 mb-4">
                  <input 
                    type="text" 
                    value={newPortfolioName}
                    onChange={(e) => setNewPortfolioName(e.target.value)}
                    placeholder="Nombre nueva cartera..."
                    className="flex-1 bg-slate-900 border border-slate-700 rounded p-2 text-white focus:border-blue-500 outline-none text-sm"
                  />
                  <button type="submit" className="bg-emerald-600 hover:bg-emerald-500 text-white px-3 py-2 rounded text-sm font-medium">
                    <Icons.Add size={16} />
                  </button>
                </form>

                <div className="space-y-2 max-h-60 overflow-y-auto">
                  {portfolios.map((p: any) => (
                    <div key={p.id} className="flex justify-between items-center bg-slate-900/50 p-3 rounded border border-slate-700/50">
                       <span className="text-slate-200 text-sm font-medium">{p.name}</span>
                       <button onClick={() => handleDeletePortfolio(p.id, p.name)} className="text-slate-500 hover:text-rose-400 transition-colors p-1" title="Eliminar">
                          <Icons.Trash size={14} />
                       </button>
                    </div>
                  ))}
                </div>
             </div>
          </Card>

          {/* ASSET TYPE MANAGEMENT */}
          <Card title="Gestión de Tipos de Activo">
             <div className="space-y-4">
                <p className="text-sm text-slate-400 mb-2">
                  Define las categorías para clasificar tus activos.
                </p>

                <form onSubmit={handleAddAssetType} className="flex gap-2 mb-4">
                  <input 
                    type="text" 
                    value={newAssetTypeName}
                    onChange={(e) => setNewAssetTypeName(e.target.value)}
                    placeholder="Nuevo tipo de activo..."
                    className="flex-1 bg-slate-900 border border-slate-700 rounded p-2 text-white focus:border-blue-500 outline-none text-sm"
                  />
                  <button type="submit" className="bg-emerald-600 hover:bg-emerald-500 text-white px-3 py-2 rounded text-sm font-medium">
                    <Icons.Add size={16} />
                  </button>
                </form>

                <div className="space-y-2 max-h-60 overflow-y-auto">
                  {assetTypes.map((a: any) => (
                    <div key={a.id} className="flex justify-between items-center bg-slate-900/50 p-3 rounded border border-slate-700/50">
                       <span className="text-slate-200 text-sm font-medium">{a.name}</span>
                       <button onClick={() => handleDeleteAssetType(a.id, a.name)} className="text-slate-500 hover:text-rose-400 transition-colors p-1" title="Eliminar">
                          <Icons.Trash size={14} />
                       </button>
                    </div>
                  ))}
                </div>
             </div>
          </Card>

          {/* DATA MANAGEMENT & RESET */}
          <Card title="Zona de Peligro" className="md:col-span-2">
            <div className="space-y-4">
              <p className="text-sm text-slate-400">
                Acciones destructivas sobre la base de datos local.
              </p>
              
              <div className="pt-2 space-y-3 md:flex md:space-y-0 md:gap-4">
                <button 
                  onClick={handleReset}
                  className="flex-1 py-3 px-4 bg-slate-700 hover:bg-slate-600 text-white rounded-lg text-sm font-medium transition-colors flex items-center justify-center gap-2"
                >
                  <Icons.Arrow size={16} /> Restaurar Datos de Ejemplo
                </button>
                
                <button 
                  onClick={handleClear}
                  className="flex-1 py-3 px-4 bg-rose-900/20 hover:bg-rose-900/40 border border-rose-900/50 text-rose-400 rounded-lg text-sm font-medium transition-colors flex items-center justify-center gap-2"
                >
                  <Icons.Trash size={16} /> Borrar Todo (Factory Reset)
                </button>
              </div>
            </div>
          </Card>
        </div>

      </div>
    </div>
  );
};

export default SettingsView;
