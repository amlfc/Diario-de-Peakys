import React, { useEffect, useState } from 'react';
import { AssetType, Currency, Position, PortfolioOwner, TransactionType } from '../types';
import { db } from '../db';
import { getFxRateToEur } from '../services/marketDataService';
import { Icons } from './ui/Icons';
import { normalizeFxRateToEur, parseFxNumber } from '../utils/fx';

interface ClosePositionModalProps {
  isOpen: boolean;
  position: Position | null;
  onClose: () => void;
}

const ClosePositionModal: React.FC<ClosePositionModalProps> = ({ isOpen, position, onClose }) => {
  const [saving, setSaving] = useState(false);
  const [formData, setFormData] = useState({
    date: new Date().toISOString().split('T')[0],
    portfolio: '',
    type: TransactionType.Sell,
    ticker: '',
    assetName: '',
    assetType: '',
    quantity: '',
    price: '',
    commission: '0',
    currencyPlatform: Currency.EUR,
    fxRateToEur: '1',
  });

  useEffect(() => {
    if (!isOpen || !position) return;

    const defaultFx = position.currentFxRateToEur || getFxRateToEur(position.currencyPlatform);

    setFormData({
      date: new Date().toISOString().split('T')[0],
      portfolio: position.portfolio,
      type: TransactionType.Sell,
      ticker: position.ticker,
      assetName: position.assetName,
      assetType: position.assetType,
      quantity: position.quantity.toString(),
      price: '',
      commission: '0',
      currencyPlatform: position.currencyPlatform,
      fxRateToEur: defaultFx.toString(),
    });
  }, [isOpen, position]);

  useEffect(() => {
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };

    if (isOpen) window.addEventListener('keydown', onEsc);
    return () => window.removeEventListener('keydown', onEsc);
  }, [isOpen, onClose]);

  if (!isOpen || !position) return null;

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value } = e.target;

    if (name === 'currencyPlatform') {
      const nextRate = getFxRateToEur(value);
      setFormData((prev) => ({
        ...prev,
        currencyPlatform: value as Currency,
        fxRateToEur: nextRate.toString(),
      }));
      return;
    }

    setFormData((prev) => ({ ...prev, [name]: value }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    try {
      setSaving(true);
      await db.transactions.add({
        date: formData.date,
        portfolio: formData.portfolio as PortfolioOwner,
        type: formData.type,
        ticker: formData.ticker.toUpperCase().trim(),
        assetName: formData.assetName.trim() || formData.ticker.toUpperCase().trim(),
        assetType: formData.assetType as AssetType,
        quantity: parseFloat(formData.quantity),
        price: parseFloat(formData.price),
        commission: parseFloat(formData.commission || '0'),
        currencyPlatform: formData.currencyPlatform,
        fxRateToEur: normalizeFxRateToEur(formData.currencyPlatform, parseFxNumber(formData.fxRateToEur)),
      });
      onClose();
    } catch (error) {
      console.error('Error al guardar la venta', error);
      alert('No se pudo registrar la venta');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />

      <div className="relative w-[95vw] max-w-3xl bg-slate-800 border border-slate-700 rounded-xl shadow-xl">
        <div className="px-5 py-4 border-b border-slate-700 flex items-center justify-between">
          <h3 className="text-slate-100 font-medium flex items-center gap-2">
            <Icons.Down size={18} /> Cerrar posición · {position.ticker}
          </h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-200 transition-colors" title="Cerrar">
            ✕
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          <div>
            <label className="block text-xs text-slate-400 mb-1">Fecha</label>
            <input required type="date" name="date" value={formData.date} onChange={handleChange} className="w-full bg-slate-900 border border-slate-700 rounded p-2 text-white" />
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1">Cartera</label>
            <input required type="text" name="portfolio" value={formData.portfolio} onChange={handleChange} className="w-full bg-slate-900 border border-slate-700 rounded p-2 text-white" />
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1">Tipo</label>
            <select name="type" value={formData.type} onChange={handleChange} className="w-full bg-slate-900 border border-slate-700 rounded p-2 text-white">
              {Object.values(TransactionType).map((type) => (
                <option key={type} value={type}>{type}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs text-slate-400 mb-1">Ticker</label>
            <input required type="text" name="ticker" value={formData.ticker} onChange={handleChange} className="w-full bg-slate-900 border border-slate-700 rounded p-2 text-white" />
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1">Nombre activo</label>
            <input type="text" name="assetName" value={formData.assetName} onChange={handleChange} className="w-full bg-slate-900 border border-slate-700 rounded p-2 text-white" />
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1">Tipo activo</label>
            <input type="text" name="assetType" value={formData.assetType} onChange={handleChange} className="w-full bg-slate-900 border border-slate-700 rounded p-2 text-white" />
          </div>

          <div>
            <label className="block text-xs text-slate-400 mb-1">Cantidad</label>
            <input required type="number" step="0.0001" name="quantity" value={formData.quantity} onChange={handleChange} className="w-full bg-slate-900 border border-slate-700 rounded p-2 text-white" />
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1">Precio venta</label>
            <input required type="number" step="0.000001" name="price" value={formData.price} onChange={handleChange} placeholder="Introduce el precio" className="w-full bg-slate-900 border border-blue-500 rounded p-2 text-white" />
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1">Comisión</label>
            <input type="number" step="0.01" name="commission" value={formData.commission} onChange={handleChange} className="w-full bg-slate-900 border border-slate-700 rounded p-2 text-white" />
          </div>

          <div>
            <label className="block text-xs text-slate-400 mb-1">Divisa plataforma</label>
            <select name="currencyPlatform" value={formData.currencyPlatform} onChange={handleChange} className="w-full bg-slate-900 border border-slate-700 rounded p-2 text-white">
              {Object.values(Currency).map((currency) => (
                <option key={currency} value={currency}>{currency}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1">Tipo cambio EUR</label>
            <input required type="number" step="0.0001" name="fxRateToEur" value={formData.fxRateToEur} onChange={handleChange} className="w-full bg-slate-900 border border-slate-700 rounded p-2 text-white" />
          </div>

          <div className="md:col-span-2 lg:col-span-3 flex justify-end gap-3 mt-2">
            <button type="button" onClick={onClose} className="px-4 py-2 rounded-lg text-slate-300 hover:bg-slate-700 transition-colors" disabled={saving}>Cancelar</button>
            <button type="submit" className="px-4 py-2 rounded-lg bg-blue-600 text-white hover:bg-blue-500 transition-colors font-medium" disabled={saving}>
              {saving ? 'Guardando...' : 'Registrar venta'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default ClosePositionModal;
