import React, { useMemo, useState } from 'react';
import { AlertCircle } from 'lucide-react';
import { formatPlainDateShort } from '../../utils/dates';

function formatCompactMoney(val, currency = 'INR') {
  if (val === null || val === undefined || !Number.isFinite(Number(val))) return '—';
  try {
    return new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency: currency || 'INR',
      maximumFractionDigits: 0,
    }).format(Number(val));
  } catch {
    return `${currency || 'USD'} ${Math.round(Number(val))}`;
  }
}

export function TrendChart({ series = [], currency = 'INR' }) {
  const [mode, setMode] = useState('spend_roas');

  const chartData = useMemo(() => {
    if (!Array.isArray(series) || series.length === 0) return null;

    const width = 760;
    const height = 220;
    const padX = 48;
    const padY = 24;
    const plotW = width - padX * 2;
    const plotH = height - padY * 2;

    const primaryValues = series.map((d) =>
      mode === 'spend_roas' ? Number(d.spend || 0) : Number(d.linkClicks || 0)
    );
    const secondaryValues = series.map((d) =>
      mode === 'spend_roas' ? Number(d.purchaseConversionValue || 0) : Number(d.purchases || 0)
    );

    const maxPrimary = Math.max(1, ...primaryValues);
    const maxSecondary = Math.max(1, ...secondaryValues);

    const xFor = (idx) =>
      series.length === 1 ? padX + plotW / 2 : padX + (idx / (series.length - 1)) * plotW;
    const yPrimary = (v) => padY + plotH - (v / maxPrimary) * plotH;
    const ySecondary = (v) => padY + plotH - (v / maxSecondary) * plotH;

    const primaryPath = series
      .map((d, i) => `${i === 0 ? 'M' : 'L'} ${xFor(i).toFixed(1)} ${yPrimary(primaryValues[i]).toFixed(1)}`)
      .join(' ');

    const secondaryPath = series
      .map((d, i) => `${i === 0 ? 'M' : 'L'} ${xFor(i).toFixed(1)} ${ySecondary(secondaryValues[i]).toFixed(1)}`)
      .join(' ');

    return {
      width,
      height,
      padX,
      padY,
      plotH,
      maxPrimary,
      maxSecondary,
      xFor,
      yPrimary,
      ySecondary,
      primaryValues,
      secondaryValues,
      primaryPath,
      secondaryPath,
    };
  }, [series, mode]);

  if (!chartData) {
    return (
      <div className="rounded-lg border border-slate-800/80 bg-slate-950/50 py-12 text-center text-xs text-slate-400">
        No daily insight trend series available yet for this filter window.
      </div>
    );
  }

  const hasProvisional = series.some((d) => d.isProvisionalAttribution);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-4 text-xs">
          <span className="inline-flex items-center gap-1.5 text-slate-300">
            <span className="w-2.5 h-2.5 rounded-full bg-indigo-500" aria-hidden="true" />
            {mode === 'spend_roas' ? 'Daily Spend' : 'Daily Link Clicks'}
          </span>
          <span className="inline-flex items-center gap-1.5 text-slate-300">
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-400" aria-hidden="true" />
            {mode === 'spend_roas' ? 'Purchase Conv. Value' : 'Attributed Purchases'}
          </span>
          {hasProvisional ? (
            <span className="inline-flex items-center gap-1 text-amber-300 text-[11px]">
              <AlertCircle className="w-3.5 h-3.5" aria-hidden="true" />
              Amber markers = provisional attribution window
            </span>
          ) : null}
        </div>

        <div className="inline-flex rounded-lg border border-slate-800 bg-slate-900/70 p-0.5 text-xs">
          <button
            type="button"
            onClick={() => setMode('spend_roas')}
            className={`px-2.5 py-1 rounded-md transition-colors ${
              mode === 'spend_roas' ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            Spend vs Value
          </button>
          <button
            type="button"
            onClick={() => setMode('clicks_conv')}
            className={`px-2.5 py-1 rounded-md transition-colors ${
              mode === 'clicks_conv' ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            Clicks vs Purchases
          </button>
        </div>
      </div>

      <div className="overflow-x-auto">
        <svg
          viewBox={`0 0 ${chartData.width} ${chartData.height}`}
          role="img"
          aria-label={
            mode === 'spend_roas'
              ? 'Daily ad spend versus purchase conversion value trend'
              : 'Daily link clicks versus purchases trend'
          }
          className="w-full min-w-[520px] h-56 select-none"
        >
          {[0, 0.25, 0.5, 0.75, 1].map((frac) => {
            const y = chartData.padY + frac * chartData.plotH;
            return (
              <line
                key={frac}
                x1={chartData.padX}
                x2={chartData.width - chartData.padX}
                y1={y}
                y2={y}
                stroke="rgba(148,163,184,0.12)"
                strokeDasharray="3 3"
              />
            );
          })}

          {series.map((d, i) => {
            if (!d.isProvisionalAttribution) return null;
            const x = chartData.xFor(i);
            return (
              <rect
                key={`prov-${d.date}`}
                x={x - 8}
                y={chartData.padY}
                width={16}
                height={chartData.plotH}
                fill="rgba(245, 158, 11, 0.08)"
              />
            );
          })}

          <path d={chartData.primaryPath} fill="none" stroke="#6366f1" strokeWidth="2.5" />
          <path d={chartData.secondaryPath} fill="none" stroke="#34d399" strokeWidth="2.5" />

          {series.map((d, i) => {
            const x = chartData.xFor(i);
            const y1 = chartData.yPrimary(chartData.primaryValues[i]);
            const y2 = chartData.ySecondary(chartData.secondaryValues[i]);
            return (
              <g key={d.date}>
                <circle cx={x} cy={y1} r="3.5" fill={d.isProvisionalAttribution ? '#f59e0b' : '#6366f1'} />
                <circle cx={x} cy={y2} r="3.5" fill="#34d399" />
                <text
                  x={x}
                  y={chartData.height - 6}
                  textAnchor="middle"
                  fill="#94a3b8"
                  fontSize="10"
                >
                  {formatPlainDateShort(d.date)}
                </text>
              </g>
            );
          })}

          <text x="6" y={chartData.padY + 6} fill="#818cf8" fontSize="10">
            {mode === 'spend_roas'
              ? formatCompactMoney(chartData.maxPrimary, currency)
              : `${chartData.maxPrimary}`}
          </text>
          <text
            x={chartData.width - 6}
            y={chartData.padY + 6}
            textAnchor="end"
            fill="#34d399"
            fontSize="10"
          >
            {mode === 'spend_roas'
              ? formatCompactMoney(chartData.maxSecondary, currency)
              : `${chartData.maxSecondary}`}
          </text>
        </svg>
      </div>
    </div>
  );
}

