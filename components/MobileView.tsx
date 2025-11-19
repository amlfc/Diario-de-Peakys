import React from 'react';
import { DashboardMetrics, PortfolioOwner } from '../types';
import { Icons } from './ui/Icons';

interface MobileViewProps {
  metrics: DashboardMetrics;
  portfolioName: string;
}

const MobileView: React.FC<MobileViewProps> = ({ metrics, portfolioName }) => {
  const formatCurrency = (val: number, curr = 'EUR') => 
    new Intl.NumberFormat('es-ES', { style: 'currency', currency: curr }).format(val);

  const formatPct = (val: number) => 
    new Intl.NumberFormat('es-ES', { style: 'percent', minimumFractionDigits: 2 }).format(val);

  return (
    <div className="bg-slate-900 rounded-xl border border-slate-800 p-4 space-y-4">
      <div className="flex items-center gap-2 border-b border-slate-800 pb-2">
        <Icons.Mobile className="text-blue-500" size={20} />
        <h2 className="text-lg font-bold text-white uppercase tracking-wider">{portfolioName}</h2>
      </div>
      
      <div className="space-y-3">
        <div className="flex justify-between items-center">
           <span className="text-slate-400 text-sm">Aportaciones</span>
           <span className="text-white font-mono">{formatCurrency(metrics.totalLiquidityAddedEur)}</span>
        </div>
        <div className="flex justify-between items-center">
           <span className="text-slate-400 text-sm">Valor Actual (EUR)</span>
           <span className="text-white font-bold font-mono text-lg">{formatCurrency(metrics.totalValueEur)}</span>
        </div>
        <div className="flex justify-between items-center">
           <span className="text-slate-400 text-sm">Rentabilidad</span>
           <span className={`font-mono font-bold ${metrics.totalReturnPct >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
             {formatPct(metrics.totalReturnPct)}
           </span>
        </div>
        <div className="flex justify-between items-center pt-2 border-t border-slate-800">
           <span className="text-slate-400 text-sm">Cierre Total</span>
           <span className="text-blue-400 font-mono font-bold">{formatCurrency(metrics.projectedCloseEur)}</span>
        </div>
      </div>
    </div>
  );
};

export default MobileView;