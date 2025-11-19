import React, { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db';
import { Icons } from './ui/Icons';
import { Card } from './ui/Card';
import { PortfolioOwner } from '../types';

const LiquidityManager: React.FC = () => {
  const liquidityEvents = useLiveQuery(() => db.liquidity.toArray()) || [];
  const portfolios = useLiveQuery(() => db.portfolios.toArray()) || [];
  
  const [formData, setFormData] = useState({
    date: new Date().toISOString().split('T')[0],
    portfolio: 'Alejandro',
    amountEur: '',
    type: 'Ingreso',
    notes: ''
  });

  const formatCurrency = (val: number) => 
    new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' }).format(val);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.amountEur) return;

    try {
      await db.liquidity.add({
        date: formData.date,
        portfolio: formData.portfolio as PortfolioOwner,
        amountEur: parseFloat(formData.amountEur),
        type: formData.type,
        notes: formData.notes
      });
      setFormData({ ...formData, amountEur: '', notes: '' });
    } catch (error) {
      console.error("Error adding liquidity:", error);
    }
  };

  const handleDelete = async (id?: number) => {
    if (id && confirm('¿Borrar esta aportación?')) {
      await db.liquidity.delete(id);
    }
  };

  // Sort by date descending
  const sortedEvents = [...liquidityEvents].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

  return (
    <div className="space-y-6 animate-fade-in">
       <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold text-white flex items-center gap-2">
          <Icons.Liquidity className="text-emerald-400" /> Gestión de Liquidez
        </h2>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* FORM */}
        <Card title="Registrar Aportación" className="h-fit">
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-xs text-slate-400 mb-1">Fecha</label>
              <input 
                type="date" 
                value={formData.date} 
                onChange={e => setFormData({...formData, date: e.target.value})} 
                className="w-full bg-slate-900 border border-slate-700 rounded p-2 text-white focus:border-blue-500 outline-none"
                required
              />
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1">Cartera</label>
              <select 
                value={formData.portfolio} 
                onChange={e => setFormData({...formData, portfolio: e.target.value})} 
                className="w-full bg-slate-900 border border-slate-700 rounded p-2 text-white focus:border-blue-500 outline-none"
              >
                 {portfolios.length > 0 ? (
                    portfolios.map(p => <option key={p.id} value={p.name}>{p.name}</option>)
                  ) : (
                    <option value="Alejandro">Alejandro</option>
                  )}
              </select>
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1">Importe (EUR)</label>
              <input 
                type="number" 
                step="0.01"
                placeholder="Ej. 500"
                value={formData.amountEur} 
                onChange={e => setFormData({...formData, amountEur: e.target.value})} 
                className="w-full bg-slate-900 border border-slate-700 rounded p-2 text-white focus:border-blue-500 outline-none font-mono text-lg"
                required
              />
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1">Tipo / Concepto</label>
              <input 
                type="text" 
                value={formData.type} 
                onChange={e => setFormData({...formData, type: e.target.value})} 
                placeholder="Ej. Ingreso Mensual"
                className="w-full bg-slate-900 border border-slate-700 rounded p-2 text-white focus:border-blue-500 outline-none"
              />
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1">Notas</label>
              <input 
                type="text" 
                value={formData.notes} 
                onChange={e => setFormData({...formData, notes: e.target.value})} 
                className="w-full bg-slate-900 border border-slate-700 rounded p-2 text-white focus:border-blue-500 outline-none"
              />
            </div>
            <button type="submit" className="w-full bg-emerald-600 hover:bg-emerald-500 text-white py-2 rounded-lg font-medium transition-colors flex justify-center items-center gap-2">
               <Icons.Add size={18} /> Añadir Aportación
            </button>
          </form>
        </Card>

        {/* TABLE */}
        <div className="lg:col-span-2">
           <div className="bg-slate-800 border border-slate-700 rounded-xl overflow-hidden shadow-sm">
              <div className="px-6 py-4 border-b border-slate-700 flex justify-between items-center">
                <h3 className="text-lg font-medium text-slate-100">Historial de Aportaciones</h3>
                <span className="text-xs text-emerald-400 font-mono bg-emerald-900/20 px-2 py-1 rounded border border-emerald-900/50">
                   Total: {formatCurrency(sortedEvents.reduce((acc, curr) => acc + curr.amountEur, 0))}
                </span>
              </div>
              <div className="overflow-x-auto max-h-[600px]">
                 <table className="w-full text-sm text-left">
                    <thead className="text-xs text-slate-400 uppercase bg-slate-900/50 sticky top-0">
                       <tr>
                          <th className="px-6 py-3">Fecha</th>
                          <th className="px-6 py-3">Cartera</th>
                          <th className="px-6 py-3">Concepto</th>
                          <th className="px-6 py-3 text-right">Importe</th>
                          <th className="px-6 py-3 text-right">Acción</th>
                       </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-700">
                       {sortedEvents.length === 0 ? (
                         <tr><td colSpan={5} className="px-6 py-8 text-center text-slate-500">No hay aportaciones registradas.</td></tr>
                       ) : (
                         sortedEvents.map((evt) => (
                           <tr key={evt.id} className="hover:bg-slate-700/30">
                              <td className="px-6 py-4 text-slate-300 font-mono text-xs">{evt.date}</td>
                              <td className="px-6 py-4 text-white font-medium">{evt.portfolio}</td>
                              <td className="px-6 py-4 text-slate-300">
                                 {evt.type}
                                 {evt.notes && <div className="text-xs text-slate-500 italic">{evt.notes}</div>}
                              </td>
                              <td className="px-6 py-4 text-right text-emerald-400 font-bold">{formatCurrency(evt.amountEur)}</td>
                              <td className="px-6 py-4 text-right">
                                 <button onClick={() => handleDelete(evt.id)} className="text-slate-500 hover:text-rose-400 p-1">
                                    <Icons.Trash size={16} />
                                 </button>
                              </td>
                           </tr>
                         ))
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