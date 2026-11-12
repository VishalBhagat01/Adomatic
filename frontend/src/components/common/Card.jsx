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
      className={`rounded-xl bg-[#0f131b] border border-slate-800/80 ${
        hoverEffect ? 'hover:border-slate-700/90 transition-colors duration-150' : ''
      } ${padded ? 'p-5' : ''} ${className}`}
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
        <h2 className="text-sm font-semibold text-slate-100">{title}</h2>
        {description && <p className="text-xs text-slate-400 mt-0.5">{description}</p>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}
