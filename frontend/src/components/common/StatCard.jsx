import React from 'react';
import { Card } from './Card';

export function StatCard({
  title,
  value,
  subtext,
  icon: Icon,
  accentColor = 'indigo',
}) {
  const accentStyles = {
    indigo: 'bg-indigo-500/10 text-indigo-400 border-indigo-500/20',
    purple: 'bg-violet-500/10 text-violet-400 border-violet-500/20',
    cyan: 'bg-sky-500/10 text-sky-400 border-sky-500/20',
    emerald: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
    amber: 'bg-amber-500/10 text-amber-400 border-amber-500/20',
  };

  return (
    <Card hoverEffect>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-medium text-slate-400 truncate">{title}</p>
          <div className="mt-2 text-2xl font-semibold tracking-tight text-white tabular-nums">
            {value}
          </div>
          {subtext && <p className="mt-1.5 text-xs text-slate-500 truncate">{subtext}</p>}
        </div>
        {Icon && (
          <div
            className={`p-2.5 rounded-lg border shrink-0 ${
              accentStyles[accentColor] || accentStyles.indigo
            }`}
          >
            <Icon className="w-4 h-4" aria-hidden="true" />
          </div>
        )}
      </div>
    </Card>
  );
}
