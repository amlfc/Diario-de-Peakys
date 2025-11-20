
import React, { useState, useEffect } from 'react';
import { calculatePositionsAndMetrics } from './services/marketDataService';
import { Position, DashboardMetrics, PortfolioOwner, Transaction } from './types';
import { seedDatabase, db } from './db';
import { autoSyncService } from './services/autoSyncService';
import Dashboard from './components/Dashboard';
import PositionsTable from './components/PositionsTable';
import TransactionForm from './components/TransactionForm';
import TransactionsHistory from './components/TransactionsHistory'; 
import Diversification from './components/Diversification';
import FundamentalRefTable from './components/FundamentalRef';
import SettingsView from './components/SettingsView';
import LiquidityManager from './components/LiquidityManager';
import ClosedOperationsAnalysis from './components/ClosedOperationsAnalysis'; // New Import
import { Icons } from './components/ui/Icons';
import { useLiveQuery } from 'dexie-react-hooks'; 

// Main Layout Components inside App to keep single file structure clean where possible
const SidebarItem = ({ icon: Icon, label, active, onClick }: any) => (
  <button 
    onClick={onClick}
    className={`w-full flex items-center gap-3 px-4 py-3 text-sm font-medium rounded-lg transition-all ${
      active ? 'bg-blue-600 text-white shadow-lg shadow-blue-900/20' : 'text-slate-400 hover:bg-slate-800 hover:text-slate-200'
    }`}
  >
    <Icon size={18} />
    <span>{label}</span>
  </button>
);

const MobileNavItem = ({ icon: Icon, label, active, onClick }: any) => (
  <button 
    onClick={onClick}
    className={`flex flex-col items-center justify-center w-full py-2 transition-colors ${
      active ? 'text-blue-500' : 'text-slate-500 hover:text-slate-400'
    }`}
  >
    <Icon size={20} />
    <span className="text-[10px] font-medium mt-0.5">{label}</span>
  </button>
);

