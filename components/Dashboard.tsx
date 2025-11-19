
import React from 'react';
import { DashboardMetrics, PortfolioOwner, Position } from '../types';
import { StatCard, Card } from './ui/Card';
import { Icons } from './ui/Icons';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Cell, Legend, ReferenceLine } from 'recharts';

interface DashboardProps {
  metrics: DashboardMetrics;
  selectedPortfolio: PortfolioOwner | 'ALL';
  positions?: Position[];
  onNavigate: (tab: string) => void;
}

const Dashboard: React.FC<DashboardProps> = ({ metrics, selectedPortfolio, positions = [], onNavigate }) => {
  const formatCurrency = (val: number) => 
    new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(val);
  
  const formatPct = (val: number) => 
    new Intl.NumberFormat('es-ES', { style: 'percent', minimumFractionDigits: 2 }).format(val);

  const isProfitable = metrics.totalReturnPct >= 0;
  const totalEquity = metrics.totalValueEur + metrics.availableCashEur;

  // Prepare Data for Cost vs Value Chart
  // We sort by Current Value to show the most significant positions first
  const performanceData = positions
    .sort((a, b) => b.currentValueEur - a.currentValueEur)
    .map(p => ({
      ticker: p.ticker,
      assetName: p.assetName,
      cost: p.totalCostEur,
      value: p.currentValueEur,
      pnl: p.unrealizedPnLEur,
      pct: p.unrealizedPnLPct
    }));

  // Custom Tooltip for the Chart
  const CustomTooltip = ({ active, payload, label }: any) => {
    if (active && payload && payload.length) {
      const data = payload[0].payload;
      const isProfit = data.pnl >= 0;
      return (
        <div className="bg-slate-800 border border-slate-600 p-3 rounded shadow-xl text-sm">
          <p className="font-bold text-white mb-2">{label} <span className="text-slate-400 font-normal text-xs">({data.assetName})</span></p>
          <p className="text-slate-300">Coste (Inc. Comis.): <span className="text-white font-mono">{formatCurrency(data.cost)}</span></p>
          <p className="text-slate-300">Valor Actual: <span className="text-white font-mono">{formatCurrency(data.value)}</span></p>
          <div className="mt-2 pt-2 border-t border-slate-600 flex justify-between gap-4">
            <span className="text-slate-400">Rendimiento:</span>
            <span className={`font-bold font-mono ${isProfit ? 'text-emerald-400' : 'text-rose-400'}`}>
              {formatCurrency(data.pnl)} ({formatPct(data.pct)})
            </span>
          </div>
        </div>
      );
    }
    return null;
  };

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold text-white">
          Resumen: <span className="text-blue-400">{selectedPortfolio === 'ALL' ? 'Global' : selectedPortfolio}</span>
        </h2>
        <div className="flex gap-2">
           <button onClick={() => onNavigate('positions')} className="text-sm text-blue-400 hover:underline">Ver Tabla Completa</button>
        </div>
      </div>

      {/* KPI Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        
        {/* 1. Patrimonio Total (Net Worth) */}
        <StatCard 
          title="Patrimonio Total"
          value={formatCurrency(totalEquity)}
          subValue={`Retorno Global: ${formatPct(metrics.totalReturnPct)}`}
          trend={isProfitable ? 'up' : 'down'}
          icon={<Icons.Wallet size={20} />}
        />

        {/* 2. Liquidez (Cash) */}
        <StatCard 
          title="Liquidez Disponible"
          value={formatCurrency(metrics.availableCashEur)}
          subValue={`(Aportado + G/P) - Invertido`}
          trend="neutral"
          icon={<Icons.Liquidity size={20} />}
        />

        {/* 3. Activos (Assets) */}
        <StatCard 
          title="Valor en Activos"
          value={formatCurrency(metrics.totalValueEur)}
          subValue={`Coste: ${formatCurrency(metrics.totalCostEur)} (Inc. Comis.)`}
          trend={metrics.unrealizedPnLEur >= 0 ? 'up' : 'down'}
          icon={<Icons.Dashboard size={20} />}
        />

        {/* 4. Realized PnL */}
        <StatCard 
          title="G/P Cerrada"
          value={formatCurrency(metrics.realizedPnLEur)}
          subValue="Operaciones cerradas"
          trend={metrics.realizedPnLEur >= 0 ? 'up' : 'down'}
          icon={<Icons.Transactions size={20} />}
        />
      </div>

      {/* Main Chart Section: Performance Cost vs Value */}
      <Card title="Rendimiento por Posición (Coste vs Valor Actual)">
        <div className="h-80 w-full">
          {performanceData.length > 0 ? (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart 
                data={performanceData} 
                margin={{ top: 20, right: 30, left: 20, bottom: 5 }}
                barGap={2}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="#334155" vertical={false} />
                <XAxis 
                  dataKey="ticker" 
                  tick={{ fill: '#94a3b8', fontSize: 12 }} 
                  axisLine={{ stroke: '#475569' }}
                />
                <YAxis 
                  tick={{ fill: '#94a3b8', fontSize: 12 }} 
                  axisLine={{ stroke: '#475569' }}
                  tickFormatter={(val) => `${val/1000}k`}
                />
                <Tooltip content={<CustomTooltip />} cursor={{fill: '#334155', opacity: 0.2}} />
                <Legend verticalAlign="top" height={36} wrapperStyle={{ color: '#cbd5e1' }}/>
                
                {/* Cost Bar (Neutral Grey) */}
                <Bar dataKey="cost" name="Coste Base" fill="#64748b" radius={[4, 4, 0, 0]} />
                
                {/* Value Bar (Colored by Profit/Loss) */}
                <Bar dataKey="value" name="Valor Actual" radius={[4, 4, 0, 0]}>
                  {performanceData.map((entry, index) => (
                    <Cell 
                      key={`cell-${index}`} 
                      fill={entry.pnl >= 0 ? '#10b981' : '#ef4444'} // Emerald-500 vs Red-500
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-full flex items-center justify-center text-slate-500 text-sm">
              No hay posiciones abiertas para mostrar rendimiento.
            </div>
          )}
        </div>
        <p className="text-xs text-center text-slate-500 mt-2">
          * La barra de color indica el Valor Actual (Verde = Ganancia, Rojo = Pérdida). La barra gris indica el Coste (Precio + Comisiones).
        </p>
      </Card>

    </div>
  );
};

export default Dashboard;
