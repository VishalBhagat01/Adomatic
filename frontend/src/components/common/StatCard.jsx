import React from 'react';
import { Card } from './Card';
import { TrendingUp, TrendingDown } from 'lucide-react';

export function StatCard({
  title,
  value,
  change,
  changeType = 'positive',
  period = 'vs last month',
  icon: Icon,
  accentColor = 'indigo',
}) {
  const accentStyles = {
    indigo: 'bg-indigo-600/10 text-indigo-400 border-indigo-500/20',
    purple: 'bg-purple-600/10 text-purple-400 border-purple-500/20',
    cyan: 'bg-cyan-600/10 text-cyan-400 border-cyan-500/20',
    emerald: 'bg-emerald-600/10 text-emerald-400 border-emerald-500/20',
  };

  const isPositive = changeType === 'positive';

  return (
    <Card hoverEffect className="relative overflow-hidden group">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-xs font-medium uppercase tracking-wider text-slate-400">
            {title}
          </p>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-2xl font-bold tracking-tight text-white">
              {value}
            </span>
          </div>
          {change && (
            <div className="mt-2.5 flex items-center gap-1.5 text-xs">
              <span
                className={`inline-flex items-center gap-0.5 font-medium ${
                  isPositive ? 'text-emerald-400' : 'text-rose-400'
                }`}
              >
                {isPositive ? (
                  <TrendingUp className="w-3.5 h-3.5" />
                ) : (
                  <TrendingDown className="w-3.5 h-3.5" />
                )}
                {change}
              </span>
              <span className="text-slate-500">{period}</span>
            </div>
          )}
        </div>
        {Icon && (
          <div
            className={`p-3 rounded-xl border ${accentStyles[accentColor] || accentStyles.indigo} group-hover:scale-105 transition-transform duration-200`}
          >
            <Icon className="w-5 h-5" />
          </div>
        )}
      </div>
    </Card>
  );
}

