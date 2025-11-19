import React from 'react';

interface CardProps {
  title?: string;
  children: React.ReactNode;
  className?: string;
}

export const Card: React.FC<CardProps> = ({ title, children, className = '' }) => {
  return (
    <div className={`bg-slate-800 border border-slate-700 rounded-xl shadow-sm overflow-hidden ${className}`}>
      {title && (
        <div className="px-6 py-4 border-b border-slate-700">
          <h3 className="text-lg font-medium text-slate-100">{title}</h3>
        </div>
      )}
      <div className="p-6">
        {children}
      </div>
    </div>
  );
};

export const StatCard: React.FC<{ title: string; value: string; subValue?: string; trend?: 'up' | 'down' | 'neutral'; icon?: React.ReactNode }> = ({ title, value, subValue, trend, icon }) => {
  const trendColor = trend === 'up' ? 'text-emerald-400' : trend === 'down' ? 'text-rose-400' : 'text-slate-400';
  
  return (
    <div className="bg-slate-800 border border-slate-700 rounded-xl p-5 flex items-start justify-between hover:border-slate-600 transition-colors">
      <div>
        <p className="text-sm font-medium text-slate-400 mb-1">{title}</p>
        <h4 className="text-2xl font-bold text-white tracking-tight">{value}</h4>
        {subValue && (
          <p className={`text-xs font-medium mt-2 ${trendColor}`}>
            {subValue}
          </p>
        )}
      </div>
      {icon && <div className="p-2 bg-slate-700/50 rounded-lg text-slate-300">{icon}</div>}
    </div>
  );
};