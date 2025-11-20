
import React, { useState, useMemo } from 'react';
import { useLiveData } from '../hooks/useLiveData'; // CAMBIO
import { db } from '../db';
import { Icons } from './ui/Icons';
import { Card } from './ui/Card';
import { PortfolioOwner } from '../types';

const LiquidityManager: React.FC = () => {
  const liquidityEvents = useLiveData(() => db.liquidity.toArray()) || [];
  const portfolios = useLiveData(() => db.portfolios.toArray()) || [];
  
  const [transactionType, setTransactionType] = useState<'IN' | 'OUT'>('IN');
  
  const [formData, setFormData] = useState({
    date: new Date().toISOString().split('T')[0],
    portfolio: 'Alejandro',
    amountEur: '',
    concept: '', 
    notes: ''
  });

  const formatCurrency = (val: number) => 
    new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' }).format(val);

  // --- DATA SANITIZATION ---
  const toNumber = (val: any): number => {
    if (typeof val === 'number' && !isNaN(val)) return val;
    if (val === null || val === undefined || val === '') return 0;
    
    const str = String(val).trim();
    let normalized = str;
    if (str.includes(',') && !str.includes('.')) {
      normalized = str.replace(',', '.');
    }
    
    const parsed = parseFloat(normalized);
    return isNaN(parsed) ? 0 : parsed;
  };

  const sanitizedEvents = useMemo(() => {
    if (!Array.isArray(liquidityEvents)) return [];
    
    return liquidityEvents.map(evt => {
      // Check for common DB field variations (camelCase vs snake_case)
      const rawAmount = (evt as any).amountEur ?? (evt as any).amount_eur ?? (evt as any).amount ?? (evt as any).importe;
      const amountEur = toNumber(rawAmount);
      
      return {
        ...evt,
        amountEur,
        // Ensure other fields exist
        date: evt.date || '',
        portfolio: evt.portfolio || 'Desconocido',
        type: evt.type || (amountEur >= 0 ? 'Ingreso' : 'Retirada')
      };
    });
  }, [liquidityEvents]);

  const sortedEvents = [...sanitizedEvents].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

  const netTotal = useMemo(() => sortedEvents.reduce((acc, curr) => acc + curr.amountEur, 0), [sortedEvents]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.amountEur) return;

    const numericAmount = parseFloat(formData.amountEur);
    const finalAmount = transactionType === 'OUT' ? -Math.abs(numericAmount) : Math.abs(numericAmount);
    const finalType = formData.concept || (transactionType === 'IN' ? 'Ingreso' : 'Retirada');

    try {
      await db.liquidity.add({
        date: formData.date,
        portfolio: formData.portfolio as PortfolioOwner,
        amountEur: finalAmount,
        type: finalType,
        notes: formData.notes
      });
      setFormData({ ...formData, amountEur: '', notes: '', concept: '' });
    } catch (error) {
      console.error("Error adding liquidity:", error);
    }
  };

  const handleDelete = async (id?: number) => {
    if (id && confirm('¿Borrar este movimiento de liquidez?')) {
      await db.liquidity.delete(id);
    }
  };

  return (
    <div className="space-y-6 animate-fade-in">
       <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold text-white flex items-center gap-2">
          <Icons.Liquidity className="text-emerald-400" /> Gestión de Liquidez
        </h2>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <Card title="Registrar Movimiento" className="h-fit">
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid grid-cols-2 gap-2 p-1 bg-slate-900 rounded-lg border border-slate-700">
                <button
                  type="button"
                  onClick={() => setTransactionType('IN')}
                  className={`py-2 px-4 rounded-md text-sm font-bold transition-all flex items-center justify-center gap-2 ${transactionType === 'IN' ? 'bg-emerald-600 text-white shadow-lg' : 'text-slate-400 hover:text-emerald-400'}`}
                >
                   <Icons.Up size={16} /> Ingreso
                </button>
                <button
                  type="button"
                  onClick={() => setTransactionType('OUT')}
                  className={`py-2 px-4 rounded-md text-sm font-bold transition-all flex items-center justify-center gap-2 ${transactionType === 'OUT' ? 'bg-rose-600 text-white shadow-lg' : 'text-slate-400 hover:text-rose-400'}`}
                >
                   <Icons.Down size={16} /> Retirada
                </button>
            </div>

            <div>
              <label className="block text-xs text-slate-400 mb-1">Fecha</label>
              <input type="date" value={formData.date} onChange={e => setFormData({...formData, date: e.target.value})} className="w-full bg-slate-900 border border-slate-700 rounded p-2 text-white focus:border-blue-500 outline-none" required/>
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1">Cartera</label>
              <select value={formData.portfolio} onChange={e => setFormData({...formData, portfolio: e.target.value})} className="w-full bg-slate-900 border border-slate-700 rounded p-2 text-white focus:border-blue-500 outline-none">
                 {portfolios.length > 0 ? portfolios.map(p => <option key={p.id} value={p.name}>{p.name}</option>) : <option value="Alejandro">Alejandro</option>}
              </select>
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1">Importe (EUR)</label>
              <input type="number" step="0.01" placeholder="Ej. 500" value={formData.amountEur} onChange={e => setFormData({...formData, amountEur: e.target.value})} className={`w-full bg-slate-900 border rounded p-2 text-white outline-none font-mono text-lg ${transactionType === 'OUT' ? 'border-rose-500/50 focus:border-rose-500' : 'border-emerald-500/50 focus:border-emerald-500'}`} required/>
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1">Concepto (Opcional)</label>
              <input type="text" value={formData.concept} onChange={e => setFormData({...formData, concept: e.target.value})} placeholder={transactionType === 'IN' ? "Ej. Ahorro Mensual" : "Ej. Retirada a Banco"} className="w-full bg-slate-900 border border-slate-700 rounded p-2 text-white focus:border-blue-500 outline-none"/>
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1">Notas</label>
              <input type="text" value={formData.notes} onChange={e => setFormData({...formData, notes: e.target.value})} className="w-full bg-slate-900 border border-slate-700 rounded p-2 text-white focus:border-blue-500 outline-none"/>
            </div>
            
            <button type="submit" className={`w-full py-2 rounded-lg font-medium transition-colors flex justify-center items-center gap-2 text-white ${transactionType === 'IN' ? 'bg-emerald-600 hover:bg-emerald-500' : 'bg-rose-600 hover:bg-rose-500'}`}>
               {transactionType === 'IN' ? <Icons.Add size={18} /> : <Icons.Arrow size={18} className="rotate-180" />}
               {transactionType === 'IN' ? 'Registrar Ingreso' : 'Registrar Retirada'}
            </button>
          </form>
        </Card>

        <div className="lg:col-span-2">
           <div className="bg-slate-800 border border-slate-700 rounded-xl overflow-hidden shadow-sm">
              <div className="px-6 py-4 border-b border-slate-700 flex justify-between items-center">
                <h3 className="text-lg font-medium text-slate-100">Historial de Movimientos</h3>
                <span className={`text-sm font-mono px-3 py-1 rounded border ${netTotal >= 0 ? 'bg-emerald-900/20 border-emerald-900/50 text-emerald-400' : 'bg-rose-900/20 border-rose-900/50 text-rose-400'}`}>
                   Neto Total: {formatCurrency(netTotal)}
                </span>
              </div>
              <div className="overflow-x-auto max-h-[600px]">
                 <table className="w-full text-sm text-left">
                    <thead className="text-xs text-slate-400 uppercase bg-slate-900/50 sticky top-0">
                       <tr><th className="px-6 py-3">Fecha</th><th className="px-6 py-3">Cartera</th><th className="px-6 py-3">Concepto</th><th className="px-6 py-3 text-right">Importe</th><th className="px-6 py-3 text-right">Acción</th></tr>
                    </thead>
                    <tbody className="divide-y divide-slate-700">
                       {sortedEvents.length === 0 ? (
                         <tr><td colSpan={5} className="px-6 py-8 text-center text-slate-500">No hay movimientos registrados.</td></tr>
                       ) : (
                         sortedEvents.map((evt, idx) => {
                           const isNegative = evt.amountEur < 0;
                           // Fallback key
                           const rowKey = evt.id ? evt.id : `liq-${idx}-${evt.date}`;
                           
                           return (
                            <tr key={rowKey} className="hover:bg-slate-700/30">
                                <td className="px-6 py-4 text-slate-300 font-mono text-xs">{evt.date}</td>
                                <td className="px-6 py-4 text-white font-medium">{evt.portfolio}</td>
                                <td className="px-6 py-4 text-slate-300">
                                    <span className={`text-xs font-bold px-2 py-0.5 rounded mr-2 ${isNegative ? 'bg-rose-900/30 text-rose-400' : 'bg-emerald-900/30 text-emerald-400'}`}>{isNegative ? 'OUT' : 'IN'}</span>
                                    {evt.type}
                                    {evt.notes && <div className="text-xs text-slate-500 italic mt-1">{evt.notes}</div>}
                                </td>
                                <td className={`px-6 py-4 text-right font-bold ${isNegative ? 'text-rose-400' : 'text-emerald-400'}`}>{formatCurrency(evt.amountEur)}</td>
                                <td className="px-6 py-4 text-right">
                                    <button onClick={() => handleDelete(evt.id)} className="text-slate-500 hover:text-rose-400 p-1"><Icons.Trash size={16} /></button>
                                </td>
                            </tr>
                           );
                         })
                       )}
                    </tbody>
                 </table>
              </div>
           </div>
        </div>
      </div>
    </div>
  );
};

export default LiquidityManager;
