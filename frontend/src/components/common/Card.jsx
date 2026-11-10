import React from 'react';

export function Card({
  children,
  className = '',
  hoverEffect = false,
  padded = true,
  ...props
}) {
  return (
    <div
      className={`rounded-xl bg-slate-900/60 border border-slate-800/80 backdrop-blur-md shadow-xl shadow-black/20 ${
        hoverEffect ? 'hover:border-slate-700/80 transition-colors duration-200' : ''
      } ${padded ? 'p-5 sm:p-6' : ''} ${className}`}
      {...props}
    >
      {children}
    </div>
  );
}

export function CardHeader({ title, description, action, className = '' }) {
  return (
    <div className={`flex items-start justify-between gap-4 mb-4 ${className}`}>
      <div>
        <h3 className="text-base font-semibold text-slate-100">{title}</h3>
        {description && (
          <p className="text-xs text-slate-400 mt-0.5">{description}</p>
        )}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}

