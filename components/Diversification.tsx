
import React, { useState, useEffect } from 'react';
import { Position, DashboardMetrics, PortfolioOwner } from '../types';
import { Card } from './ui/Card';
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import { db } from '../db';
import { useLiveData } from '../hooks/useLiveData'; // CAMBIO

interface DiversificationProps {
  positions: Position[];
  metrics: DashboardMetrics;
  selectedPortfolio: PortfolioOwner | 'ALL';
}

const COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#64748b', '#0ea5e9', '#d946ef'];

const TargetInput: React.FC<{ 
  assetType: string; 
  initialValue: number; 
  onSave: (type: string, val: string) => void; 
}> = ({ assetType, initialValue, onSave }) => {
  const [val, setVal] = useState(initialValue.toString());

  useEffect(() => {
    setVal(initialValue.toString());
  }, [initialValue]);

  const handleBlur = () => {
    if (val !== initialValue.toString()) {
      onSave(assetType, val);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      (e.target as HTMLInputElement).blur();
    }
  };

  return (
    <div className="flex items-center justify-center">
      <input type="number" className="w-16 bg-slate-900 border border-slate-600 rounded px-1 py-0.5 text-center text-white focus:border-blue-500 outline-none text-xs" value={val} placeholder="0" onChange={(e) => setVal(e.target.value)} onBlur={handleBlur} onKeyDown={handleKeyDown} />
      <span className="ml-1 text-slate-500">%</span>
    </div>
  );
};

