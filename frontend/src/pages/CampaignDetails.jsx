import React, { useEffect, useState, useCallback } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import {
  Images,
  FileText,
  Users,
  LayoutGrid,
  Package,
  Trash2,
  RotateCcw,
  Activity,
  ExternalLink,
  Download,
  Pencil,
  CheckCircle2,
  AlertCircle,
} from 'lucide-react';
import { Card, CardHeader } from '../components/common/Card';
import { Button } from '../components/common/Button';
import { Badge } from '../components/common/Badge';
import { StatusBadge } from '../components/common/StatusBadge';
import { Tabs } from '../components/common/Tabs';
import { ModalDialog } from '../components/common/ModalDialog';
import { campaignApi, creativeApi } from '../services/api';
import { useStudio, usePageTitle } from '../context/StudioContext';

export function CampaignDetails() {
  const { id } = useParams();
  const navigate = useNavigate();
  usePageTitle('Campaign Details');
  const { announce } = useStudio();

  const [details, setDetails] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [activeTab, setActiveTab] = useState('creatives');
  const [approvedOnly, setApprovedOnly] = useState(false);
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const [busyAction, setBusyAction] = useState(false);

  const loadDetails = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await campaignApi.getDetails(id);
      setDetails(res.data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    loadDetails();
  }, [loadDetails]);

  const handleRegenerateCampaign = async () => {
    setBusyAction(true);
    try {
      await campaignApi.regenerate(id);
      announce('Campaign queued for regeneration');
      navigate(`/campaigns/${id}/workspace`);
    } catch (err) {
      setError(err.message);
      setBusyAction(false);
    }
  };

  const handleDeleteCampaign = async () => {
    setBusyAction(true);
    try {
      await campaignApi.remove(id);
      setConfirmDeleteOpen(false);
      announce('Campaign deleted');
      navigate('/campaigns');
    } catch (err) {
      setError(err.message);
      setBusyAction(false);
    }
  };

  if (loading) {
    return (
      <div className="space-y-4 animate-pulse">
        <div className="h-8 w-72 bg-slate-800/70 rounded" />
        <div className="h-64 bg-slate-800/50 rounded-xl" />
      </div>
    );
  }

  if (error && !details) {
    return (
      <Card>
        <div role="alert" className="py-10 text-center space-y-3">
          <AlertCircle className="w-8 h-8 text-rose-400 mx-auto" aria-hidden="true" />
          <h1 className="text-base font-semibold text-white">Campaign unavailable</h1>
          <p className="text-xs text-slate-400">{error}</p>
          <Button variant="secondary" size="sm" onClick={loadDetails}>
            Retry
          </Button>
        </div>
      </Card>
    );
  }

  const campaign = details.campaign;
  const product = details.product;
  const strategy = details.strategy;
  const creatives = details.creatives || [];
  const adCopies = details.adCopies || [];

  const displayedCreatives = approvedOnly ? creatives.filter((c) => c.approved) : creatives;
  const approvedCount = creatives.filter((c) => c.approved).length;
  const personas = strategy?.customer_personas || [];
  const angles = strategy?.marketing_angles || [];
  const placements = strategy?.placement_recommendations || [];

  const tabs = [
    {
      id: 'creatives',
      label: 'Creatives',
      icon: Images,
      count: creatives.length,
      content: (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-xs text-slate-400">
              Showing {displayedCreatives.length} of {creatives.length} generated creatives ({approvedCount}{' '}
              approved)
            </p>
            <label className="inline-flex items-center gap-2 text-xs text-slate-300 cursor-pointer">
              <input
                type="checkbox"
                checked={approvedOnly}
                onChange={(e) => setApprovedOnly(e.target.checked)}
              />
              <span>Show approved assets only</span>
            </label>
          </div>

          {displayedCreatives.length === 0 ? (
            <Card>
              <p className="text-xs text-slate-500 text-center py-8">
                No creative assets match this filter yet. Check the live Generation Workspace for progress.
              </p>
            </Card>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
              {displayedCreatives.map((cr) => {
                const mediaSrc = creativeApi.mediaSrc(cr.id, { cacheBust: cr.version || 1 });
                const dlSrc = creativeApi.mediaSrc(cr.id, { download: true, cacheBust: cr.version || 1 });
                return (
                  <Card key={cr.id} padded={false} className="overflow-hidden flex flex-col">
                    <div className="aspect-[4/3] bg-[#07090d] border-b border-slate-800/80 relative flex items-center justify-center">
                      {cr.assetType === 'video' ? (
                        <video controls preload="metadata" src={mediaSrc} className="w-full h-full object-contain bg-black" />
                      ) : (
                        <img src={mediaSrc} alt={cr.title} className="w-full h-full object-contain" />
                      )}
                      <div className="absolute top-2.5 right-2.5">
                        <StatusBadge status={cr.approvalStatus} kind="approval" size="sm" />
                      </div>
                    </div>
                    <div className="p-4 space-y-2.5 flex-1 flex flex-col justify-between">
                      <div>
                        <h3 className="text-sm font-semibold text-white truncate">{cr.title}</h3>
                        <p className="text-xs text-slate-400 mt-0.5">
                          {cr.placement} · {cr.aspectRatio} · v{cr.version || 1}
                        </p>
                        {cr.evaluation?.overall_weighted_score !== undefined && (
                          <p className="text-xs text-emerald-300 mt-1 font-mono">
                            QA Score: {Number(cr.evaluation.overall_weighted_score).toFixed(1)} / 100
                          </p>
                        )}
                      </div>
                      <div className="pt-2.5 border-t border-slate-800/80 flex items-center justify-between gap-2">
                        <Link
                          to={`/creatives/${cr.id}/edit`}
                          className="inline-flex items-center gap-1.5 text-xs font-medium text-indigo-300 hover:text-indigo-200"
                        >
                          <Pencil className="w-3.5 h-3.5" aria-hidden="true" />
                          Edit &amp; Regenerate
                        </Link>
                        <a
                          href={dlSrc}
                          download
                          className="inline-flex items-center gap-1 text-xs text-slate-400 hover:text-white"
                        >
                          <Download className="w-3.5 h-3.5" aria-hidden="true" />
                          Download
                        </a>
                      </div>
                    </div>
                  </Card>
                );
              })}
            </div>
          )}
        </div>
      ),
    },
    {
      id: 'copy',
      label: 'Ad Copy Variations',
      icon: FileText,
      count: adCopies.length,
      content: (
        <div className="space-y-4">
          {adCopies.length === 0 ? (
            <Card>
              <p className="text-xs text-slate-500 text-center py-8">
                Ad copy bundles will appear once Stage 09 copy verification finishes.
              </p>
            </Card>
          ) : (
            adCopies.map((copy) => (
              <Card key={copy.id} className="space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h3 className="text-sm font-semibold text-white">
                      {copy.creativeAngle || copy.placement || 'Ad Copy Set'}
                    </h3>
                    {copy.audienceHypothesis && (
                      <p className="text-xs text-slate-400 mt-0.5">Audience: {copy.audienceHypothesis}</p>
                    )}
                  </div>
                  {copy.callToAction && <Badge variant="purple">CTA: {copy.callToAction}</Badge>}
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
                  <div className="space-y-2">
                    <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                      Headlines
                    </div>
                    <ul className="space-y-1.5">
                      {(copy.headlines?.length ? copy.headlines : [copy.headline]).map((h, i) => (
                        <li key={i} className="p-2.5 rounded-lg bg-[#0b0e15] border border-slate-800 text-slate-100 font-medium">
                          {h}
                        </li>
                      ))}
                    </ul>
                  </div>

                  <div className="space-y-2">
                    <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                      Primary Copy Variations
                    </div>
                    <ul className="space-y-1.5">
                      {(copy.primaryTexts?.length ? copy.primaryTexts : [copy.primaryText]).map((p, i) => (
                        <li key={i} className="p-2.5 rounded-lg bg-[#0b0e15] border border-slate-800 text-slate-300 leading-relaxed">
                          {p}
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>

                {Array.isArray(copy.supportingEvidence) && copy.supportingEvidence.length > 0 && (
                  <div className="pt-2 border-t border-slate-800/80">
                    <div className="text-[11px] font-semibold uppercase tracking-wider text-emerald-400 mb-1.5 flex items-center gap-1">
                      <CheckCircle2 className="w-3.5 h-3.5" aria-hidden="true" />
                      Claim Verification Evidence
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {copy.supportingEvidence.map((ev, i) => (
                        <Badge key={i} variant="success" size="sm">
                          {ev}
                        </Badge>
                      ))}
                    </div>
                  </div>
                )}
              </Card>
            ))
          )}
        </div>
      ),
    },
    {
      id: 'audience',
      label: 'Audience & Angles',
      icon: Users,
      count: personas.length + angles.length,
      content: (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <Card className="space-y-4">
            <CardHeader
              title="Target Audience Hypotheses"
              description="Customer personas derived from verified product features."
            />
            {personas.length === 0 ? (
              <p className="text-xs text-slate-500">Strategy not yet generated for this campaign.</p>
            ) : (
              <div className="space-y-3">
                {personas.map((p, idx) => (
                  <div key={idx} className="p-3.5 rounded-lg bg-[#0b0e15] border border-slate-800 space-y-2 text-xs">
                    <div className="font-semibold text-white">{p.persona_name}</div>
                    {p.demographics && <p className="text-slate-400">{p.demographics}</p>}
                    {p.pain_points?.length > 0 && (
                      <p className="text-slate-300">
                        <strong className="text-slate-400">Pain points:</strong> {p.pain_points.join('; ')}
                      </p>
                    )}
                    {p.purchase_motivations?.length > 0 && (
                      <p className="text-slate-300">
                        <strong className="text-slate-400">Motivations:</strong>{' '}
                        {p.purchase_motivations.join('; ')}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            )}
          </Card>

          <Card className="space-y-4">
            <CardHeader
              title="Marketing Angles"
              description="Distinct strategic angles translating features into buyer hooks."
            />
            {angles.length === 0 ? (
              <p className="text-xs text-slate-500">No angles generated yet.</p>
            ) : (
              <div className="space-y-3">
                {angles.map((a, idx) => (
                  <div key={idx} className="p-3.5 rounded-lg bg-[#0b0e15] border border-slate-800 space-y-1.5 text-xs">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-semibold text-white">{a.angle_name}</span>
                      {a.target_persona && <Badge variant="neutral" size="sm">{a.target_persona}</Badge>}
                    </div>
                    <p className="text-indigo-300 font-medium">Hook: {a.core_hook}</p>
                    <p className="text-slate-400">{a.messaging_direction}</p>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>
      ),
    },
    {
      id: 'placements',
      label: 'Placement Recommendations',
      icon: LayoutGrid,
      count: placements.length || campaign.placements?.length || 0,
      content: (
        <Card>
          <CardHeader
            title="Placement Strategy"
            description="Recommended formats, aspect ratios, and platform adaptation notes."
          />
          {placements.length > 0 ? (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {placements.map((rec, i) => (
                <div key={i} className="p-4 rounded-lg bg-[#0b0e15] border border-slate-800 space-y-2 text-xs">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-semibold text-white">{rec.placement}</span>
                    <div className="flex gap-1.5">
                      <Badge variant="purple" size="sm">{rec.recommended_format}</Badge>
                      <Badge variant="neutral" size="sm">{rec.aspect_ratio}</Badge>
                    </div>
                  </div>
                  <p className="text-slate-400 leading-relaxed">{rec.rationale}</p>
                </div>
              ))}
            </div>
          ) : (
            <div className="flex flex-wrap gap-2">
              {(campaign.placements || []).map((pl) => (
                <Badge key={pl} variant="neutral" size="md">{pl}</Badge>
              ))}
            </div>
          )}
        </Card>
      ),
    },
    {
      id: 'product',
      label: 'Product Grounding',
      icon: Package,
      content: (
        <Card>
          <CardHeader
            title={product?.product_name || 'Extracted Product Snapshot'}
            description="Source truth used across strategy, blueprints, and claim checks."
          />
          {product ? (
            <div className="space-y-4 text-xs">
              {product.description && <p className="text-slate-300 leading-relaxed">{product.description}</p>}
              {product.features?.length > 0 && (
                <div>
                  <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 mb-1.5">
                    Verified Features
                  </div>
                  <ul className="list-disc pl-4 space-y-1 text-slate-300">
                    {product.features.map((f, i) => (
                      <li key={i}>{f}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          ) : (
            <p className="text-xs text-slate-500">Product extraction snapshot pending.</p>
          )}
        </Card>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-2.5">
            <h1 className="text-xl font-semibold text-white truncate">{campaign.name}</h1>
            <StatusBadge status={campaign.status} size="md" />
          </div>
          <div className="flex flex-wrap items-center gap-3 text-xs text-slate-400">
            <a
              href={campaign.productUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-indigo-400 hover:text-indigo-300 truncate max-w-md"
            >
              {campaign.productUrl}
              <ExternalLink className="w-3 h-3 shrink-0" aria-hidden="true" />
            </a>
            {campaign.executionMetadata?.totalCostUsd !== undefined && (
              <span>Cost: ${Number(campaign.executionMetadata.totalCostUsd).toFixed(4)}</span>
            )}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <Link
            to={`/campaigns/${id}/workspace`}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-[#0f131b] hover:bg-slate-800/70 border border-slate-800 text-xs font-medium text-slate-200"
          >
            <Activity className="w-3.5 h-3.5" aria-hidden="true" />
            Live Workspace
          </Link>
          <Button
            variant="secondary"
            size="sm"
            icon={RotateCcw}
            onClick={handleRegenerateCampaign}
            disabled={busyAction}
          >
            Regenerate All
          </Button>
          <Button
            variant="danger"
            size="sm"
            icon={Trash2}
            onClick={() => setConfirmDeleteOpen(true)}
            disabled={busyAction}
          >
            Delete
          </Button>
        </div>
      </div>

      <Tabs tabs={tabs} activeTab={activeTab} onChange={setActiveTab} label="Campaign detail sections" />

      <ModalDialog
        open={confirmDeleteOpen}
        onClose={() => setConfirmDeleteOpen(false)}
        title="Delete Campaign"
        subtitle="Soft-deletes this campaign record cleanly."
        footer={
          <>
            <Button variant="ghost" size="sm" onClick={() => setConfirmDeleteOpen(false)}>
              Cancel
            </Button>
            <Button variant="danger" size="sm" onClick={handleDeleteCampaign} disabled={busyAction}>
              {busyAction ? 'Deleting...' : 'Confirm Delete'}
            </Button>
          </>
        }
      >
        <p className="text-sm text-slate-300">
          Are you sure you want to delete <strong className="text-white">{campaign.name}</strong>?
        </p>
      </ModalDialog>
    </div>
  );
}

