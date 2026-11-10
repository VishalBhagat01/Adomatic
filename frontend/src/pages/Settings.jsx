import React from 'react';
import { Card, CardHeader } from '../components/common/Card';
import { Badge } from '../components/common/Badge';
import { Button } from '../components/common/Button';
import { Settings as SettingsIcon, Key, Server, Cpu, Shield } from 'lucide-react';

export function Settings() {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold text-white">Platform Settings</h2>
        <p className="text-xs text-slate-400 mt-1">
          Configure API connections, agent parameters, and environment specifications.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        <Card>
          <CardHeader
            title="Service Topology"
            description="Active communication endpoints"
            action={<Badge variant="purple">Architecture</Badge>}
          />
          <div className="space-y-3 text-xs">
            <div className="flex justify-between items-center py-2 border-b border-slate-800">
              <span className="text-slate-400">Frontend Endpoint</span>
              <span className="font-mono text-slate-200">http://localhost:5173</span>
            </div>
            <div className="flex justify-between items-center py-2 border-b border-slate-800">
              <span className="text-slate-400">Backend Express API</span>
              <span className="font-mono text-slate-200">http://localhost:5000</span>
            </div>
            <div className="flex justify-between items-center py-2 border-b border-slate-800">
              <span className="text-slate-400">FastAPI Agent Runtime</span>
              <span className="font-mono text-slate-200">http://localhost:8000</span>
            </div>
            <div className="flex justify-between items-center py-2">
              <span className="text-slate-400">Environment</span>
              <span className="text-emerald-400 font-semibold">Development / Monorepo</span>
            </div>
          </div>
        </Card>

        <Card>
          <CardHeader
            title="Security & Isolation"
            description="Invariants applied to this codebase"
            action={<Badge variant="success">Hardened</Badge>}
          />
          <div className="space-y-3 text-xs text-slate-300">
            <div className="flex items-start gap-2.5">
              <Shield className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
              <span>No API keys or plaintext credentials checked into version control.</span>
            </div>
            <div className="flex items-start gap-2.5">
              <Server className="w-4 h-4 text-sky-400 shrink-0 mt-0.5" />
              <span>Express backend runs isolated with Helmet, CORS, and Zod schemas.</span>
            </div>
            <div className="flex items-start gap-2.5">
              <Cpu className="w-4 h-4 text-purple-400 shrink-0 mt-0.5" />
              <span>FastAPI agent runs in a sandboxed Python virtual environment.</span>
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
}

