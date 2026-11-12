import React, { useEffect, useState, useCallback, useRef } from 'react';
import { useParams, Link } from 'react-router-dom';
import {
  CheckCircle2,
  Circle,
  Loader2,
  AlertTriangle,
  RotateCcw,
  ArrowRight,
  Radio,
  Images,
} from 'lucide-react';
import { Card, CardHeader } from '../components/common/Card';
import { Button } from '../components/common/Button';
import { Badge } from '../components/common/Badge';
import { StatusBadge, isCampaignInFlight } from '../components/common/StatusBadge';
import { campaignApi, creativeApi } from '../services/api';
import { useStudio, usePageTitle } from '../context/StudioContext';

const PIPELINE_STAGES = [
  { key: 'EXTRACTING_PRODUCT', label: '1. Product Extraction', desc: 'Scraping structured schema, pricing, specs, and images' },
  { key: 'ANALYZING_PRODUCT', label: '2. Product Analysis', desc: 'Separating verified claims from uncertain fields' },
  { key: 'GENERATING_STRATEGY', label: '3. Marketing Strategy', desc: 'Synthesizing personas, pain points, and messaging angles' },
  { key: 'PLANNING_CREATIVES', label: '4. Creative Planning', desc: 'Drafting image blueprints and video storyboards' },
  { key: 'GENERATING_ASSETS', label: '5. Image & Video Generation', desc: 'Rendering multi-angle visuals and Veo scenes' },
  { key: 'EVALUATING_CREATIVES', label: '6. Creative Evaluation', desc: 'Scoring product fidelity, composition, and readability' },
  { key: 'GENERATING_COPY', label: '7. Copy Generation', desc: 'Generating claim-verified headlines, copy, and CTAs' },
  { key: 'ASSEMBLING_CAMPAIGN', label: '8. Campaign Assembly', desc: 'Packaging approved creatives and telemetry' },
  { key: 'COMPLETED', label: '9. Completed', desc: 'All campaign assets ready for studio review' },
];

const STAGE_ORDER = PIPELINE_STAGES.map((s) => s.key);

