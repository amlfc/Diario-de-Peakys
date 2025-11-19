
import React, { useState, useEffect } from 'react';
import { calculatePositionsAndMetrics } from './services/marketDataService';
import { Position, DashboardMetrics, PortfolioOwner, Transaction } from './types';
import { seedDatabase, db } from './db';
import { autoSyncService } from './services/autoSyncService';
import Dashboard from './components/Dashboard';
import PositionsTable from './components/PositionsTable';
import TransactionForm from './components/TransactionForm';
import TransactionsHistory from './components/TransactionsHistory'; // New Import
import Diversification from './components/Diversification';
import FundamentalRefTable from './components/FundamentalRef';
import SettingsView from './components/SettingsView';
import LiquidityManager from './components/LiquidityManager';
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

const App: React.FC = () => {
  const [activeTab, setActiveTab] = useState<'dashboard' | 'positions' | 'transactions' | 'liquidity' | 'analysis' | 'settings'>('dashboard');
  const [selectedPortfolio, setSelectedPortfolio] = useState<PortfolioOwner | 'ALL'>('ALL');
  
  // Logic for showing form (Create or Edit)
  const [isFormVisible, setIsFormVisible] = useState(false);
  const [editingTransaction, setEditingTransaction] = useState<Transaction | undefined>(undefined);
  
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
          </div>
          
          <div className="mb-6">
            <p className="px-4 text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Análisis</p>
            <SidebarItem icon={Icons.Diversification} label="Diversificación" active={activeTab === 'analysis'} onClick={() => setActiveTab('analysis')} />
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
      <main className="flex-1 flex flex-col overflow-hidden">
        {/* Topbar */}
        <header className="h-16 border-b border-slate-800 bg-slate-900/80 backdrop-blur-md flex items-center justify-between px-6 z-10">
          <div className="flex items-center gap-4">
            {/* Portfolio Switcher */}
            <select 
              value={selectedPortfolio}
              onChange={(e) => setSelectedPortfolio(e.target.value as any)}
              className="bg-slate-800 text-white text-sm rounded-lg border border-slate-700 px-3 py-2 focus:ring-2 focus:ring-blue-500 outline-none max-w-[200px]"
            >
              <option value="ALL">Todas las Carteras</option>
              {portfolios.map(p => (
                <option key={p.id} value={p.name}>{p.name}</option>
              ))}
            </select>
          </div>
          
          <button 
            onClick={handleAddNew}
            className="bg-blue-600 hover:bg-blue-500 text-white px-4 py-2 rounded-lg text-sm font-medium flex items-center gap-2 transition-colors"
          >
            <Icons.Add size={16} />
            <span className="hidden sm:inline">Nueva Operación</span>
          </button>
        </header>

        {/* Content Scroll Area */}
        <div className="flex-1 overflow-y-auto p-4 md:p-8 scroll-smooth">
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
               <div className="grid grid-cols-1 gap-6">
                  <Diversification positions={positions} metrics={metrics} selectedPortfolio={selectedPortfolio} />
                  <FundamentalRefTable />
               </div>
            )}

            {activeTab === 'settings' && (
              <SettingsView />
            )}

          </div>
        </div>
      </main>
    </div>
  );
};

export default App;
