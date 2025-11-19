
import React, { useRef, useState, useEffect } from 'react';
import { db } from '../db';
import { useLiveQuery } from 'dexie-react-hooks';
import { Card } from './ui/Card';
import { Icons } from './ui/Icons';
import { importTransactionsFromExcel, exportTransactionsToExcel } from '../services/excelService';
import { autoSyncService } from '../services/autoSyncService';

const SettingsView: React.FC = () => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const backupInputRef = useRef<HTMLInputElement>(null);
  const [isImporting, setIsImporting] = useState(false);
  
  // Auto Sync State
  const [isSyncLinked, setIsSyncLinked] = useState(false);
  const [canRestoreSync, setCanRestoreSync] = useState(false);
  const [lastAutoSave, setLastAutoSave] = useState<Date | null>(null);

  // Portfolio & Asset State
  const [newPortfolioName, setNewPortfolioName] = useState('');
  const [newAssetTypeName, setNewAssetTypeName] = useState('');
  
  // Price Feed State
  const [priceFeedUrl, setPriceFeedUrl] = useState('');
  const [isSavingUrl, setIsSavingUrl] = useState(false);

  const portfolios = useLiveQuery(() => db.portfolios.toArray()) || [];
  const assetTypes = useLiveQuery(() => db.assetTypes.toArray()) || [];

  useEffect(() => {
    const savedUrl = localStorage.getItem('PRICE_FEED_URL');
    if (savedUrl) setPriceFeedUrl(savedUrl);

    // Subscribe to AutoSync Status
    autoSyncService.onStatusChange = (linked, date, canRestore) => {
       setIsSyncLinked(linked);
       setLastAutoSave(date);
       setCanRestoreSync(canRestore);
    };
    // Initial check (triggers internal restore attempt logic in service)
  }, []);

  const handleLinkAutoSync = async () => {
    await autoSyncService.linkFile();
  };
  
  const handleRestoreAutoSync = async () => {
    await autoSyncService.restorePermission();
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

  const handleReset = async () => {
    if (confirm('¿Estás seguro de que quieres restaurar los datos de ejemplo? Se borrarán tus cambios actuales y se cargarán los datos demo.')) {
      try {
        await (db as any).delete();
        localStorage.removeItem('PRICE_FEED_URL');
        localStorage.removeItem('DATA_SEEDED');
        window.location.reload();
      } catch (error) {
        console.error("Error al resetear DB:", error);
        alert("Ocurrió un error al restaurar. Intenta recargar la página.");
      }
    }
  };

  const handleClear = async () => {
    if (confirm('¿Estás seguro de que quieres borrar TODA la base de datos? Quedará completamente vacía (sin carteras, ni activos, ni transacciones).')) {
        try {
            await (db as any).delete();
            localStorage.setItem('DATA_SEEDED', 'true');
            alert('Base de datos vaciada correctamente.');
            window.location.reload();
        } catch (error) {
            console.error("Error al vaciar DB:", error);
            alert("Ocurrió un error al borrar la base de datos.");
        }
    }
  };

  // --- EXCEL HANDLERS ---
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

  // --- FULL DATABASE BACKUP (JSON) HANDLERS ---
  const handleExportDB = async () => {
    try {
      const data = {
        transactions: await db.transactions.toArray(),
        liquidity: await db.liquidity.toArray(),
        portfolios: await db.portfolios.toArray(),
        assetTypes: await db.assetTypes.toArray(),
        allocationTargets: await db.allocationTargets.toArray(),
        metadata: {
           version: 4,
           exportDate: new Date().toISOString(),
           priceFeedUrl: localStorage.getItem('PRICE_FEED_URL') || ''
        }
      };

      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `Peakys_DB_Backup_${new Date().toISOString().split('T')[0]}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

    } catch (error) {
      console.error("Error exportando DB:", error);
      alert("Error al generar el archivo de base de datos.");
    }
  };

  const handleImportDB = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!confirm("ADVERTENCIA: Al restaurar una base de datos, se BORRARÁN todos los datos actuales y se reemplazarán por los del archivo. ¿Continuar?")) {
      if (backupInputRef.current) backupInputRef.current.value = '';
      return;
    }

    const reader = new FileReader();
    reader.onload = async (evt) => {
      try {
        const json = JSON.parse(evt.target?.result as string);
        
        if (!json.transactions || !json.portfolios) {
           throw new Error("El archivo no parece ser un backup válido de Peakys.");
        }

        await (db as any).transaction('rw', db.transactions, db.liquidity, db.portfolios, db.assetTypes, db.allocationTargets, async () => {
            await db.transactions.clear();
            await db.liquidity.clear();
            await db.portfolios.clear();
            await db.assetTypes.clear();
            await db.allocationTargets.clear();

            await db.transactions.bulkAdd(json.transactions);
            await db.liquidity.bulkAdd(json.liquidity || []);
            await db.portfolios.bulkAdd(json.portfolios || []);
            await db.assetTypes.bulkAdd(json.assetTypes || []);
            await db.allocationTargets.bulkAdd(json.allocationTargets || []);
        });

        if (json.metadata?.priceFeedUrl) {
           localStorage.setItem('PRICE_FEED_URL', json.metadata.priceFeedUrl);
        }

        alert("Base de datos restaurada con éxito.");
        window.location.reload();

      } catch (error: any) {
        console.error("Error importando DB:", error);
        alert("Error al restaurar: " + error.message);
      }
    };
    reader.readAsText(file);
    if (backupInputRef.current) backupInputRef.current.value = '';
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

        {/* BACKUP SECTION - AUTO SYNC (NEW) */}
        <Card title="Sincronización Automática (Experimental)">
           <div className="space-y-4">
             <div className={`p-4 rounded-lg border ${isSyncLinked ? 'bg-emerald-900/20 border-emerald-800' : 'bg-slate-900/50 border-slate-700'}`}>
                <div className="flex items-center justify-between mb-2">
                   <span className={`font-bold ${isSyncLinked ? 'text-emerald-400' : canRestoreSync ? 'text-orange-400' : 'text-slate-300'}`}>
                     Estado: {isSyncLinked ? 'VINCULADO Y GUARDANDO' : canRestoreSync ? 'ESPERANDO REACTIVACIÓN' : 'NO VINCULADO'}
                   </span>
                   {lastAutoSave && (
                     <span className="text-xs text-slate-400">
                        Último guardado: {lastAutoSave.toLocaleTimeString()}
                     </span>
                   )}
                </div>
                <p className="text-sm text-slate-400 mb-4">
                  Esta función permite elegir un archivo <strong>.json</strong> en tu disco duro. 
                  La aplicación escribirá automáticamente en él cada vez que hagas un cambio (añadir operación, importar excel, etc).
                  <br/><br/>
                  {canRestoreSync && (
                     <span className="text-orange-300 text-xs block bg-orange-900/30 p-2 rounded border border-orange-900/50">
                        ⚠ Detectamos que ya elegiste un archivo anteriormente. 
                        Por seguridad del navegador, debes pulsar "Reactivar" cada vez que recargues la página.
                     </span>
                  )}
                </p>
                
                {canRestoreSync ? (
                    <button 
                      onClick={handleRestoreAutoSync}
                      className="w-full py-3 px-4 rounded-lg font-medium transition-colors flex items-center justify-center gap-2 bg-orange-600 hover:bg-orange-500 text-white"
                    >
                      <Icons.Add size={18} className="rotate-45" /> Reactivar Sincronización (Dar Permiso)
                    </button>
                ) : (
                    <button 
                      onClick={handleLinkAutoSync}
                      disabled={isSyncLinked}
                      className={`w-full py-3 px-4 rounded-lg font-medium transition-colors flex items-center justify-center gap-2 ${
                        isSyncLinked 
                          ? 'bg-slate-800 text-emerald-400 cursor-default border border-emerald-900'
                          : 'bg-blue-600 hover:bg-blue-500 text-white'
                      }`}
                    >
                      {isSyncLinked ? (
                        <> <Icons.Up size={18} className="rotate-0" /> Archivo Vinculado Correctamente </>
                      ) : (
                        <> <Icons.Wallet size={18} /> Seleccionar / Crear Archivo Local </>
                      )}
                    </button>
                )}
             </div>
           </div>
        </Card>

        {/* MANUAL BACKUP SECTION */}
        <Card title="Copia de Seguridad Manual (Base de Datos)">
           <div className="space-y-4">
              <div className="flex flex-col sm:flex-row gap-4">
                 {/* EXPORT DB */}
                 <button 
                    onClick={handleExportDB}
                    className="flex-1 bg-slate-700 hover:bg-slate-600 text-white px-4 py-3 rounded-lg flex items-center justify-center gap-2 font-medium transition-colors border border-slate-600"
                 >
                    <Icons.Arrow size={18} className="rotate-90" />
                    Descargar Copia Manual (.json)
                 </button>

                 {/* IMPORT DB */}
                 <input 
                    type="file" 
                    ref={backupInputRef}
                    accept=".json"
                    onChange={handleImportDB}
                    className="hidden"
                 />
                 <button 
                    onClick={() => backupInputRef.current?.click()}
                    className="flex-1 bg-slate-700 hover:bg-slate-600 text-white px-4 py-3 rounded-lg flex items-center justify-center gap-2 font-medium transition-colors border border-slate-600"
                 >
                    <Icons.Add size={18} className="rotate-45" />
                    Restaurar Copia Manual
                 </button>
              </div>
           </div>
        </Card>

        {/* PRICE FEED CONFIGURATION */}
        <Card title="Fuente de Datos (Google Sheets)">
           <div className="space-y-4">
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
        
        {/* IMPORT / EXPORT EXCEL */}
        <Card title="Herramientas Excel (Operativas)">
          <div className="space-y-4">
            <div className="flex flex-col sm:flex-row items-center gap-4">
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
                  className="w-full sm:w-auto flex-1 bg-emerald-600 hover:bg-emerald-500 text-white px-4 py-3 rounded-lg flex items-center justify-center gap-2 font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
               >
                 {isImporting ? (
                   <span>Procesando...</span>
                 ) : (
                   <>
                     <Icons.Add size={18} className="rotate-45" />
                     Subir Excel Transacciones
                   </>
                 )}
               </button>

               <button 
                  onClick={handleExportExcel}
                  className="w-full sm:w-auto flex-1 bg-emerald-600 hover:bg-emerald-500 text-white px-4 py-3 rounded-lg flex items-center justify-center gap-2 font-medium transition-colors"
               >
                  <Icons.Arrow size={18} className="rotate-90" />
                  Descargar Excel Transacciones
               </button>
            </div>
          </div>
        </Card>

        {/* DANGER ZONE */}
        <Card title="Gestión de Datos" className="md:col-span-2">
            <div className="space-y-4">
              <div className="pt-2 space-y-3 md:flex md:space-y-0 md:gap-4">
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
  );
};

export default SettingsView;