export function GenerationWorkspace() {
  const { id } = useParams();
  usePageTitle('Generation Workspace');
  const { announce } = useStudio();

  const [campaign, setCampaign] = useState(null);
  const [creatives, setCreatives] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [sseState, setSseState] = useState('connecting');
  const [eventLog, setEventLog] = useState([]);
  const [retrying, setRetrying] = useState(false);

  const pollTimerRef = useRef(null);

  const loadWorkspaceData = useCallback(async () => {
    try {
      const [statusRes, creativesRes] = await Promise.all([
        campaignApi.getStatus(id),
        campaignApi.getCreatives(id),
      ]);
      setCampaign(statusRes.data);
      setCreatives(creativesRes.data?.creatives || []);
      setError(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    setLoading(true);
    loadWorkspaceData();

    const appendLog = (msg, type = 'info') => {
      setEventLog((prev) => [
        { time: new Date().toLocaleTimeString(), message: msg, type },
        ...prev.slice(0, 29),
      ]);
    };

    const unsubscribe = campaignApi.subscribeEvents(id, {
      onOpen: () => setSseState('connected'),
      onSnapshot: (snap) => {
        setSseState('connected');
        setCampaign((prev) => ({ ...(prev || {}), ...snap }));
      },
      onStageChanged: (ev) => {
        setCampaign((prev) => ({
          ...(prev || {}),
          status: ev.toStage,
          currentStage: ev.toStage,
          progress: ev.progress ?? prev?.progress ?? 0,
        }));
        appendLog(`Transitioned: ${ev.fromStage} → ${ev.toStage}`);
      },
      onProgress: (ev) => {
        setCampaign((prev) => ({
          ...(prev || {}),
          progress: ev.progress ?? prev?.progress ?? 0,
          currentStage: ev.stage ?? prev?.currentStage,
        }));
        if (ev.videoProgress !== undefined) {
          appendLog(`Video assembly progress: ${ev.videoProgress}%`);
        }
      },
      onRetry: (ev) => {
        setCampaign((prev) => ({
          ...(prev || {}),
          retryCount: ev.retryCount ?? (prev?.retryCount || 0) + 1,
        }));
        appendLog(`Retrying stage ${ev.stage} (attempt #${ev.attempt}): ${ev.error}`, 'warning');
      },
      onCreativeGenerated: (ev) => {
        appendLog(`Generated ${ev.assetType}: ${ev.title || ev.creativeId}`);
        loadWorkspaceData();
      },
      onCompleted: () => {
        appendLog('Campaign workflow completed successfully.', 'success');
        announce('Campaign generation completed');
        loadWorkspaceData();
      },
      onFailed: (ev) => {
        appendLog(`Failed at ${ev.stage}: ${ev.error}`, 'error');
        announce(`Campaign generation failed at ${ev.stage}`);
        loadWorkspaceData();
      },
      onError: () => {
        setSseState('reconnecting');
      },
    });

    // Lightweight periodic sync while in-flight in case SSE misses an intermediate stage
    pollTimerRef.current = setInterval(() => {
      loadWorkspaceData();
    }, 8000);

    return () => {
      unsubscribe();
      if (pollTimerRef.current) clearInterval(pollTimerRef.current);
    };
  }, [id, loadWorkspaceData, announce]);

  useEffect(() => {
    if (campaign?.status && !isCampaignInFlight(campaign.status) && campaign.status !== 'INITIALIZED') {
      if (pollTimerRef.current) {
        clearInterval(pollTimerRef.current);
        pollTimerRef.current = null;
      }
    }
  }, [campaign?.status]);

  const handleRegenerateCampaign = async () => {
    setRetrying(true);
    try {
      await campaignApi.regenerate(id);
      announce('Campaign queued for full regeneration');
      await loadWorkspaceData();
    } catch (err) {
      setError(err.message);
    } finally {
      setRetrying(false);
    }
  };

  if (loading) {
    return (
      <div className="space-y-5 animate-pulse">
        <div className="h-8 w-64 bg-slate-800/70 rounded" />
        <div className="h-44 bg-slate-800/50 rounded-xl" />
      </div>
    );
  }

  if (error && !campaign) {
    return (
      <Card>
        <div role="alert" className="text-center py-10 space-y-3">
          <AlertTriangle className="w-8 h-8 text-rose-400 mx-auto" aria-hidden="true" />
          <h1 className="text-base font-semibold text-white">Unable to open Generation Workspace</h1>
          <p className="text-xs text-slate-400">{error}</p>
          <div className="flex justify-center gap-2">
            <Button variant="secondary" size="sm" onClick={loadWorkspaceData}>
              Retry
            </Button>
            <Link
              to="/campaigns"
              className="px-3 py-1.5 rounded-lg bg-slate-800 text-xs text-slate-200"
            >
              Back to Campaigns
            </Link>
          </div>
        </div>
      </Card>
    );
  }

  const currentStatus = campaign?.status || 'INITIALIZED';
  const currentIdx = STAGE_ORDER.indexOf(currentStatus);
  const failedStageKey = campaign?.errorMetadata?.failedStage || campaign?.currentStage;
  const progressPct = Math.max(0, Math.min(100, Number(campaign?.progress || 0)));

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2.5">
            <h1 className="text-xl font-semibold text-white truncate">
              {campaign?.name || 'Generation Workspace'}
            </h1>
            <StatusBadge status={currentStatus} size="md" />
            <span className="inline-flex items-center gap-1.5 text-[11px] px-2 py-0.5 rounded bg-[#0f131b] border border-slate-800 text-slate-300">
              <Radio
                className={`w-3 h-3 ${sseState === 'connected' ? 'text-emerald-400' : 'text-amber-400'}`}
                aria-hidden="true"
              />
              {sseState === 'connected' ? 'Live stream' : 'Syncing'}
            </span>
          </div>
          <p className="text-xs text-slate-400 mt-1">
            Job ID: <span className="font-mono text-slate-300">{campaign?.jobId || 'local-orchestrator'}</span>
            {' · '}Retries: <span className="font-mono text-slate-300">{campaign?.retryCount || 0}</span>
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {!isCampaignInFlight(currentStatus) && (
            <Button
              variant="secondary"
              size="sm"
              icon={RotateCcw}
              onClick={handleRegenerateCampaign}
              disabled={retrying}
            >
              {retrying ? 'Re-queueing...' : 'Re-run Pipeline'}
            </Button>
          )}
          <Link
            to={`/campaigns/${id}`}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-medium"
          >
            Campaign Details <ArrowRight className="w-3.5 h-3.5" aria-hidden="true" />
          </Link>
        </div>
      </div>

      {/* Progress Banner */}
      <Card>
        <div className="flex items-center justify-between text-xs mb-2">
          <span className="font-medium text-slate-200">
            Overall Progress ({currentStatus.replace(/_/g, ' ')})
          </span>
          <span className="font-mono text-slate-300 tabular-nums">{progressPct}%</span>
        </div>
        <progress
          value={progressPct}
          max={100}
          aria-label="Campaign pipeline completion progress"
          className="w-full h-2 rounded-full overflow-hidden [&::-webkit-progress-bar]:bg-slate-800 [&::-webkit-progress-value]:bg-indigo-500"
        />

        {currentStatus === 'FAILED' && campaign?.errorMetadata && (
          <div
            role="alert"
            className="mt-4 rounded-lg bg-rose-950/40 border border-rose-500/35 p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
          >
            <div className="space-y-1">
              <div className="flex items-center gap-2 text-xs font-semibold text-rose-200">
                <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0" aria-hidden="true" />
                <span>
                  Failed at {campaign.errorMetadata.failedStage} ({campaign.errorMetadata.errorCode})
                </span>
              </div>
              <p className="text-xs text-rose-300/90 break-words">{campaign.errorMetadata.errorMessage}</p>
            </div>
            <Button
              variant="danger"
              size="sm"
              icon={RotateCcw}
              onClick={handleRegenerateCampaign}
              disabled={retrying}
            >
              Retry Campaign
            </Button>
          </div>
        )}
      </Card>

      {/* 9-Stage Stepper + Live Stream Feed */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        <div className="lg:col-span-7">
          <Card>
            <CardHeader
              title="Execution Pipeline Stages"
              description="Step-by-step live state reported directly by the orchestrator."
            />

            <ol className="space-y-2.5">
              {PIPELINE_STAGES.map((stage, idx) => {
                const isFailed = currentStatus === 'FAILED' && failedStageKey === stage.key;
                const isCompleted =
                  currentStatus === 'COMPLETED' ||
                  (currentIdx > idx && currentStatus !== 'FAILED') ||
                  Boolean(
                    campaign?.stageHistory?.some(
                      (h) => h.stage === stage.key && h.status === 'completed'
                    )
                  );
                const isActive = currentStatus === stage.key && currentStatus !== 'COMPLETED';

                let borderStyle = 'border-slate-800/80 bg-[#0b0e15]';
                if (isFailed) borderStyle = 'border-rose-500/40 bg-rose-950/20';
                else if (isActive) borderStyle = 'border-indigo-500/40 bg-indigo-950/20';
                else if (isCompleted) borderStyle = 'border-emerald-500/25 bg-emerald-950/10';

                return (
                  <li
                    key={stage.key}
                    className={`flex items-start gap-3 p-3 rounded-lg border ${borderStyle}`}
                  >
                    <div className="mt-0.5 shrink-0">
                      {isFailed ? (
                        <AlertTriangle className="w-4 h-4 text-rose-400" aria-hidden="true" />
                      ) : isCompleted ? (
                        <CheckCircle2 className="w-4 h-4 text-emerald-400" aria-hidden="true" />
                      ) : isActive ? (
                        <Loader2 className="w-4 h-4 text-indigo-400 animate-spin" aria-hidden="true" />
                      ) : (
                        <Circle className="w-4 h-4 text-slate-600" aria-hidden="true" />
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-2">
                        <span
                          className={`text-xs font-semibold ${
                            isFailed
                              ? 'text-rose-200'
                              : isActive
                                ? 'text-indigo-200'
                                : isCompleted
                                  ? 'text-emerald-200'
                                  : 'text-slate-400'
                          }`}
                        >
                          {stage.label}
                        </span>
                        {isActive && <Badge variant="purple" size="sm">Running</Badge>}
                        {isFailed && <Badge variant="error" size="sm">Failed</Badge>}
                        {isCompleted && stage.key === 'COMPLETED' && (
                          <Badge variant="success" size="sm">Ready</Badge>
                        )}
                      </div>
                      <p className="text-[11px] text-slate-500 mt-0.5">{stage.desc}</p>
                    </div>
                  </li>
                );
              })}
            </ol>
          </Card>
        </div>

        {/* Right: Live Event Log + Streamed Creatives Preview */}
        <div className="lg:col-span-5 space-y-6">
          <Card>
            <CardHeader
              title="Live Execution Events"
              description="Real-time transitions received over Server-Sent Events"
            />
            {eventLog.length === 0 ? (
              <p className="text-xs text-slate-500 py-3">
                Listening for incoming execution transitions...
              </p>
            ) : (
              <ul className="space-y-2 max-h-60 overflow-y-auto text-xs font-mono">
                {eventLog.map((ev, i) => (
                  <li
                    key={i}
                    className={`p-2 rounded bg-[#0b0e15] border ${
                      ev.type === 'error'
                        ? 'border-rose-500/30 text-rose-300'
                        : ev.type === 'warning'
                          ? 'border-amber-500/30 text-amber-300'
                          : ev.type === 'success'
                            ? 'border-emerald-500/30 text-emerald-300'
                            : 'border-slate-800 text-slate-300'
                    }`}
                  >
                    <span className="text-slate-500 mr-2">[{ev.time}]</span>
                    <span>{ev.message}</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card>
            <CardHeader
              title={`Streamed Creatives (${creatives.length})`}
              description="Assets appear as soon as image or video pipelines store outputs."
            />
            {creatives.length === 0 ? (
              <div className="py-6 text-center text-xs text-slate-500">
                <Images className="w-6 h-6 text-slate-600 mx-auto mb-1.5" aria-hidden="true" />
                Waiting for asset generation stage...
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-3">
                {creatives.map((cr) => (
                  <Link
                    key={cr.id}
                    to={`/creatives/${cr.id}/edit`}
                    className="group rounded-lg bg-[#0b0e15] border border-slate-800 hover:border-indigo-500/40 overflow-hidden block"
                  >
                    <div className="aspect-square bg-black flex items-center justify-center">
                      {cr.assetType === 'video' ? (
                        <video
                          src={creativeApi.mediaSrc(cr.id, { cacheBust: cr.version || 1 })}
                          className="w-full h-full object-cover"
                          muted
                        />
                      ) : (
                        <img
                          src={creativeApi.mediaSrc(cr.id, { cacheBust: cr.version || 1 })}
                          alt={cr.title}
                          className="w-full h-full object-cover"
                        />
                      )}
                    </div>
                    <div className="p-2 flex items-center justify-between gap-1 text-[11px]">
                      <span className="text-slate-200 truncate">{cr.title}</span>
                      <StatusBadge status={cr.approvalStatus} kind="approval" size="sm" />
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}