const App: React.FC = () => {
  const [activeTab, setActiveTab] = useState<'dashboard' | 'positions' | 'transactions' | 'liquidity' | 'analysis' | 'settings'>('dashboard');
  const [selectedPortfolio, setSelectedPortfolio] = useState<PortfolioOwner | 'ALL'>('ALL');
  
  // Logic for showing form (Create or Edit)
  const [isFormVisible, setIsFormVisible] = useState(false);
  const [editingTransaction, setEditingTransaction] = useState<Transaction | undefined>(undefined);
  
  // Logic for Analysis Sub-tabs
  const [showDeepAnalysis, setShowDeepAnalysis] = useState(false);

  // State for calculated data
  const [positions, setPositions] = useState<Position[]>([]);
  const [metrics, setMetrics] = useState<DashboardMetrics>({
    totalValueEur: 0, totalCostEur: 0, unrealizedPnLEur: 0, unrealizedPnLPct: 0,
    totalLiquidityAddedEur: 0, realizedPnLEur: 0, totalReturnPct: 0, projectedCloseEur: 0
  });

  // Live queries
  const transactionsTrigger = useLiveQuery(() => db.transactions.toArray());
  const liquidityTrigger = useLiveQuery(() => db.liquidity.toArray());
  const portfolios = useLiveQuery(() => db.portfolios.toArray()) || [];
  const allTransactions = useLiveQuery(() => {
      if (selectedPortfolio === 'ALL') return db.transactions.toArray();
      return db.transactions.where('portfolio').equals(selectedPortfolio).toArray();
  }, [selectedPortfolio]) || [];

  useEffect(() => {
    seedDatabase();
    autoSyncService.init(); // Initialize auto-sync service after DB is ready
  }, []);

  // Refresh data loop (simulating live market + reaction to DB changes)
  useEffect(() => {
    const refresh = async () => {
      const data = await calculatePositionsAndMetrics(selectedPortfolio);
      setPositions(data.activePositions);
      setMetrics(data.dashboard);
    };
    
    refresh();

    // Simulate live price ticking every 5 seconds
    const interval = setInterval(refresh, 5000);
    return () => clearInterval(interval);
  }, [selectedPortfolio, transactionsTrigger, liquidityTrigger]); 

  // Handlers
  const handleAddNew = () => {
    setEditingTransaction(undefined);
    setIsFormVisible(true);
    setActiveTab('transactions');
  };

  const handleEditTransaction = (tx: Transaction) => {
    setEditingTransaction(tx);
    setIsFormVisible(true);
    // Ensure we are on the tab, though likely already there
    setActiveTab('transactions'); 
    // Scroll to top to see form
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleFormClose = () => {
    setIsFormVisible(false);
    setEditingTransaction(undefined);
  };

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

      alert("Copia de seguridad descargada correctamente. (Incluye configuración de Google Sheets)");

    } catch (error) {
      console.error("Error exportando DB:", error);
      alert("Error al generar el archivo de base de datos.");
    }
  };

  return (
    <div className="flex h-screen bg-slate-900 overflow-hidden">
      {/* Sidebar */}
      <aside className="w-64 bg-slate-900 border-r border-slate-800 hidden md:flex flex-col">
        <div className="p-6 border-b border-slate-800">
          <h1 className="text-xl font-bold text-white flex items-center gap-2">
            <Icons.Settings className="text-blue-500" />
            Diario de <span className="text-slate-500 font-light">Peakys</span>
          </h1>
        </div>
        
        <div className="p-4 space-y-2 flex-1 overflow-y-auto">
          <div className="mb-6">
            <p className="px-4 text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Menu Principal</p>
            <SidebarItem icon={Icons.Dashboard} label="Dashboard" active={activeTab === 'dashboard'} onClick={() => setActiveTab('dashboard')} />
            <SidebarItem icon={Icons.Positions} label="Posiciones Abiertas" active={activeTab === 'positions'} onClick={() => setActiveTab('positions')} />
            <SidebarItem icon={Icons.Transactions} label="Transacciones" active={activeTab === 'transactions'} onClick={() => setActiveTab('transactions')} />
            <SidebarItem icon={Icons.Liquidity} label="Gestión de Liquidez" active={activeTab === 'liquidity'} onClick={() => setActiveTab('liquidity')} />
            <SidebarItem icon={Icons.Diversification} label="Análisis" active={activeTab === 'analysis'} onClick={() => setActiveTab('analysis')} />
          </div>
        </div>

        <div className="p-4 border-t border-slate-800">
           <button 
             onClick={() => setActiveTab('settings')}
             className={`flex items-center gap-2 w-full px-2 py-2 text-sm transition-colors rounded-lg ${activeTab === 'settings' ? 'text-blue-400 bg-slate-800' : 'text-slate-400 hover:text-white hover:bg-slate-800/50'}`}
           >
             <Icons.Settings size={16} /> Configuración Global
           </button>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col overflow-hidden relative">
        {/* Topbar */}
        <header className="h-16 border-b border-slate-800 bg-slate-900/80 backdrop-blur-md flex items-center justify-between px-4 sm:px-6 z-10">
          <div className="flex items-center gap-2 sm:gap-4 flex-1 min-w-0">
            {/* Portfolio Switcher */}
            <select 
              value={selectedPortfolio}
              onChange={(e) => setSelectedPortfolio(e.target.value as any)}
              className="bg-slate-800 text-white text-sm rounded-lg border border-slate-700 px-2 py-2 sm:px-3 focus:ring-2 focus:ring-blue-500 outline-none max-w-[160px] sm:max-w-[200px] truncate"
            >
              <option value="ALL">Todas las Carteras</option>
              {portfolios.map(p => (
                <option key={p.id} value={p.name}>{p.name}</option>
              ))}
            </select>
          </div>
          
          <div className="flex items-center gap-3">
             {/* Quick Save Button */}
             <button 
               onClick={handleExportDB}
               className="text-slate-400 hover:text-white transition-colors p-2"
               title="Guardar Copia de Seguridad (JSON)"
             >
               <Icons.Save size={20} />
             </button>

             {/* Mobile Settings Button */}
             <button 
               onClick={() => setActiveTab('settings')}
               className="md:hidden text-slate-400 hover:text-white transition-colors p-2"
             >
               <Icons.Settings size={20} />
             </button>

             {/* Add Button */}
             <button 
               onClick={handleAddNew}
               className="bg-blue-600 hover:bg-blue-500 text-white p-2 sm:px-4 sm:py-2 rounded-lg text-sm font-medium flex items-center gap-2 transition-colors"
             >
               <Icons.Add size={20} />
               <span className="hidden sm:inline">Nueva Operación</span>
             </button>
          </div>
        </header>

        {/* Content Scroll Area */}
        <div className="flex-1 overflow-y-auto p-4 pb-24 md:p-8 md:pb-8 scroll-smooth">
          <div className="max-w-7xl mx-auto space-y-8">
            
            {activeTab === 'dashboard' && (
              <>
                <Dashboard 
                  metrics={metrics} 
                  selectedPortfolio={selectedPortfolio} 
                  positions={positions}
                  onNavigate={(tab) => setActiveTab(tab as any)}
                />
                {/* Full width Diversification below chart */}
                <div className="w-full">
                  <Diversification positions={positions} metrics={metrics} selectedPortfolio={selectedPortfolio} />
                </div>
              </>
            )}

            {activeTab === 'positions' && (
              <PositionsTable positions={positions} />
            )}

            {activeTab === 'transactions' && (
              <div className="space-y-6">
                {isFormVisible && (
                  <TransactionForm 
                    onSuccess={handleFormClose} 
                    onCancel={handleFormClose}
                    initialData={editingTransaction} 
                  />
                )}
                
                <TransactionsHistory 
                  selectedPortfolio={selectedPortfolio} 
                  onEdit={handleEditTransaction} 
                />
              </div>
            )}

            {activeTab === 'liquidity' && (
              <LiquidityManager />
            )}

            {activeTab === 'analysis' && (
               <div className="flex flex-col gap-6">
                  {/* Toggle Buttons */}
                  <div className="flex bg-slate-800 p-1 rounded-lg w-fit border border-slate-700">
                      <button 
                        onClick={() => setShowDeepAnalysis(false)}
                        className={`px-4 py-2 text-sm font-medium rounded-md transition-all ${!showDeepAnalysis ? 'bg-slate-600 text-white shadow' : 'text-slate-400 hover:text-white'}`}
                      >
                        Diversificación
                      </button>
                      <button 
                        onClick={() => setShowDeepAnalysis(true)}
                        className={`px-4 py-2 text-sm font-medium rounded-md transition-all flex items-center gap-2 ${showDeepAnalysis ? 'bg-slate-600 text-white shadow' : 'text-slate-400 hover:text-white'}`}
                      >
                        <Icons.Chart size={16} /> Histórico Cerradas
                      </button>
                  </div>

                  {showDeepAnalysis ? (
                      <ClosedOperationsAnalysis transactions={allTransactions} />
                  ) : (
                      <>
                        <Diversification positions={positions} metrics={metrics} selectedPortfolio={selectedPortfolio} />
                        <FundamentalRefTable />
                      </>
                  )}
               </div>
            )}

            {activeTab === 'settings' && (
              <SettingsView />
            )}

          </div>
        </div>

        {/* Mobile Bottom Navigation */}
        <div className="md:hidden fixed bottom-0 left-0 w-full bg-slate-900 border-t border-slate-800 flex justify-around items-center px-2 py-1 z-50">
           <MobileNavItem icon={Icons.Dashboard} label="Inicio" active={activeTab === 'dashboard'} onClick={() => setActiveTab('dashboard')} />
           <MobileNavItem icon={Icons.Positions} label="Posiciones" active={activeTab === 'positions'} onClick={() => setActiveTab('positions')} />
           <MobileNavItem icon={Icons.Transactions} label="Transac." active={activeTab === 'transactions'} onClick={() => setActiveTab('transactions')} />
           <MobileNavItem icon={Icons.Liquidity} label="Liquidez" active={activeTab === 'liquidity'} onClick={() => setActiveTab('liquidity')} />
           <MobileNavItem icon={Icons.Diversification} label="Análisis" active={activeTab === 'analysis'} onClick={() => setActiveTab('analysis')} />
        </div>
      </main>
    </div>
  );
};

export default App;
