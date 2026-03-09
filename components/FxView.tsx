import React, { useEffect, useMemo, useState } from 'react';
import {
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  Pie,
  PieChart,
  PolarAngleAxis,
  RadialBar,
  RadialBarChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  FxCarryResponse,
  FxCorrelationMatrixResponse,
  FxDxyImpactResponse,
  FxExposureResponse,
  FxOverviewResponse,
  FxStressResponse,
  PortfolioOwner,
  User,
} from '../types';
import { fxApiService } from '../services/fxApiService';
import { Card } from './ui/Card';
import { Icons } from './ui/Icons';

interface FxViewProps {
  selectedPortfolio: PortfolioOwner | 'ALL';
  user: User | null;
}

type FxPanel = 'exposure' | 'carry' | 'dxy' | 'stress';

const COLORS = ['#0ea5e9', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899'];
const SCENARIO_OPTIONS = ['usd_rally', 'eur_crash', 'risk_off', 'carry_unwind', 'custom'];
const CUSTOM_FIELDS = ['USD', 'JPY', 'CHF', 'MXN', 'TRY', 'GBP'];

const formatCurrency = (value: number) =>
  new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(value || 0);
const formatPct = (value: number, digits = 1) => `${(value || 0).toFixed(digits)}%`;
const formatSignedPct = (value: number, digits = 1) => `${value >= 0 ? '+' : ''}${(value || 0).toFixed(digits)}%`;

const alertClass = (severity: string) =>
  severity === 'high'
    ? 'border-rose-700/50 bg-rose-900/20 text-rose-200'
    : severity === 'medium'
      ? 'border-amber-700/50 bg-amber-900/20 text-amber-200'
      : 'border-slate-700 bg-slate-900/60 text-slate-200';

const FxView: React.FC<FxViewProps> = ({ selectedPortfolio, user }) => {
  const [panel, setPanel] = useState<FxPanel>('exposure');
  const [overview, setOverview] = useState<FxOverviewResponse | null>(null);
  const [carry, setCarry] = useState<FxCarryResponse | null>(null);
  const [exposure, setExposure] = useState<FxExposureResponse | null>(null);
  const [dxyImpact, setDxyImpact] = useState<FxDxyImpactResponse | null>(null);
  const [correlations, setCorrelations] = useState<FxCorrelationMatrixResponse | null>(null);
  const [stress, setStress] = useState<FxStressResponse | null>(null);
  const [scenario, setScenario] = useState('usd_rally');
  const [customShocks, setCustomShocks] = useState<Record<string, string>>({
    USD: '4.6',
    JPY: '0',
    CHF: '0',
    MXN: '0',
    TRY: '0',
    GBP: '0',
  });
  const [loading, setLoading] = useState(false);
  const [stressLoading, setStressLoading] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const [showStressHedge, setShowStressHedge] = useState(false);

  const isConfigured = fxApiService.isConfigured();

  const alerts = useMemo(() => {
    const map = new Map<string, any>();
    [...(overview?.alerts || []), ...(carry?.alerts || []), ...(dxyImpact?.alerts || [])].forEach((alert) => {
      map.set(`${alert.kind}-${alert.title}`, alert);
    });
    return Array.from(map.values());
  }, [overview, carry, dxyImpact]);

  useEffect(() => {
    if (!isConfigured) return;
    let cancelled = false;

    const load = async () => {
      setLoading(true);
      const results = await Promise.allSettled([
        fxApiService.getOverview(),
        fxApiService.getCarry(),
        fxApiService.getExposure(user, selectedPortfolio),
        fxApiService.getDxyImpact(user, selectedPortfolio),
        fxApiService.getCorrelationMatrix(),
      ]);
      if (cancelled) return;

      const nextErrors: string[] = [];
      if (results[0].status === 'fulfilled') setOverview(results[0].value);
      else nextErrors.push('overview');
      if (results[1].status === 'fulfilled') setCarry(results[1].value);
      else nextErrors.push('carry');
      if (results[2].status === 'fulfilled') setExposure(results[2].value);
      else nextErrors.push('exposure');
      if (results[3].status === 'fulfilled') setDxyImpact(results[3].value);
      else nextErrors.push('dxy');
      if (results[4].status === 'fulfilled') setCorrelations(results[4].value);
      else nextErrors.push('correlations');

      setErrors(nextErrors);
      setLoading(false);
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, [isConfigured, selectedPortfolio, user]);

  useEffect(() => {
    if (!isConfigured) return;
    void runStressTest(scenario);
  }, [isConfigured, selectedPortfolio, user]);

  const runStressTest = async (nextScenario: string) => {
    if (!isConfigured) return;
    setStressLoading(true);
    const parsedShocks = Object.fromEntries(
      Object.entries(customShocks)
        .map(([currency, value]) => [currency, Number.parseFloat((value || '0').replace(',', '.'))])
        .filter(([, value]) => Number.isFinite(value))
    ) as Record<string, number>;

    try {
      const response = await fxApiService.stressTest(
        user,
        selectedPortfolio,
        nextScenario,
        nextScenario === 'custom' ? parsedShocks : undefined
      );
      setStress(response);
    } catch {
      setStress(null);
    } finally {
      setStressLoading(false);
    }
  };

  if (!isConfigured) {
    return (
      <Card title="Cobertura de Divisas">
        <p className="text-sm text-slate-300">
          Configura `FX_API_URL` en Ajustes para habilitar el backend FastAPI de divisas.
        </p>
      </Card>
    );
  }

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-white flex items-center gap-2">
            <Icons.Divisas className="text-cyan-400" /> Cobertura de Divisas
          </h2>
          <p className="text-sm text-slate-400 mt-1">
            Base EUR · {selectedPortfolio === 'ALL' ? 'Todas mis carteras' : selectedPortfolio}
          </p>
        </div>
        {loading && <span className="text-sm text-cyan-300">Actualizando FX...</span>}
      </div>

      {alerts.length > 0 && (
        <div className="grid grid-cols-1 gap-3 xl:grid-cols-4">
          {alerts.slice(0, 4).map((alert) => (
            <div key={`${alert.kind}-${alert.title}`} className={`rounded-xl border p-4 ${alertClass(alert.severity)}`}>
              <p className="text-sm font-semibold">{alert.title}</p>
              <p className="mt-2 text-xs leading-5">{alert.message}</p>
            </div>
          ))}
        </div>
      )}

      {errors.length > 0 && (
        <div className="rounded-xl border border-amber-700/50 bg-amber-900/20 p-4 text-sm text-amber-100">
          Respuesta parcial del backend FX: {errors.join(', ')}
        </div>
      )}

      <Card title="Overview FX">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
          {(overview?.pairs || []).slice(0, 6).map((pair, index) => (
            <div key={pair.ticker} className="rounded-xl border border-slate-700 bg-slate-900/60 p-4">
              <p className="text-xs text-slate-500">{pair.pair}</p>
              <p className="mt-1 text-lg font-semibold text-white">{pair.last_price.toFixed(pair.last_price > 10 ? 2 : 4)}</p>
              <p className={`mt-1 text-sm ${pair.day_change_pct >= 0 ? 'text-emerald-300' : 'text-rose-300'}`}>
                {formatSignedPct(pair.day_change_pct, 2)}
              </p>
              <div className="mt-3 h-1.5 rounded-full bg-slate-700">
                <div
                  className="h-1.5 rounded-full bg-cyan-400"
                  style={{ width: `${Math.min(Math.abs(pair.z_score_52w) * 20, 100)}%` }}
                />
              </div>
            </div>
          ))}
        </div>
      </Card>

      <div className="flex flex-wrap gap-2 rounded-xl border border-slate-700 bg-slate-800 p-2">
        {[
          ['exposure', 'Exposición FX', Icons.Shield],
          ['carry', 'Carry vs EUR', Icons.Chart],
          ['dxy', 'Fortaleza USD', Icons.Gauge],
          ['stress', 'Stress Test FX', Icons.Target],
        ].map(([id, label, Icon]: any) => (
          <button
            key={id}
            type="button"
            onClick={() => setPanel(id as FxPanel)}
            className={`inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium ${
              panel === id ? 'bg-cyan-600 text-white' : 'text-slate-300 hover:bg-slate-700'
            }`}
          >
            <Icon size={16} />
            {label}
          </button>
        ))}
      </div>

      {panel === 'exposure' && (
        <div className="grid grid-cols-1 gap-6 xl:grid-cols-[1fr_1.1fr]">
          <Card title="Donut de exposición por divisa">
            <div className="h-80">
              {exposure?.donut?.length ? (
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={exposure.donut} dataKey="value" nameKey="name" innerRadius={65} outerRadius={105}>
                      {exposure.donut.map((entry, index) => (
                        <Cell key={`${entry.name}-${index}`} fill={COLORS[index % COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip
                      contentStyle={{ backgroundColor: '#0f172a', borderColor: '#334155', color: '#e2e8f0' }}
                      formatter={(value: number) => formatCurrency(value)}
                    />
                  </PieChart>
                </ResponsiveContainer>
              ) : (
                <div className="flex h-full items-center justify-center text-sm text-slate-500">Sin datos de exposición.</div>
              )}
            </div>
          </Card>

          <Card title="Cobertura sugerida">
            <div className="mb-4 rounded-xl border border-slate-700 bg-slate-900/60 p-4">
              <p className="text-sm text-slate-400">Semáforo USD</p>
              <p
                className={`mt-2 text-lg font-semibold ${
                  exposure?.usd_traffic_light.state === 'green'
                    ? 'text-emerald-300'
                    : exposure?.usd_traffic_light.state === 'orange'
                      ? 'text-amber-300'
                      : 'text-rose-300'
                }`}
              >
                {exposure?.usd_traffic_light.state?.toUpperCase() || 'N/A'}
              </p>
              <p className="mt-1 text-xs text-slate-500">
                Sin cubrir: {formatPct(exposure?.usd_traffic_light.uncovered_share_pct || 0, 1)}
              </p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-xs uppercase text-slate-400">
                  <tr>
                    <th className="px-4 py-3 text-left">Divisa</th>
                    <th className="px-4 py-3 text-right">Exposición</th>
                    <th className="px-4 py-3 text-right">Hedge ratio</th>
                    <th className="px-4 py-3 text-right">Notional</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-700">
                  {(exposure?.currency_breakdown || []).map((row) => (
                    <tr key={row.currency}>
                      <td className="px-4 py-3 text-slate-100">{row.currency}</td>
                      <td className="px-4 py-3 text-right text-white">{formatCurrency(row.exposure_eur)}</td>
                      <td className="px-4 py-3 text-right text-cyan-300">{row.hedge_ratio.toFixed(2)}</td>
                      <td className="px-4 py-3 text-right text-emerald-300">{formatCurrency(row.notional_to_hedge_eur)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </div>
      )}

      {panel === 'carry' && (
        <Card title="Ranking carry-to-risk">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-xs uppercase text-slate-400">
                <tr>
                  <th className="px-4 py-3 text-left">Par</th>
                  <th className="px-4 py-3 text-right">Carry</th>
                  <th className="px-4 py-3 text-right">Vol 30d</th>
                  <th className="px-4 py-3 text-right">Momentum</th>
                  <th className="px-4 py-3 text-right">Carry/Risk</th>
                  <th className="px-4 py-3 text-left">Señal</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-700">
                {(carry?.ranking || []).map((row) => (
                  <tr key={row.currency}>
                    <td className="px-4 py-3 text-slate-100">{row.pair}</td>
                    <td className="px-4 py-3 text-right text-white">{formatPct(row.carry_pct, 2)}</td>
                    <td className="px-4 py-3 text-right text-slate-300">{formatPct(row.volatility_30d_pct, 2)}</td>
                    <td className={`px-4 py-3 text-right ${row.momentum_1m_pct >= 0 ? 'text-emerald-300' : 'text-rose-300'}`}>{formatSignedPct(row.momentum_1m_pct, 2)}</td>
                    <td className={`px-4 py-3 text-right ${row.carry_to_risk >= 0 ? 'text-cyan-300' : 'text-rose-300'}`}>{row.carry_to_risk.toFixed(2)}</td>
                    <td className="px-4 py-3 text-slate-200">{row.signal}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {panel === 'dxy' && (
        <div className="grid grid-cols-1 gap-6 xl:grid-cols-[0.85fr_1.15fr]">
          <Card title="Gauge DXY">
            <div className="h-72">
              {dxyImpact ? (
                <ResponsiveContainer width="100%" height="100%">
                  <RadialBarChart
                    data={[{ value: dxyImpact.percentile_1y || 0, fill: dxyImpact.zone === 'weak' ? '#10b981' : dxyImpact.zone === 'strong' ? '#ef4444' : '#f59e0b' }]}
                    innerRadius="70%"
                    outerRadius="100%"
                    startAngle={180}
                    endAngle={0}
                  >
                    <PolarAngleAxis type="number" domain={[0, 100]} tick={false} />
                    <RadialBar background dataKey="value" cornerRadius={10} />
                  </RadialBarChart>
                </ResponsiveContainer>
              ) : (
                <div className="flex h-full items-center justify-center text-sm text-slate-500">Sin datos DXY.</div>
              )}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-xl border border-slate-700 bg-slate-900/60 p-3">
                <p className="text-xs text-slate-500">Percentil</p>
                <p className="mt-1 text-xl text-white">{(dxyImpact?.percentile_1y || 0).toFixed(1)}</p>
              </div>
              <div className="rounded-xl border border-slate-700 bg-slate-900/60 p-3">
                <p className="text-xs text-slate-500">USD bucket</p>
                <p className="mt-1 text-xl text-white">{formatCurrency(dxyImpact?.usd_exposure_eur || 0)}</p>
              </div>
            </div>
          </Card>

          <Card title="EUR/USD y correlaciones">
            <div className="h-72">
              {dxyImpact?.chart?.length ? (
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={dxyImpact.chart}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                    <XAxis dataKey="date" tick={{ fill: '#94a3b8', fontSize: 11 }} minTickGap={30} />
                    <YAxis tick={{ fill: '#94a3b8', fontSize: 11 }} />
                    <Tooltip
                      contentStyle={{ backgroundColor: '#0f172a', borderColor: '#334155', color: '#e2e8f0' }}
                      formatter={(value: number) => value.toFixed(4)}
                    />
                    <Line type="monotone" dataKey="eurusd" stroke="#38bdf8" dot={false} strokeWidth={2} />
                  </LineChart>
                </ResponsiveContainer>
              ) : (
                <div className="flex h-full items-center justify-center text-sm text-slate-500">Sin histórico EUR/USD.</div>
              )}
            </div>
            <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
              <div className="rounded-xl border border-slate-700 bg-slate-900/60 p-4">
                <p className="text-xs text-slate-500">Impacto ejemplo $10.000</p>
                <p className={`mt-1 text-lg ${(dxyImpact?.impact_example.impact_eur || 0) >= 0 ? 'text-emerald-300' : 'text-rose-300'}`}>
                  {formatCurrency(dxyImpact?.impact_example.impact_eur || 0)}
                </p>
              </div>
              <div className="rounded-xl border border-slate-700 bg-slate-900/60 p-4">
                <p className="text-xs text-slate-500">Beta DXY → EUR/USD</p>
                <p className="mt-1 text-lg text-white">{(dxyImpact?.beta_30d || 0).toFixed(2)}</p>
              </div>
            </div>
            <div className="mt-4 overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-xs uppercase text-slate-400">
                  <tr>
                    <th className="px-3 py-2 text-left">Serie</th>
                    {(correlations?.labels || []).map((label) => (
                      <th key={label} className="px-3 py-2">{label}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {(correlations?.labels || []).map((label, rowIndex) => (
                    <tr key={label}>
                      <td className="px-3 py-2 text-slate-200">{label}</td>
                      {(correlations?.matrix[rowIndex] || []).map((value, columnIndex) => (
                        <td key={`${label}-${columnIndex}`} className="px-3 py-2 text-center text-slate-300">
                          {value === null ? '-' : value.toFixed(2)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </div>
      )}

      {panel === 'stress' && (
        <div className="space-y-6">
          <Card title="Stress test FX">
            <div className="grid grid-cols-1 gap-4 xl:grid-cols-[0.75fr_1.25fr]">
              <div className="space-y-3">
                <select
                  value={scenario}
                  onChange={(event) => setScenario(event.target.value)}
                  className="w-full rounded-lg border border-slate-700 bg-slate-900 p-3 text-white outline-none focus:border-cyan-500"
                >
                  {SCENARIO_OPTIONS.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={() => void runStressTest(scenario)}
                  className="rounded-lg bg-cyan-600 px-4 py-2 text-sm font-medium text-white hover:bg-cyan-500"
                >
                  {stressLoading ? 'Simulando...' : 'Simular escenario'}
                </button>
              </div>
              <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
                {CUSTOM_FIELDS.map((currency) => (
                  <div key={currency} className="rounded-xl border border-slate-700 bg-slate-900/60 p-3">
                    <label className="text-xs text-slate-500">{currency}</label>
                    <input
                      type="number"
                      step="0.1"
                      disabled={scenario !== 'custom'}
                      value={customShocks[currency] || '0'}
                      onChange={(event) => setCustomShocks((current) => ({ ...current, [currency]: event.target.value }))}
                      className="mt-2 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-white disabled:opacity-50"
                    />
                  </div>
                ))}
              </div>
            </div>
          </Card>

          <Card title="Resultado del escenario">
            <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
              <div className="rounded-xl border border-slate-700 bg-slate-900/60 p-4">
                <p className="text-xs text-slate-500">Actual</p>
                <p className="mt-1 text-xl text-white">{formatCurrency(stress?.portfolio_totals.current_value_eur || 0)}</p>
              </div>
              <div className="rounded-xl border border-slate-700 bg-slate-900/60 p-4">
                <p className="text-xs text-slate-500">Escenario</p>
                <p className="mt-1 text-xl text-white">{formatCurrency(stress?.portfolio_totals.shocked_value_eur || 0)}</p>
              </div>
              <div className="rounded-xl border border-slate-700 bg-slate-900/60 p-4">
                <p className="text-xs text-slate-500">P&L</p>
                <p className={`mt-1 text-xl ${(stress?.portfolio_totals.pnl_eur || 0) >= 0 ? 'text-emerald-300' : 'text-rose-300'}`}>
                  {formatCurrency(stress?.portfolio_totals.pnl_eur || 0)}
                </p>
              </div>
            </div>
            <div className="mt-4 overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-xs uppercase text-slate-400">
                  <tr>
                    <th className="px-4 py-3 text-left">Divisa</th>
                    <th className="px-4 py-3 text-right">Shock</th>
                    <th className="px-4 py-3 text-right">P&L</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-700">
                  {(stress?.currency_impact || []).map((row) => (
                    <tr key={row.currency}>
                      <td className="px-4 py-3 text-slate-100">{row.currency}</td>
                      <td className={`px-4 py-3 text-right ${row.shock_pct >= 0 ? 'text-emerald-300' : 'text-rose-300'}`}>{formatSignedPct(row.shock_pct, 1)}</td>
                      <td className={`px-4 py-3 text-right ${(row.pnl_eur || 0) >= 0 ? 'text-emerald-300' : 'text-rose-300'}`}>{formatCurrency(row.pnl_eur)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <button
              type="button"
              onClick={() => setShowStressHedge((current) => !current)}
              className="mt-4 rounded-lg border border-cyan-700 bg-cyan-900/20 px-4 py-2 text-sm font-medium text-cyan-200"
            >
              ¿Cómo cubrir esto?
            </button>
            {showStressHedge && (
              <div className="mt-4 overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-xs uppercase text-slate-400">
                    <tr>
                      <th className="px-4 py-3 text-left">Divisa</th>
                      <th className="px-4 py-3 text-left">Par</th>
                      <th className="px-4 py-3 text-right">Notional</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-700">
                    {(stress?.how_to_hedge || []).map((row) => (
                      <tr key={row.currency}>
                        <td className="px-4 py-3 text-slate-100">{row.currency}</td>
                        <td className="px-4 py-3 text-slate-300">{row.fx_pair}</td>
                        <td className="px-4 py-3 text-right text-cyan-300">{formatCurrency(row.suggested_hedge_notional_eur)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </div>
      )}
    </div>
  );
};

export default FxView;
