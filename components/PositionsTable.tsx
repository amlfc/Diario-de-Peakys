
import React from 'react';
import { Position, Currency } from '../types';
import { Icons } from './ui/Icons';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db';

interface PositionsTableProps {
  positions: Position[];
}

const PositionsTable: React.FC<PositionsTableProps> = ({ positions }) => {
  
  // Fetch available asset types for the dropdown
  const assetTypes = useLiveQuery(() => db.assetTypes.toArray()) || [];

  const formatCurrency = (val: number, currency: string = Currency.EUR) => 
    new Intl.NumberFormat('es-ES', { style: 'currency', currency }).format(val);

  const formatPct = (val: number) => 
    new Intl.NumberFormat('es-ES', { style: 'percent', minimumFractionDigits: 2 }).format(val);

  // Handler to update asset type in DB
  const handleTypeChange = async (portfolio: string, ticker: string, newType: string) => {
    try {
      await db.transactions
        .where('portfolio').equals(portfolio)
        .filter(tx => tx.ticker === ticker)
        .modify({ assetType: newType });
    } catch (error) {
      console.error("Failed to update asset type", error);
      alert("Error al actualizar el tipo de activo");
    }
  };

  // Sort by value descending
  const sortedPositions = [...positions].sort((a, b) => b.currentValueEur - a.currentValueEur);

  return (
    <div className="bg-slate-800 border border-slate-700 rounded-xl overflow-hidden shadow-sm">
      <div className="px-6 py-4 border-b border-slate-700 flex justify-between items-center">
        <h3 className="text-lg font-medium text-slate-100 flex items-center gap-2">
          <Icons.Positions size={18} /> Posiciones Abiertas
        </h3>
      </div>
      <div className="overflow-x-auto pb-24 md:pb-0">
        <table className="w-full text-sm text-left">
          <thead className="text-xs text-slate-400 uppercase bg-slate-900/50">
            <tr>
              <th className="px-4 py-3">Ticker</th>
              <th className="px-4 py-3">Activo</th>
              <th className="px-4 py-3">Tipo Activo</th>
              <th className="px-4 py-3">Cartera</th>
              <th className="px-4 py-3 text-center">Mon. Orig.</th>
              <th className="px-4 py-3 text-right">Cant.</th>
              
              {/* Origin Currency Columns */}
              <th className="px-4 py-3 text-right bg-slate-800/30 border-l border-slate-700">Valor (Orig)</th>
              <th className="px-4 py-3 text-right bg-slate-800/30">G/P (Orig)</th>

              {/* EUR Columns */}
              <th className="px-4 py-3 text-right border-l border-slate-700">Valor (EUR)</th>
              <th className="px-4 py-3 text-right">G/P Lat. (EUR)</th>
              <th className="px-4 py-3 text-right">%</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-700">
            {sortedPositions.length === 0 ? (
              <tr>
                <td colSpan={11} className="px-6 py-8 text-center text-slate-500">
                  No hay posiciones abiertas para esta selección.
                </td>
              </tr>
            ) : (
              sortedPositions.map((pos) => {
                const isProfitEur = pos.unrealizedPnLEur >= 0;
                const isProfitOrigin = pos.unrealizedPnLOrigin >= 0;
                const isDifferentCurrency = pos.currencyOrigin !== Currency.EUR;

                return (
                  <tr key={`${pos.portfolio}-${pos.ticker}`} className="hover:bg-slate-700/30 transition-colors">
                    <td className="px-4 py-4 font-medium text-white">{pos.ticker}</td>
                    <td className="px-4 py-4 text-slate-300 max-w-[150px] truncate" title={pos.assetName}>{pos.assetName}</td>
                    
                    <td className="px-4 py-4">
                      <select 
                        value={pos.assetType}
                        onChange={(e) => handleTypeChange(pos.portfolio, pos.ticker, e.target.value)}
                        className="bg-slate-900 border border-slate-600 text-slate-300 text-xs rounded px-2 py-1 focus:border-blue-500 outline-none max-w-[140px]"
                      >
                        {assetTypes.map(at => (
                          <option key={at.id} value={at.name}>{at.name}</option>
                        ))}
                      </select>
                    </td>

                    <td className="px-4 py-4 text-slate-400">{pos.portfolio}</td>
                    <td className="px-4 py-4 text-center text-blue-300 font-mono text-xs">{pos.currencyOrigin}</td>
                    <td className="px-4 py-4 text-right text-slate-300">{pos.quantity.toFixed(2)}</td>
                    
                    {/* Origin Columns */}
                    <td className="px-4 py-4 text-right bg-slate-800/30 border-l border-slate-700 text-slate-300">
                       {isDifferentCurrency ? formatCurrency(pos.currentValueOrigin, pos.currencyOrigin) : '-'}
                    </td>
                    <td className={`px-4 py-4 text-right bg-slate-800/30 font-medium ${isProfitOrigin ? 'text-emerald-400' : 'text-rose-400'}`}>
                       {isDifferentCurrency ? formatCurrency(pos.unrealizedPnLOrigin, pos.currencyOrigin) : '-'}
                    </td>

                    {/* EUR Columns */}
                    <td className="px-4 py-4 text-right border-l border-slate-700 text-white font-bold">
                      {formatCurrency(pos.currentValueEur, Currency.EUR)}
                    </td>
                    <td className={`px-4 py-4 text-right font-medium ${isProfitEur ? 'text-emerald-400' : 'text-rose-400'}`}>
                      {formatCurrency(pos.unrealizedPnLEur, Currency.EUR)}
                    </td>
                    <td className={`px-4 py-4 text-right font-medium ${isProfitEur ? 'text-emerald-400' : 'text-rose-400'}`}>
                      {formatPct(pos.unrealizedPnLPct)}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default PositionsTable;
