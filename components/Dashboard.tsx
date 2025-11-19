import React from 'react';
import { DashboardMetrics, PortfolioOwner } from '../types';
import { StatCard, Card } from './ui/Card';
import { Icons } from './ui/Icons';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';

interface DashboardProps {
  metrics: DashboardMetrics;
  selectedPortfolio: PortfolioOwner | 'ALL';
}

const Dashboard: React.FC<DashboardProps> = ({ metrics, selectedPortfolio }) => {
  const formatCurrency = (val: number) => 
    new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' }).format(val);
  
  const formatPct = (val: number) => 
    new Intl.NumberFormat('es-ES', { style: 'percent', minimumFractionDigits: 2 }).format(val);

  const isProfitable = metrics.totalReturnPct >= 0;

  // Mock data for the chart based on current stats (usually this would be historical)
  const chartData = [
    { name: 'Coste', value: metrics.totalCostEur },
    { name: 'Valor', value: metrics.totalValueEur },
    { name: 'Cierre', value: metrics.projectedCloseEur },
  ];

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold text-white">
          Resumen: <span className="text-blue-400">{selectedPortfolio === 'ALL' ? 'Global' : selectedPortfolio}</span>
        </h2>
        <span className="text-sm text-slate-400">Actualizado hace unos segundos</span>
      </div>

      {/* KPI Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard 
          title="Valor Total Cartera"
          value={formatCurrency(metrics.totalValueEur)}
          subValue={`${formatCurrency(metrics.unrealizedPnLEur)} (${formatPct(metrics.unrealizedPnLPct)})`}
          trend={metrics.unrealizedPnLEur >= 0 ? 'up' : 'down'}
          icon={<Icons.Wallet size={20} />}
        />
        <StatCard 
          title="Total Invertido"
          value={formatCurrency(metrics.totalCostEur)}
          subValue={`Aportado: ${formatCurrency(metrics.totalLiquidityAddedEur)}`}
          trend="neutral"
          icon={<Icons.Arrow size={20} />}
        />
        <StatCard 
          title="G/P Realizada"
          value={formatCurrency(metrics.realizedPnLEur)}
          subValue="Operaciones cerradas"
          trend={metrics.realizedPnLEur >= 0 ? 'up' : 'down'}
          icon={<Icons.Transactions size={20} />}
        />
        <StatCard 
          title="Rentabilidad Total"
          value={formatPct(metrics.totalReturnPct)}
          subValue="Retorno Global Estimado"
          trend={isProfitable ? 'up' : 'down'}
          icon={<Icons.Up size={20} />}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Chart Section */}
        <Card title="Distribución de Valor" className="lg:col-span-2">
          <div className="h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData} layout="vertical" margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#334155" horizontal={false} />
                <XAxis type="number" hide />
                <YAxis dataKey="name" type="category" tick={{ fill: '#94a3b8' }} width={80} />
                <Tooltip 
                  contentStyle={{ backgroundColor: '#1e293b', borderColor: '#334155', color: '#f1f5f9' }}
                  itemStyle={{ color: '#f1f5f9' }}
                  formatter={(value: number) => formatCurrency(value)}
                />
                <Bar dataKey="value" fill="#3b82f6" radius={[0, 4, 4, 0]} barSize={30} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>

        {/* Mini Stats / Actions */}
        <Card title="Indicadores Clave">
          <div className="space-y-4">
             <div className="p-4 bg-slate-700/30 rounded-lg border border-slate-700">
                <p className="text-sm text-slate-400 mb-1">Cierre Total Estimado</p>
                <p className="text-xl font-semibold text-emerald-400">{formatCurrency(metrics.projectedCloseEur)}</p>
                <p className="text-xs text-slate-500 mt-1">Si se liquidara todo hoy</p>
             </div>
             
             <div className="p-4 bg-slate-700/30 rounded-lg border border-slate-700 flex justify-between items-center">
               <div>
                  <p className="text-sm text-slate-400">Posiciones Vivas</p>
                  <p className="text-lg font-medium text-white">Ver detalle</p>
               </div>
               <Icons.Positions className="text-blue-400" size={24} />
             </div>
          </div>
        </Card>
      </div>
    </div>
  );
};

export default Dashboard;