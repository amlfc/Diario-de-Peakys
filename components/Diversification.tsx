import React, { useMemo, useState, useEffect } from 'react';
import { Position, DashboardMetrics, PortfolioOwner, PositionNote } from '../types';
import { Card } from './ui/Card';
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import { db } from '../db';
import { useLiveData } from '../hooks/useLiveData';
import { Icons } from './ui/Icons';
import PositionNotesModal from './PositionNotesModal';

interface DiversificationProps {
  positions: Position[];
  metrics: DashboardMetrics;
  selectedPortfolio: PortfolioOwner | 'ALL';
}

const COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#64748b', '#0ea5e9', '#d946ef'];

const TargetInput: React.FC<{
  assetType: string;
  initialValue: number;
  onSave: (type: string, val: string) => void;
}> = ({ assetType, initialValue, onSave }) => {
  const [val, setVal] = useState(initialValue.toString());

  useEffect(() => {
    setVal(initialValue.toString());
  }, [initialValue]);

  const handleBlur = () => {
    if (val !== initialValue.toString()) {
      onSave(assetType, val);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      (e.target as HTMLInputElement).blur();
    }
  };

  return (
    <div className="flex items-center justify-center">
      <input
        type="number"
        className="w-16 bg-slate-900 border border-slate-600 rounded px-1 py-0.5 text-center text-white focus:border-blue-500 outline-none text-xs"
        value={val}
        placeholder="0"
        onChange={(e) => setVal(e.target.value)}
        onBlur={handleBlur}
        onKeyDown={handleKeyDown}
      />
      <span className="ml-1 text-slate-500">%</span>
    </div>
  );
};

