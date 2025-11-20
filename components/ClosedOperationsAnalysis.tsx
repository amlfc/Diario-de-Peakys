
import React, { useMemo, useState } from 'react';
import { Transaction } from '../types';
import { 
  calculateClosedTrades, 
  calculateAnalysisMetrics, 
  exportAnalysisToExcel, 
  exportAnalysisToPDF 
} from '../services/analysisService';
import { Card, StatCard } from './ui/Card';
import { Icons } from './ui/Icons';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Cell, ReferenceLine, AreaChart, Area } from 'recharts';

interface Props {
  transactions: Transaction[];
}

const ClosedOperationsAnalysis: React.FC<Props> = ({ transactions }) => {
  const [timeRange, setTimeRange] = useState<'ALL' | 'YTD' | '12M'>('ALL');

  // 1. Calculate Data
  const allClosedTrades = useMemo(() => calculateClosedTrades(transactions), [transactions]);

  // 2. Filter by Time Range
  const filteredTrades = useMemo(() => {
    if (timeRange === 'ALL') return allClosedTrades;
    const now = new Date();
    const cutoff = new Date();
    
    if (timeRange === 'YTD') {
        cutoff.setMonth(0, 1); // Jan 1st
    } else {
        cutoff.setMonth(now.getMonth() - 12); // 12 Months ago
    }

    return allClosedTrades.filter(t => new Date(t.date) >= cutoff);
  }, [allClosedTrades, timeRange]);

  // 3. Metrics
  const metrics = useMemo(() => calculateAnalysisMetrics(filteredTrades), [filteredTrades]);

  // 4. Chart Data Preparation
  const chartData = useMemo(() => {
     // Group by Month
     const grouped = new Map<string, { date: string, pnl: number, accumulated: number }>();
     
     // Sort oldest to newest for accumulation
     const chronological = [...filteredTrades].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
     
     let runningTotal = 0;

     chronological.forEach(t => {
         const monthKey = t.date.substring(0, 7); // YYYY-MM
         const curr = grouped.get(monthKey) || { date: monthKey, pnl: 0, accumulated: 0 };
         curr.pnl += t.netPnLEur;
         grouped.set(monthKey, curr);
     });

     // Calculate accumulation sequentially over months
     const result: any[] = [];
     Array.from(grouped.values()).forEach(item => {
         runningTotal += item.pnl;
         item.accumulated = runningTotal;
         result.push(item);
     });
     
     return result;
  }, [filteredTrades]);

  const formatCurrency = (val: number) => 
    new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(val);

  return (
    <div className="space-y-6 animate-fade-in">
      
      {/* HEADER & CONTROLS */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
             <h2 className="text-xl font-bold text-white flex items-center gap-2">
                 <Icons.Chart className="text-purple-400" /> Análisis de Operaciones Cerradas
             </h2>
             <p className="text-xs text-slate-400 mt-1">Rendimiento histórico basado en operaciones finalizadas (Realized P&L).</p>
        </div>

        <div className="flex flex-wrap gap-2">
            {/* Time Filters */}
            <div className="flex bg-slate-800 rounded-lg p-1 border border-slate-700">
                {(['ALL', 'YTD', '12M'] as const).map(r => (
                    <button 
                      key={r}
                      onClick={() => setTimeRange(r)}
                      className={`px-3 py-1 text-xs font-medium rounded transition-colors ${timeRange === r ? 'bg-slate-600 text-white' : 'text-slate-400 hover:text-slate-200'}`}
                    >
                        {r === 'ALL' ? 'Todo' : r}
                    </button>
                ))}
            </div>

            {/* Exports */}
            <button 
              onClick={() => exportAnalysisToExcel(filteredTrades, metrics)}
              className="bg-emerald-700/20 hover:bg-emerald-700/40 text-emerald-400 border border-emerald-700/50 px-3 py-1.5 rounded-lg text-sm font-medium flex items-center gap-2 transition-colors"
            >
               <Icons.Excel size={16} /> Excel
            </button>
            <button 
              onClick={() => exportAnalysisToPDF(filteredTrades, metrics)}
              className="bg-rose-700/20 hover:bg-rose-700/40 text-rose-400 border border-rose-700/50 px-3 py-1.5 rounded-lg text-sm font-medium flex items-center gap-2 transition-colors"
            >
               <Icons.PDF size={16} /> PDF Informe
            </button>
        </div>
      </div>

      {/* KPI CARDS */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
          <StatCard title="Beneficio Neto" value={formatCurrency(metrics.totalProfitEur)} trend={metrics.totalProfitEur >= 0 ? 'up' : 'down'} />
          <StatCard title="Win Rate" value={(metrics.winRate * 100).toFixed(1) + '%'} subValue={`${metrics.totalTrades} Ops`} trend={metrics.winRate > 0.5 ? 'up' : 'neutral'} />
          <StatCard title="Profit Factor" value={metrics.profitFactor.toFixed(2)} trend={metrics.profitFactor > 1.5 ? 'up' : 'neutral'} />
          <StatCard title="Avg Ganancia" value={formatCurrency(metrics.avgWinEur)} subValue="En ganadoras" trend="up" />
          <StatCard title="Avg Pérdida" value={formatCurrency(metrics.avgLossEur)} subValue="En perdedoras" trend="down" />
          <StatCard title="Mejor Op." value={metrics.bestTrade ? formatCurrency(metrics.bestTrade.netPnLEur) : '-'} subValue={metrics.bestTrade?.ticker || '-'} icon={<Icons.Target size={16}/>} />
      </div>

      {/* CHARTS ROW */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
         {/* Monthly P&L */}
         <Card title="P&L Mensual (Realizado)">
             <div className="h-64 w-full">
                <ResponsiveContainer width="100%" height="100%">
                   <BarChart data={chartData} margin={{top: 10, right: 10, left: 0, bottom: 0}}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#334155" vertical={false} />
                      <XAxis dataKey="date" tick={{fill: '#94a3b8', fontSize: 10}} axisLine={{stroke: '#475569'}} />
                      <YAxis tick={{fill: '#94a3b8', fontSize: 10}} axisLine={{stroke: '#475569'}} tickFormatter={(val) => `${val/1000}k`}/>
                      <Tooltip 
                        contentStyle={{backgroundColor: '#1e293b', borderColor: '#334155', color: '#fff'}}
                        formatter={(val: number) => formatCurrency(val)}
                        labelStyle={{color: '#94a3b8'}}
                      />
                      <ReferenceLine y={0} stroke="#cbd5e1" />
                      <Bar dataKey="pnl" radius={[2, 2, 0, 0]}>
                        {chartData.map((entry, index) => (
                            <Cell key={`cell-${index}`} fill={entry.pnl >= 0 ? '#10b981' : '#ef4444'} />
                        ))}
                      </Bar>
                   </BarChart>
                </ResponsiveContainer>
             </div>
         </Card>

         {/* Equity Curve (Accumulated) */}
         <Card title="Curva de Equidad (Acumulada)">
             <div className="h-64 w-full">
                <ResponsiveContainer width="100%" height="100%">
                   <AreaChart data={chartData} margin={{top: 10, right: 10, left: 0, bottom: 0}}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#334155" vertical={false} />
                      <XAxis dataKey="date" tick={{fill: '#94a3b8', fontSize: 10}} axisLine={{stroke: '#475569'}} />
                      <YAxis tick={{fill: '#94a3b8', fontSize: 10}} axisLine={{stroke: '#475569'}} domain={['auto', 'auto']}/>
                      <Tooltip 
                        contentStyle={{backgroundColor: '#1e293b', borderColor: '#334155', color: '#fff'}}
                        formatter={(val: number) => formatCurrency(val)}
                      />
                      <ReferenceLine y={0} stroke="#cbd5e1" strokeDasharray="3 3"/>
                      <Area type="monotone" dataKey="accumulated" stroke="#3b82f6" fill="#3b82f6" fillOpacity={0.2} strokeWidth={2} />
                   </AreaChart>
                </ResponsiveContainer>
             </div>
         </Card>
      </div>

      {/* DETAILED TABLE */}
      <Card title="Detalle de Operaciones">
        <div className="overflow-x-auto max-h-[400px]">
          <table className="w-full text-sm text-left">
             <thead className="text-xs text-slate-400 uppercase bg-slate-900/50 sticky top-0">
                 <tr>
                     <th className="px-4 py-3">Fecha</th>
                     <th className="px-4 py-3">Ticker</th>
                     <th className="px-4 py-3">Cartera</th>
                     <th className="px-4 py-3">Tipo</th>
                     <th className="px-4 py-3 text-right">Coste Base</th>
                     <th className="px-4 py-3 text-right">Venta Neta</th>
                     <th className="px-4 py-3 text-right">P&L (€)</th>
                     <th className="px-4 py-3 text-right">%</th>
                 </tr>
             </thead>
             <tbody className="divide-y divide-slate-700">
                 {filteredTrades.map((trade) => (
                     <tr key={trade.id} className="hover:bg-slate-700/30">
                         <td className="px-4 py-3 text-slate-400 text-xs font-mono">{trade.date}</td>
                         <td className="px-4 py-3 text-white font-medium">{trade.ticker}</td>
                         <td className="px-4 py-3 text-slate-400 text-xs">{trade.portfolio}</td>
                         <td className="px-4 py-3 text-slate-300 text-xs">{trade.type}</td>
                         <td className="px-4 py-3 text-right text-slate-400 text-xs">{formatCurrency(trade.grossCostEur)}</td>
                         <td className="px-4 py-3 text-right text-slate-300">{formatCurrency(trade.grossRevenueEur)}</td>
                         <td className={`px-4 py-3 text-right font-bold ${trade.netPnLEur >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                             {formatCurrency(trade.netPnLEur)}
                         </td>
                         <td className={`px-4 py-3 text-right font-medium text-xs ${trade.netPnLEur >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                             {(trade.returnPct * 100).toFixed(2)}%
                         </td>
                     </tr>
                 ))}
                 {filteredTrades.length === 0 && (
                     <tr><td colSpan={8} className="p-8 text-center text-slate-500">No hay operaciones cerradas en este periodo.</td></tr>
                 )}
             </tbody>
          </table>
        </div>
      </Card>

    </div>
  );
};

export default ClosedOperationsAnalysis;
