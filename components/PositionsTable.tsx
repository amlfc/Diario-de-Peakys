import React from 'react';
import { Position, Currency } from '../types';
import { Icons } from './ui/Icons';

interface PositionsTableProps {
  positions: Position[];
}

const PositionsTable: React.FC<PositionsTableProps> = ({ positions }) => {
  
  const formatCurrency = (val: number, currency: Currency = Currency.EUR) => 
    new Intl.NumberFormat('es-ES', { style: 'currency', currency }).format(val);

  const formatPct = (val: number) => 
    new Intl.NumberFormat('es-ES', { style: 'percent', minimumFractionDigits: 2 }).format(val);

  // Sort by value descending
  const sortedPositions = [...positions].sort((a, b) => b.currentValueEur - a.currentValueEur);

  return (
    <div className="bg-slate-800 border border-slate-700 rounded-xl overflow-hidden shadow-sm">
      <div className="px-6 py-4 border-b border-slate-700 flex justify-between items-center">
        <h3 className="text-lg font-medium text-slate-100 flex items-center gap-2">
          <Icons.Positions size={18} /> Posiciones Abiertas
        </h3>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm text-left">
          <thead className="text-xs text-slate-400 uppercase bg-slate-900/50">
            <tr>
              <th className="px-6 py-3">Ticker</th>
              <th className="px-6 py-3">Activo</th>
              <th className="px-6 py-3">Cartera</th>
              <th className="px-6 py-3 text-right">Cant.</th>
              <th className="px-6 py-3 text-right">CMP (Plat)</th>
              <th className="px-6 py-3 text-right">Actual (Orig)</th>
              <th className="px-6 py-3 text-right">Valor (EUR)</th>
              <th className="px-6 py-3 text-right">G/P Latente (EUR)</th>
              <th className="px-6 py-3 text-right">%</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-700">
            {sortedPositions.length === 0 ? (
              <tr>
                <td colSpan={9} className="px-6 py-8 text-center text-slate-500">
                  No hay posiciones abiertas para esta selección.
                </td>
              </tr>
            ) : (
              sortedPositions.map((pos) => {
                const isProfit = pos.unrealizedPnLEur >= 0;
                return (
                  <tr key={`${pos.portfolio}-${pos.ticker}`} className="hover:bg-slate-700/30 transition-colors">
                    <td className="px-6 py-4 font-medium text-white">{pos.ticker}</td>
                    <td className="px-6 py-4 text-slate-300 max-w-[200px] truncate" title={pos.assetName}>{pos.assetName}</td>
                    <td className="px-6 py-4 text-slate-400">{pos.portfolio}</td>
                    <td className="px-6 py-4 text-right text-slate-300">{pos.quantity.toFixed(2)}</td>
                    <td className="px-6 py-4 text-right text-slate-400">
                      {formatCurrency(pos.avgPricePlatform, pos.currencyPlatform)}
                    </td>
                    <td className="px-6 py-4 text-right text-white font-medium">
                      {formatCurrency(pos.currentPriceOrigin, pos.currencyOrigin)}
                    </td>
                    <td className="px-6 py-4 text-right text-white font-bold">
                      {formatCurrency(pos.currentValueEur, Currency.EUR)}
                    </td>
                    <td className={`px-6 py-4 text-right font-medium ${isProfit ? 'text-emerald-400' : 'text-rose-400'}`}>
                      {formatCurrency(pos.unrealizedPnLEur, Currency.EUR)}
                    </td>
                    <td className={`px-6 py-4 text-right font-medium ${isProfit ? 'text-emerald-400' : 'text-rose-400'}`}>
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