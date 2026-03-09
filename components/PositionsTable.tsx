
import React, { useMemo, useState } from 'react';
import { Position, Currency, PositionNote, Transaction, TransactionType, DefaultAssetTypes } from '../types';
import { Icons } from './ui/Icons';
import { useLiveData } from '../hooks/useLiveData'; // CAMBIO
import { db } from '../db';
import PositionNotesModal from './PositionNotesModal';
import { getRiskLevelsConfig } from '../utils/riskLevels';
import ClosePositionModal from './ClosePositionModal';

interface PositionsTableProps {
  positions: Position[];
}

const PositionsTable: React.FC<PositionsTableProps> = ({ positions }) => {
  
  const assetTypes = useLiveData(() => db.assetTypes.toArray()) || [];
  const transactions = useLiveData(() => db.transactions.toArray()) || [];
  const positionNotes = useLiveData(() => db.positionNotes.toArray()) || [];

  const [notesModal, setNotesModal] = useState<{
    open: boolean;
    title: string;
    key: string;
    portfolio: string;
    ticker: string;
    initialNote: string;
  }>({ open: false, title: '', key: '', portfolio: '', ticker: '', initialNote: '' });

  const [closePositionModal, setClosePositionModal] = useState<{
    open: boolean;
    position: Position | null;
  }>({ open: false, position: null });

  const [manualOrdersByPosition, setManualOrdersByPosition] = useState<Record<string, { stopPrice?: string; trailingActivationPrice?: string }>>(() => {
    try {
      const raw = localStorage.getItem('POSITION_MANUAL_ORDERS');
      return raw ? JSON.parse(raw) : {};
    } catch {
      return {};
    }
  });

  const formatCurrency = (val: number, currency: string = Currency.EUR) => 
    new Intl.NumberFormat('es-ES', { style: 'currency', currency }).format(val);

  const formatPct = (val: number) => 
    new Intl.NumberFormat('es-ES', { style: 'percent', minimumFractionDigits: 2 }).format(val);

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

  const notesByKey = useMemo(() => {
    const map = new Map<string, PositionNote>();
    for (const n of positionNotes) {
      if (n && n.positionKey) map.set(n.positionKey, n);
    }
    return map;
  }, [positionNotes]);

  const computePositionKey = (portfolio: string, ticker: string) => {
    const txs = (transactions as Transaction[])
      .filter(t => (t.portfolio || '') === portfolio && (t.ticker || '').toUpperCase() === ticker.toUpperCase())
      .slice()
      .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

    let net = 0;
    let lastOpenDate: string | null = null;

    for (const tx of txs) {
      const qty = typeof tx.quantity === 'number' ? tx.quantity : parseFloat(String(tx.quantity || 0));
      const isBuy = tx.type === TransactionType.Buy;
      const prev = net;
      net = isBuy ? (net + qty) : (net - qty);

      if (prev <= 0.0001 && net > 0.0001) {
        lastOpenDate = tx.date;
      }
      // When net goes back to 0, the cycle is closed; next open will overwrite lastOpenDate
    }

    // Fallback: if we couldn't infer the open date, we still want a stable key
    const openDate = lastOpenDate || 'UNKNOWN';
    return `${portfolio}-${ticker}-${openDate}`;
  };

  const riskConfig = getRiskLevelsConfig();

  const assetTypeOptions = useMemo(() => {
    const dbOptions = assetTypes
      .map((item) => item?.name?.trim())
      .filter((name): name is string => !!name);

    return dbOptions.length > 0 ? Array.from(new Set(dbOptions)) : Object.values(DefaultAssetTypes);
  }, [assetTypes]);

  const updateManualOrder = (positionKey: string, field: 'stopPrice' | 'trailingActivationPrice', value: string) => {
    setManualOrdersByPosition(prev => {
      const next = {
        ...prev,
        [positionKey]: {
          ...prev[positionKey],
          [field]: value
        }
      };
      localStorage.setItem('POSITION_MANUAL_ORDERS', JSON.stringify(next));
      return next;
    });
  };

  const openNotes = (pos: Position) => {
    const key = computePositionKey(pos.portfolio, pos.ticker);
    const existing = notesByKey.get(key);
    setNotesModal({
      open: true,
      title: `Notas · ${pos.ticker} · ${pos.portfolio}`,
      key,
      portfolio: pos.portfolio,
      ticker: pos.ticker,
      initialNote: existing?.note || ''
    });
  };

  const saveNotes = async (key: string, portfolio: string, ticker: string, note: string) => {
    const now = new Date().toISOString();
    const existing = notesByKey.get(key);

    if (existing && existing.id) {
      await db.positionNotes.update(existing.id, { note, updatedAt: now });
      return;
    }

    // Parse key to get openedDate
    const openedDate = key.split('-').slice(2).join('-') || 'UNKNOWN';
    await db.positionNotes.add({
      positionKey: key,
      portfolio,
      ticker,
      openedDate,
      note,
      updatedAt: now
    });
  };

  const sortedPositions = [...positions].sort((a, b) => b.currentValueEur - a.currentValueEur);

  return (
    <>
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
              <th className="px-4 py-3 text-right bg-slate-800/30 border-l border-slate-700">Valor (Orig)</th>
              <th className="px-4 py-3 text-right bg-slate-800/30">G/P (Orig)</th>
              <th className="px-4 py-3 text-right border-l border-slate-700">Valor (EUR)</th>
              <th className="px-4 py-3 text-right">G/P Lat. (EUR)</th>
              <th className="px-4 py-3 text-right">%</th>
              <th className="px-4 py-3 text-right border-l border-slate-700">Stops Auto</th>
              <th className="px-4 py-3 text-right">TP/Trail Auto</th>
              <th className="px-4 py-3 text-right">Stop Manual</th>
              <th className="px-4 py-3 text-right">TP/Trail Manual</th>
              <th className="px-4 py-3 text-center">Acciones</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-700">
            {sortedPositions.length === 0 ? (
              <tr><td colSpan={16} className="px-6 py-8 text-center text-slate-500">No hay posiciones abiertas para esta selección.</td></tr>
            ) : (
              sortedPositions.map((pos) => {
                const isProfitEur = pos.unrealizedPnLEur >= 0;
                const isProfitOrigin = pos.unrealizedPnLOrigin >= 0;
                const isDifferentCurrency = pos.currencyOrigin !== Currency.EUR;
                const positionKey = computePositionKey(pos.portfolio, pos.ticker);
                const noteText = notesByKey.get(positionKey)?.note || '';
                const hasNote = noteText.trim().length > 0;
                const avgBuyPrice = pos.avgPricePlatform;
                const autoStops = riskConfig.stopPercents.map(level => ({
                  level,
                  price: avgBuyPrice * (1 - level / 100)
                }));
                const autoTrails = riskConfig.trailingPercents.map(level => ({
                  level,
                  price: avgBuyPrice * (1 + level / 100)
                }));
                const manualOrders = manualOrdersByPosition[positionKey] || {};
                const rowAssetTypeOptions = Array.from(new Set([
                  ...(pos.assetType ? [pos.assetType] : []),
                  ...assetTypeOptions
                ]));

                return (
                  <tr key={`${pos.portfolio}-${pos.ticker}`} className="hover:bg-slate-700/30 transition-colors">
                    <td className="px-4 py-4 font-medium text-white">
                      <div className="flex items-center gap-2">
                        <span>{pos.ticker}</span>
                        <button
                          type="button"
                          onClick={() => openNotes(pos)}
                          title={hasNote ? 'Ver/editar notas' : 'Añadir notas'}
                          className={`p-1 rounded transition-colors ${hasNote ? 'text-emerald-400 hover:bg-emerald-900/20' : 'text-slate-400 hover:bg-slate-700/50'}`}
                        >
                          <Icons.PDF size={14} />
                        </button>
                      </div>
                    </td>
                    <td className="px-4 py-4 text-slate-300 max-w-[150px] truncate" title={pos.assetName}>{pos.assetName}</td>
                    <td className="px-4 py-4">
                      <select 
                        value={pos.assetType}
                        onChange={(e) => handleTypeChange(pos.portfolio, pos.ticker, e.target.value)}
                        className="bg-slate-900 border border-slate-600 text-slate-300 text-xs rounded px-2 py-1 focus:border-blue-500 outline-none max-w-[140px]"
                      >
                        {rowAssetTypeOptions.map((name) => <option key={name} value={name}>{name}</option>)}
                      </select>
                    </td>
                    <td className="px-4 py-4 text-slate-400">{pos.portfolio}</td>
                    <td className="px-4 py-4 text-center text-blue-300 font-mono text-xs">{pos.currencyOrigin}</td>
                    <td className="px-4 py-4 text-right text-slate-300">{pos.quantity.toFixed(2)}</td>
                    <td className="px-4 py-4 text-right bg-slate-800/30 border-l border-slate-700 text-slate-300">
                       {isDifferentCurrency ? formatCurrency(pos.currentValueOrigin, pos.currencyOrigin) : '-'}
                    </td>
                    <td className={`px-4 py-4 text-right bg-slate-800/30 font-medium ${isProfitOrigin ? 'text-emerald-400' : 'text-rose-400'}`}>
                       {isDifferentCurrency ? formatCurrency(pos.unrealizedPnLOrigin, pos.currencyOrigin) : '-'}
                    </td>
                    <td className="px-4 py-4 text-right border-l border-slate-700 text-white font-bold">
                      {formatCurrency(pos.currentValueEur, Currency.EUR)}
                    </td>
                    <td className={`px-4 py-4 text-right font-medium ${isProfitEur ? 'text-emerald-400' : 'text-rose-400'}`}>
                      {formatCurrency(pos.unrealizedPnLEur, Currency.EUR)}
                    </td>
                    <td className={`px-4 py-4 text-right font-medium ${isProfitEur ? 'text-emerald-400' : 'text-rose-400'}`}>
                      {formatPct(pos.unrealizedPnLPct)}
                    </td>
                    <td className="px-4 py-4 text-right border-l border-slate-700">
                      <div className="space-y-1 font-mono text-xs">
                        {autoStops.map((item, index) => (
                          <div key={`stop-${positionKey}-${index}`} className="text-rose-300">
                            S{index + 1} ({item.level}%): {formatCurrency(item.price, pos.currencyPlatform)}
                          </div>
                        ))}
                      </div>
                    </td>
                    <td className="px-4 py-4 text-right">
                      <div className="space-y-1 font-mono text-xs">
                        {autoTrails.map((item, index) => (
                          <div key={`trail-${positionKey}-${index}`} className="text-emerald-300">
                            TP{index + 1} ({item.level}%): {formatCurrency(item.price, pos.currencyPlatform)}
                          </div>
                        ))}
                      </div>
                    </td>
                    <td className="px-4 py-4 text-right">
                      <input
                        type="number"
                        step="0.01"
                        value={manualOrders.stopPrice || ''}
                        onChange={(e) => updateManualOrder(positionKey, 'stopPrice', e.target.value)}
                        placeholder="Ej. 125.50"
                        className="w-28 bg-slate-900 border border-slate-700 rounded p-1.5 text-white text-xs text-right focus:border-blue-500 outline-none"
                      />
                    </td>
                    <td className="px-4 py-4 text-right">
                      <input
                        type="number"
                        step="0.01"
                        value={manualOrders.trailingActivationPrice || ''}
                        onChange={(e) => updateManualOrder(positionKey, 'trailingActivationPrice', e.target.value)}
                        placeholder="Ej. 148.00"
                        className="w-28 bg-slate-900 border border-slate-700 rounded p-1.5 text-white text-xs text-right focus:border-blue-500 outline-none"
                      />
                    </td>
                    <td className="px-4 py-4 text-center">
                      <button
                        type="button"
                        onClick={() => setClosePositionModal({ open: true, position: pos })}
                        className="inline-flex items-center gap-1 px-3 py-1.5 text-xs rounded-lg bg-rose-600/90 text-white hover:bg-rose-500 transition-colors"
                        title="Cerrar posición con venta"
                      >
                        <Icons.Down size={13} /> Cerrar
                      </button>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>

    <PositionNotesModal
      isOpen={notesModal.open}
      title={notesModal.title}
      initialNote={notesModal.initialNote}
      onClose={() => setNotesModal({ open: false, title: '', key: '', portfolio: '', ticker: '', initialNote: '' })}
      onSave={(note) => saveNotes(notesModal.key, notesModal.portfolio, notesModal.ticker, note)}
    />

    <ClosePositionModal
      isOpen={closePositionModal.open}
      position={closePositionModal.position}
      onClose={() => setClosePositionModal({ open: false, position: null })}
    />
    </>
  );
};

export default PositionsTable;
