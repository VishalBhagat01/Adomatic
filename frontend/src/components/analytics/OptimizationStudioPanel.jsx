import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  Sparkles,
  FlaskConical,
  Brain,
  Activity,
  ShieldCheck,
  AlertTriangle,
  Check,
  X,
  Plus,
  RefreshCw,
} from 'lucide-react';
import { Card, CardHeader } from '../common/Card';
import { Button } from '../common/Button';
import { Badge } from '../common/Badge';
import { ModalDialog } from '../common/ModalDialog';
import { optimizationApi, observabilityApi } from '../../services/api';

const TABS = [
  { id: 'intelligence', label: 'Performance Intelligence', icon: Sparkles },
  { id: 'experiments', label: 'Controlled Experiments', icon: FlaskConical },
  { id: 'memory', label: 'Creative Learning Memory', icon: Brain },
  { id: 'observability', label: 'Reliability & AI Cost', icon: Activity },
];

export function OptimizationStudioPanel({ filters = {}, creatives = [], onAnnounce }) {
  const [activeTab, setActiveTab] = useState('intelligence');
  const tabRefs = useRef({});
  const panelRefs = useRef({});

  const [loading, setLoading] = useState(false);
  const [busyAction, setBusyAction] = useState(false);
  const [error, setError] = useState(null);

  const [intelligence, setIntelligence] = useState(null);
  const [recommendations, setRecommendations] = useState([]);
  const [experiments, setExperiments] = useState([]);
  const [memory, setMemory] = useState(null);
  const [metrics, setMetrics] = useState(null);
  const [readiness, setReadiness] = useState(null);

  const [memFilters, setMemFilters] = useState({
    productCategory: '',
    placement: '',
    format: '',
    outcomeStatus: '',
  });

  // Create Experiment Modal state
  const [expModalOpen, setExpModalOpen] = useState(false);
  const [expForm, setExpForm] = useState({
    name: '',
    hypothesis: '',
    variableTested: 'hook_type',
    objective: 'CONVERSIONS',
    placement: 'instagram_feed',
    banditEnabled: false,
    variantALabel: 'Question Hook Variant',
    variantAHook: 'question_hook',
    variantACreativeId: '',
    variantBLabel: 'Direct Benefit Variant',
    variantBHook: 'direct_benefit_hook',
    variantBCreativeId: '',
  });

  // Explicit Approval Modal state
  const [approveTarget, setApproveTarget] = useState(null);
  const [confirmPhrase, setConfirmPhrase] = useState('');

  const loadOptimizationData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const q = {
        ...(filters.since ? { since: filters.since } : {}),
        ...(filters.until ? { until: filters.until } : {}),
        ...(filters.campaignId ? { campaignId: filters.campaignId } : {}),
        ...(filters.origin ? { origin: filters.origin } : {}),
        includeTestFixtures: filters.includeTestFixtures !== false ? 'true' : 'false',
      };
      const cleanMem = Object.fromEntries(
        Object.entries(memFilters).filter(([, v]) => Boolean(v))
      );

      const [intelRes, recRes, expRes, memRes, metRes, readyRes] = await Promise.all([
        optimizationApi.getIntelligence(q).catch(() => ({ data: null })),
        optimizationApi.listRecommendations({}).catch(() => ({ data: { items: [] } })),
        optimizationApi.listExperiments({}).catch(() => ({ data: { items: [] } })),
        optimizationApi.retrieveMemory(cleanMem).catch(() => ({ data: null })),
        observabilityApi.getMetrics().catch(() => ({ data: null })),
        observabilityApi.getReadiness().catch(() => ({ data: null })),
      ]);

      setIntelligence(intelRes.data || null);
      setRecommendations(recRes.data?.items || []);
      setExperiments(expRes.data?.items || []);
      setMemory(memRes.data || null);
      setMetrics(metRes.data || null);
      setReadiness(readyRes.data || null);
    } catch (err) {
      setError(err.message || 'Failed to load optimization data');
    } finally {
      setLoading(false);
    }
  }, [filters, memFilters]);

  useEffect(() => {
    loadOptimizationData();
  }, [loadOptimizationData]);

  // Support native find-in-page beforematch event across hidden="until-found" tabpanels
  useEffect(() => {
    const cleanups = [];
    for (const tab of TABS) {
      const panelEl = panelRefs.current[tab.id];
      if (!panelEl) continue;
      const onMatch = () => setActiveTab(tab.id);
      panelEl.addEventListener('beforematch', onMatch);
      cleanups.push(() => panelEl.removeEventListener('beforematch', onMatch));
    }
    return () => cleanups.forEach((fn) => fn());
  }, []);

  const selectTab = (tabId) => {
    setActiveTab(tabId);
    const btn = tabRefs.current[tabId];
    if (btn && typeof btn.scrollIntoView === 'function') {
      btn.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    }
  };

  const handleTabKeyDown = (e, index) => {
    let nextIdx = null;
    if (e.key === 'ArrowRight') nextIdx = (index + 1) % TABS.length;
    else if (e.key === 'ArrowLeft') nextIdx = (index - 1 + TABS.length) % TABS.length;
    else if (e.key === 'Home') nextIdx = 0;
    else if (e.key === 'End') nextIdx = TABS.length - 1;

    if (nextIdx !== null) {
      e.preventDefault();
      const targetTab = TABS[nextIdx];
      selectTab(targetTab.id);
      tabRefs.current[targetTab.id]?.focus();
    }
  };

  const handleGenerateRecommendations = async () => {
    setBusyAction(true);
    setError(null);
    try {
      await optimizationApi.generateRecommendations({
        includeTestFixtures: filters.includeTestFixtures !== false ? 'true' : 'false',
      });
      await optimizationApi.syncMemory({});
      onAnnounce?.('Generated evidence-backed optimization recommendations and synced learning memory');
      await loadOptimizationData();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusyAction(false);
    }
  };

  const handleRecommendationDecision = async (id, actionStatus) => {
    try {
      await optimizationApi.updateRecommendationStatus(id, actionStatus);
      onAnnounce?.(`Recommendation marked as ${actionStatus}`);
      await loadOptimizationData();
    } catch (err) {
      setError(err.message);
    }
  };

  const handleCreateExperiment = async (e) => {
    e.preventDefault();
    setBusyAction(true);
    setError(null);
    try {
      await optimizationApi.createExperiment({
        name: expForm.name.trim(),
        hypothesis: expForm.hypothesis.trim(),
        variableTested: expForm.variableTested,
        objective: expForm.objective,
        placement: expForm.placement,
        banditEnabled: expForm.banditEnabled,
        variants: [
          {
            variantId: 'var_a',
            label: expForm.variantALabel.trim(),
            hookType: expForm.variantAHook,
            creativeId: expForm.variantACreativeId || null,
            placement: expForm.placement,
          },
          {
            variantId: 'var_b',
            label: expForm.variantBLabel.trim(),
            hookType: expForm.variantBHook,
            creativeId: expForm.variantBCreativeId || null,
            placement: expForm.placement,
          },
        ],
      });
      setExpModalOpen(false);
      setExpForm((prev) => ({ ...prev, name: '', hypothesis: '' }));
      onAnnounce?.('Controlled experiment created');
      await loadOptimizationData();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusyAction(false);
    }
  };

  const handleConfirmApproval = async (e) => {
    e.preventDefault();
    if (!approveTarget) return;
    setBusyAction(true);
    setError(null);
    try {
      await optimizationApi.approveExperimentBudget(approveTarget.id, {
        approve: true,
        confirmationPhrase: confirmPhrase.trim(),
      });
      setApproveTarget(null);
      setConfirmPhrase('');
      onAnnounce?.('Explicit budget action approval recorded');
      await loadOptimizationData();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusyAction(false);
    }
  };

  const handleTriggerRecovery = async () => {
    setBusyAction(true);
    try {
      const res = await optimizationApi.triggerStalledRecovery({ autoRequeue: false });
      onAnnounce?.(`Scanned ${res.data?.scannedCount || 0} campaigns, recovered ${res.data?.recoveredCount || 0}`);
      await loadOptimizationData();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusyAction(false);
    }
  };

  return (
    <Card className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-white">
            Optimization Engine, Experiments &amp; Production Observability
          </h2>
          <p className="text-xs text-slate-400 mt-0.5">
            Statistical creative intelligence, guarded learning memory, controlled A/B tests, and system health.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="secondary"
            size="sm"
            icon={RefreshCw}
            disabled={loading || busyAction}
            onClick={loadOptimizationData}
          >
            Refresh
          </Button>
          <Button
            variant="primary"
            size="sm"
            icon={Sparkles}
            disabled={busyAction}
            onClick={handleGenerateRecommendations}
          >
            Analyze &amp; Sync Memory
          </Button>
        </div>
      </div>

      {error ? (
        <div
          role="alert"
          className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-200"
        >
          {error}
        </div>
      ) : null}

      {/* Accessible Single-Row Horizontal Tablist */}
      <div
        role="tablist"
        aria-label="Optimization studio sections"
        className="studio-tablist"
      >
        {TABS.map((tab, idx) => {
          const Icon = tab.icon;
          const selected = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              ref={(el) => {
                tabRefs.current[tab.id] = el;
              }}
              id={`opt-tab-${tab.id}`}
              type="button"
              role="tab"
              aria-selected={selected}
              tabIndex={selected ? 0 : -1}
              onClick={() => selectTab(tab.id)}
              onKeyDown={(e) => handleTabKeyDown(e, idx)}
              className="studio-tab inline-flex items-center gap-1.5"
            >
              <Icon className="w-3.5 h-3.5" aria-hidden="true" />
              <span>{tab.label}</span>
            </button>
          );
        })}
      </div>

      {/* Tab Panel 1: Performance Intelligence & Recommendations */}
      <div
        ref={(el) => {
          panelRefs.current.intelligence = el;
        }}
        role="tabpanel"
        aria-labelledby="opt-tab-intelligence"
        hidden={activeTab !== 'intelligence' ? 'until-found' : undefined}
        tabIndex={activeTab === 'intelligence' ? 0 : undefined}
      >
        <div className="space-y-4 pt-1">
          {intelligence?.causationDisclaimer ? (
            <div className="rounded-lg border border-amber-500/25 bg-amber-500/5 px-3 py-2 text-xs text-amber-200 flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-amber-400" aria-hidden="true" />
              <span>{intelligence.causationDisclaimer}</span>
            </div>
          ) : null}

          {/* Cohort Comparisons & Statistical Gating */}
          {intelligence?.cohortComparisons?.length > 0 ? (
            <div className="space-y-2">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                Normalized Cohort Significance Checks
              </h3>
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                {intelligence.cohortComparisons.map((comp) => (
                  <div
                    key={comp.cohortKey}
                    className="rounded-lg border border-slate-800 bg-slate-900/60 p-3 text-xs space-y-1.5"
                  >
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                      <span className="font-mono text-[11px] text-slate-300">{comp.cohortKey}</span>
                      <Badge
                        variant={
                          comp.status === 'statistically_distinct_association' ? 'success' : 'warning'
                        }
                      >
                        {comp.status.replace(/_/g, ' ')}
                      </Badge>
                    </div>
                    {comp.candidateLeaderTitle ? (
                      <p className="text-slate-300">
                        Leader candidate: <strong className="text-white">{comp.candidateLeaderTitle}</strong>{' '}
                        (conf: {Math.round((comp.statisticalConfidence || 0) * 100)}%, p={comp.pValue})
                      </p>
                    ) : null}
                    {comp.warning ? <p className="text-amber-300">{comp.warning}</p> : null}
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          {/* Metadata Dimension Breakdowns */}
          {intelligence?.breakdowns?.byHookType?.length > 0 ? (
            <div className="space-y-2">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                Creative Metadata Attribution (By Hook Type)
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                {intelligence.breakdowns.byHookType.map((row) => (
                  <div
                    key={row.key}
                    className="rounded-lg border border-slate-800 bg-slate-900/50 p-3 text-xs space-y-1"
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-medium text-white">{row.key}</span>
                      <Badge variant={row.reliable ? 'success' : 'neutral'}>
                        {row.reliable ? 'Sample Reliable' : 'Low Sample'}
                      </Badge>
                    </div>
                    <p className="text-slate-400">
                      Link CTR: <span className="text-slate-200 font-mono">{row.linkCtr ?? '—'}%</span> · ROAS:{' '}
                      <span className="text-slate-200 font-mono">{row.roas ?? '—'}x</span>
                    </p>
                    <p className="text-[11px] text-slate-500">
                      {row.impressions} impr. · {row.linkClicks} link clicks · {row.purchases} purchases
                    </p>
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          {/* Evidence-Backed Optimization Recommendations */}
          <div className="space-y-2">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-400">
              Evidence-Backed Optimization Recommendations ({recommendations.length})
            </h3>
            {recommendations.length === 0 ? (
              <p className="text-xs text-slate-500 py-4">
                No recommendations generated yet. Click &ldquo;Analyze &amp; Sync Memory&rdquo; after syncing Meta insights or fixtures.
              </p>
            ) : (
              <ul className="space-y-2.5">
                {recommendations.slice(0, 8).map((rec) => (
                  <li
                    key={rec.id}
                    className="rounded-lg border border-slate-800 bg-slate-900/70 p-3 text-xs flex flex-wrap items-start justify-between gap-3"
                  >
                    <div className="space-y-1 flex-1 min-w-[240px]">
                      <div className="flex items-center gap-2 flex-wrap">
                        <Badge variant={rec.impactLevel === 'high' ? 'warning' : 'neutral'}>
                          {rec.insightType}
                        </Badge>
                        <Badge variant={rec.actionStatus === 'applied' ? 'success' : 'neutral'}>
                          {rec.actionStatus}
                        </Badge>
                        <span className="text-[11px] font-mono text-slate-400">
                          Confidence {Math.round((rec.confidenceScore || 0) * 100)}%
                        </span>
                      </div>
                      <p className="text-slate-200 leading-relaxed">{rec.recommendation}</p>
                      {rec.sampleSizeWarning ? (
                        <p className="text-[11px] text-amber-300">Sample note: {rec.sampleSizeWarning}</p>
                      ) : null}
                    </div>
                    <div className="flex items-center gap-1.5">
                      {rec.actionStatus === 'pending' ? (
                        <>
                          <Button
                            variant="secondary"
                            size="sm"
                            icon={Check}
                            onClick={() => handleRecommendationDecision(rec.id, 'applied')}
                          >
                            Apply
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            icon={X}
                            onClick={() => handleRecommendationDecision(rec.id, 'dismissed')}
                          >
                            Dismiss
                          </Button>
                        </>
                      ) : null}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>

      {/* Tab Panel 2: Controlled Experiments */}
      <div
        ref={(el) => {
          panelRefs.current.experiments = el;
        }}
        role="tabpanel"
        aria-labelledby="opt-tab-experiments"
        hidden={activeTab !== 'experiments' ? 'until-found' : undefined}
        tabIndex={activeTab === 'experiments' ? 0 : undefined}
      >
        <div className="space-y-4 pt-1">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs text-slate-400">
              Isolate single creative variables, inspect statistical confidence &amp; sample warnings, and require explicit human approval before any budget shift.
            </p>
            <Button
              variant="primary"
              size="sm"
              icon={Plus}
              onClick={() => setExpModalOpen(true)}
            >
              New Experiment
            </Button>
          </div>

          {experiments.length === 0 ? (
            <p className="text-xs text-slate-500 py-6 text-center">
              No controlled experiments recorded yet. Create an A/B experiment to compare hooks, opening scenes, or placements cleanly.
            </p>
          ) : (
            <div className="space-y-3">
              {experiments.map((exp) => (
                <div
                  key={exp.id}
                  className="rounded-lg border border-slate-800 bg-slate-900/60 p-3.5 text-xs space-y-2.5"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <span className="font-semibold text-white">{exp.name}</span>
                      <p className="text-slate-400 mt-0.5">{exp.hypothesis}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant={exp.status === 'concluded' ? 'success' : 'warning'}>
                        {exp.status}
                      </Badge>
                      <Badge variant="neutral">{exp.variableTested}</Badge>
                      {exp.userApprovedBudgetAction ? (
                        <Badge variant="success">Budget Approved by User</Badge>
                      ) : (
                        <Badge variant="neutral">Approval Gated</Badge>
                      )}
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
                    {(exp.variants || []).map((v) => (
                      <div
                        key={v.variantId}
                        className={`rounded border p-2.5 ${
                          exp.winningVariantId === v.variantId
                            ? 'border-emerald-500/40 bg-emerald-500/5'
                            : 'border-slate-800 bg-slate-950/50'
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <span className="font-medium text-slate-200">{v.label}</span>
                          {exp.winningVariantId === v.variantId ? (
                            <Badge variant="success">Winner</Badge>
                          ) : null}
                        </div>
                        <p className="text-[11px] font-mono text-slate-400 mt-1">
                          CTR: {v.ctr ?? '—'}% · Impr: {v.impressions} · Clicks: {v.linkClicks} · Spend: {v.spend}
                        </p>
                        {exp.banditEligible && exp.banditAllocations?.[v.variantId] ? (
                          <p className="text-[11px] text-indigo-300 mt-1">
                            Advisory Bandit Share:{' '}
                            {Math.round(exp.banditAllocations[v.variantId].recommendedTrafficShare * 100)}%
                          </p>
                        ) : null}
                      </div>
                    ))}
                  </div>

                  <p className="text-slate-300">{exp.conclusion}</p>
                  {exp.sampleSizeWarnings?.length > 0 ? (
                    <p className="text-[11px] text-amber-300">{exp.sampleSizeWarnings.join(' · ')}</p>
                  ) : null}

                  {exp.status === 'concluded' && !exp.userApprovedBudgetAction ? (
                    <div className="pt-1">
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => {
                          setApproveTarget(exp);
                          setConfirmPhrase('');
                        }}
                      >
                        Explicitly Approve Winner Action
                      </Button>
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Tab Panel 3: Creative Learning Memory */}
      <div
        ref={(el) => {
          panelRefs.current.memory = el;
        }}
        role="tabpanel"
        aria-labelledby="opt-tab-memory"
        hidden={activeTab !== 'memory' ? 'until-found' : undefined}
        tabIndex={activeTab === 'memory' ? 0 : undefined}
      >
        <div className="space-y-4 pt-1">
          {memory?.productTruthGuardrail ? (
            <div className="rounded-lg border border-emerald-500/25 bg-emerald-500/5 px-3 py-2 text-xs text-emerald-200 flex items-start gap-2">
              <ShieldCheck className="w-4 h-4 shrink-0 mt-0.5 text-emerald-400" aria-hidden="true" />
              <span>{memory.productTruthGuardrail.policy}</span>
            </div>
          ) : null}

          <div className="flex flex-wrap items-center gap-2 text-xs">
            <select
              aria-label="Filter memory by format"
              value={memFilters.format}
              onChange={(e) => setMemFilters((p) => ({ ...p, format: e.target.value }))}
              className="rounded border border-slate-700 bg-slate-900 px-2.5 py-1.5 text-slate-200"
            >
              <option value="">All Formats</option>
              <option value="image">Image</option>
              <option value="video">Video</option>
            </select>
            <select
              aria-label="Filter memory by placement"
              value={memFilters.placement}
              onChange={(e) => setMemFilters((p) => ({ ...p, placement: e.target.value }))}
              className="rounded border border-slate-700 bg-slate-900 px-2.5 py-1.5 text-slate-200"
            >
              <option value="">All Placements</option>
              <option value="instagram_feed">Instagram Feed</option>
              <option value="instagram_reels">Instagram Reels</option>
              <option value="facebook_feed">Facebook Feed</option>
            </select>
            <select
              aria-label="Filter memory by outcome"
              value={memFilters.outcomeStatus}
              onChange={(e) => setMemFilters((p) => ({ ...p, outcomeStatus: e.target.value }))}
              className="rounded border border-slate-700 bg-slate-900 px-2.5 py-1.5 text-slate-200"
            >
              <option value="">All Outcomes</option>
              <option value="winning">Winning</option>
              <option value="underperforming">Underperforming</option>
              <option value="rejected_qa">Rejected QA</option>
            </select>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 text-xs">
            <div className="space-y-2">
              <h3 className="font-semibold text-emerald-300">
                Successful Concepts ({memory?.successfulConcepts?.length || 0})
              </h3>
              {(memory?.successfulConcepts || []).length === 0 ? (
                <p className="text-slate-500">No statistically reliable winning entries recorded yet.</p>
              ) : (
                memory.successfulConcepts.map((entry) => (
                  <div
                    key={entry.id}
                    className="rounded border border-slate-800 bg-slate-900/60 p-2.5 space-y-1"
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-medium text-white">{entry.productCategory} · {entry.hookType}</span>
                      <Badge variant="success">{entry.placement}</Badge>
                    </div>
                    <p className="text-slate-300">{(entry.keyLearnings || []).join(' ')}</p>
                  </div>
                ))
              )}
            </div>

            <div className="space-y-2">
              <h3 className="font-semibold text-rose-300">
                Underperforming &amp; QA-Rejected Patterns ({memory?.failedConcepts?.length || 0})
              </h3>
              {(memory?.failedConcepts || []).length === 0 ? (
                <p className="text-slate-500">No failed or QA-rejected patterns stored yet.</p>
              ) : (
                memory.failedConcepts.map((entry) => (
                  <div
                    key={entry.id}
                    className="rounded border border-slate-800 bg-slate-900/60 p-2.5 space-y-1"
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-medium text-white">{entry.productCategory} · {entry.hookType}</span>
                      <Badge variant="danger">{entry.outcomeStatus}</Badge>
                    </div>
                    <p className="text-slate-300">{(entry.keyLearnings || []).join(' ')}</p>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Tab Panel 4: System Observability & AI Generation Cost */}
      <div
        ref={(el) => {
          panelRefs.current.observability = el;
        }}
        role="tabpanel"
        aria-labelledby="opt-tab-observability"
        hidden={activeTab !== 'observability' ? 'until-found' : undefined}
        tabIndex={activeTab === 'observability' ? 0 : undefined}
      >
        <div className="space-y-4 pt-1 text-xs">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className="rounded-lg border border-slate-800 bg-slate-900/60 p-3">
              <p className="text-slate-400">Readiness Status</p>
              <p className="text-sm font-semibold text-white mt-1">
                {readiness?.status || 'unknown'}
              </p>
            </div>
            <div className="rounded-lg border border-slate-800 bg-slate-900/60 p-3">
              <p className="text-slate-400">HTTP Requests (Avg Latency)</p>
              <p className="text-sm font-semibold text-white mt-1 font-mono">
                {metrics?.http?.requestsTotal ?? 0} ({metrics?.http?.avgLatencyMs ?? 0}ms)
              </p>
            </div>
            <div className="rounded-lg border border-slate-800 bg-slate-900/60 p-3">
              <p className="text-slate-400">Estimated AI Spend</p>
              <p className="text-sm font-semibold text-emerald-300 mt-1 font-mono">
                ${(metrics?.campaigns?.estimatedAiCostUsd ?? 0).toFixed(4)}
              </p>
            </div>
            <div className="rounded-lg border border-slate-800 bg-slate-900/60 p-3">
              <p className="text-slate-400">Stalled Jobs Recovered</p>
              <p className="text-sm font-semibold text-white mt-1 font-mono">
                {metrics?.campaigns?.recoveredFromStall ?? 0}
              </p>
            </div>
          </div>

          <div className="flex items-center justify-between flex-wrap gap-2 rounded-lg border border-slate-800 bg-slate-900/50 p-3">
            <span className="text-slate-300">
              Non-destructive crash recovery scans stalled non-terminal campaigns while preserving existing assets.
            </span>
            <Button
              variant="secondary"
              size="sm"
              disabled={busyAction}
              onClick={handleTriggerRecovery}
            >
              Run Stall Recovery Scan
            </Button>
          </div>
        </div>
      </div>

      {/* Create Controlled Experiment Modal */}
      <ModalDialog
        open={expModalOpen}
        onClose={() => setExpModalOpen(false)}
        title="Create Controlled Creative Experiment"
        subtitle="Isolate one creative variable and track statistical significance before changing spend."
      >
        <form onSubmit={handleCreateExperiment} className="space-y-3 text-xs">
          <div>
            <label className="block text-slate-300 mb-1" htmlFor="exp-name">Experiment Name</label>
            <input
              id="exp-name"
              required
              autoFocus
              value={expForm.name}
              onChange={(e) => setExpForm((p) => ({ ...p, name: e.target.value }))}
              placeholder="e.g., 750W Mixer Hook Test"
              className="w-full rounded border border-slate-700 bg-slate-950 px-3 py-2 text-white"
            />
          </div>
          <div>
            <label className="block text-slate-300 mb-1" htmlFor="exp-hyp">Hypothesis</label>
            <input
              id="exp-hyp"
              required
              value={expForm.hypothesis}
              onChange={(e) => setExpForm((p) => ({ ...p, hypothesis: e.target.value }))}
              placeholder="Question hook improves Instagram Feed link CTR vs direct benefit hook"
              className="w-full rounded border border-slate-700 bg-slate-950 px-3 py-2 text-white"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-slate-300 mb-1" htmlFor="exp-var">Variable Tested</label>
              <select
                id="exp-var"
                value={expForm.variableTested}
                onChange={(e) => setExpForm((p) => ({ ...p, variableTested: e.target.value }))}
                className="w-full rounded border border-slate-700 bg-slate-950 px-2.5 py-2 text-white"
              >
                <option value="hook_type">Hook Type</option>
                <option value="marketing_angle">Marketing Angle</option>
                <option value="opening_scene">Opening Scene</option>
                <option value="placement">Placement</option>
                <option value="ad_copy">Ad Copy</option>
              </select>
            </div>
            <div>
              <label className="block text-slate-300 mb-1" htmlFor="exp-place">Placement</label>
              <input
                id="exp-place"
                value={expForm.placement}
                onChange={(e) => setExpForm((p) => ({ ...p, placement: e.target.value }))}
                className="w-full rounded border border-slate-700 bg-slate-950 px-3 py-2 text-white"
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-slate-300 mb-1" htmlFor="exp-vara">Variant A Label</label>
              <input
                id="exp-vara"
                required
                value={expForm.variantALabel}
                onChange={(e) => setExpForm((p) => ({ ...p, variantALabel: e.target.value }))}
                className="w-full rounded border border-slate-700 bg-slate-950 px-3 py-2 text-white"
              />
            </div>
            <div>
              <label className="block text-slate-300 mb-1" htmlFor="exp-varb">Variant B Label</label>
              <input
                id="exp-varb"
                required
                value={expForm.variantBLabel}
                onChange={(e) => setExpForm((p) => ({ ...p, variantBLabel: e.target.value }))}
                className="w-full rounded border border-slate-700 bg-slate-950 px-3 py-2 text-white"
              />
            </div>
          </div>
          {creatives.length > 0 ? (
            <div className="grid grid-cols-2 gap-3">
              <select
                aria-label="Variant A creative"
                value={expForm.variantACreativeId}
                onChange={(e) => setExpForm((p) => ({ ...p, variantACreativeId: e.target.value }))}
                className="rounded border border-slate-700 bg-slate-950 px-2 py-1.5 text-slate-200"
              >
                <option value="">Link Creative A (optional)</option>
                {creatives.slice(0, 30).map((c) => (
                  <option key={c.id} value={c.id}>{c.title}</option>
                ))}
              </select>
              <select
                aria-label="Variant B creative"
                value={expForm.variantBCreativeId}
                onChange={(e) => setExpForm((p) => ({ ...p, variantBCreativeId: e.target.value }))}
                className="rounded border border-slate-700 bg-slate-950 px-2 py-1.5 text-slate-200"
              >
                <option value="">Link Creative B (optional)</option>
                {creatives.slice(0, 30).map((c) => (
                  <option key={c.id} value={c.id}>{c.title}</option>
                ))}
              </select>
            </div>
          ) : null}
          <label className="flex items-center gap-2 text-slate-300">
            <input
              type="checkbox"
              checked={expForm.banditEnabled}
              onChange={(e) => setExpForm((p) => ({ ...p, banditEnabled: e.target.checked }))}
            />
            Compute advisory contextual bandit weights once sample minimum is met
          </label>
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="ghost" size="sm" onClick={() => setExpModalOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" size="sm" disabled={busyAction}>
              Create Experiment
            </Button>
          </div>
        </form>
      </ModalDialog>

      {/* Human-Gated Budget Approval Confirmation Modal */}
      <ModalDialog
        open={Boolean(approveTarget)}
        onClose={() => setApproveTarget(null)}
        title="Confirm Human Budget Action Authorization"
        subtitle="AdPilot never adjusts spend or launches ads automatically."
      >
        <form onSubmit={handleConfirmApproval} className="space-y-3 text-xs">
          <p className="text-slate-300">
            Type <code className="text-indigo-300">APPROVE_EXPERIMENT_BUDGET_ACTION</code> to authorize follow-up scaling for{' '}
            <strong className="text-white">{approveTarget?.name}</strong>.
          </p>
          <input
            aria-label="Confirmation phrase"
            value={confirmPhrase}
            onChange={(e) => setConfirmPhrase(e.target.value)}
            placeholder="APPROVE_EXPERIMENT_BUDGET_ACTION"
            className="w-full rounded border border-slate-700 bg-slate-950 px-3 py-2 text-white font-mono"
          />
          <div className="flex justify-end gap-2 pt-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              autoFocus
              onClick={() => setApproveTarget(null)}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              variant="primary"
              size="sm"
              disabled={busyAction || confirmPhrase.trim() !== 'APPROVE_EXPERIMENT_BUDGET_ACTION'}
            >
              Confirm Approval
            </Button>
          </div>
        </form>
      </ModalDialog>
    </Card>
  );
}
