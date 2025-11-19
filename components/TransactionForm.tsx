import React, { useState } from 'react';
import { db } from '../db';
import { useLiveQuery } from 'dexie-react-hooks';
import { AssetType, Currency, PortfolioOwner, TransactionType, DefaultAssetTypes } from '../types';
import { Icons } from './ui/Icons';

interface TransactionFormProps {
  onSuccess: () => void;
  onCancel: () => void;
}

const TransactionForm: React.FC<TransactionFormProps> = ({ onSuccess, onCancel }) => {
  const portfolios = useLiveQuery(() => db.portfolios.toArray()) || [];
  const assetTypes = useLiveQuery(() => db.assetTypes.toArray()) || [];
  
  const [formData, setFormData] = useState({
    date: new Date().toISOString().split('T')[0],
    portfolio: 'Alejandro', // Default fallback
    type: TransactionType.Buy,
    ticker: '',
    assetName: '',
    assetType: DefaultAssetTypes.ActionLong,
    quantity: '',
    price: '',
    commission: '0',
    currencyPlatform: Currency.EUR,
    fxRateToEur: '1',
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await db.transactions.add({
        date: formData.date,
        portfolio: formData.portfolio as PortfolioOwner,
        type: formData.type as TransactionType,
        ticker: formData.ticker.toUpperCase(),
        assetName: formData.assetName,
        assetType: formData.assetType as AssetType,
        quantity: parseFloat(formData.quantity),
        price: parseFloat(formData.price),
        commission: parseFloat(formData.commission),
        currencyPlatform: formData.currencyPlatform as Currency,
        fxRateToEur: parseFloat(formData.fxRateToEur),
      });
      onSuccess();
    } catch (error) {
      console.error("Error adding transaction:", error);
      alert("Error al guardar la transacción");
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    setFormData({ ...formData, [e.target.name]: e.target.value });
  };

  return (
    <div className="bg-slate-800 p-6 rounded-xl border border-slate-700">
      <h3 className="text-lg font-medium text-white mb-4 flex items-center gap-2">
        <Icons.Add size={18} /> Nueva Transacción
      </h3>
      <form onSubmit={handleSubmit} className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        <div>
          <label className="block text-xs text-slate-400 mb-1">Fecha</label>
          <input type="date" name="date" value={formData.date} onChange={handleChange} className="w-full bg-slate-900 border border-slate-700 rounded p-2 text-white focus:border-blue-500 outline-none" required />
        </div>
        <div>
          <label className="block text-xs text-slate-400 mb-1">Cartera</label>
          <select name="portfolio" value={formData.portfolio} onChange={handleChange} className="w-full bg-slate-900 border border-slate-700 rounded p-2 text-white focus:border-blue-500 outline-none">
            {portfolios.length > 0 ? (
              portfolios.map(p => <option key={p.id} value={p.name}>{p.name}</option>)
            ) : (
              <option value="Alejandro">Alejandro</option>
            )}
          </select>
        </div>
        <div>
          <label className="block text-xs text-slate-400 mb-1">Tipo Operación</label>
          <select name="type" value={formData.type} onChange={handleChange} className="w-full bg-slate-900 border border-slate-700 rounded p-2 text-white focus:border-blue-500 outline-none">
            {Object.values(TransactionType).map(t => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>
        
        <div>
          <label className="block text-xs text-slate-400 mb-1">Ticker</label>
          <input type="text" name="ticker" value={formData.ticker} onChange={handleChange} placeholder="Ej. AAPL" className="w-full bg-slate-900 border border-slate-700 rounded p-2 text-white focus:border-blue-500 outline-none" required />
        </div>
        <div>
          <label className="block text-xs text-slate-400 mb-1">Nombre Activo</label>
          <input type="text" name="assetName" value={formData.assetName} onChange={handleChange} placeholder="Ej. Apple Inc" className="w-full bg-slate-900 border border-slate-700 rounded p-2 text-white focus:border-blue-500 outline-none" required />
        </div>
        <div>
          <label className="block text-xs text-slate-400 mb-1">Tipo Activo</label>
          <select name="assetType" value={formData.assetType} onChange={handleChange} className="w-full bg-slate-900 border border-slate-700 rounded p-2 text-white focus:border-blue-500 outline-none">
            {assetTypes.length > 0 ? (
              assetTypes.map(t => <option key={t.id} value={t.name}>{t.name}</option>)
            ) : (
              <option value={DefaultAssetTypes.ActionLong}>{DefaultAssetTypes.ActionLong}</option>
            )}
          </select>
        </div>

        <div>
          <label className="block text-xs text-slate-400 mb-1">Cantidad</label>
          <input type="number" step="0.0001" name="quantity" value={formData.quantity} onChange={handleChange} className="w-full bg-slate-900 border border-slate-700 rounded p-2 text-white focus:border-blue-500 outline-none" required />
        </div>
        <div>
          <label className="block text-xs text-slate-400 mb-1">Precio (Divisa Plat)</label>
          <input type="number" step="0.01" name="price" value={formData.price} onChange={handleChange} className="w-full bg-slate-900 border border-slate-700 rounded p-2 text-white focus:border-blue-500 outline-none" required />
        </div>
        <div>
          <label className="block text-xs text-slate-400 mb-1">Comisión</label>
          <input type="number" step="0.01" name="commission" value={formData.commission} onChange={handleChange} className="w-full bg-slate-900 border border-slate-700 rounded p-2 text-white focus:border-blue-500 outline-none" />
        </div>

        <div>
          <label className="block text-xs text-slate-400 mb-1">Divisa Plataforma</label>
          <select name="currencyPlatform" value={formData.currencyPlatform} onChange={handleChange} className="w-full bg-slate-900 border border-slate-700 rounded p-2 text-white focus:border-blue-500 outline-none">
            {Object.values(Currency).map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs text-slate-400 mb-1">Tipo Cambio a EUR</label>
          <input type="number" step="0.0001" name="fxRateToEur" value={formData.fxRateToEur} onChange={handleChange} className="w-full bg-slate-900 border border-slate-700 rounded p-2 text-white focus:border-blue-500 outline-none" />
        </div>

        <div className="col-span-1 md:col-span-2 lg:col-span-3 flex justify-end gap-3 mt-4">
          <button type="button" onClick={onCancel} className="px-4 py-2 rounded-lg text-slate-300 hover:bg-slate-700 transition-colors">Cancelar</button>
          <button type="submit" className="px-4 py-2 rounded-lg bg-blue-600 text-white hover:bg-blue-500 transition-colors font-medium">Guardar Transacción</button>
        </div>
      </form>
    </div>
  );
};

export default TransactionForm;