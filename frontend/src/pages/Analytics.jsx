import React, { useEffect, useState, useCallback, useMemo } from 'react';
import {
  BarChart3,
  CheckCircle2,
  Images,
  Layers,
  RefreshCw,
  AlertTriangle,
  Database,
  Trash2,
  TrendingUp,
  ShieldAlert,
} from 'lucide-react';
import { Card, CardHeader } from '../components/common/Card';
import { StatCard } from '../components/common/StatCard';
import { Button } from '../components/common/Button';
import { Badge } from '../components/common/Badge';
import { SortablePerformanceTable } from '../components/analytics/SortablePerformanceTable';
import { TrendChart } from '../components/analytics/TrendChart';
import { CreativeMappingModal } from '../components/analytics/CreativeMappingModal';
import { OptimizationStudioPanel } from '../components/analytics/OptimizationStudioPanel';
import {
  dashboardApi,
  creativeApi,
  campaignApi,
  metaApi,
  analyticsApi,
} from '../services/api';
import { usePageTitle, useStudio } from '../context/StudioContext';
import { todayPlainDateISO, offsetPlainDateISO } from '../utils/dates';

function formatMoney(val, currency = 'INR') {
  if (val === null || val === undefined || !Number.isFinite(Number(val))) return '—';
  try {
    return new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency: currency || 'INR',
      maximumFractionDigits: 2,
    }).format(Number(val));
  } catch {
    return `${currency || 'USD'} ${Number(val).toFixed(2)}`;
  }
}

function formatInt(val) {
  if (val === null || val === undefined || !Number.isFinite(Number(val))) return '—';
  return new Intl.NumberFormat('en-IN').format(Math.round(Number(val)));
}

