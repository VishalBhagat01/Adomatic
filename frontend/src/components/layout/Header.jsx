import React, { useState, useEffect, useCallback } from 'react';
import { useLocation, useNavigate, Link } from 'react-router-dom';
import { Menu, Search, RefreshCw, Server, Bot, Plus } from 'lucide-react';
import { checkBackendHealth, checkAgentHealth } from '../../services/api';
import { useStudio } from '../../context/StudioContext';

function resolveSectionLabel(pathname) {
  if (pathname === '/') return 'Dashboard';
  if (pathname === '/campaigns/new') return 'Create Campaign';
  if (pathname === '/campaigns') return 'Campaigns';
  if (/^\/campaigns\/[^/]+\/workspace$/.test(pathname)) return 'Generation Workspace';
  if (/^\/campaigns\/[^/]+$/.test(pathname)) return 'Campaign Details';
  if (pathname === '/creatives') return 'Creative Gallery';
  if (/^\/creatives\/[^/]+\/edit$/.test(pathname)) return 'Creative Editor';
  if (pathname === '/analytics') return 'Analytics';
  if (pathname === '/settings') return 'Settings';
  return 'Studio';
}

export function Header({ onToggleSidebar }) {
  const location = useLocation();
  const navigate = useNavigate();
  const { globalSearch, setGlobalSearch } = useStudio();
  const sectionLabel = resolveSectionLabel(location.pathname);

  const [backendStatus, setBackendStatus] = useState({ online: false, checking: true });
  const [agentStatus, setAgentStatus] = useState({ online: false, checking: true });
  const [isRefreshing, setIsRefreshing] = useState(false);

  const checkServices = useCallback(async () => {
    setIsRefreshing(true);
    const [bRes, aRes] = await Promise.all([checkBackendHealth(), checkAgentHealth()]);
    setBackendStatus({ online: bRes.online, checking: false, latency: bRes.latencyMs });
    setAgentStatus({ online: aRes.online, checking: false, latency: aRes.latencyMs });
    setIsRefreshing(false);
  }, []);

  useEffect(() => {
    checkServices();
    const interval = setInterval(checkServices, 30000);
    return () => clearInterval(interval);
  }, [checkServices]);

  const handleSearchSubmit = (e) => {
    e.preventDefault();
    if (location.pathname !== '/campaigns') {
      navigate('/campaigns');
    }
  };

  return (
    <header className="h-16 bg-[#0b0e15]/95 border-b border-slate-800/80 backdrop-blur-sm sticky top-0 z-30 px-4 sm:px-6 flex items-center justify-between gap-4">
      <div className="flex items-center gap-3 min-w-0">
        <button
          type="button"
          onClick={onToggleSidebar}
          className="p-2 rounded-lg text-slate-400 hover:text-slate-100 hover:bg-slate-800/70 lg:hidden"
          aria-label="Open navigation sidebar"
        >
          <Menu className="w-5 h-5" aria-hidden="true" />
        </button>

        <span className="text-sm font-medium text-slate-300 truncate">{sectionLabel}</span>
      </div>

      <form onSubmit={handleSearchSubmit} className="hidden md:flex items-center flex-1 max-w-md mx-4">
        <div className="relative w-full">
          <Search
            className="w-4 h-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none"
            aria-hidden="true"
          />
          <label htmlFor="header-campaign-search" className="visually-hidden">
            Search campaigns by name, prompt, or URL
          </label>
          <input
            id="header-campaign-search"
            type="search"
            value={globalSearch}
            onChange={(e) => setGlobalSearch(e.target.value)}
            placeholder="Search campaigns by title or product URL..."
            autoCorrect="off"
            autoCapitalize="none"
            spellCheck={false}
            className="w-full bg-[#090b10] border border-slate-800 rounded-lg pl-9 pr-3 py-1.5 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-indigo-500"
          />
        </div>
      </form>

      <div className="flex items-center gap-2 sm:gap-2.5 shrink-0">
        <div
          className="hidden sm:flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-[#0f131b] border border-slate-800 text-[11px]"
          title={`Backend API: ${backendStatus.online ? `Online (${backendStatus.latency}ms)` : 'Offline'}`}
        >
          <Server className="w-3.5 h-3.5 text-slate-400" aria-hidden="true" />
          <span className="text-slate-300">API</span>
          <span
            className={`w-2 h-2 rounded-full ${
              backendStatus.checking
                ? 'bg-slate-500'
                : backendStatus.online
                  ? 'bg-emerald-400'
                  : 'bg-rose-500'
            }`}
            aria-label={backendStatus.online ? 'Backend online' : 'Backend offline'}
          />
        </div>

        <div
          className="hidden sm:flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-[#0f131b] border border-slate-800 text-[11px]"
          title={`Python AI Agent: ${agentStatus.online ? `Online (${agentStatus.latency}ms)` : 'Offline'}`}
        >
          <Bot className="w-3.5 h-3.5 text-indigo-400" aria-hidden="true" />
          <span className="text-slate-300">Agent</span>
          <span
            className={`w-2 h-2 rounded-full ${
              agentStatus.checking
                ? 'bg-slate-500'
                : agentStatus.online
                  ? 'bg-emerald-400'
                  : 'bg-rose-500'
            }`}
            aria-label={agentStatus.online ? 'Agent online' : 'Agent offline'}
          />
        </div>

        <button
          type="button"
          onClick={checkServices}
          disabled={isRefreshing}
          className="p-2 rounded-lg text-slate-400 hover:text-slate-100 hover:bg-slate-800/70"
          title="Refresh service status"
          aria-label="Refresh backend and agent service status"
        >
          <RefreshCw className={`w-4 h-4 ${isRefreshing ? 'animate-spin text-indigo-400' : ''}`} aria-hidden="true" />
        </button>

        <Link
          to="/campaigns/new"
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-medium transition-colors border border-indigo-500/40"
        >
          <Plus className="w-3.5 h-3.5" aria-hidden="true" />
          <span className="hidden sm:inline">New Campaign</span>
        </Link>
      </div>
    </header>
  );
}
