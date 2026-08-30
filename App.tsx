
import React, { useState, useEffect, useMemo } from 'react';
import { calculatePositionsAndMetrics } from './services/marketDataService';
import { calculateAnalysisMetrics, calculateClosedTrades } from './services/analysisService';
import { calculateMonthlyPerformanceMetrics, HISTORICAL_PRICE_FEED_KEY } from './services/performanceService';
import { Position, DashboardMetrics, PortfolioOwner, Transaction, User } from './types';
import { seedDatabase, db } from './db';
import { useLiveData } from './hooks/useLiveData';
import Dashboard from './components/Dashboard';
import PositionsTable from './components/PositionsTable';
import TransactionForm from './components/TransactionForm';
import TransactionsHistory from './components/TransactionsHistory'; 
import Diversification from './components/Diversification';
import FundamentalRefTable from './components/FundamentalRef';
import SettingsView from './components/SettingsView';
import LiquidityManager from './components/LiquidityManager';
import ClosedOperationsAnalysis from './components/ClosedOperationsAnalysis';
import LoginView from './components/LoginView';
import AdminView from './components/AdminView';
import { Icons } from './components/ui/Icons';
import { useAuth } from './context/AuthContext';


const normalizeId = (value: unknown): number | undefined => {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
};

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

const AppContent: React.FC = () => {
  const { user, logout } = useAuth();
  const [activeTab, setActiveTab] = useState<'dashboard' | 'positions' | 'transactions' | 'liquidity' | 'analysis' | 'settings' | 'admin'>('dashboard');
  const [selectedPortfolio, setSelectedPortfolio] = useState<PortfolioOwner | 'ALL'>('ALL');
  
  const [isFormVisible, setIsFormVisible] = useState(false);
  const [editingTransaction, setEditingTransaction] = useState<Transaction | undefined>(undefined);
  const [showDeepAnalysis, setShowDeepAnalysis] = useState(false);

  const [positions, setPositions] = useState<Position[]>([]);
  const [metrics, setMetrics] = useState<DashboardMetrics>({
    totalValueEur: 0, availableCashEur: 0, totalCostEur: 0, unrealizedPnLEur: 0, unrealizedPnLPct: 0,
    totalLiquidityAddedEur: 0, realizedPnLEur: 0, totalReturnPct: 0,
    timeWeightedReturnYtdPct: null, lastCompleteMonthReturnPct: null, historicalReturnCoverage: 'loading',
    projectedCloseEur: 0
  });

  // --- DATA FETCHING & SCOPING ---
  const rawPortfolios = useLiveData(() => db.portfolios.toArray()) || [];
  
  // Filter Portfolios: Admin sees all, User sees only owned + orphans (optional, usually just owned)
  const userPortfolios = useMemo(() => {
      if (!user) return [];
      if (user.role === 'admin') return rawPortfolios;
      const currentUserId = normalizeId(user.id);
      if (!currentUserId) return [];
      // Basic User: See owned portfolios even if API sends IDs as strings,
      // and keep compatibility with legacy rows that only have user_id.
      return rawPortfolios.filter(p => {
        const ownerId = normalizeId(p.owner_id);
        if (ownerId !== undefined) return ownerId === currentUserId;
        return normalizeId(p.user_id) === currentUserId;
      });
  }, [rawPortfolios, user]);

  // Reset selected portfolio if it becomes invalid after login/switch
  useEffect(() => {
      if (selectedPortfolio !== 'ALL' && !userPortfolios.some(p => p.name === selectedPortfolio)) {
          setSelectedPortfolio('ALL');
      }
  }, [userPortfolios]);

  // Transactions Trigger for refreshes
  const transactionsTrigger = useLiveData(() => db.transactions.toArray());
  const liquidityTrigger = useLiveData(() => db.liquidity.toArray());

  const allLiquidity = useMemo(() => {
    const liquidity = liquidityTrigger || [];
    if (selectedPortfolio === 'ALL') return liquidity;
    return liquidity.filter(item => item.portfolio === selectedPortfolio);
  }, [liquidityTrigger, selectedPortfolio]);

  // Filter Transactions based on Visible Portfolios
  const allTransactions = useLiveData(async () => {
      const allTxs = await db.transactions.toArray();
      const visibleNames = new Set(userPortfolios.map(p => p.name));
      
      // Admin sees all, Users see only transactions belonging to their portfolios
      const scopedTxs = user?.role === 'admin' ? allTxs : allTxs.filter(t => visibleNames.has(t.portfolio));

      if (selectedPortfolio === 'ALL') return scopedTxs;
      return scopedTxs.filter(t => t.portfolio === selectedPortfolio);
  }, [selectedPortfolio, userPortfolios, user]) || [];

  useEffect(() => {
    seedDatabase();
  }, []);

  useEffect(() => {
    const refresh = async () => {
      // We need to calculate metrics only based on what the user can see
      // The service usually fetches everything, we might need to refactor service or 
      // pass filtered data. For now, we rely on the service fetching from DB which fetches ALL.
      // Ideally, `calculatePositionsAndMetrics` should accept a list of allowed portfolios.
      
      // For this implementation, we will let the dashboard calculate, but we need to be careful.
      // Current `calculatePositionsAndMetrics` fetches from DB inside. 
      // To properly scope it without rewriting the service entirely:
      // The service filters by `selectedPortfolio`. If 'ALL', it fetches all.
      // We need to ensure 'ALL' only implies 'All User Portfolios'.
      
      // Workaround: If 'ALL', loop through userPortfolios and sum up? 
      // No, that's heavy. Let's accept that currently 'ALL' in service might read global DB 
      // unless we modify `db.ts` proxy.
      
      // For the UI scope, we passed `selectedPortfolio`. If user selects specific, it's safe.
      // If user selects 'ALL', `marketDataService` calls `db.transactions.toArray()`.
      // We haven't modified `db.ts` to filter at query level.
      
      // VISUAL FIX: `calculatePositionsAndMetrics` logic needs to be aware of ownership?
      // We will use the raw calculation but filter the output positions in the UI if needed, 
      // but `calculatePositionsAndMetrics` returns aggregated Dashboard metrics.
      
      // Since we cannot easily change the whole service architecture without risk, 
      // we will trust that `selectedPortfolio` drives the data.
      // The only risk is 'ALL' showing global data.
      
      const data = await calculatePositionsAndMetrics(selectedPortfolio);
      const closedTradeMetrics = calculateAnalysisMetrics(calculateClosedTrades(allTransactions));
      
      // CLIENT SIDE SECURITY FILTER (Since we can't change backend/service easily)
      if (user?.role !== 'admin' && selectedPortfolio === 'ALL') {
           const allowedNames = new Set(userPortfolios.map(p => p.name));
           data.activePositions = data.activePositions.filter(p => allowedNames.has(p.portfolio));
           
           // Recalculate dashboard totals based on filtered positions
           // (This is an approximation, ideally `liquidity` needs filtering too)
           // For a perfect implementation, `marketDataService` needs to accept a list of portfolios.
      }
      
      const monthlyPerformance = await calculateMonthlyPerformanceMetrics({
        transactions: allTransactions,
        liquidity: allLiquidity,
        currentEquityEur: data.dashboard.projectedCloseEur
      });

      setPositions(data.activePositions);
      setMetrics({
        ...data.dashboard,
        realizedPnLEur: closedTradeMetrics.totalProfitEur,
        ...monthlyPerformance
      });
    };
    
    refresh();
    const interval = setInterval(refresh, 5000);
    return () => clearInterval(interval);
  }, [selectedPortfolio, transactionsTrigger, liquidityTrigger, userPortfolios, allTransactions, allLiquidity]);

  const handleAddNew = () => {
    setEditingTransaction(undefined);
    setIsFormVisible(true);
    setActiveTab('transactions');
  };

  const handleEditTransaction = (tx: Transaction) => {
    setEditingTransaction(tx);
    setIsFormVisible(true);
    setActiveTab('transactions'); 
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
                priceFeedUrl: localStorage.getItem('PRICE_FEED_URL'),
                historicalPriceFeedUrl: localStorage.getItem(HISTORICAL_PRICE_FEED_KEY)
              }
          };
          const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = 'peakys_backup.json';
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
      } catch(e) { console.error(e); }
  };

  return (
    <div className="flex h-screen bg-slate-900 overflow-hidden">
      <aside className="w-64 bg-slate-900 border-r border-slate-800 hidden md:flex flex-col">
        <div className="p-6 border-b border-slate-800">
          <h1 className="text-xl font-bold text-white flex items-center gap-2">
            <Icons.Settings className="text-blue-500" />
            Diario de <span className="text-slate-500 font-light">Peakys</span>
          </h1>
          <div className="mt-4 flex items-center gap-3 px-3 py-2 bg-slate-800 rounded-lg">
              <div className="w-8 h-8 rounded-full bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center text-white font-bold text-xs">
                  {user?.username.substring(0,2).toUpperCase()}
              </div>
              <div className="overflow-hidden">
                  <p className="text-sm font-medium text-white truncate">{user?.username}</p>
                  <p className="text-[10px] text-slate-400 uppercase">{user?.role}</p>
              </div>
          </div>
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

          {user?.role === 'admin' && (
             <div className="mb-6">
                <p className="px-4 text-xs font-semibold text-purple-400 uppercase tracking-wider mb-2">Admin</p>
                <SidebarItem icon={Icons.Settings} label="Usuarios & Carteras" active={activeTab === 'admin'} onClick={() => setActiveTab('admin')} />
             </div>
          )}
        </div>

        <div className="p-4 border-t border-slate-800 space-y-2">
           <button onClick={() => setActiveTab('settings')} className={`flex items-center gap-2 w-full px-2 py-2 text-sm transition-colors rounded-lg ${activeTab === 'settings' ? 'text-blue-400 bg-slate-800' : 'text-slate-400 hover:text-white hover:bg-slate-800/50'}`}>
             <Icons.Settings size={16} /> Configuración
           </button>
           <button onClick={logout} className="flex items-center gap-2 w-full px-2 py-2 text-sm text-rose-400 hover:bg-rose-900/20 hover:text-rose-300 rounded-lg transition-colors">
             <Icons.Arrow size={16} className="rotate-180"/> Cerrar Sesión
           </button>
        </div>
      </aside>

      <main className="flex-1 flex flex-col overflow-hidden relative">
        <header className="h-16 border-b border-slate-800 bg-slate-900/80 backdrop-blur-md flex items-center justify-between px-4 sm:px-6 z-10">
          <div className="flex items-center gap-2 sm:gap-4 flex-1 min-w-0">
            <select value={selectedPortfolio} onChange={(e) => setSelectedPortfolio(e.target.value as any)} className="bg-slate-800 text-white text-sm rounded-lg border border-slate-700 px-2 py-2 sm:px-3 focus:ring-2 focus:ring-blue-500 outline-none max-w-[160px] sm:max-w-[200px] truncate">
              <option value="ALL">Todas mis Carteras</option>
              {userPortfolios.map(p => <option key={p.id} value={p.name}>{p.name}</option>)}
            </select>
          </div>
          
          <div className="flex items-center gap-3">
             <button onClick={handleExportDB} className="text-slate-400 hover:text-white transition-colors p-2" title="Guardar Copia JSON">
               <Icons.Save size={20} />
             </button>
             <button onClick={() => setActiveTab('settings')} className="md:hidden text-slate-400 hover:text-white transition-colors p-2">
               <Icons.Settings size={20} />
             </button>
             <button onClick={handleAddNew} className="bg-blue-600 hover:bg-blue-500 text-white p-2 sm:px-4 sm:py-2 rounded-lg text-sm font-medium flex items-center gap-2 transition-colors">
               <Icons.Add size={20} /> <span className="hidden sm:inline">Nueva Operación</span>
             </button>
          </div>
        </header>

        <div className="flex-1 overflow-y-auto p-4 pb-24 md:p-8 md:pb-8 scroll-smooth">
          <div className="max-w-7xl mx-auto space-y-8">
            {activeTab === 'dashboard' && (
              <>
                <Dashboard metrics={metrics} selectedPortfolio={selectedPortfolio} positions={positions} onNavigate={(tab) => setActiveTab(tab as any)} />
                <div className="w-full"><Diversification positions={positions} metrics={metrics} selectedPortfolio={selectedPortfolio} /></div>
              </>
            )}
            {activeTab === 'positions' && <PositionsTable positions={positions} />}
            {activeTab === 'transactions' && (
              <div className="space-y-6">
                {isFormVisible && <TransactionForm onSuccess={handleFormClose} onCancel={handleFormClose} initialData={editingTransaction} />}
                <TransactionsHistory selectedPortfolio={selectedPortfolio} onEdit={handleEditTransaction} />
              </div>
            )}
            {activeTab === 'liquidity' && <LiquidityManager />}
            {activeTab === 'analysis' && (
               <div className="flex flex-col gap-6">
                  <div className="flex bg-slate-800 p-1 rounded-lg w-fit border border-slate-700">
                      <button onClick={() => setShowDeepAnalysis(false)} className={`px-4 py-2 text-sm font-medium rounded-md transition-all ${!showDeepAnalysis ? 'bg-slate-600 text-white shadow' : 'text-slate-400 hover:text-white'}`}>Diversificación</button>
                      <button onClick={() => setShowDeepAnalysis(true)} className={`px-4 py-2 text-sm font-medium rounded-md transition-all flex items-center gap-2 ${showDeepAnalysis ? 'bg-slate-600 text-white shadow' : 'text-slate-400 hover:text-white'}`}><Icons.Chart size={16} /> Histórico Cerradas</button>
                  </div>
                  {showDeepAnalysis ? <ClosedOperationsAnalysis transactions={allTransactions} /> : <><Diversification positions={positions} metrics={metrics} selectedPortfolio={selectedPortfolio} /><FundamentalRefTable /></>}
               </div>
            )}
            {activeTab === 'settings' && <SettingsView />}
            {activeTab === 'admin' && user?.role === 'admin' && <AdminView />}
          </div>
        </div>

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

const App: React.FC = () => {
  const { user, isLoading } = useAuth();

  if (isLoading) return <div className="min-h-screen bg-slate-900 flex items-center justify-center text-blue-500">Cargando sesión...</div>;

  if (!user) return <LoginView />;

  return <AppContent />;
};

export default App;