const Diversification: React.FC<DiversificationProps> = ({ positions, metrics, selectedPortfolio }) => {
  
  const allAssetTypes = useLiveData(() => db.assetTypes.toArray()) || [];
  
  const targets = useLiveData(async () => {
    if (selectedPortfolio === 'ALL') return await db.allocationTargets.toArray();
    const all = await db.allocationTargets.toArray();
    return all.filter(t => t.portfolio === selectedPortfolio);
  }, [selectedPortfolio]);

  const currentValuesMap = new Map<string, number>();
  let totalValue = 0;

  positions.forEach(pos => {
    const currentVal = currentValuesMap.get(pos.assetType) || 0;
    currentValuesMap.set(pos.assetType, currentVal + pos.currentValueEur);
    totalValue += pos.currentValueEur;
  });

  const pieData = Array.from(currentValuesMap.entries()).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value);

  const formatCurrency = (val: number) => 
    new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(val);

  const referenceCapital = metrics.totalLiquidityAddedEur + metrics.realizedPnLEur;

  const handleTargetChange = async (assetType: string, newVal: string) => {
    if (selectedPortfolio === 'ALL') return;
    const val = parseFloat(newVal);
    if (isNaN(val)) return;

    const existing = targets?.find(t => t.assetType === assetType);
    if (existing && existing.id) {
      await db.allocationTargets.update(existing.id, { targetPercentage: val });
    } else {
      await db.allocationTargets.add({
        portfolio: selectedPortfolio,
        assetType: assetType,
        targetPercentage: val
      });
    }
  };

  const uniqueAssetTypes = Array.from(new Set([
    ...allAssetTypes.map(a => a.name),
    ...Array.from(currentValuesMap.keys())
  ])).sort();

  return (
    <Card title={`Diversificación: ${selectedPortfolio === 'ALL' ? 'Global' : selectedPortfolio}`} className="h-full min-h-[500px]">
      <div className="flex flex-col xl:flex-row h-full gap-8">
        <div className="w-full xl:w-1/3 h-64 xl:h-auto flex flex-col items-center justify-center relative">
          {totalValue > 0 ? (
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={pieData} cx="50%" cy="50%" innerRadius={60} outerRadius={80} paddingAngle={5} dataKey="value">
                  {pieData.map((entry, index) => (<Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} stroke="#1e293b" strokeWidth={2} />))}
                </Pie>
                <Tooltip contentStyle={{ backgroundColor: '#1e293b', borderColor: '#334155', color: '#f1f5f9' }} formatter={(value: number) => formatCurrency(value)} />
                <Legend layout="horizontal" verticalAlign="bottom" align="center" wrapperStyle={{ fontSize: '10px', marginTop: '10px' }}/>
              </PieChart>
            </ResponsiveContainer>
          ) : (<div className="text-slate-500 text-sm">Sin datos para mostrar gráfico</div>)}
          
          <div className="absolute top-0 right-0 text-xs text-right text-slate-500 bg-slate-900/50 p-2 rounded">
             <div className="font-medium text-slate-300">Capital Referencia</div>
             <div>{formatCurrency(referenceCapital)}</div>
             <div className="text-[10px] mt-1">(Aportado + G/P Realizada)</div>
          </div>
        </div>

        <div className="w-full xl:w-2/3 overflow-x-auto">
           {selectedPortfolio === 'ALL' && (
             <div className="mb-4 p-3 bg-blue-900/20 border border-blue-800 rounded text-blue-300 text-sm">
               Selecciona una cartera específica arriba para editar los Objetivos %. En vista Global se muestra la suma de objetivos.
             </div>
           )}

           <table className="w-full text-sm text-left">
            <thead className="text-xs text-slate-400 uppercase bg-slate-900/50 border-b border-slate-700">
              <tr><th className="px-4 py-3">Tipo Activo</th><th className="px-4 py-3 text-right">Actual €</th><th className="px-4 py-3 text-right">Actual %</th><th className="px-4 py-3 text-center w-24">Obj %</th><th className="px-4 py-3 text-right">Obj €</th><th className="px-4 py-3 text-center">Estado</th></tr>
            </thead>
            <tbody className="divide-y divide-slate-700">
              {uniqueAssetTypes.map((type) => {
                const currentVal = currentValuesMap.get(type) || 0;
                const currentPct = referenceCapital > 0 ? (currentVal / referenceCapital) * 100 : 0;
                let targetPct = 0;
                if (selectedPortfolio !== 'ALL') {
                  targetPct = targets?.find(t => t.assetType === type)?.targetPercentage || 0;
                }

                const targetVal = referenceCapital * (targetPct / 100);
                let statusColor = 'text-slate-500';
                let statusText = '-';
                if (targetVal > 0) {
                  const ratio = currentVal / targetVal;
                  if (ratio < 0.9) { statusColor = 'text-blue-400 font-bold'; statusText = 'Comprar'; } 
                  else if (ratio > 1.1) { statusColor = 'text-rose-400 font-bold'; statusText = 'Vender'; } 
                  else { statusColor = 'text-emerald-400 font-bold'; statusText = 'OK'; }
                }

                return (
                  <tr key={type} className="hover:bg-slate-700/30">
                    <td className="px-4 py-3 font-medium text-slate-200">{type}</td>
                    <td className="px-4 py-3 text-right text-slate-300">{formatCurrency(currentVal)}</td>
                    <td className="px-4 py-3 text-right text-slate-400">{currentPct.toFixed(1)}%</td>
                    <td className="px-4 py-3 text-center">
                      {selectedPortfolio !== 'ALL' ? <TargetInput assetType={type} initialValue={targetPct} onSave={handleTargetChange} /> : <span className="text-slate-600">-</span>}
                    </td>
                    <td className="px-4 py-3 text-right text-slate-500">{targetVal > 0 ? formatCurrency(targetVal) : '-'}</td>
                    <td className={`px-4 py-3 text-center ${statusColor} text-xs uppercase tracking-wide`}>{statusText}</td>
                  </tr>
                );
              })}
              <tr className="bg-slate-800/50 border-t border-slate-600 font-medium">
                 <td className="px-4 py-3 text-slate-200">Liquidez / Sin Asignar</td>
                 <td className="px-4 py-3 text-right text-white">{formatCurrency(referenceCapital - totalValue)}</td>
                 <td className="px-4 py-3 text-right text-slate-400">{(referenceCapital > 0 ? ((referenceCapital - totalValue) / referenceCapital * 100) : 0).toFixed(1)}%</td>
                 <td colSpan={3}></td>
              </tr>
            </tbody>
           </table>
        </div>
      </div>
    </Card>
  );
};

export default Diversification;
