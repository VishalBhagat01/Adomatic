import React from 'react';
import { NavLink } from 'react-router-dom';
import {
  LayoutDashboard,
  PlusSquare,
  Layers,
  Images,
  BarChart3,
  Settings,
  X,
} from 'lucide-react';
import { useStudio } from '../../context/StudioContext';

const NAV_ITEMS = [
  { name: 'Dashboard', path: '/', icon: LayoutDashboard, end: true },
  { name: 'Create Campaign', path: '/campaigns/new', icon: PlusSquare, end: true },
  { name: 'Campaigns', path: '/campaigns', icon: Layers, end: true },
  { name: 'Creative Gallery', path: '/creatives', icon: Images, end: false },
  { name: 'Analytics', path: '/analytics', icon: BarChart3, end: true },
  { name: 'Settings', path: '/settings', icon: Settings, end: true },
];

export function Sidebar({ isOpen, onClose }) {
  const { identity } = useStudio();

  return (
    <>
      {isOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/70 lg:hidden"
          onClick={onClose}
          aria-hidden="true"
        />
      )}

      <aside
        aria-label="Primary studio navigation"
        className={`fixed top-0 bottom-0 left-0 z-50 w-64 bg-[#0b0e15] border-r border-slate-800/80 flex flex-col transition-transform duration-150 ease-out lg:translate-x-0 ${
          isOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="h-16 flex items-center justify-between px-5 border-b border-slate-800/80">
          <NavLink to="/" onClick={onClose} className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-indigo-600/20 border border-indigo-500/40 flex items-center justify-center text-indigo-300 font-bold text-sm">
              A
            </div>
            <div>
              <div className="flex items-center gap-1.5">
                <span className="font-semibold text-sm tracking-tight text-white">AdPilot</span>
                <span className="text-[10px] font-semibold text-indigo-300 bg-indigo-500/15 px-1.5 py-0.5 rounded border border-indigo-500/25">
                  STUDIO
                </span>
              </div>
              <p className="text-[11px] text-slate-500 leading-tight">Ad Creative Engine</p>
            </div>
          </NavLink>

          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800/70 lg:hidden"
            aria-label="Close navigation menu"
          >
            <X className="w-4 h-4" aria-hidden="true" />
          </button>
        </div>

        <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto" aria-label="Main routes">
          <div className="px-3 pb-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
            Workspace
          </div>
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            return (
              <NavLink
                key={item.path}
                to={item.path}
                end={item.end}
                onClick={onClose}
                className={({ isActive }) =>
                  `flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors border ${
                    isActive
                      ? 'bg-indigo-500/12 text-indigo-200 border-indigo-500/30'
                      : 'text-slate-400 hover:text-slate-100 hover:bg-slate-800/50 border-transparent'
                  }`
                }
              >
                <Icon className="w-4 h-4 shrink-0" aria-hidden="true" />
                <span>{item.name}</span>
              </NavLink>
            );
          })}
        </nav>

        <div className="p-4 border-t border-slate-800/80 space-y-2">
          <div className="p-3 rounded-lg bg-[#0f131b] border border-slate-800/80">
            <div className="text-[11px] text-slate-500 uppercase tracking-wider font-medium">
              Active Tenant
            </div>
            <div className="text-xs font-mono text-slate-200 mt-1 truncate" title={identity.tenantId}>
              {identity.tenantId}
            </div>
          </div>
        </div>
      </aside>
    </>
  );
}
