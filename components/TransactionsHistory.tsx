import React, { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db';
import { Icons } from './ui/Icons';
import { Transaction, TransactionType } from '../types';

interface TransactionsHistoryProps {
  onEdit: (transaction: Transaction) => void;
  selectedPortfolio: string | 'ALL';
}

const TransactionsHistory: React.FC<TransactionsHistoryProps> = ({ onEdit, selectedPortfolio }) => {
  
  const transactions = useLiveQuery(() => {
    if (selectedPortfolio === 'ALL') return db.transactions.toArray();
    return db.transactions.where('portfolio').equals(selectedPortfolio).toArray();
  }, [selectedPortfolio]) || [];

  // Sort by Date Descending (Newest first)
  const sortedTransactions = [...transactions].sort((a, b) => 
    new Date(b.date).getTime() - new Date(a.date).getTime()
  );

  const handleDelete = async (id: number) => {
    if (confirm('¿Estás seguro de que quieres eliminar esta transacción? Esto recalculará tus posiciones.')) {
      await db.transactions.delete(id);
    }
  };

  const formatCurrency = (val: number, currency: string) => 
    new Intl.NumberFormat('es-ES', { style: 'currency', currency }).format(val);

  return (
    <div className="bg-slate-800 border border-slate-700 rounded-xl overflow-hidden shadow-sm">
      <div className="px-6 py-4 border-b border-slate-700 flex justify-between items-center">
        <h3 className="text-lg font-medium text-slate-100 flex items-center gap-2">
          <Icons.Transactions size={18} /> Historial de Operaciones ({sortedTransactions.length})
        </h3>
      </div>
      <div className="overflow-x-auto pb-12">
        <table className="w-full text-sm text-left">
          <thead className="text-xs text-slate-400 uppercase bg-slate-900/50">
            <tr>
              <th className="px-6 py-3">Fecha</th>
              <th className="px-6 py-3">Ticker</th>
              <th className="px-6 py-3">Operación</th>
              <th className="px-6 py-3">Cartera</th>
              <th className="px-6 py-3 text-right">Cant.</th>
              <th className="px-6 py-3 text-right">Precio</th>
              <th className="px-6 py-3 text-right">Comisión</th>
              <th className="px-6 py-3 text-right">Total (Neto)</th>
              <th className="px-6 py-3 text-center">Acciones</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-700">
            {sortedTransactions.length === 0 ? (
              <tr>
                <td colSpan={9} className="px-6 py-8 text-center text-slate-500">
                  No hay transacciones registradas. 
                  <br/> Usa el botón "Nueva Operación" o importa un Excel desde Configuración.
                </td>
              </tr>
            ) : (
              sortedTransactions.map((tx) => {
                const isBuy = tx.type === TransactionType.Buy;
                // Total Cost for Buy = Price*Qty + Comm
                // Total Proceeds for Sell = Price*Qty - Comm
                const grossTotal = tx.quantity * tx.price;
                const netTotal = isBuy ? (grossTotal + tx.commission) : (grossTotal - tx.commission);
                
                return (
                  <tr key={tx.id} className="hover:bg-slate-700/30 transition-colors group">
                    <td className="px-6 py-4 text-slate-300 font-mono text-xs">{tx.date}</td>
                    <td className="px-6 py-4 font-medium text-white">{tx.ticker}</td>
                    <td className="px-6 py-4">
                      <span className={`text-xs font-medium px-2 py-1 rounded border ${isBuy ? 'bg-emerald-900/20 border-emerald-900/50 text-emerald-400' : 'bg-rose-900/20 border-rose-900/50 text-rose-400'}`}>
                        {tx.type}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-slate-400">{tx.portfolio}</td>
                    <td className="px-6 py-4 text-right text-slate-300">{tx.quantity}</td>
                    <td className="px-6 py-4 text-right text-slate-300">
                        {formatCurrency(tx.price, tx.currencyPlatform)}
                    </td>
                    <td className="px-6 py-4 text-right text-slate-400 text-xs">
                        {tx.commission > 0 ? formatCurrency(tx.commission, tx.currencyPlatform) : '-'}
                    </td>
                    <td className={`px-6 py-4 text-right font-medium ${isBuy ? 'text-slate-200' : 'text-emerald-400'}`}>
                        {formatCurrency(netTotal, tx.currencyPlatform)}
                    </td>
                    <td className="px-6 py-4 text-center">
                       <div className="flex items-center justify-center gap-2 opacity-50 group-hover:opacity-100 transition-opacity">
                         <button 
                           onClick={() => onEdit(tx)}
                           className="p-1.5 rounded bg-slate-700 text-blue-400 hover:bg-blue-900/30 transition-colors" 
                           title="Editar"
                         >
                           <Icons.Settings size={14} />
                         </button>
                         <button 
                           onClick={() => tx.id && handleDelete(tx.id)}
                           className="p-1.5 rounded bg-slate-700 text-rose-400 hover:bg-rose-900/30 transition-colors" 
                           title="Eliminar"
                         >
                           <Icons.Trash size={14} />
                         </button>
                       </div>
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

export default TransactionsHistory;