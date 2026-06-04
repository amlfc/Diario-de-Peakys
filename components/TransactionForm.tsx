
import React, { useState, useEffect, useMemo } from 'react';
import { db } from '../db';
import { useLiveData } from '../hooks/useLiveData'; // CAMBIO
import { AssetType, Currency, PortfolioOwner, TransactionType, DefaultAssetTypes, Transaction } from '../types';
import { Icons } from './ui/Icons';
import { getFxRateToEur } from '../services/marketDataService';
import { normalizeStoredFxRateToEur, parseFxNumber } from '../utils/fx';

interface TransactionFormProps {
  onSuccess: () => void;
  onCancel: () => void;
  initialData?: Transaction;
}

const TransactionForm: React.FC<TransactionFormProps> = ({ onSuccess, onCancel, initialData }) => {
  const portfolios = useLiveData(() => db.portfolios.toArray()) || [];
  const assetTypes = useLiveData(() => db.assetTypes.toArray()) || [];
  
  const [formData, setFormData] = useState({
    date: new Date().toISOString().split('T')[0],
    portfolio: '', 
    type: TransactionType.Buy,
    ticker: '',
    assetName: '',
    assetType: DefaultAssetTypes.ActionLong,
    quantity: '',
    price: '',
    commission: '0',
    currencyPlatform: Currency.EUR,
    fxRateToEur: '0',
    excludeFromMetrics: false,
  });

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
        fxRateToEur: normalizeStoredFxRateToEur(initialData.currencyPlatform, initialData.fxRateToEur).toString(),
        excludeFromMetrics: !!initialData.excludeFromMetrics,
      });
    }
  }, [initialData]);

  useEffect(() => {
    if (initialData) return;
    if (formData.portfolio) return;
    if (portfolios.length === 0) return;

    setFormData(prev => ({ ...prev, portfolio: portfolios[0].name }));
  }, [initialData, formData.portfolio, portfolios]);

  const assetTypeOptions = useMemo(() => {
    const dbOptions = assetTypes
      .map((item) => item?.name?.trim())
      .filter((name): name is string => !!name);

    const baseOptions = dbOptions.length > 0 ? dbOptions : Object.values(DefaultAssetTypes);
    const currentValue = formData.assetType?.trim();

    return Array.from(new Set([
      ...(currentValue ? [currentValue] : []),
      ...baseOptions,
    ]));
  }, [assetTypes, formData.assetType]);

 const handleSubmit = async (e: React.FormEvent) => {
  e.preventDefault();

  if (!formData.portfolio) {
    alert('Primero crea una cartera en Configuración > Mis Carteras.');
    return;
  }

  try {
    const tickerUpper = (formData.ticker || "").toUpperCase().trim();
    const assetNameSafe = (formData.assetName || "").trim() || tickerUpper;

    const currencyPlatform = formData.currencyPlatform as Currency;
    const payload = {
      date: formData.date,
      portfolio: formData.portfolio as PortfolioOwner,
      type: formData.type as TransactionType,
      ticker: tickerUpper,
      assetName: assetNameSafe,
      assetType: formData.assetType as AssetType,
      quantity: parseFloat(formData.quantity),
      price: parseFloat(formData.price),
      commission: parseFloat(formData.commission),
      currencyPlatform,
      fxRateToEur: normalizeStoredFxRateToEur(currencyPlatform, parseFxNumber(formData.fxRateToEur)),
      excludeFromMetrics: !!formData.excludeFromMetrics,
    };

    if (initialData && initialData.id) {
      await db.transactions.update(initialData.id, payload);
    } else {
      await db.transactions.add(payload);
    }
    onSuccess();
  } catch (error) {
    console.error("Error saving transaction:", error);
    alert("Error al guardar la transacción");
  }
};


  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value, type, checked } = e.target as HTMLInputElement;

    if (name === 'currencyPlatform') {
      const newRate = value === Currency.EUR ? 0 : getFxRateToEur(value);
      setFormData({ 
        ...formData, 
        currencyPlatform: value as Currency, 
        fxRateToEur: newRate.toString() 
      });
    } else {
      setFormData({ ...formData, [name]: type === 'checkbox' ? checked : value });
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
          <select name="portfolio" value={formData.portfolio} onChange={handleChange} className="w-full bg-slate-900 border border-slate-700 rounded p-2 text-white focus:border-blue-500 outline-none" required>
            {portfolios.length > 0 ? (
              portfolios.map(p => <option key={p.id} value={p.name}>{p.name}</option>)
            ) : (
              <option value="">Primero crea una cartera en Configuración</option>
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
          <input type="text" name="assetName" value={formData.assetName} onChange={handleChange} placeholder="Ej. Apple Inc" className="w-full bg-slate-900 border border-slate-700 rounded p-2 text-white focus:border-blue-500 outline-none" />
        </div>
        <div>
          <label className="block text-xs text-slate-400 mb-1">Tipo Activo</label>
          <select name="assetType" value={formData.assetType} onChange={handleChange} className="w-full bg-slate-900 border border-slate-700 rounded p-2 text-white focus:border-blue-500 outline-none">
            {assetTypeOptions.map((name) => <option key={name} value={name}>{name}</option>)}
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
          <input type="number" step="0.0001" name="fxRateToEur" value={formData.fxRateToEur} onChange={handleChange} className="w-full bg-slate-900 border border-slate-700 rounded p-2 text-white focus:border-blue-500 outline-none" title="Se calcula automáticamente si la lista de precios está cargada"/>
        </div>



        <div className="md:col-span-2 lg:col-span-3">
          <label className="flex items-start gap-2 text-xs text-slate-300 cursor-pointer">
            <input
              type="checkbox"
              name="excludeFromMetrics"
              checked={formData.excludeFromMetrics}
              onChange={handleChange}
              className="mt-0.5"
            />
            <span>Ignorar en métricas (útil para cambios de divisa o movimientos internos)</span>
          </label>
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