export function Analytics() {
  usePageTitle('Analytics');
  const { announce } = useStudio();

  const [filters, setFilters] = useState(() => ({
    since: '',
    until: '',
    campaignId: '',
    origin: '',
    includeTestFixtures: true,
  }));

  const [state, setState] = useState({
    loading: true,
    syncing: false,
    error: null,
    summary: null,
    creatives: [],
    campaigns: [],
    metaStatus: null,
    overview: null,
    comparison: [],
    trends: [],
    breakdowns: { placements: [], audiences: [] },
  });

  const [mappingTarget, setMappingTarget] = useState(null);

  const loadAnalytics = useCallback(async () => {
    setState((prev) => ({ ...prev, loading: true, error: null }));
    try {
      const queryFilters = {
        ...(filters.since ? { since: filters.since } : {}),
        ...(filters.until ? { until: filters.until } : {}),
        ...(filters.campaignId ? { campaignId: filters.campaignId } : {}),
        ...(filters.origin ? { origin: filters.origin } : {}),
        includeTestFixtures: filters.includeTestFixtures ? 'true' : 'false',
      };

      const [sumRes, crRes, campRes, metaRes, ovRes, compRes, trendRes, bdRes] =
        await Promise.all([
          dashboardApi.getSummary(),
          creativeApi.list({ limit: 100 }).catch(() => ({ data: [] })),
          campaignApi.list({ limit: 100 }).catch(() => ({ data: [] })),
          metaApi.getStatus().catch(() => ({ data: { connected: false } })),
          analyticsApi.overview(queryFilters),
          analyticsApi.creatives(queryFilters),
          analyticsApi.trends(queryFilters),
          analyticsApi.breakdowns(queryFilters),
        ]);

      setState((prev) => ({
        ...prev,
        loading: false,
        error: null,
        summary: sumRes.data,
        creatives: crRes.data || [],
        campaigns: campRes.data || [],
        metaStatus: metaRes.data || { connected: false },
        overview: ovRes.data || null,
        comparison: compRes.data?.items || [],
        trends: trendRes.data?.series || [],
        breakdowns: {
          placements: bdRes.data?.placements || [],
          audiences: bdRes.data?.audiences || [],
        },
      }));
    } catch (err) {
      setState((prev) => ({
        ...prev,
        loading: false,
        error: err.message || 'Failed to load analytics data',
      }));
    }
  }, [filters]);

  useEffect(() => {
    loadAnalytics();
  }, [loadAnalytics]);

  const applyPresetRange = (days) => {
    const accountTz = state.overview?.dataQuality?.timezones?.[0] || undefined;
    const until = todayPlainDateISO(accountTz);
    const since = offsetPlainDateISO(until, -(days - 1));
    setFilters((prev) => ({ ...prev, since, until }));
  };

  const handleTriggerLiveSync = async () => {
    setState((prev) => ({ ...prev, syncing: true, error: null }));
    try {
      await metaApi.triggerSync({
        ...(filters.since ? { since: filters.since } : {}),
        ...(filters.until ? { until: filters.until } : {}),
        include_placement_breakdown: true,
        include_audience_breakdown: true,
      });
      announce('Meta Marketing insights synchronized');
      await loadAnalytics();
    } catch (err) {
      setState((prev) => ({ ...prev, error: err.message }));
    } finally {
      setState((prev) => ({ ...prev, syncing: false }));
    }
  };

  const handleLoadFixtures = async () => {
    setState((prev) => ({ ...prev, syncing: true, error: null }));
    try {
      await metaApi.triggerFixtureSync({});
      announce('Isolated Meta test fixture dataset loaded');
      await loadAnalytics();
    } catch (err) {
      setState((prev) => ({ ...prev, error: err.message }));
    } finally {
      setState((prev) => ({ ...prev, syncing: false }));
    }
  };

  const handleClearFixtures = async () => {
    setState((prev) => ({ ...prev, syncing: true, error: null }));
    try {
      await metaApi.clearFixtures();
      announce('Isolated Meta test fixtures removed');
      await loadAnalytics();
    } catch (err) {
      setState((prev) => ({ ...prev, error: err.message }));
    } finally {
      setState((prev) => ({ ...prev, syncing: false }));
    }
  };

  // Meta Analytics derived view models
  const metaTotals = state.overview?.totals || {};
  const dataQuality = state.overview?.dataQuality || {};
  const primaryCurrency = dataQuality.primaryCurrency || 'INR';
  const containsFixtures = Boolean(state.overview?.containsTestFixtures);
  const metaCampaignRollups = state.overview?.campaigns || [];

  // Conversion Funnel steps
  const funnelSteps = useMemo(() => {
    const steps = [
      { label: 'Impressions', value: metaTotals.impressions },
      { label: 'Link Clicks', value: metaTotals.linkClicks },
      { label: 'Landing Page Views', value: metaTotals.landingPageViews },
      { label: 'Add to Cart', value: metaTotals.addToCart },
      { label: 'Purchases', value: metaTotals.purchases },
    ];
    const base = Math.max(1, Number(metaTotals.impressions || 0));
    return steps.map((s) => ({
      ...s,
      pct:
        s.value !== null && s.value !== undefined && base > 0
          ? Math.max(2, Math.min(100, Math.round((Number(s.value) / base) * 100)))
          : 0,
    }));
  }, [metaTotals]);

  // Existing Studio Creative QA Metrics (preserved cleanly)
  const qaTotals = state.summary?.totals || {
    totalCampaigns: 0,
    generatedCreatives: 0,
    approvedCreatives: 0,
    imageCreatives: 0,
    videoCreatives: 0,
  };
  const scoredCreatives = state.creatives.filter(
    (c) => c.evaluation?.overall_weighted_score !== undefined
  );
  const avgScore =
    scoredCreatives.length > 0
      ? (
          scoredCreatives.reduce(
            (sum, c) => sum + Number(c.evaluation.overall_weighted_score || 0),
            0
          ) / scoredCreatives.length
        ).toFixed(1)
      : '—';
  const byPlacement = state.creatives.reduce((acc, cr) => {
    const key = cr.placement || 'unknown';
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2.5 flex-wrap">
            <h1 className="text-xl font-semibold text-white">
              Campaign &amp; Meta Performance Analytics
            </h1>
            {state.metaStatus?.connected ? (
              <Badge variant="success">
                Meta Connected · {state.metaStatus.connection?.primaryAdAccountId || 'Active'}
              </Badge>
            ) : (
              <Badge variant="neutral">Meta Not Connected</Badge>
            )}
          </div>
          <p className="text-xs text-slate-400 mt-1">
            Real Meta Marketing API campaign delivery metrics, AdPilot creative attribution, and studio QA health.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {state.metaStatus?.connected ? (
            <Button
              variant="primary"
              size="sm"
              icon={RefreshCw}
              disabled={state.syncing}
              onClick={handleTriggerLiveSync}
            >
              {state.syncing ? 'Syncing...' : 'Sync Meta Insights'}
            </Button>
          ) : null}
          <Button
            variant="secondary"
            size="sm"
            icon={Database}
            disabled={state.syncing}
            onClick={handleLoadFixtures}
          >
            {state.syncing ? 'Loading...' : 'Load Test Fixtures'}
          </Button>
          {containsFixtures ? (
            <Button
              variant="ghost"
              size="sm"
              icon={Trash2}
              disabled={state.syncing}
              onClick={handleClearFixtures}
            >
              Clear Fixtures
            </Button>
          ) : null}
          <Button
            variant="ghost"
            size="sm"
            icon={RefreshCw}
            onClick={loadAnalytics}
            disabled={state.loading}
          >
            Refresh
          </Button>
        </div>
      </div>

      {/* Test Fixture Isolation Notice */}
      {containsFixtures ? (
        <div
          role="status"
          className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 flex flex-wrap items-center justify-between gap-3 text-xs text-amber-200"
        >
          <div className="flex items-center gap-2.5">
            <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" aria-hidden="true" />
            <span>
              <strong>TEST FIXTURE DATA ACTIVE:</strong> Currently displaying isolated Graph API v27.0 test fixture records alongside any live synced data. Not live billing spend.
            </span>
          </div>
          <Badge variant="warning">Isolated Test Fixture</Badge>
        </div>
      ) : null}

      {state.error ? (
        <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-xs text-rose-300">
          {state.error}
        </div>
      ) : null}

      {/* Filter Toolbar */}
      <Card padding="p-4">
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-6 gap-3 items-end">
          <div>
            <label htmlFor="analytics-since" className="block text-[11px] text-slate-400 mb-1">
              Since (Account Date)
            </label>
            <input
              id="analytics-since"
              type="date"
              value={filters.since}
              onChange={(e) => setFilters((prev) => ({ ...prev, since: e.target.value }))}
              className="studio-input text-xs py-1.5"
            />
          </div>

          <div>
            <label htmlFor="analytics-until" className="block text-[11px] text-slate-400 mb-1">
              Until (Account Date)
            </label>
            <input
              id="analytics-until"
              type="date"
              value={filters.until}
              onChange={(e) => setFilters((prev) => ({ ...prev, until: e.target.value }))}
              className="studio-input text-xs py-1.5"
            />
          </div>

          <div>
            <label htmlFor="analytics-campaign" className="block text-[11px] text-slate-400 mb-1">
              AdPilot Campaign
            </label>
            <select
              id="analytics-campaign"
              value={filters.campaignId}
              onChange={(e) => setFilters((prev) => ({ ...prev, campaignId: e.target.value }))}
              className="studio-input text-xs py-1.5"
            >
              <option value="">All Campaigns</option>
              {state.campaigns.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="analytics-origin" className="block text-[11px] text-slate-400 mb-1">
              Creative Origin
            </label>
            <select
              id="analytics-origin"
              value={filters.origin}
              onChange={(e) => setFilters((prev) => ({ ...prev, origin: e.target.value }))}
              className="studio-input text-xs py-1.5"
            >
              <option value="">All Origins</option>
              <option value="adpilot_generated">AdPilot AI Generated</option>
              <option value="uploaded_creative">Uploaded Creative</option>
              <option value="external_meta">External Meta Ad</option>
            </select>
          </div>

          <div className="flex items-center gap-1.5">
            <Button variant="secondary" size="sm" onClick={() => applyPresetRange(7)}>
              7d
            </Button>
            <Button variant="secondary" size="sm" onClick={() => applyPresetRange(14)}>
              14d
            </Button>
            <Button variant="secondary" size="sm" onClick={() => applyPresetRange(30)}>
              30d
            </Button>
            {(filters.since || filters.until || filters.campaignId || filters.origin) ? (
              <Button
                variant="ghost"
                size="sm"
                onClick={() =>
                  setFilters({
                    since: '',
                    until: '',
                    campaignId: '',
                    origin: '',
                    includeTestFixtures: filters.includeTestFixtures,
                  })
                }
              >
                Reset
              </Button>
            ) : null}
          </div>

          <label className="inline-flex items-center gap-2 text-xs text-slate-300 cursor-pointer pb-1.5">
            <input
              type="checkbox"
              checked={filters.includeTestFixtures}
              onChange={(e) =>
                setFilters((prev) => ({ ...prev, includeTestFixtures: e.target.checked }))
              }
              className="rounded border-slate-700 bg-slate-900 text-indigo-500"
            />
            <span>Include Test Fixtures</span>
          </label>
        </div>
      </Card>

      {/* Meta Performance KPI Strip */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          title="Meta Ad Spend"
          value={formatMoney(metaTotals.spend, primaryCurrency)}
          subtext={`CPM ${formatMoney(metaTotals.cpm, primaryCurrency)} · ${formatInt(metaTotals.impressions)} impr.`}
          icon={TrendingUp}
          accentColor="indigo"
        />
        <StatCard
          title="Conversion Revenue"
          value={formatMoney(metaTotals.purchaseConversionValue, primaryCurrency)}
          subtext={`${formatInt(metaTotals.purchases)} purchases · CPA ${formatMoney(metaTotals.cpa, primaryCurrency)}`}
          icon={CheckCircle2}
          accentColor="emerald"
        />
        <StatCard
          title="Blended ROAS"
          value={
            metaTotals.roas !== null && metaTotals.roas !== undefined
              ? `${Number(metaTotals.roas).toFixed(2)}x`
              : '—'
          }
          subtext={`Attribution: ${dataQuality.attributionSettings?.[0] || '7d_click_1d_view'}`}
          icon={BarChart3}
          accentColor="amber"
        />
        <StatCard
          title="Link Clicks &amp; CTR"
          value={
            metaTotals.linkCtr !== null && metaTotals.linkCtr !== undefined
              ? `${Number(metaTotals.linkCtr).toFixed(2)}%`
              : '—'
          }
          subtext={`${formatInt(metaTotals.linkClicks)} link clicks (All CTR: ${
            metaTotals.allClickCtr !== null && metaTotals.allClickCtr !== undefined
              ? `${Number(metaTotals.allClickCtr).toFixed(2)}%`
              : '—'
          }) · CPC ${formatMoney(metaTotals.cpc, primaryCurrency)}`}
          icon={Layers}
          accentColor="cyan"
        />
      </div>

      {/* Trends + Conversion Funnel */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        <Card className="xl:col-span-2">
          <CardHeader
            title="Daily Delivery &amp; Attribution Trends"
            description="Grouped strictly by Meta Ad Account calendar day. Amber shading indicates trailing delayed-attribution window."
          />
          <TrendChart series={state.trends} currency={primaryCurrency} />
        </Card>

        <Card>
          <CardHeader
            title="Meta Conversion Funnel"
            description="Inline outbound clicks through attributed purchases"
          />
          <ul className="space-y-3 text-xs">
            {funnelSteps.map((step) => (
              <li key={step.label} className="space-y-1">
                <div className="flex items-center justify-between">
                  <span className="text-slate-300 font-medium">{step.label}</span>
                  <span className="font-mono text-slate-200">{formatInt(step.value)}</span>
                </div>
                <div className="h-2 rounded-full bg-slate-800/90 overflow-hidden">
                  <div
                    className="h-full rounded-full bg-indigo-500 transition-all"
                    style={{ width: `${step.pct}%` }}
                  />
                </div>
              </li>
            ))}
          </ul>
        </Card>
      </div>

      {/* Creative-Level Comparison (Responsive + Accessible Sortable Table) */}
      <Card>
        <CardHeader
          title="Creative-Level Performance Comparison"
          description="Sort any metric column or remap ads across AdPilot Generated, Uploaded Creative, and External Meta origins."
          action={<Badge variant="purple">{state.comparison.length} Ads</Badge>}
        />
        <SortablePerformanceTable
          items={state.comparison}
          onOpenMappingModal={(row) => setMappingTarget(row)}
        />
      </Card>

      {/* Campaign Rollups + Placement & Audience Breakdowns + Data Quality */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <Card>
          <CardHeader
            title="Campaign Performance Rollups"
            description="Aggregated spend, link clicks, purchases, and ROAS by Meta campaign"
          />
          {metaCampaignRollups.length === 0 ? (
            <p className="text-xs text-slate-500 py-6 text-center">
              No campaign performance rows recorded yet.
            </p>
          ) : (
            <ul className="space-y-3 text-xs">
              {metaCampaignRollups.map((camp) => (
                <li
                  key={`${camp.metaAdAccountId}:${camp.metaCampaignId}`}
                  className="p-3 rounded-lg border border-slate-800/80 bg-slate-950/60 space-y-1.5"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium text-slate-100 truncate">
                      {camp.metaCampaignName}
                    </span>
                    <Badge variant={camp.roas >= 3 ? 'success' : 'neutral'}>
                      ROAS {camp.roas !== null ? `${camp.roas.toFixed(2)}x` : '—'}
                    </Badge>
                  </div>
                  <div className="grid grid-cols-3 gap-2 text-[11px] font-mono text-slate-400">
                    <span>Spend {formatMoney(camp.spend, camp.currency)}</span>
                    <span>Links {formatInt(camp.linkClicks)}</span>
                    <span>Purchases {formatInt(camp.purchases)}</span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <CardHeader
            title="Placement Breakdown"
            description="Performance across publisher_platform and platform_position"
          />
          {state.breakdowns.placements.length === 0 ? (
            <p className="text-xs text-slate-500 py-6 text-center">
              Run a sync with placement breakdowns enabled to inspect Feed vs Reels efficiency.
            </p>
          ) : (
            <ul className="space-y-2.5 text-xs">
              {state.breakdowns.placements.slice(0, 8).map((pl) => (
                <li
                  key={pl.dimension}
                  className="p-2.5 rounded-lg border border-slate-800/80 bg-slate-950/50 flex items-center justify-between gap-3"
                >
                  <div className="min-w-0">
                    <div className="font-medium text-slate-200 truncate">{pl.dimension}</div>
                    <div className="text-[11px] font-mono text-slate-400">
                      Link CTR {pl.linkCtr !== null ? `${pl.linkCtr.toFixed(2)}%` : '—'} · Purchases{' '}
                      {formatInt(pl.purchases)}
                    </div>
                  </div>
                  <div className="text-right font-mono shrink-0">
                    <div className="text-slate-100">{formatMoney(pl.spend, pl.currency)}</div>
                    <div className="text-[11px] text-amber-300">
                      {pl.roas !== null ? `${pl.roas.toFixed(2)}x` : '—'}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <CardHeader
            title="Data Quality &amp; Attribution Notes"
            description="Currency boundaries, timezone alignment, and incomplete fields"
            action={<ShieldAlert className="w-4 h-4 text-slate-400" aria-hidden="true" />}
          />
          <div className="space-y-3 text-xs">
            <div className="flex justify-between gap-2 border-b border-slate-800/80 pb-2">
              <span className="text-slate-400">Currencies</span>
              <span className="font-mono text-slate-200">
                {dataQuality.currencies?.join(', ') || '—'}
              </span>
            </div>
            <div className="flex justify-between gap-2 border-b border-slate-800/80 pb-2">
              <span className="text-slate-400">Account Timezones</span>
              <span className="font-mono text-slate-200">
                {dataQuality.timezones?.join(', ') || '—'}
              </span>
            </div>
            <div className="flex justify-between gap-2 border-b border-slate-800/80 pb-2">
              <span className="text-slate-400">Provisional Dates</span>
              <span className="font-mono text-amber-300">
                {dataQuality.provisionalDates?.length || 0} trailing days
              </span>
            </div>
            {dataQuality.missingMetrics?.length > 0 ? (
              <div className="text-[11px] text-slate-400">
                Missing in some rows:{' '}
                <span className="font-mono text-slate-300">
                  {dataQuality.missingMetrics.join(', ')}
                </span>
              </div>
            ) : null}
            {dataQuality.discrepancyWarnings?.length > 0 ? (
              <ul className="space-y-1.5 pt-1">
                {dataQuality.discrepancyWarnings.map((w, idx) => (
                  <li
                    key={idx}
                    className="rounded-md border border-amber-500/20 bg-amber-500/5 px-2.5 py-1.5 text-[11px] text-amber-200"
                  >
                    {w}
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        </Card>
      </div>

      {/* Step 12 Optimization Engine, Controlled Experiments & Production Observability */}
      <OptimizationStudioPanel
        filters={filters}
        creatives={state.creatives}
        onAnnounce={announce}
      />

      {/* Preserved Studio Creative QA Analytics Section */}
      <div className="pt-2 border-t border-slate-800/80 space-y-4">
        <div>
          <h2 className="text-base font-semibold text-white">Studio Quality Analytics</h2>
          <p className="text-xs text-slate-400 mt-0.5">
            QA approval ratios, format distribution, and placement coverage across AdPilot-generated creatives.
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard
            title="Average QA Score"
            value={avgScore === '—' ? '—' : `${avgScore}/100`}
            subtext={`${scoredCreatives.length} evaluated creatives`}
            icon={BarChart3}
            accentColor="indigo"
          />
          <StatCard
            title="Approval Rate"
            value={
              qaTotals.generatedCreatives > 0
                ? `${Math.round((qaTotals.approvedCreatives / qaTotals.generatedCreatives) * 100)}%`
                : '—'
            }
            subtext={`${qaTotals.approvedCreatives} of ${qaTotals.generatedCreatives} approved`}
            icon={CheckCircle2}
            accentColor="emerald"
          />
          <StatCard
            title="Images vs Videos"
            value={`${qaTotals.imageCreatives} / ${qaTotals.videoCreatives}`}
            subtext="Generated creative assets"
            icon={Images}
            accentColor="cyan"
          />
          <StatCard
            title="Total Campaigns"
            value={qaTotals.totalCampaigns}
            subtext="Active & historical"
            icon={Layers}
            accentColor="purple"
          />
        </div>

        <Card>
          <CardHeader
            title="Creatives by Target Placement"
            description="Actual counts grouped by ad placement metadata."
          />
          {Object.keys(byPlacement).length === 0 ? (
            <p className="text-xs text-slate-500 py-8 text-center">
              No generated creatives recorded yet. Placement counts appear automatically once campaigns run.
            </p>
          ) : (
            <ul className="space-y-2.5 text-xs">
              {Object.entries(byPlacement).map(([placement, count]) => {
                const pct = Math.round((count / state.creatives.length) * 100);
                return (
                  <li key={placement} className="space-y-1">
                    <div className="flex items-center justify-between">
                      <span className="font-medium text-slate-200">{placement}</span>
                      <span className="font-mono text-slate-400">
                        {count} assets ({pct}%)
                      </span>
                    </div>
                    <div className="h-1.5 rounded-full bg-slate-800 overflow-hidden">
                      <div className="h-full bg-indigo-500 rounded-full" style={{ width: `${pct}%` }} />
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      </div>

      <CreativeMappingModal
        open={Boolean(mappingTarget)}
        targetRow={mappingTarget}
        campaigns={state.campaigns}
        creatives={state.creatives}
        onClose={() => setMappingTarget(null)}
        onSaved={async () => {
          announce('Creative lineage mapping saved');
          await loadAnalytics();
        }}
      />
    </div>
  );
}
