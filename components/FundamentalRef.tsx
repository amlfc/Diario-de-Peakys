
import React from 'react';
import { FundamentalRef } from '../types';

const REF_DATA: FundamentalRef[] = [
  { metric: 'ROE', reference: 'Superior 20%, estable en tiempo' },
  { metric: 'ROA', reference: 'Superior al 12-15%' },
  { metric: 'Ratio de Liquidez', reference: 'Mayor a 1' },
  { metric: 'Deuda LP', reference: 'Controlada vs EBITDA' },
  { metric: 'EV/EBITDA', reference: 'x10 - x12 razonable' },
  { metric: 'PER', reference: 'Media histórica x15-x20' },
  { metric: 'Crecimiento Ventas', reference: 'Mayor a 8% anual' },
  { metric: 'ROI', reference: 'Mayor a 13%' },
  { metric: 'Flujo de Caja Libre', reference: 'Positivo y creciente' },
];

const FundamentalRefTable: React.FC = () => {
  return (
    <div className="bg-slate-800 border border-slate-700 rounded-xl overflow-hidden">
      <div className="px-6 py-4 border-b border-slate-700">
        <h3 className="text-lg font-medium text-slate-100">Referencias Fundamentales</h3>
      </div>
      <table className="w-full text-sm text-left">
        <thead className="text-xs text-slate-400 uppercase bg-slate-900/50">
          <tr>
            <th className="px-6 py-3">Métrica</th>
            <th className="px-6 py-3">Criterio / Referencia</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-700">
          {REF_DATA.map((row, idx) => (
            <tr key={idx} className="hover:bg-slate-700/30">
              <td className="px-6 py-3 font-medium text-blue-400">{row.metric}</td>
              <td className="px-6 py-3 text-slate-300">{row.reference}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

export default FundamentalRefTable;
