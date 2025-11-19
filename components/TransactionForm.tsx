import React, { useState, useEffect } from 'react';
import { db } from '../db';
import { useLiveQuery } from 'dexie-react-hooks';
import { AssetType, Currency, PortfolioOwner, TransactionType, DefaultAssetTypes, Transaction } from '../types';
import { Icons } from './ui/Icons';
import { getFxRateToEur } from '../services/marketDataService';

interface TransactionFormProps {
  onSuccess: () => void;
  onCancel: () => void;
  initialData?: Transaction; // Optional prop for editing mode
}

const TransactionForm: React.FC<TransactionFormProps> = ({ onSuccess, onCancel, initialData }) => {
  const portfolios = useLiveQuery(() => db.portfolios.toArray()) || [];
  const assetTypes = useLiveQuery(() => db.assetTypes.toArray()) || [];
  
  const [formData, setFormData] = useState({
    date: new Date().toISOString().split('T')[0],
    portfolio: 'Alejandro', 
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

  // Load initial data if editing
  useEffect(() => {
    if (initialData) {
      setFormData({
        date: initialData.date,
        portfolio: initialData.portfolio,
        type: initialData.type,
        ticker: initialData.ticker,
        assetName: initialData.assetName,
        assetType: initialData.assetType,
        quantity: initialData.quantity.toString(),
        price: initialData.price.toString(),
        commission: initialData.commission.toString(),
        currencyPlatform: initialData.currencyPlatform,
        fxRateToEur: initialData.fxRateToEur.toString(),
      });
    }
  }, [initialData]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const payload = {
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
      };

      if (initialData && initialData.id) {
        // Update existing
        await db.transactions.update(initialData.id, payload);
      } else {
        // Create new
        await db.transactions.add(payload);
      }
      onSuccess();
    } catch (error) {
      console.error("Error saving transaction:", error);
      alert("Error al guardar la transacción");
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value } = e.target;

    if (name === 'currencyPlatform') {
      // Auto-fetch FX rate when currency changes
      // getFxRateToEur handles logic: Returns 1 for EUR, or fetched/fallback rate for others
      const newRate = getFxRateToEur(value);
      setFormData({ 
        ...formData, 
        currencyPlatform: value as Currency, 
        fxRateToEur: newRate.toString() 
      });
    } else {
      setFormData({ ...formData, [name]: value });
    }
  };

  const isEditing = !!initialData;

  return (
    <div className="bg-slate-800 p-6 rounded-xl border border-slate-700 mb-6 animate-fade-in">
      <h3 className="text-lg font-medium text-white mb-4 flex items-center gap-2">
        {isEditing ? <Icons.Settings size={18} /> : <Icons.Add size={18} />} 
        {isEditing ? 'Editar Transacción' : 'Nueva Transacción'}
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
          <input type="number" step="0.000001" name="price" value={formData.price} onChange={handleChange} className="w-full bg-slate-900 border border-slate-700 rounded p-2 text-white focus:border-blue-500 outline-none" required />
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
          <input 
            type="number" 
            step="0.0001" 
            name="fxRateToEur" 
            value={formData.fxRateToEur} 
            onChange={handleChange} 
            className="w-full bg-slate-900 border border-slate-700 rounded p-2 text-white focus:border-blue-500 outline-none"
            title="Se calcula automáticamente si la lista de precios está cargada"
          />
        </div>

        <div className="col-span-1 md:col-span-2 lg:col-span-3 flex justify-end gap-3 mt-4">
          <button type="button" onClick={onCancel} className="px-4 py-2 rounded-lg text-slate-300 hover:bg-slate-700 transition-colors">Cancelar</button>
          <button type="submit" className="px-4 py-2 rounded-lg bg-blue-600 text-white hover:bg-blue-500 transition-colors font-medium">
            {isEditing ? 'Guardar Cambios' : 'Crear Transacción'}
          </button>
        </div>
      </form>
    </div>
  );
};

export default TransactionForm;