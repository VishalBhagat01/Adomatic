import React from 'react';
import { NavLink } from 'react-router-dom';
import {
  LayoutDashboard,
  Layers,
  Sparkles,
  Palette,
  BarChart3,
  Settings,
  Zap,
  HelpCircle,
  ChevronRight,
} from 'lucide-react';
import { Badge } from '../common/Badge';

const NAV_ITEMS = [
  { name: 'Dashboard', path: '/', icon: LayoutDashboard },
  { name: 'Campaigns', path: '/campaigns', icon: Layers },
  { name: 'Creative Studio', path: '/creatives', icon: Sparkles, badge: 'AI' },
  { name: 'Brand Assets', path: '/brand-assets', icon: Palette },
  { name: 'Analytics', path: '/analytics', icon: BarChart3 },
  { name: 'Settings', path: '/settings', icon: Settings },
];

export function Sidebar({ isOpen, onClose }) {
  return (
    <>
      {/* Mobile backdrop */}
      {isOpen && (
        <div
          className="fixed inset-0 z-40 bg-slate-950/80 backdrop-blur-sm lg:hidden"
          onClick={onClose}
          aria-hidden="true"
        />
      )}

      <aside
        className={`fixed top-0 bottom-0 left-0 z-50 w-64 bg-slate-950/95 border-r border-slate-800/80 backdrop-blur-xl flex flex-col transition-transform duration-200 ease-in-out lg:translate-x-0 ${
          isOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        {/* Brand Header */}
        <div className="h-16 flex items-center justify-between px-6 border-b border-slate-800/80">
          <NavLink to="/" className="flex items-center gap-2.5 group">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center shadow-lg shadow-indigo-500/25 group-hover:scale-105 transition-transform">
              <Zap className="w-5 h-5 text-white" />
            </div>
            <div>
              <div className="flex items-center gap-1.5">
                <span className="font-bold text-base tracking-tight text-white font-['Plus_Jakarta_Sans']">
                  AdPilot
                </span>
                <span className="text-xs font-extrabold text-indigo-400 bg-indigo-500/10 px-1.5 py-0.5 rounded border border-indigo-500/20">
                  AI
                </span>
              </div>
              <p className="text-[10px] text-slate-400 -mt-0.5">Creative Suite</p>
            </div>
          </NavLink>
        </div>

        {/* Navigation Links */}
        <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
          <div className="px-3 pb-2 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
            Platform
          </div>
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            return (
              <NavLink
                key={item.path}
                to={item.path}
                onClick={() => onClose && onClose()}
                end={item.path === '/'}
                className={({ isActive }) =>
                  `flex items-center justify-between px-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-150 ${
                    isActive
                      ? 'bg-indigo-600/15 text-indigo-300 border border-indigo-500/30 shadow-sm shadow-indigo-500/10'
                      : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900/60 border border-transparent'
                  }`
                }
              >
                <div className="flex items-center gap-3">
                  <Icon className="w-4 h-4 shrink-0" />
                  <span>{item.name}</span>
                </div>
                {item.badge && (
                  <Badge variant="purple" size="sm">
                    {item.badge}
                  </Badge>
                )}
              </NavLink>
            );
          })}
        </nav>

        {/* Workspace / Quota Card */}
        <div className="p-4 border-t border-slate-800/80">
          <div className="p-3.5 rounded-xl bg-gradient-to-b from-slate-900 to-slate-950 border border-slate-800/90">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-semibold text-slate-200">Creative Credits</span>
              <span className="text-[11px] font-medium text-indigo-400">850 / 1000</span>
            </div>
            <div className="w-full h-1.5 bg-slate-800 rounded-full overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-indigo-500 to-purple-500 rounded-full"
                style={{ width: '85%' }}
              />
            </div>
            <p className="text-[10px] text-slate-400 mt-2">
              85% available for image generation
            </p>
          </div>

          <div className="mt-3 flex items-center justify-between px-2 text-xs text-slate-500">
            <span className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-emerald-400" />
              v0.1.0-alpha
            </span>
            <NavLink to="/settings" className="hover:text-slate-300">
              Docs & Help
            </NavLink>
          </div>
        </div>
      </aside>
    </>
  );
}

