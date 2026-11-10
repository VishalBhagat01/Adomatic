import React, { useState, useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import {
  Menu,
  Search,
  Bell,
  RefreshCw,
  Server,
  Bot,
  CheckCircle2,
  AlertCircle,
  Sparkles,
} from 'lucide-react';
import { Badge } from '../common/Badge';
import { checkBackendHealth, checkAgentHealth } from '../../services/api';

const ROUTE_TITLES = {
  '/': 'Executive Overview',
  '/campaigns': 'Ad Campaigns',
  '/creatives': 'Creative Studio',
  '/brand-assets': 'Brand Kit & Assets',
  '/analytics': 'Performance Analytics',
  '/settings': 'System Settings',
};

export function Header({ onToggleSidebar }) {
  const location = useLocation();
  const currentTitle = ROUTE_TITLES[location.pathname] || 'Dashboard';

  const [backendStatus, setBackendStatus] = useState({ online: false, checking: true });
  const [agentStatus, setAgentStatus] = useState({ online: false, checking: true });
  const [isRefreshing, setIsRefreshing] = useState(false);

  async function checkServices() {
    setIsRefreshing(true);
    const [bRes, aRes] = await Promise.all([
      checkBackendHealth(),
      checkAgentHealth(),
    ]);
    setBackendStatus({ online: bRes.online, checking: false, latency: bRes.latencyMs });
    setAgentStatus({ online: aRes.online, checking: false, latency: aRes.latencyMs });
    setIsRefreshing(false);
  }

  useEffect(() => {
    checkServices();
    const interval = setInterval(checkServices, 30000);
    return () => clearInterval(interval);
  }, []);

  return (
    <header className="h-16 bg-slate-950/70 border-b border-slate-800/80 backdrop-blur-md sticky top-0 z-30 px-4 sm:px-6 flex items-center justify-between gap-4">
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={onToggleSidebar}
          className="p-2 rounded-lg text-slate-400 hover:text-slate-200 hover:bg-slate-900 lg:hidden focus:outline-none focus:ring-2 focus:ring-indigo-500"
          aria-label="Open sidebar"
        >
          <Menu className="w-5 h-5" />
        </button>

        <div>
          <h1 className="text-base sm:text-lg font-bold text-slate-100 font-['Plus_Jakarta_Sans']">
            {currentTitle}
          </h1>
        </div>
      </div>

      {/* Middle: Quick search bar */}
      <div className="hidden md:flex items-center flex-1 max-w-md mx-4">
        <div className="relative w-full">
          <Search className="w-4 h-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            type="text"
            placeholder="Search campaigns, ad copy, creative templates..."
            className="w-full bg-slate-900/80 border border-slate-800 rounded-lg pl-9 pr-4 py-1.5 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-indigo-500/80 focus:ring-1 focus:ring-indigo-500 transition-colors"
          />
        </div>
      </div>

      {/* Right: Service Status Pills & User Profile */}
      <div className="flex items-center gap-2 sm:gap-3">
        {/* Backend Status Pill */}
        <div
          className="hidden sm:flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-slate-900 border border-slate-800 text-[11px]"
          title={`Backend Service: ${backendStatus.online ? 'Online' : 'Offline'}`}
        >
          <Server className="w-3.5 h-3.5 text-slate-400" />
          <span className="text-slate-300 font-medium">API</span>
          <span
            className={`w-2 h-2 rounded-full ${
              backendStatus.online ? 'bg-emerald-400' : 'bg-rose-500'
            }`}
          />
        </div>

        {/* Agent Status Pill */}
        <div
          className="hidden sm:flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-slate-900 border border-slate-800 text-[11px]"
          title={`Agent Service: ${agentStatus.online ? 'Online' : 'Offline'}`}
        >
          <Bot className="w-3.5 h-3.5 text-indigo-400" />
          <span className="text-slate-300 font-medium">Agent</span>
          <span
            className={`w-2 h-2 rounded-full ${
              agentStatus.online ? 'bg-emerald-400' : 'bg-rose-500'
            }`}
          />
        </div>

        {/* Refresh health checks */}
        <button
          type="button"
          onClick={checkServices}
          disabled={isRefreshing}
          className="p-2 rounded-lg text-slate-400 hover:text-slate-200 hover:bg-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500"
          title="Refresh service health"
        >
          <RefreshCw className={`w-4 h-4 ${isRefreshing ? 'animate-spin text-indigo-400' : ''}`} />
        </button>

        {/* Notifications */}
        <button
          type="button"
          className="p-2 rounded-lg text-slate-400 hover:text-slate-200 hover:bg-slate-900 relative focus:outline-none focus:ring-2 focus:ring-indigo-500"
          aria-label="View notifications"
        >
          <Bell className="w-4 h-4" />
          <span className="absolute top-1.5 right-1.5 w-2 h-2 bg-indigo-500 rounded-full" />
        </button>

        {/* User avatar */}
        <div className="flex items-center gap-2 pl-2 border-l border-slate-800">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-tr from-indigo-600 to-purple-600 flex items-center justify-center text-xs font-bold text-white shadow-sm shadow-indigo-500/20">
            AP
          </div>
        </div>
      </div>
    </header>
  );
}

