import React, { useState, useEffect } from 'react';
import {
  Sparkles,
  Layers,
  Image,
  TrendingUp,
  Cpu,
  Server,
  Code2,
  CheckCircle,
  XCircle,
  RefreshCw,
  ExternalLink,
  ShieldCheck,
  Zap,
} from 'lucide-react';
import { Card, CardHeader } from '../components/common/Card';
import { StatCard } from '../components/common/StatCard';
import { Button } from '../components/common/Button';
import { Badge } from '../components/common/Badge';
import { checkBackendHealth, checkAgentHealth } from '../services/api';

export function Dashboard() {
  const [backendHealth, setBackendHealth] = useState(null);
  const [agentHealth, setAgentHealth] = useState(null);
  const [loading, setLoading] = useState(true);

  async function fetchHealth() {
    setLoading(true);
    const [b, a] = await Promise.all([
      checkBackendHealth(),
      checkAgentHealth(),
    ]);
    setBackendHealth(b);
    setAgentHealth(a);
    setLoading(false);
  }

  useEffect(() => {
    fetchHealth();
  }, []);

  return (
    <div className="space-y-6">
      {/* Hero Welcome Banner */}
      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-r from-indigo-950/80 via-slate-900 to-slate-950 border border-indigo-500/20 p-6 sm:p-8 backdrop-blur-xl">
        <div className="absolute -right-10 -bottom-10 w-72 h-72 bg-indigo-500/10 rounded-full blur-3xl pointer-events-none" />
        <div className="relative z-10 max-w-2xl">
          <Badge variant="purple" size="md" dot className="mb-3">
            AdPilot Foundation Active
          </Badge>
          <h2 className="text-2xl sm:text-3xl font-extrabold text-white tracking-tight font-['Plus_Jakarta_Sans']">
            AI-Powered Advertising Creative Suite
          </h2>
          <p className="mt-2 text-sm text-slate-300 leading-relaxed">
            Welcome to the AdPilot AI monorepo workspace. The core architecture connects
            a React Vite interface, Node.js Express orchestration backend, and a
            Python FastAPI agent runtime.
          </p>

          <div className="mt-5 flex flex-wrap items-center gap-3">
            <Button variant="primary" icon={Sparkles}>
              Generate Creative
            </Button>
            <Button variant="secondary" icon={Layers}>
              View Campaigns
            </Button>
            <Button
              variant="outline"
              icon={RefreshCw}
              onClick={fetchHealth}
              disabled={loading}
            >
              Probe Services
            </Button>
          </div>
        </div>
      </div>

      {/* Key Metric Overview Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-5">
        <StatCard
          title="Active Campaigns"
          value="12"
          change="+18%"
          changeType="positive"
          icon={Layers}
          accentColor="indigo"
        />
        <StatCard
          title="Creatives Generated"
          value="1,420"
          change="+32%"
          changeType="positive"
          icon={Image}
          accentColor="purple"
        />
        <StatCard
          title="Avg. ROAS Target"
          value="4.6x"
          change="+12.4%"
          changeType="positive"
          icon={TrendingUp}
          accentColor="emerald"
        />
        <StatCard
          title="Agent Orchestration"
          value="LangGraph"
          change="Ready"
          changeType="positive"
          icon={Cpu}
          accentColor="cyan"
        />
      </div>

      {/* Monorepo Services Health & Diagnostics */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* Frontend Service Card */}
        <Card hoverEffect>
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2.5">
              <div className="p-2 rounded-lg bg-sky-500/10 text-sky-400 border border-sky-500/20">
                <Code2 className="w-5 h-5" />
              </div>
              <div>
                <h4 className="text-sm font-semibold text-white">Frontend Service</h4>
                <p className="text-xs text-slate-400">React + Vite + Tailwind</p>
              </div>
            </div>
            <Badge variant="success" size="sm" dot>
              Running
            </Badge>
          </div>
          <p className="text-xs text-slate-300 mt-2">
            Client-side Single Page Application running on Vite dev server. Supports dark-mode design tokens and responsive shell layout.
          </p>
          <div className="mt-4 pt-3 border-t border-slate-800 flex items-center justify-between text-xs text-slate-400">
            <span>Port: 5173</span>
            <span className="text-emerald-400 font-mono">http://localhost:5173</span>
          </div>
        </Card>

        {/* Backend Service Card */}
        <Card hoverEffect>
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2.5">
              <div className="p-2 rounded-lg bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                <Server className="w-5 h-5" />
              </div>
              <div>
                <h4 className="text-sm font-semibold text-white">Backend API</h4>
                <p className="text-xs text-slate-400">Node.js + Express (ESM)</p>
              </div>
            </div>
            {backendHealth?.online ? (
              <Badge variant="success" size="sm" dot>
                Online ({backendHealth.latencyMs}ms)
              </Badge>
            ) : (
              <Badge variant="error" size="sm" dot>
                Offline
              </Badge>
            )}
          </div>
          <p className="text-xs text-slate-300 mt-2">
            REST API orchestrator with Zod environment validation, structured JSON logging, and centralized error handling.
          </p>
          <div className="mt-4 pt-3 border-t border-slate-800 flex items-center justify-between text-xs text-slate-400">
            <span>Port: 5000</span>
            <span className="font-mono text-slate-300">
              {backendHealth?.online ? `Uptime: ${backendHealth.details?.uptimeSeconds}s` : 'Offline'}
            </span>
          </div>
        </Card>

        {/* Agent Service Card */}
        <Card hoverEffect>
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2.5">
              <div className="p-2 rounded-lg bg-purple-500/10 text-purple-400 border border-purple-500/20">
                <Cpu className="w-5 h-5" />
              </div>
              <div>
                <h4 className="text-sm font-semibold text-white">Agent Runtime</h4>
                <p className="text-xs text-slate-400">Python + FastAPI + LangGraph</p>
              </div>
            </div>
            {agentHealth?.online ? (
              <Badge variant="success" size="sm" dot>
                Online ({agentHealth.latencyMs}ms)
              </Badge>
            ) : (
              <Badge variant="error" size="sm" dot>
                Offline
              </Badge>
            )}
          </div>
          <p className="text-xs text-slate-300 mt-2">
            Autonomous multi-agent orchestration runtime leveraging Pydantic schemas, Uvicorn, and LangGraph workflow state machines.
          </p>
          <div className="mt-4 pt-3 border-t border-slate-800 flex items-center justify-between text-xs text-slate-400">
            <span>Port: 8000</span>
            <span className="font-mono text-slate-300">
              {agentHealth?.online ? `Py ${agentHealth.details?.python_version}` : 'Offline'}
            </span>
          </div>
        </Card>
      </div>

      {/* System Architecture Specifications */}
      <Card>
        <CardHeader
          title="Monorepo Architecture Invariants"
          description="Independent services configured with modular contracts, strict schemas, and zero cross-service contamination."
          action={
            <Badge variant="neutral" size="sm">
              <ShieldCheck className="w-3 h-3 mr-1 text-emerald-400" />
              Isolated Runtimes
            </Badge>
          }
        />
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs">
          <div className="p-4 rounded-lg bg-slate-950/60 border border-slate-800/80">
            <span className="font-semibold text-indigo-300 block mb-1">Frontend (Client)</span>
            <p className="text-slate-400 leading-relaxed">
              React 18 with Vite, Tailwind CSS v4 design tokens, client-side React Router navigation, dark mode by default.
            </p>
          </div>
          <div className="p-4 rounded-lg bg-slate-950/60 border border-slate-800/80">
            <span className="font-semibold text-emerald-300 block mb-1">Backend (Server)</span>
            <p className="text-slate-400 leading-relaxed">
              Express with ES modules, Helmet headers, CORS policies, centralized error handlers, structured request logging.
            </p>
          </div>
          <div className="p-4 rounded-lg bg-slate-950/60 border border-slate-800/80">
            <span className="font-semibold text-purple-300 block mb-1">Agent (Intelligence)</span>
            <p className="text-slate-400 leading-relaxed">
              FastAPI with Pydantic v2 validation, LangGraph workflows, dedicated Python 3.13 virtual environment.
            </p>
          </div>
        </div>
      </Card>
    </div>
  );
}

