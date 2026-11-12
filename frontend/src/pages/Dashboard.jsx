import React, { useEffect, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import {
  Layers,
  Images,
  CheckCircle2,
  Activity,
  Plus,
  RefreshCw,
  AlertCircle,
  ArrowRight,
  Clock,
} from 'lucide-react';
import { StatCard } from '../components/common/StatCard';
import { Card, CardHeader } from '../components/common/Card';
import { Button } from '../components/common/Button';
import { StatusBadge, isCampaignInFlight } from '../components/common/StatusBadge';
import { dashboardApi } from '../services/api';
import { usePageTitle } from '../context/StudioContext';

function formatRelativeTime(iso) {
  if (!iso) return 'Just now';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return 'Recent';
  return date.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function Dashboard() {
  usePageTitle('Dashboard');

  const [state, setState] = useState({ loading: true, error: null, data: null });

  const loadSummary = useCallback(async () => {
    setState((prev) => ({ ...prev, loading: true, error: null }));
    try {
      const res = await dashboardApi.getSummary();
      setState({ loading: false, error: null, data: res.data });
    } catch (err) {
      setState({ loading: false, error: err.message, data: null });
    }
  }, []);

  useEffect(() => {
    loadSummary();
  }, [loadSummary]);

  const totals = state.data?.totals || {
    totalCampaigns: 0,
    generatedCreatives: 0,
    approvedCreatives: 0,
    rejectedCreatives: 0,
    pendingCreatives: 0,
    imageCreatives: 0,
    videoCreatives: 0,
  };
  const statusCounts = state.data?.statusCounts || {};
  const recentCampaigns = state.data?.recentCampaigns || [];
  const recentActivity = state.data?.recentActivity || [];

  const activeInFlightCount = Object.entries(statusCounts).reduce(
    (sum, [status, count]) => (isCampaignInFlight(status) ? sum + Number(count || 0) : sum),
    0
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-white">Studio Overview</h1>
          <p className="text-xs text-slate-400 mt-1">
            Live metrics aggregated across campaigns, creative assets, and execution stages.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="secondary"
            size="sm"
            icon={RefreshCw}
            onClick={loadSummary}
            disabled={state.loading}
          >
            Refresh
          </Button>
          <Link
            to="/campaigns/new"
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-medium border border-indigo-500/40"
          >
            <Plus className="w-3.5 h-3.5" aria-hidden="true" />
            New Campaign
          </Link>
        </div>
      </div>

      {state.error && (
        <div
          role="alert"
          className="rounded-xl bg-rose-950/35 border border-rose-500/30 p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
        >
          <div className="flex items-center gap-2.5 text-sm text-rose-200">
            <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" aria-hidden="true" />
            <span>Failed to load studio metrics: {state.error}</span>
          </div>
          <Button variant="secondary" size="sm" icon={RefreshCw} onClick={loadSummary}>
            Retry
          </Button>
        </div>
      )}

      {/* Primary KPI Strip (Strict Real Data) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          title="Total Campaigns"
          value={state.loading ? '—' : totals.totalCampaigns}
          subtext={`${statusCounts.COMPLETED || 0} completed · ${statusCounts.FAILED || 0} failed`}
          icon={Layers}
          accentColor="indigo"
        />
        <StatCard
          title="Generated Creatives"
          value={state.loading ? '—' : totals.generatedCreatives}
          subtext={`${totals.imageCreatives} images · ${totals.videoCreatives} videos`}
          icon={Images}
          accentColor="cyan"
        />
        <StatCard
          title="Approved Creatives"
          value={state.loading ? '—' : totals.approvedCreatives}
          subtext={
            totals.generatedCreatives > 0
              ? `${Math.round((totals.approvedCreatives / totals.generatedCreatives) * 100)}% QA approval rate`
              : 'Awaiting generated creatives'
          }
          icon={CheckCircle2}
          accentColor="emerald"
        />
        <StatCard
          title="Active Pipeline Runs"
          value={state.loading ? '—' : activeInFlightCount}
          subtext={`${totals.pendingCreatives} pending review`}
          icon={Activity}
          accentColor="amber"
        />
      </div>

      {/* Main Two-Column Content */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Recent Campaigns */}
        <div className="lg:col-span-2">
          <Card>
            <CardHeader
              title="Recent Campaigns"
              description="Jump directly into live execution workspaces or finished campaign bundles."
              action={
                <Link
                  to="/campaigns"
                  className="text-xs font-medium text-indigo-400 hover:text-indigo-300 inline-flex items-center gap-1"
                >
                  All campaigns <ArrowRight className="w-3.5 h-3.5" aria-hidden="true" />
                </Link>
              }
            />

            {state.loading ? (
              <div className="space-y-3 animate-pulse">
                {[1, 2, 3].map((n) => (
                  <div key={n} className="h-16 rounded-lg bg-slate-800/50" />
                ))}
              </div>
            ) : recentCampaigns.length === 0 ? (
              <div className="py-12 px-4 text-center border border-dashed border-slate-800 rounded-lg bg-[#0b0e15]">
                <Layers className="w-7 h-7 text-slate-600 mx-auto mb-2.5" aria-hidden="true" />
                <p className="text-sm font-medium text-slate-200">No campaigns created yet</p>
                <p className="text-xs text-slate-500 mt-1 max-w-sm mx-auto">
                  Start with a product URL to inspect extracted specifications and launch your first creative workflow.
                </p>
                <div className="mt-4">
                  <Link
                    to="/campaigns/new"
                    className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-medium"
                  >
                    <Plus className="w-3.5 h-3.5" aria-hidden="true" />
                    Create First Campaign
                  </Link>
                </div>
              </div>
            ) : (
              <div className="divide-y divide-slate-800/70">
                {recentCampaigns.map((c) => {
                  const targetRoute =
                    c.status === 'COMPLETED'
                      ? `/campaigns/${c.id}`
                      : `/campaigns/${c.id}/workspace`;
                  return (
                    <div
                      key={c.id}
                      className="py-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                    >
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <Link
                            to={targetRoute}
                            className="text-sm font-medium text-white hover:text-indigo-300 truncate"
                          >
                            {c.name}
                          </Link>
                          <StatusBadge status={c.status} />
                        </div>
                        <div className="text-xs text-slate-500 mt-1 flex flex-wrap items-center gap-2">
                          <span>{(c.formats || []).join(', ')}</span>
                          <span>·</span>
                          <span>{(c.placements || []).join(', ')}</span>
                          <span>·</span>
                          <span>{formatRelativeTime(c.createdAt)}</span>
                        </div>
                      </div>

                      <div className="flex items-center gap-2 shrink-0">
                        <Link
                          to={`/campaigns/${c.id}/workspace`}
                          className="px-2.5 py-1.5 rounded-md text-xs text-slate-300 hover:text-white bg-[#0b0e15] border border-slate-800 hover:border-slate-700"
                        >
                          Workspace
                        </Link>
                        {c.status === 'COMPLETED' && (
                          <Link
                            to={`/campaigns/${c.id}`}
                            className="px-2.5 py-1.5 rounded-md text-xs font-medium text-indigo-300 bg-indigo-500/10 border border-indigo-500/25 hover:bg-indigo-500/20"
                          >
                            Details
                          </Link>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </Card>
        </div>

        {/* Status Distribution & Recent Activity */}
        <div className="space-y-6">
          <Card>
            <CardHeader
              title="Campaign Statuses"
              description="Current state distribution across tenant runs"
            />
            {Object.keys(statusCounts).length === 0 ? (
              <p className="text-xs text-slate-500 py-4">No execution status data recorded yet.</p>
            ) : (
              <ul className="space-y-2.5">
                {Object.entries(statusCounts).map(([status, count]) => {
                  const pct =
                    totals.totalCampaigns > 0
                      ? Math.round((Number(count) / totals.totalCampaigns) * 100)
                      : 0;
                  return (
                    <li key={status} className="space-y-1">
                      <div className="flex items-center justify-between text-xs">
                        <StatusBadge status={status} />
                        <span className="font-mono text-slate-300">
                          {count} ({pct}%)
                        </span>
                      </div>
                      <div className="h-1.5 w-full rounded-full bg-slate-800/80 overflow-hidden">
                        <div className="h-full bg-indigo-500/70 rounded-full" style={{ width: `${pct}%` }} />
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>

          <Card>
            <CardHeader
              title="Recent Activity"
              description="Latest pipeline transitions and events"
            />
            {recentActivity.length === 0 ? (
              <p className="text-xs text-slate-500 py-4">No pipeline activity recorded yet.</p>
            ) : (
              <ul className="space-y-3 max-h-[340px] overflow-y-auto pr-1">
                {recentActivity.map((act, idx) => (
                  <li key={idx} className="flex items-start gap-2.5 text-xs">
                    <Clock className="w-3.5 h-3.5 text-slate-500 shrink-0 mt-0.5" aria-hidden="true" />
                    <div className="min-w-0 flex-1">
                      <Link
                        to={`/campaigns/${act.campaignId}/workspace`}
                        className="font-medium text-slate-200 hover:text-indigo-300 truncate block"
                      >
                        {act.campaignName}
                      </Link>
                      <p className="text-slate-400 mt-0.5">
                        Stage <span className="font-mono text-slate-300">{act.stage}</span> ({act.status})
                      </p>
                      {act.error && <p className="text-rose-400 mt-0.5 break-words">{act.error}</p>}
                      <p className="text-[11px] text-slate-500 mt-0.5">
                        {formatRelativeTime(act.timestamp)}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}