const Diversification: React.FC<DiversificationProps> = ({ positions, metrics, selectedPortfolio }) => {
  const allAssetTypes = useLiveData(() => db.assetTypes.toArray()) || [];
  const positionNotes = useLiveData(() => db.positionNotes.toArray()) || [];

  const notesByKey = useMemo(() => {
    const map = new Map<string, PositionNote>();
    for (const n of positionNotes) {
      if (n && n.positionKey) map.set(n.positionKey, n);
    }
    return map;
  }, [positionNotes]);

  const [notesModal, setNotesModal] = useState<{
    open: boolean;
    title: string;
    key: string;
    portfolio: PortfolioOwner | null;
    assetType: string;
    initialNote: string;
  }>({ open: false, title: '', key: '', portfolio: null, assetType: '', initialNote: '' });

  const makeDivKey = (portfolio: PortfolioOwner, assetType: string) => `DIV-${portfolio}-${assetType}`;

  const targets = useLiveData(async () => {
    if (selectedPortfolio === 'ALL') return await db.allocationTargets.toArray();
    const all = await db.allocationTargets.toArray();
    return all.filter((t) => t.portfolio === selectedPortfolio);
  }, [selectedPortfolio]);

  // La diversificacion se calcula sobre el patrimonio actual de la cartera visible.
  // Usamos valor de mercado para que activos + liquidez cuadren con ese patrimonio.
  const currentValuesMap = new Map<string, number>();
  let totalCurrentValue = 0;

  positions.forEach((pos) => {
    const currentVal = currentValuesMap.get(pos.assetType) || 0;
    currentValuesMap.set(pos.assetType, currentVal + pos.currentValueEur);
    totalCurrentValue += pos.currentValueEur;
  });

  const pieData = Array.from(currentValuesMap.entries())
    .map(([name, value]) => ({ name, value }))
    .sort((a, b) => b.value - a.value);

  const formatCurrency = (val: number) =>
    new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(val);

  const formatSignedCurrency = (val: number) =>
    new Intl.NumberFormat('es-ES', {
      style: 'currency',
      currency: 'EUR',
      maximumFractionDigits: 0,
      signDisplay: 'always',
    }).format(val);

  const referenceCapital = metrics.totalValueEur + metrics.availableCashEur;
  const unallocatedLiquidity = metrics.availableCashEur;

  const handleTargetChange = async (assetType: string, newVal: string) => {
    if (selectedPortfolio === 'ALL') return;
    const val = parseFloat(newVal);
    if (isNaN(val)) return;

    const existing = targets?.find((t) => t.assetType === assetType);
    if (existing && existing.id) {
      await db.allocationTargets.update(existing.id, { targetPercentage: val });
    } else {
      await db.allocationTargets.add({
        portfolio: selectedPortfolio,
        assetType: assetType,
        targetPercentage: val,
      });
    }
  };

  const openDivNotes = (assetType: string) => {
    if (selectedPortfolio === 'ALL') return;
    const key = makeDivKey(selectedPortfolio, assetType);
    const existing = notesByKey.get(key);

    setNotesModal({
      open: true,
      title: `Notas · ${assetType} · ${selectedPortfolio}`,
      key,
      portfolio: selectedPortfolio,
      assetType,
      initialNote: existing?.note || '',
    });
  };

  const saveDivNotes = async (key: string, portfolio: PortfolioOwner, assetType: string, note: string) => {
    const now = new Date().toISOString();
    const existing = notesByKey.get(key);

    if (existing && existing.id) {
      await db.positionNotes.update(existing.id, { note, updatedAt: now });
      return;
    }

    await db.positionNotes.add({
      positionKey: key,
      portfolio,
      ticker: assetType,
      openedDate: 'DIV',
      note,
      updatedAt: now,
    });
  };

  const uniqueAssetTypes = Array.from(new Set([...allAssetTypes.map((a) => a.name), ...Array.from(currentValuesMap.keys())])).sort();

  return (
    <Card title={`Diversificación: ${selectedPortfolio === 'ALL' ? 'Global' : selectedPortfolio}`} className="h-full min-h-[500px]">
      <div className="flex flex-col xl:flex-row h-full gap-8">
        <div className="w-full xl:w-1/3 h-64 xl:h-auto flex flex-col items-center justify-center relative">
          {totalCurrentValue > 0 ? (
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={pieData} cx="50%" cy="50%" innerRadius={60} outerRadius={80} paddingAngle={5} dataKey="value">
                  {pieData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} stroke="#1e293b" strokeWidth={2} />
                  ))}
                </Pie>
                <Tooltip
                  contentStyle={{ backgroundColor: '#1e293b', borderColor: '#334155', color: '#f1f5f9' }}
                  formatter={(value: number) => formatCurrency(value)}
                />
                <Legend layout="horizontal" verticalAlign="bottom" align="center" wrapperStyle={{ fontSize: '10px', marginTop: '10px' }} />
              </PieChart>
            </ResponsiveContainer>
          ) : (
            <div className="text-slate-500 text-sm">Sin datos para mostrar gráfico</div>
          )}

          <div className="absolute top-0 right-0 text-xs text-right text-slate-500 bg-slate-900/50 p-2 rounded">
            <div className="font-medium text-slate-300">Capital Referencia</div>
            <div>{formatCurrency(referenceCapital)}</div>
            <div className="text-[10px] mt-1">(Patrimonio Total)</div>
          </div>
        </div>

        <div className="w-full xl:w-2/3 overflow-x-auto">
          {selectedPortfolio === 'ALL' && (
            <div className="mb-4 p-3 bg-blue-900/20 border border-blue-800 rounded text-blue-300 text-sm">
              Selecciona una cartera específica arriba para editar los Objetivos %. En vista Global se muestra la suma de objetivos.
            </div>
          )}

          <table className="w-full text-sm text-left">
            <thead className="text-xs text-slate-400 uppercase bg-slate-900/50 border-b border-slate-700">
              <tr>
                <th className="px-4 py-3">Tipo Activo</th>
                <th className="px-4 py-3 text-right">Valor actual €</th>
                <th className="px-4 py-3 text-right">Valor actual %</th>
                <th className="px-4 py-3 text-center w-24">Obj %</th>
                <th className="px-4 py-3 text-right">Obj €</th>
                <th className="px-4 py-3 text-right">Δ €</th>
                <th className="px-4 py-3 text-center">Estado</th>
              </tr>
            </thead>

            <tbody className="divide-y divide-slate-700">
              {uniqueAssetTypes.map((type) => {
                const currentVal = currentValuesMap.get(type) || 0;
                const currentPct = referenceCapital > 0 ? (currentVal / referenceCapital) * 100 : 0;

                let targetPct = 0;
                let hasTarget = false;

                if (selectedPortfolio !== 'ALL') {
                  const t = targets?.find((tt) => tt.assetType === type);
                  hasTarget = !!t;
                  targetPct = t?.targetPercentage ?? 0;
                }

                const targetVal = referenceCapital * (targetPct / 100);
                const deltaVal = hasTarget ? targetVal - currentVal : 0;

                const deltaClass =
                  selectedPortfolio === 'ALL' || !hasTarget
                    ? 'text-slate-600'
                    : Math.abs(deltaVal) < 1
                      ? 'text-emerald-400'
                      : deltaVal > 0
                        ? 'text-blue-400'
                        : 'text-rose-400';

                let statusColor = 'text-slate-500';
                let statusText = '-';

                if (hasTarget) {
                  if (targetVal === 0) {
                    if (currentVal > 0) {
                      statusColor = 'text-rose-400 font-bold';
                      statusText = 'Vender';
                    } else {
                      statusColor = 'text-emerald-400 font-bold';
                      statusText = 'OK';
                    }
                  } else {
                    const ratio = currentVal / targetVal;
                    if (ratio < 0.9) {
                      statusColor = 'text-blue-400 font-bold';
                      statusText = 'Comprar';
                    } else if (ratio > 1.1) {
                      statusColor = 'text-rose-400 font-bold';
                      statusText = 'Vender';
                    } else {
                      statusColor = 'text-emerald-400 font-bold';
                      statusText = 'OK';
                    }
                  }
                }

                return (
                  <tr key={type} className="hover:bg-slate-700/30">
                    <td className="px-4 py-3 font-medium text-slate-200">
                      <div className="flex items-center gap-2">
                        <span>{type}</span>

                        <button
                          type="button"
                          onClick={() => openDivNotes(type)}
                          disabled={selectedPortfolio === 'ALL'}
                          title={
                            selectedPortfolio === 'ALL'
                              ? 'Selecciona una cartera (no Global)'
                              : ((notesByKey.get(selectedPortfolio === 'ALL' ? '' : makeDivKey(selectedPortfolio as PortfolioOwner, type))?.note || '').trim()
                                    .length > 0
                                  ? 'Ver/editar notas'
                                  : 'Añadir notas')
                          }
                          className={(() => {
                            if (selectedPortfolio === 'ALL') return 'p-1 rounded opacity-30 cursor-not-allowed';
                            const key = makeDivKey(selectedPortfolio as PortfolioOwner, type);
                            const hasNote = (notesByKey.get(key)?.note || '').trim().length > 0;
                            return `p-1 rounded transition-colors ${
                              hasNote ? 'text-emerald-400 hover:bg-emerald-900/20' : 'text-slate-400 hover:bg-slate-700/50'
                            }`;
                          })()}
                        >
                          <Icons.PDF size={14} />
                        </button>
                      </div>
                    </td>

                    <td className="px-4 py-3 text-right text-slate-300">{formatCurrency(currentVal)}</td>
                    <td className="px-4 py-3 text-right text-slate-400">{currentPct.toFixed(1)}%</td>

                    <td className="px-4 py-3 text-center">
                      {selectedPortfolio !== 'ALL' ? (
                        <TargetInput assetType={type} initialValue={targetPct} onSave={handleTargetChange} />
                      ) : (
                        <span className="text-slate-600">-</span>
                      )}
                    </td>

                    <td className="px-4 py-3 text-right text-slate-500">{hasTarget ? formatCurrency(targetVal) : '-'}</td>

                    <td className={`px-4 py-3 text-right ${deltaClass}`}>
                      {selectedPortfolio !== 'ALL' && hasTarget ? formatSignedCurrency(deltaVal) : '-'}
                    </td>

                    <td className={`px-4 py-3 text-center ${statusColor} text-xs uppercase tracking-wide`}>{statusText}</td>
                  </tr>
                );
              })}

              <tr className="bg-slate-800/50 border-t border-slate-600 font-medium">
                <td className="px-4 py-3 text-slate-200">Liquidez / Sin Asignar</td>
                <td className="px-4 py-3 text-right text-white">{formatCurrency(unallocatedLiquidity)}</td>
                <td className="px-4 py-3 text-right text-slate-400">
                  {(referenceCapital > 0 ? (unallocatedLiquidity / referenceCapital) * 100 : 0).toFixed(1)}%
                </td>
                <td colSpan={4}></td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <PositionNotesModal
        isOpen={notesModal.open}
        title={notesModal.title}
        initialNote={notesModal.initialNote}
        onClose={() => setNotesModal({ open: false, title: '', key: '', portfolio: null, assetType: '', initialNote: '' })}
        onSave={(note) => {
          if (!notesModal.portfolio) return;
          return saveDivNotes(notesModal.key, notesModal.portfolio, notesModal.assetType, note);
        }}
      />
    </Card>
  );
};

export default Diversification;


